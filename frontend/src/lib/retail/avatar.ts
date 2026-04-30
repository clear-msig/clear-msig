// Avatar helpers — deterministic visuals from a Solana address.
//
// Until a real contacts/identity layer exists, members show up as
// colored circles with two-letter initials. The color and initials
// are derived from the address hash so the same wallet always renders
// the same avatar — visual continuity even when names aren't known.
//
// Palette is curated to harmonize with the accent green brand and to
// keep enough variation that two members rarely collide visually
// inside a small wallet.

const PALETTE: ReadonlyArray<readonly [string, string]> = [
  ["from-rose-300", "to-orange-300"],
  ["from-amber-300", "to-yellow-300"],
  ["from-emerald-300", "to-teal-400"],
  ["from-sky-300", "to-blue-400"],
  ["from-violet-300", "to-purple-400"],
  ["from-lime-300", "to-green-400"],
  ["from-fuchsia-300", "to-pink-400"],
  ["from-cyan-300", "to-indigo-400"],
];

/// Stable 32-bit-ish hash so the avatar is the same on every load.
/// Not crypto-grade — just enough for picking a palette index.
function hash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/// Two-character avatar label. Prefers letters from the address so
/// the initials read as a name-ish pair rather than a base58 prefix.
export function avatarInitials(address: string): string {
  if (!address) return "??";
  const letters = address.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 2) {
    return (letters[0] + letters[letters.length - 1]).toUpperCase();
  }
  // Address has fewer than 2 letters (rare — base58 always has some,
  // but be defensive). Fall back to the first two characters as-is.
  return address.slice(0, 2).toUpperCase();
}

/// Returns the Tailwind classes for a deterministic gradient. Caller
/// composes with `bg-gradient-to-br ${from} ${to}`.
export function avatarGradient(address: string): {
  from: string;
  to: string;
} {
  const idx = hash(address) % PALETTE.length;
  const [from, to] = PALETTE[idx];
  return { from, to };
}
