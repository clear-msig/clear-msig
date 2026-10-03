import type { Connection, SignatureStatus } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { checkSecureReceipts } from "../receiptReconciliation";
import type { SecureReceipt } from "../transactionOperation";
const receipt = (signature: string): SecureReceipt => ({signature,genesis:"chain",signer:"wallet",action:"step",operation:"operation",status:"unknown",complete:false});
function delayed() {
  let records = [receipt("first")];
  let resolve!: (result: {value: (SignatureStatus | null)[]}) => void;
  const getSignatureStatuses = vi.fn(() => new Promise<{value: (SignatureStatus | null)[]}>(done => {resolve=done;}));
  const connection = {getGenesisHash:async()=>"chain",getSignatureStatuses} as unknown as Connection;
  const store = {read:()=>records,write:(next:SecureReceipt[])=>{records=next;}};
  return {store,connection,getSignatureStatuses,respond:(status:SignatureStatus|null)=>resolve({value:[status]})};
}
const confirmed: SignatureStatus = {slot:1,confirmations:1,err:null,confirmationStatus:"confirmed"};
describe("delayed Secure status reconciliation",()=>{
  it("preserves a later step added during status lookup",async()=>{
    const f=delayed();const pending=checkSecureReceipts(f.connection,"wallet",f.store,()=>{});
    await vi.waitFor(()=>expect(f.getSignatureStatuses).toHaveBeenCalledOnce());
    f.store.write([...f.store.read(),receipt("later-step")]);f.respond(confirmed);await pending;
    expect(f.store.read()).toEqual([{...receipt("first"),status:"confirmed"},receipt("later-step")]);
  });
  it.each([null,{...confirmed,err:{InstructionError:[0,"InvalidArgument"]}}] as const)("does not overwrite a newer confirmed result with stale response %j",async status=>{
    const f=delayed();const pending=checkSecureReceipts(f.connection,"wallet",f.store,()=>{});
    await vi.waitFor(()=>expect(f.getSignatureStatuses).toHaveBeenCalledOnce());
    const updated={...receipt("first"),action:"newer metadata",status:"confirmed" as const,complete:true};
    f.store.write([updated,receipt("later-step")]);f.respond(status as SignatureStatus|null);await pending;
    expect(f.store.read()).toEqual([updated,receipt("later-step")]);
  });
  it("retains a newer failed outcome instead of overwriting it with confirmation",async()=>{
    const f=delayed();const pending=checkSecureReceipts(f.connection,"wallet",f.store,()=>{});
    await vi.waitFor(()=>expect(f.getSignatureStatuses).toHaveBeenCalledOnce());
    const updated={...receipt("first"),status:"failed" as const};f.store.write([updated]);f.respond(confirmed);await pending;expect(f.store.read()).toEqual([updated]);
  });
  it("does not resurrect a removed receipt",async()=>{
    const f=delayed();const pending=checkSecureReceipts(f.connection,"wallet",f.store,()=>{});
    await vi.waitFor(()=>expect(f.getSignatureStatuses).toHaveBeenCalledOnce());
    f.store.write([receipt("later-step")]);f.respond(confirmed);await pending;expect(f.store.read()).toEqual([receipt("later-step")]);
  });
  it("does not apply an old lookup to a replacement operation",async()=>{
    const f=delayed();const pending=checkSecureReceipts(f.connection,"wallet",f.store,()=>{});
    await vi.waitFor(()=>expect(f.getSignatureStatuses).toHaveBeenCalledOnce());
    const replacement={...receipt("first"),operation:"replacement"};f.store.write([replacement]);f.respond(confirmed);await pending;expect(f.store.read()).toEqual([replacement]);
  });
});
