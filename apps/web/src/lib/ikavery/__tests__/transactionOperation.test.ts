import { Connection, Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSecureOperation, secureTransactionReview, type SecureReceipt } from "../transactionOperation";
import { withSigningLock } from "@/lib/clearsign/signingLock";
const payer = Keypair.fromSeed(new Uint8Array(32).fill(4));
const destination = Keypair.fromSeed(new Uint8Array(32).fill(5)).publicKey;
function tx(amount = 1n) {
  return new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:destination.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:destination,lamports:amount})]}).compileToV0Message());
}
function fixture() {
  let current = true;
  let receipts: SecureReceipt[] = [];
  const review = vi.fn(async (_document: string, _assertCurrent: () => void) => {});
  const provider = vi.fn(async (transaction: VersionedTransaction) => {transaction.sign([payer]);return transaction;});
  const send = vi.fn(async (wire: Uint8Array) => {
    expect(receipts).toHaveLength(1);
    expect(receipts[0].status).toBe("unknown");
    return bs58.encode(VersionedTransaction.deserialize(wire).signatures[0]);
  });
  const confirm = vi.fn(async () => ({value:{err:null}}));
  const connection = {sendRawTransaction:send,confirmTransaction:confirm,getGenesisHash:vi.fn(async()=>"synthetic-genesis"),isBlockhashValid:vi.fn(async()=>({value:true}))} as unknown as Connection;
  const operation = createSecureOperation({connection, signer:payer.publicKey,action:"Synthetic sweep",operationId:"fixture",assertCurrent:()=>{if(!current)throw new Error("stale");},signTransaction:provider as <T extends VersionedTransaction>(t:T)=>Promise<T>,review,store:{read:()=>receipts,write:(r)=>{receipts=r;}}});
  return {operation,review,provider,send,confirm,connection,stale:()=>{current=false;},get receipts(){return receipts;}};
}
afterEach(()=>vi.useRealTimers());
describe("Secure reviewed signing and durable submission boundary",()=>{
  it("reviews full addresses and exact raw amounts without rounding",()=>{
    const review=secureTransactionReview(tx(9007199254740993n),"Synthetic");
    expect(review).toContain("9007199254740993 lamports"); expect(review).toContain(destination.toBase58()); expect(review).toContain("Exact transaction message:");
  });
  it("records the expected signature before sending and clears recovery only on completed flow",async()=>{
    const f=fixture();const signed=await f.operation.signTransaction(tx());const signature=await f.operation.connection.sendRawTransaction(signed.serialize());
    expect(f.review).toHaveBeenCalledOnce();expect(f.receipts[0]).toMatchObject({signature,status:"unknown",complete:false});
    await f.operation.connection.confirmTransaction(signature);expect(f.receipts[0].status).toBe("confirmed");expect(f.receipts[0].complete).toBe(false);
    f.operation.complete();expect(f.receipts[0].complete).toBe(true);
  });
  it("rejects a stale preparation before opening a wallet",async()=>{const f=fixture();f.stale();await expect(f.operation.signTransaction(tx())).rejects.toThrow("stale");expect(f.provider).not.toHaveBeenCalled();});
  it("rejects account/navigation/form changes during review",async()=>{const f=fixture();f.review.mockImplementation(async()=>f.stale());await expect(f.operation.signTransaction(tx())).rejects.toThrow("stale");expect(f.provider).not.toHaveBeenCalled();});
  it("discards a correct late signature after lifecycle invalidation",async()=>{const f=fixture();f.provider.mockImplementation(async t=>{t.sign([payer]);f.stale();return t;});await expect(f.operation.signTransaction(tx())).rejects.toThrow("stale");expect(f.send).not.toHaveBeenCalled();});
  it("rejects provider message mutation even when the new message is validly signed",async()=>{const f=fixture();f.provider.mockImplementation(async()=>{const other=tx(2n);other.sign([payer]);return other;});await expect(f.operation.signTransaction(tx())).rejects.toThrow("changed the reviewed transaction");expect(f.send).not.toHaveBeenCalled();});
  it("rejects forged signatures",async()=>{const f=fixture();f.provider.mockImplementation(async t=>{t.signatures[0].fill(1);return t;});await expect(f.operation.signTransaction(tx())).rejects.toThrow("signature is invalid");});
  it("requires review and verification for the separate network-signed sweep",async()=>{const f=fixture();const signed=tx();signed.sign([payer]);await f.operation.connection.sendRawTransaction(signed.serialize());expect(f.review).toHaveBeenCalledOnce();expect(f.review.mock.calls[0][0]).toContain("Final network-signed");});
  it("retains unknown status and exact recovery ID on RPC transport failure",async()=>{const f=fixture();f.send.mockRejectedValue(new Error("network lost"));const signed=await f.operation.signTransaction(tx());await expect(f.operation.connection.sendRawTransaction(signed.serialize())).rejects.toThrow("network lost");expect(f.receipts[0].status).toBe("unknown");expect(f.operation.failure(new Error("network lost")).message).toContain(f.receipts[0].signature);});
  it("records confirmation despite unmount, then prevents further continuation",async()=>{const f=fixture();const signed=await f.operation.signTransaction(tx());const sig=await f.operation.connection.sendRawTransaction(signed.serialize());f.stale();await expect(f.operation.connection.confirmTransaction(sig)).rejects.toThrow("stale");expect(f.receipts[0]).toMatchObject({status:"confirmed",complete:false});});
  it("prevents resubmission of the same wire bytes",async()=>{const f=fixture();const signed=await f.operation.signTransaction(tx());await f.operation.connection.sendRawTransaction(signed.serialize());await expect(f.operation.connection.sendRawTransaction(signed.serialize())).rejects.toThrow("recovery record");expect(f.send).toHaveBeenCalledOnce();});
  it("blocks stale final broadcast before network activity",async()=>{const f=fixture();const signed=tx();signed.sign([payer]);f.stale();await expect(f.operation.connection.sendRawTransaction(signed.serialize())).rejects.toThrow("stale");expect(f.send).not.toHaveBeenCalled();});
  it("shares exclusion with message signing through timeout and late resolution",async()=>{
    vi.useFakeTimers();const f=fixture();let finish!:(t:VersionedTransaction)=>void;f.provider.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=f.operation.signTransaction(tx());const rejected=expect(pending).rejects.toThrow("Wallet did not respond");
    await vi.advanceTimersByTimeAsync(60000);await rejected;
    await expect(withSigningLock(async()=>1)).rejects.toThrow("current signing request");
    const signed=tx();signed.sign([payer]);finish(signed);await vi.advanceTimersByTimeAsync(1);
    await expect(withSigningLock(async()=>1)).resolves.toBe(1);expect(f.send).not.toHaveBeenCalled();
  });
});

it("rejects an expired reviewed transaction before wallet handoff",async()=>{const f=fixture();vi.mocked(f.connection.isBlockhashValid).mockResolvedValue({context:{slot:1},value:false});await expect(f.operation.signTransaction(tx())).rejects.toThrow("blockhash expired");expect(f.provider).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();});
