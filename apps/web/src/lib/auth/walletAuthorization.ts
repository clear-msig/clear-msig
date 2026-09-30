import "server-only";
import { withAgentWalletStorageScope } from "@/features/agents/server/walletScope";
import { PublicKey } from "@solana/web3.js";
import { NextResponse, type NextRequest } from "next/server";
import { authenticateNotificationRequest, NotificationAuthError } from "@/lib/notifications/dynamicAuth";
import { getConnection, CLEAR_WALLET_PROGRAM_ID, DEFAULT_COMMITMENT } from "@/lib/chain/client";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { findIntentAddress, findWalletAddress, parseIntent } from "@/lib/msig";

export interface WalletMemberAuthorization {
  identity: Awaited<ReturnType<typeof authenticateNotificationRequest>>;
  walletName: string;
  walletAddress: string;
  chainGenesisHash: string;
  memberWallets: string[];
  governanceWallets: string[];
}

const genesisByConnection = new WeakMap<ReturnType<typeof getConnection>, Promise<string>>();

/** Discover identity only through the deployment's fixed, same-chain RPC connection. */
export async function getAgentChainGenesisHash(): Promise<string> {
  const connection = getConnection();
  let pending = genesisByConnection.get(connection);
  if (!pending) {
    pending = connection.getGenesisHash().then((genesis) => {
      if (new PublicKey(genesis).toBase58() !== genesis) throw new Error("Invalid chain genesis identity.");
      return genesis;
    }).catch((error) => { genesisByConnection.delete(connection); throw error; });
    genesisByConnection.set(connection, pending);
  }
  const genesis = await pending;
  const expected = process.env.NEXT_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH?.trim();
  if (expected && genesis !== expected) {
    throw new NotificationAuthError("The RPC chain identity does not match the configured Solana network.", 503);
  }
  return genesis;
}

/** Resolve an exact, unique program-owned wallet. Names are not an authority. */
export async function resolveCanonicalAgentWallet(walletName: string) {
  if (!walletName || Buffer.byteLength(walletName, "utf8") > 256) {
    throw new NotificationAuthError("A valid wallet name is required.", 400);
  }
  const wallet = await fetchWalletByName(getConnection(), walletName);
  if (!wallet) throw new NotificationAuthError("Wallet is unavailable.", 403);
  const [expected] = findWalletAddress(walletName, new PublicKey(wallet.account.creator), CLEAR_WALLET_PROGRAM_ID);
  if (wallet.account.name !== walletName || !wallet.pda.equals(expected)) {
    throw new NotificationAuthError("Wallet identity could not be verified.", 403);
  }
  return wallet;
}

/** Fresh governance membership, not threshold authority to trade or move funds. */
export async function authenticateWalletMember(
  request: NextRequest,
  walletName: string,
): Promise<WalletMemberAuthorization> {
  if (!request.headers.get("authorization")?.startsWith("Bearer ")) {
    throw new NotificationAuthError("Sign in with Dynamic to access private agent data. A connected wallet alone is not an authenticated session.");
  }
  const identity = await authenticateNotificationRequest(request);
  if (!identity.verifiedSolanaWallets.length) {
    throw new NotificationAuthError("Sign in with a verified Solana wallet that belongs to this treasury.", 403);
  }
  const chainGenesisHash = await getAgentChainGenesisHash();
  const wallet = await resolveCanonicalAgentWallet(walletName);
  const [address] = findIntentAddress(wallet.pda, 0, CLEAR_WALLET_PROGRAM_ID);
  // No cached roster: removing a member must revoke the next private request.
  const info = await getConnection().getAccountInfo(address, DEFAULT_COMMITMENT);
  if (!info?.owner.equals(CLEAR_WALLET_PROGRAM_ID)) {
    throw new NotificationAuthError("Wallet membership could not be verified.", 403);
  }
  const intent = parseIntent(new Uint8Array(info.data));
  if (!intent.approved || intent.intentIndex !== 0 || intent.wallet !== wallet.pda.toBase58()) {
    throw new NotificationAuthError("Wallet membership could not be verified.", 403);
  }
  const members = new Set([...intent.proposers, ...intent.approvers]);
  const memberWallets = identity.verifiedSolanaWallets.filter((actor) => {
    try { return members.has(new PublicKey(actor).toBase58()); } catch { return false; }
  });
  if (!memberWallets.length) {
    throw new NotificationAuthError("Your signed-in wallet is not a current member of this treasury.", 403);
  }
  return { identity, walletName, walletAddress: wallet.pda.toBase58(), chainGenesisHash, memberWallets, governanceWallets: [...members] };
}

export function walletAuthorizationFailure(error: unknown): NextResponse {
  const known = error instanceof NotificationAuthError;
  return NextResponse.json(
    { error: known ? error.message : "Wallet authorization is temporarily unavailable. Try again after signing in." },
    { status: known ? error.status : 503, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function withWalletMember(
  request: NextRequest,
  walletName: string,
  handler: (authorization: WalletMemberAuthorization) => Promise<NextResponse>,
): Promise<NextResponse> {
  let authorization: WalletMemberAuthorization;
  try { authorization = await authenticateWalletMember(request, walletName); }
  catch (error) { return walletAuthorizationFailure(error); }
  const response = await withAgentWalletStorageScope(authorization, () => handler(authorization));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/** Public resolution does not grant private membership or trade authority. */
export async function withCanonicalAgentWallet(
  walletName: string,
  handler: (walletAddress: string) => Promise<NextResponse>,
): Promise<NextResponse> {
  let walletAddress: string;
  let chainGenesisHash: string;
  try {
    chainGenesisHash = await getAgentChainGenesisHash();
    walletAddress = (await resolveCanonicalAgentWallet(walletName)).pda.toBase58();
  }
  catch (error) { return walletAuthorizationFailure(error); }
  return withAgentWalletStorageScope({ walletName, walletAddress, chainGenesisHash }, () => handler(walletAddress));
}
