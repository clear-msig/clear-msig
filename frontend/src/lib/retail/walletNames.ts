// Wallet name suffix — disambiguates names per creator without
// requiring an on-chain program change.
//
// The on-chain program derives wallet PDAs from sha256(name) only,
// so two users on devnet can't both have a "Team" wallet. The proper
// fix is creator-scoped seeds in the program (slated for Plan B).
// Until then we suffix the user-typed name with a 6-char base58
// fragment of the creator's pubkey before storing it on chain. The
// PDA is unique per (name, creator); the user never sees the suffix.
//
// Layout of an on-chain name:   <typed>#<pubkey-prefix>
//                e.g.            "Team#9Da5az"
//
// Display layer: anywhere we show a wallet name from chain, run it
// through toDisplay() to strip the suffix. Direct entries (older
// wallets created before this change) flow through unchanged because
// the regex only matches our suffix shape.

const SEPARATOR = "#";
const SUFFIX_LEN = 6;

/// Turn a user-typed name + creator pubkey into the unique on-chain
/// name. Idempotent: passing an already-suffixed name through again
/// is a no-op (the suffix is detected and reused).
export function toOnChainName(typed: string, creatorBase58: string): string {
  const cleaned = typed.trim();
  if (!cleaned) return cleaned;
  if (hasSuffix(cleaned)) return cleaned;
  const suffix = creatorBase58.slice(0, SUFFIX_LEN);
  return `${cleaned}${SEPARATOR}${suffix}`;
}

/// Turn a possibly-suffixed on-chain name into the display name.
/// The suffix is the trailing `#XXXXXX` (6 base58 chars). Names
/// without that exact shape pass through unchanged.
export function toDisplayName(onChain: string): string {
  if (!onChain) return onChain;
  const cleaned = onChain.trim();
  if (!hasSuffix(cleaned)) return cleaned;
  const idx = cleaned.lastIndexOf(SEPARATOR);
  return cleaned.slice(0, idx);
}

/// Display name with the first letter capitalised. Handy in headlines
/// like "Add someone to Family" so the wallet name doesn't render as
/// a sentence ending in a person's lowercase name. We capitalise here
/// (display-only) rather than at create-time so the on-chain bytes
/// stay exactly what the user typed.
export function toHeadingName(onChain: string): string {
  const display = toDisplayName(onChain);
  if (!display) return display;
  // Use codePointAt to handle the rare emoji-led wallet name; we only
  // upper-case the first ASCII letter, so emoji and CJK pass through.
  const first = display[0];
  if (!first || !/[a-z]/.test(first)) return display;
  return first.toUpperCase() + display.slice(1);
}

/// True when the name carries our suffix shape. Used both internally
/// and by the create-wallet form to avoid double-appending when a
/// power user pastes an already-suffixed name.
export function hasSuffix(name: string): boolean {
  return new RegExp(`${SEPARATOR}[1-9A-HJ-NP-Za-km-z]{${SUFFIX_LEN}}$`).test(name);
}

/// True when `address` is the creator of the wallet, derived from
/// the on-chain name's suffix (the first 6 base58 chars of the
/// creator's pubkey are appended at create-time). Used to render a
/// "creator" badge on the member list and to gate destructive
/// actions (you can't kick the wallet's owner — they need to stay
/// in to authorise their own departure if they ever want to).
///
/// Returns false for legacy names without a suffix.
export function isCreatorAddress(onChainName: string, address: string): boolean {
  if (!onChainName || !address) return false;
  if (!hasSuffix(onChainName)) return false;
  const idx = onChainName.lastIndexOf(SEPARATOR);
  const suffix = onChainName.slice(idx + 1);
  return address.startsWith(suffix);
}
