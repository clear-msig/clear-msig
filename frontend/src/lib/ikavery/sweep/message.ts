import {
  type Connection,
  MessageV0,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
} from "@solana/web3.js";

const ZERO_BLOCKHASH = "11111111111111111111111111111111";

/** Token-kegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA - original SPL Token program. */
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
/** TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb - Token-2022 program. */
export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);
/** ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL - ATA program. */
export const ATA_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
/** SPL Token instruction discriminators consumed by the on-chain sweep parser. */
export const SPL_IX_TRANSFER_CHECKED = 12;
export const SPL_IX_CLOSE_ACCOUNT = 9;
export const ATA_IX_CREATE_IDEMPOTENT = 1;

/**
 * Build a serialized MessageV0 carrying the sweep instructions. The on-chain
 * program re-parses these bytes to compute the structural intent digest;
 * compute-budget ixs are excluded from the intent so the executor can
 * refresh them without redirecting funds.
 *
 * The blockhash is just a parser placeholder at propose time - by execute
 * time the broadcaster pulls a fresh one and rebuilds the message bytes.
 */
export interface BuildSweepMessageParams {
  /**
   * Fee payer of the sweep tx (NOT the proposer of the on-chain proposal -
   * the program never reads the fee payer at propose time, only the
   * structural intent). Typically the dWallet account itself, since that's
   * what holds the funds being swept.
   */
  feePayer: PublicKey;
  /**
   * Per-instruction sweep operations. Currently only system-transfer is
   * exposed via {@link transferSol}; the parser supports SPL transfers /
   * close-account / ATA-create-idempotent too.
   */
  instructions: import("@solana/web3.js").TransactionInstruction[];
  /**
   * Recent blockhash. Optional - defaults to the all-1s placeholder, which
   * is sufficient for propose-time intent extraction.
   */
  recentBlockhash?: string;
}

export function buildSweepMessage(
  params: BuildSweepMessageParams,
): { messageBytes: Uint8Array; messageLen: number } {
  if (params.instructions.length === 0) {
    throw new Error("buildSweepMessage: at least one instruction required");
  }

  const message = new TransactionMessage({
    payerKey: params.feePayer,
    recentBlockhash: params.recentBlockhash ?? ZERO_BLOCKHASH,
    instructions: params.instructions,
  }).compileToV0Message();

  const messageBytes = message.serialize();
  return { messageBytes, messageLen: messageBytes.length };
}

/**
 * Convenience: a single SOL transfer from `from` to `to`. The dWallet
 * account is normally both the fee payer and the source of funds, so
 * the typical caller passes `from === feePayer`.
 */
export function transferSol(
  from: PublicKey,
  to: PublicKey,
  lamports: number | bigint,
) {
  return SystemProgram.transfer({
    fromPubkey: from,
    toPubkey: to,
    lamports: typeof lamports === "bigint" ? Number(lamports) : lamports,
  });
}

export interface TransferSplCheckedParams {
  /** dWallet's ATA - source of the tokens. */
  source: PublicKey;
  /** Token mint. Echoed in the on-chain intent for replay protection. */
  mint: PublicKey;
  /** Destination ATA. */
  destination: PublicKey;
  /** Owner of the source ATA - typically the dWallet account. */
  authority: PublicKey;
  /** Amount in mint base units. */
  amount: number | bigint;
  /** Mint decimals - must match `mint`'s on-chain `decimals` field. */
  decimals: number;
  /** Token program. Defaults to the original SPL Token program. */
  programId?: PublicKey;
}

/**
 * SPL `TransferChecked` (instruction discriminator 12). The on-chain sweep
 * parser whitelists this variant for both Token and Token-2022 programs;
 * use the legacy non-checked transfer at your peril (the program rejects it).
 */
