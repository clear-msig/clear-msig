import { Connection, PublicKey, TransactionMessage, VersionedTransaction, SystemInstruction, SystemProgram, type TransactionConfirmationStrategy, type Commitment } from "@solana/web3.js";
import bs58 from "bs58";
import { withSigningLock, trackProviderSigning } from "@/lib/clearsign/signingLock";
import { withWalletSignatureTimeout } from "@/lib/wallet/signing";
import { IKAVERY_PROGRAM_ID, CREATE_MEMBERS_BYTES, SECP256R1_PRECOMPILE_ID } from "@/lib/ikavery/constants";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ATA_PROGRAM_ID } from "./sweep/message";
import { IKA_DWALLET_PROGRAM_ID } from "@/lib/ikavery/dwallet/constants";

export type SecureReceipt = { signature: string; genesis: string; signer: string; action: string; operation: string; status: "unknown" | "confirmed" | "failed"; complete: boolean };
export interface ReceiptStore { read(): SecureReceipt[]; write(receipts: SecureReceipt[]): void }
export class SecureOperationError extends Error {}
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

/** Exact message bytes are bound separately from the human-readable instruction inventory. */
export function secureTransactionReview(tx: VersionedTransaction, action: string): string {
  if (tx.message.addressTableLookups.length) throw new Error("Secure review does not support address lookup tables.");
  const message = TransactionMessage.decompile(tx.message);
  const lines = [action, `Fee payer: ${message.payerKey.toBase58()}`, `Blockhash: ${message.recentBlockhash}`, "Network fees and account rent may apply."];
  const names = ["Create vault", "Propose sweep", "Approve sweep", "Authorize sweep execution", "Propose roster change", "Approve roster change", "Execute roster change", "Propose enrollment", "Approve enrollment", "Execute enrollment", "Stage roster change"];
  message.instructions.forEach((ix, index) => {
    let label = "Instruction (inspect exact program, accounts and bytes)";
    const data = ix.data;
    if (ix.programId.equals(SystemProgram.programId)) {
      if (SystemInstruction.decodeInstructionType(ix) === "Transfer") {
        const transfer = SystemInstruction.decodeTransfer(ix);
        label = `Transfer ${transfer.lamports.toString()} lamports from ${transfer.fromPubkey.toBase58()} to ${transfer.toPubkey.toBase58()}`;
      }
    } else if (ix.programId.equals(IKAVERY_PROGRAM_ID)) {
      label = names[data[0]] ?? "Unknown Secure instruction";
      if (data[0] === 0 && data.length === 40 + CREATE_MEMBERS_BYTES) {
        label += `; threshold ${data.readUInt16LE(35)} of ${data[37]} members; dWallet ${new PublicKey(data.subarray(1,33)).toBase58()}`;
      }
      if (data[0] === 10 && data.length === 2 * CREATE_MEMBERS_BYTES + 12) {
        label += `; additions ${data[5 + CREATE_MEMBERS_BYTES]}; removals ${data[8 + 2 * CREATE_MEMBERS_BYTES]}; new threshold ${data.readUInt16LE(9 + 2 * CREATE_MEMBERS_BYTES)}`;
      }
      if (data[0] === 7 && data.length >= 72) label += `; new credential ${hex(data.subarray(5,39))}; approver-only ${data[71] === 1}`;
    } else if (ix.programId.equals(IKA_DWALLET_PROGRAM_ID) && data[0] === 24 && data.length === 33) {
      label = `Transfer dWallet authority to ${new PublicKey(data.subarray(1)).toBase58()} (only that authority can move it again)`;
    }
    if (ix.programId.equals(TOKEN_PROGRAM_ID) || ix.programId.equals(TOKEN_2022_PROGRAM_ID)) {
      if (data[0] === 12 && data.length === 10) label = `Transfer token amount ${data.readBigUInt64LE(1)} base units; decimals ${data[9]}; source ${ix.keys[0]?.pubkey.toBase58()}; mint ${ix.keys[1]?.pubkey.toBase58()}; destination ${ix.keys[2]?.pubkey.toBase58()}`;
      else if (data[0] === 9) label = "Close token account; remaining rent goes to the destination account below";
    } else if (ix.programId.equals(ATA_PROGRAM_ID) && data[0] === 1) label = "Create associated token account if missing (payer pays rent)";
    else if (ix.programId.equals(SECP256R1_PRECOMPILE_ID)) label = "Verify passkey credential signature";
    lines.push(`\n${index + 1}. ${label}`, `Program: ${ix.programId.toBase58()}`);
    ix.keys.forEach(key => lines.push(`${key.pubkey.toBase58()} · ${key.isSigner ? "signer" : "not signer"} · ${key.isWritable ? "writable" : "read-only"}`));
    lines.push(`Instruction bytes: ${hex(data)}`);
  });
  lines.push(`\nExact transaction message: ${hex(tx.message.serialize())}`);
  return lines.join("\n");
}

async function verifySignatures(tx: VersionedTransaction) {
  const { default: nacl } = await import("tweetnacl");
  const bytes = tx.message.serialize();
  for (let i = 0; i < tx.message.header.numRequiredSignatures; i++) {
    if (!nacl.sign.detached.verify(bytes, tx.signatures[i], tx.message.staticAccountKeys[i].toBytes()))
      throw new SecureOperationError("Secure transaction signature is invalid. Nothing was submitted by this step.");
  }
}

