import { requestRecovery } from "@/lib/clearsign/requestRecovery";
import { PublicKey, type Connection, type AccountInfo } from "@solana/web3.js";
import { CLEAR_WALLET_PROGRAM_ID } from "./client";
import { findIntentAddress, findWalletAddress } from "@/lib/msig/pda";
import {
  parseIntent,
  parseWallet,
  type IntentAccount,
} from "@/lib/msig/accounts";
import { IntentType } from "@/lib/msig/message";
export const LEGACY_SETUP_UNAVAILABLE =
  "Setup requiring a separate approval is unavailable: a canonical install-intent approval is not implemented yet. No setup proposal was created. Existing configured chains remain usable.";
export function assertAutomaticLegacySetup(
  account: IntentAccount | null | undefined,
  signer: string,
): void {
  if (
    !account ||
    !account.approved ||
    account.intentType !== IntentType.AddIntent ||
    account.approvalThreshold !== 1 ||
    !account.proposers.includes(signer) ||
    !account.approvers.includes(signer)
  )
    throw new Error(LEGACY_SETUP_UNAVAILABLE);
}
export function assertNewWalletSetupSupported(
  proposers: readonly string[],
  approvers: readonly string[],
  threshold: number,
  signer: string,
): void {
  if (
    threshold !== 1 ||
    !proposers.includes(signer) ||
    !approvers.includes(signer)
  )
    throw new Error(LEGACY_SETUP_UNAVAILABLE);
}
export async function assertLegacySetupNetwork(
  connection: Connection,
  expectedGenesis?: string,
): Promise<void> {
  const expected =
    expectedGenesis ??
    process.env.NEXT_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH?.trim();
  if (!expected)
    throw new Error(
      "Setup requires the configured Solana genesis identity. Nothing was created.",
    );
  if ((await connection.getGenesisHash()) !== expected)
    throw new Error(
      "RPC network differs from the configured setup network. Nothing was created.",
    );
}
export async function readAutomaticLegacySetup(input: {
  connection: Connection;
  walletName: string;
  walletAddress: PublicKey | undefined;
  signer: PublicKey;
  expectedGenesis?: string;
  waitForFinalization?: boolean;
  assertCurrent?: () => void;
}) {
  if (!input.walletAddress)
    throw new Error(
      "Setup authority is still loading. No setup proposal was created.",
    );
  await assertLegacySetupNetwork(input.connection, input.expectedGenesis);
  const [intentAddress, intentBump] = findIntentAddress(
    input.walletAddress,
    0,
    CLEAR_WALLET_PROGRAM_ID,
  );
  let snapshot = await input.connection.getMultipleAccountsInfoAndContext(
    [input.walletAddress, intentAddress],
    { commitment: "finalized" },
  );
  if (input.waitForFinalization) {
    for (
      let attempt = 0;
      snapshot.value.some((account) => !account) && attempt < 20;
      attempt += 1
    ) {
      input.assertCurrent?.();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      input.assertCurrent?.();
      snapshot = await input.connection.getMultipleAccountsInfoAndContext(
        [input.walletAddress, intentAddress],
        { commitment: "finalized" },
      );
    }
    if (snapshot.value.some((account) => !account))
      throw new Error(
        "Wallet created; finalized setup authority is not available yet. Reopen this wallet to finish setup. Do not create another wallet.",
      );
  }
  if (snapshot.value.length !== 2)
    throw new Error("Setup authority could not be verified.");
  const owned = (info: AccountInfo<Buffer> | null, maximum: number) => {
    if (
      !info ||
      info.executable ||
      !info.owner.equals(CLEAR_WALLET_PROGRAM_ID) ||
      info.data.length > maximum
    )
      throw new Error(
        "Setup authority account ownership could not be verified.",
      );
    return new Uint8Array(info.data);
  };
  const wallet = parseWallet(owned(snapshot.value[0], 512));
  const [walletAddress, walletBump] = findWalletAddress(
    input.walletName,
    new PublicKey(wallet.creator),
    CLEAR_WALLET_PROGRAM_ID,
  );
  const intentBytes = owned(snapshot.value[1], 65536);
  const intent = parseIntent(intentBytes);
  if (
    wallet.name !== input.walletName ||
    !walletAddress.equals(input.walletAddress) ||
    wallet.bump !== walletBump ||
    intent.wallet !== input.walletAddress.toBase58() ||
    intent.intentIndex !== 0 ||
    intent.bump !== intentBump ||
    intentBytes[37] !== 1
  )
    throw new Error("Setup authority does not match the canonical wallet.");
  assertAutomaticLegacySetup(intent, input.signer.toBase58());
  return intent;
}
/** Actual producer seam: unsupported authority reaches no encryption/prepare/sign/submit work. */
export async function withAutomaticLegacySetup<T>(
  input: Parameters<typeof readAutomaticLegacySetup>[0] & {
    accountKey: string;
    template: string;
  },
  create: (
    authority: IntentAccount,
    recovery: ReturnType<typeof requestRecovery.begin>,
  ) => Promise<T>,
): Promise<T> {
  const authority = await readAutomaticLegacySetup(input);
  const recovery = requestRecovery.begin({
    walletName: input.walletName,
    endpoint: input.connection.rpcEndpoint,
    accountKey: input.accountKey,
    label: "Chain setup",
    identity: ["legacy-setup", input.walletAddress!.toBase58(), input.template],
  });
  try {
    input.assertCurrent?.();
    return await create(authority, {
      ...recovery,
      submitting: (proposal) => {
        input.assertCurrent?.();
        recovery.submitting(proposal);
      },
      accepted: (proposal, txid) => {
        recovery.accepted(proposal, txid);
        input.assertCurrent?.();
      },
    });
  } finally {
    recovery.finish();
  }
}