export function transferSplTokenChecked(
  params: TransferSplCheckedParams,
): TransactionInstruction {
  const programId = params.programId ?? TOKEN_PROGRAM_ID;
  const amount =
    typeof params.amount === "bigint" ? params.amount : BigInt(params.amount);
  const data = new Uint8Array(10);
  data[0] = SPL_IX_TRANSFER_CHECKED;
  const view = new DataView(data.buffer);
  view.setBigUint64(1, amount, true);
  data[9] = params.decimals & 0xff;
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.source, isSigner: false, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: params.destination, isSigner: false, isWritable: true },
      { pubkey: params.authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

export interface CreateIdempotentAtaParams {
  /** Pays for the new ATA's rent (typically the dWallet itself). */
  payer: PublicKey;
  /** ATA address - derive externally with `getAssociatedTokenAddressSync`. */
  ata: PublicKey;
  /** Wallet that will own the ATA. */
  owner: PublicKey;
  /** Mint the ATA holds. */
  mint: PublicKey;
  /** Token program backing the mint. Defaults to original SPL Token. */
  tokenProgramId?: PublicKey;
}

/**
 * Associated Token Account program - `CreateIdempotent` (disc 1). Creates the
 * destination ATA on-the-fly as part of the sweep when the recipient hasn't
 * touched the mint before; idempotent so re-broadcasting is safe.
 */
export function createIdempotentAta(
  params: CreateIdempotentAtaParams,
): TransactionInstruction {
  const tokenProgramId = params.tokenProgramId ?? TOKEN_PROGRAM_ID;
  return new TransactionInstruction({
    programId: ATA_PROGRAM_ID,
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.ata, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: false, isWritable: false },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      {
        pubkey: SystemProgram.programId,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([ATA_IX_CREATE_IDEMPOTENT]),
  });
}

export interface CloseSplAccountParams {
  /** ATA being closed. */
  account: PublicKey;
  /** Recipient of the reclaimed rent lamports. */
  destination: PublicKey;
  /** Owner of the ATA. */
  authority: PublicKey;
  /** Token program backing the ATA. Defaults to original SPL Token. */
  programId?: PublicKey;
}

/**
 * SPL Token `CloseAccount` (disc 9). Reclaims the ATA's rent into
 * `destination`. Account must be empty - the caller's responsibility.
 */
export function closeSplAccount(
  params: CloseSplAccountParams,
): TransactionInstruction {
  const programId = params.programId ?? TOKEN_PROGRAM_ID;
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.account, isSigner: false, isWritable: true },
      { pubkey: params.destination, isSigner: false, isWritable: true },
      { pubkey: params.authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([SPL_IX_CLOSE_ACCOUNT]),
  });
}

/** Re-export the v0 type for callers building messages by hand. */
export type SweepMessageV0 = MessageV0;

/**
 * Derive the Associated Token Account address for `owner` + `mint`.
 *
 * Mirrors `@solana/spl-token`'s `getAssociatedTokenAddressSync` so we
 * don't have to take the dep just for one PDA. Seeds (in order):
 *   - owner pubkey
 *   - token program id (Token or Token-2022)
 *   - mint pubkey
 * with the ATA program id as the program seed.
 */
export function deriveAta(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgramId: PublicKey = TOKEN_PROGRAM_ID,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID,
  );
  return pda;
}

/**
 * Read a SPL mint's `decimals` from chain. The on-chain TransferChecked
 * instruction rejects mismatched decimals, so the page must pass the
 * exact value — fetching here once per mint is cheap.
 */
export async function fetchMintDecimals(
  connection: Connection,
  mint: PublicKey,
): Promise<number> {
  const info = await connection.getAccountInfo(mint, "confirmed");
  if (!info) {
    throw new Error(`Mint ${mint.toBase58()} not found on chain.`);
  }
  // Mint layout: ...32 bytes mint_authority option / supply (8) +
  // decimals(1) at offset 44 for SPL Token; Token-2022 has the same
  // base layout for the first 82 bytes.
  if (info.data.length < 45) {
    throw new Error(
      `Mint ${mint.toBase58()} too small (${info.data.length} bytes); not a Mint account.`,
    );
  }
  return info.data[44]!;
}

export interface PrepareSplSweepTargetParams {
  connection: Connection;
  /** dWallet that holds the tokens (also the source ATA owner). */
  dwallet: PublicKey;
  /** Mint of the token being moved. */
  mint: PublicKey;
  /** Recipient wallet (NOT the ATA). */
  destinationOwner: PublicKey;
  /** Amount in mint base units. */
  amount: bigint;
  /** Token program backing the mint. Defaults to legacy SPL Token. */
  tokenProgramId?: PublicKey;
  /**
   * Pre-fetched decimals. If omitted we fetch from chain. Useful for
   * pages that already pulled the mint info to render a balance table.
   */
  decimals?: number;
}

/**
 * Prepare an SPL `SweepTarget` ready to feed to `runInAppSweep`.
 * Derives source + destination ATAs, fetches mint decimals if needed,
 * and probes destination ATA existence so the resulting target carries
 * an accurate `destinationAtaExists` flag (drives whether the sweep
 * emits an `AtaCreateIdempotent` ix and changes the structural digest).
 */
export async function prepareSplSweepTarget(
  params: PrepareSplSweepTargetParams,
): Promise<{
  kind: "spl";
  programId: PublicKey;
  mint: PublicKey;
  decimals: number;
  sourceAta: PublicKey;
  destinationOwner: PublicKey;
  destinationAta: PublicKey;
  destinationAtaExists: boolean;
  amount: bigint;
}> {
  const programId = params.tokenProgramId ?? TOKEN_PROGRAM_ID;
  const decimals =
    params.decimals ?? (await fetchMintDecimals(params.connection, params.mint));
  const sourceAta = deriveAta(params.dwallet, params.mint, programId);
  const destinationAta = deriveAta(
    params.destinationOwner,
    params.mint,
    programId,
  );
  const destinationInfo = await params.connection.getAccountInfo(
    destinationAta,
    "confirmed",
  );
  return {
    kind: "spl",
    programId,
    mint: params.mint,
    decimals,
    sourceAta,
    destinationOwner: params.destinationOwner,
    destinationAta,
    destinationAtaExists: destinationInfo !== null,
    amount: params.amount,
  };
}