export function createSecureOperation(options: {
  connection: Connection; signer: PublicKey; action: string; assertCurrent: () => void;
  signTransaction: <T extends VersionedTransaction>(tx: T) => Promise<T>;
  review: (document: string, assertCurrent: () => void) => Promise<void>;
  store: ReceiptStore;
  operationId: string;
}) {
  const { connection, assertCurrent, store } = options;
  const allowed = new Set<string>();
  let genesisBinding: string | undefined;
  const readGenesis = async () => {
    const genesis = await connection.getGenesisHash();
    assertCurrent();
    if (genesisBinding !== undefined && genesisBinding !== genesis) throw new SecureOperationError("RPC network changed during Secure operation.");
    genesisBinding = genesis;
    return genesis;
  };
  const checkBlockhash = async (tx: VersionedTransaction) => {
    const valid = await connection.isBlockhashValid(tx.message.recentBlockhash, {commitment: "confirmed"});
    assertCurrent();
    if (valid.value !== true) throw new SecureOperationError("Transaction blockhash expired or could not be verified. Prepare a fresh review before signing or submitting.");
  };
  const update = (signature: string, changes: Partial<SecureReceipt>) => store.write(store.read().map(r => r.signature === signature ? {...r, ...changes} : r));
  const signTransaction = <T extends VersionedTransaction>(tx: T): Promise<T> => withSigningLock(async () => {
    assertCurrent();
    if (!tx.message.staticAccountKeys[0]?.equals(options.signer)) throw new SecureOperationError("Secure fee payer does not match the connected wallet.");
    const genesis = await readGenesis();
    const message = hex(tx.message.serialize());
    await options.review(secureTransactionReview(tx, `${options.action}\nNetwork genesis: ${genesis}`), assertCurrent);
    assertCurrent();
    if (hex(tx.message.serialize()) !== message) throw new SecureOperationError("Transaction changed after review.");
    await checkBlockhash(tx);
    const signed = await withWalletSignatureTimeout(trackProviderSigning(options.signTransaction(tx)));
    assertCurrent();
    if (hex(signed.message.serialize()) !== message) throw new SecureOperationError("Wallet changed the reviewed transaction. Nothing was submitted by this step.");
    await verifySignatures(signed);
    assertCurrent();
    allowed.add(hex(signed.serialize()));
    return signed;
  });
  const scopedConnection = new Proxy(connection, {
    get(target, property) {
      if (property === "sendRawTransaction") return async (wire: Uint8Array, sendOptions: Parameters<Connection["sendRawTransaction"]>[1]) => {
        assertCurrent();
        const bytes = Uint8Array.from(wire);
        const tx = VersionedTransaction.deserialize(bytes);
        const genesis = await readGenesis();
        await verifySignatures(tx);
        assertCurrent();
        // The final network-signed sweep does not pass through the browser wallet.
        if (!allowed.has(hex(bytes))) {
          await withSigningLock(() => options.review(secureTransactionReview(tx, `${options.action}\nNetwork genesis: ${genesis}\nFinal network-signed transaction; review before broadcast.`), assertCurrent));
          assertCurrent();
        }
        await checkBlockhash(tx);
        const signature = bs58.encode(tx.signatures[0]);
        const receipts = store.read();
        if (receipts.some(r => r.signature === signature)) throw new SecureOperationError("This transaction already has a recovery record. Check its status before retrying.");
        store.write([...receipts, {signature, genesis, signer: options.signer.toBase58(), action: options.action, operation: options.operationId, status: "unknown", complete: false}]);
        assertCurrent();
        // The receipt is durable BEFORE the network call. An exception is unknown,
        // never evidence that the node rejected or failed to receive the bytes.
        const returned = await connection.sendRawTransaction(bytes, sendOptions);
        if (returned !== signature) throw new SecureOperationError("RPC returned a different transaction ID. Check the recorded transaction before continuing.");
        return signature;
      };
      if (property === "confirmTransaction") return async (strategy: TransactionConfirmationStrategy | string, commitment?: Commitment) => {
        const result = typeof strategy === "string" ? await connection.confirmTransaction(strategy, commitment) : await connection.confirmTransaction(strategy, commitment);
        const signature = typeof strategy === "string" ? strategy : strategy.signature;
        if (result?.value?.err === null) update(signature, {status: "confirmed"});
        else if (result?.value?.err !== undefined) update(signature, {status: "failed"});
        // Finish recording confirmation even after navigation, then stop the flow.
        assertCurrent();
        return result;
      };
      if (property === "sendTransaction" || property === "requestAirdrop") return () => { throw new SecureOperationError("Unsupported Secure submission path."); };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? (...args: unknown[]) => { assertCurrent(); return value.apply(target, args); } : value;
    },
  });
  return {
    connection: scopedConnection,
    signTransaction,
    assertCurrent,
    progress: <T,>(callback: (stage: T) => void) => (stage: T) => { assertCurrent(); callback(stage); },
    complete() {
      assertCurrent();
      store.write(store.read().map(r => r.operation === options.operationId ? {...r, complete: true} : r));
    },
    failure(error: unknown) {
      const receipts = store.read().filter(r => r.operation === options.operationId);
      if (receipts.length) return new SecureOperationError(`Some Secure steps may already be on chain. Check the recovery notice before retrying. Transaction IDs: ${receipts.map(r => r.signature).join(", ")}`);
      return new SecureOperationError(error instanceof Error ? error.message : String(error));
    },
  };
}
