// Destination safety signals. These help a reader notice a wrong or
// look-alike address; they never block or approve anything. The full address
// is always shown separately.

export interface KnownAddress {
  name: string;
  address: string;
}

export type DestinationAssessment =
  | { kind: "saved"; name: string }
  | { kind: "lookalike"; name: string; address: string }
  | { kind: "seen-before" }
  | { kind: "first-time" };

/// Address poisoning copies the first and last characters of a trusted
/// address. Flag a different address sharing both ends with a known one.
const LOOKALIKE_ENDS = 4;

export function assessDestination(
  destination: string,
  contacts: readonly KnownAddress[],
  recentRecipients: readonly string[],
): DestinationAssessment {
  const saved = contacts.find((c) => c.address === destination);
  if (saved) return { kind: "saved", name: saved.name };
  const pool: KnownAddress[] = [
    ...contacts,
    ...recentRecipients.map((address) => ({ name: "a recent recipient", address })),
  ];
  const lookalike = pool.find(
    (k) =>
      k.address !== destination &&
      k.address.length === destination.length &&
      destination.length >= LOOKALIKE_ENDS * 2 + 4 &&
      k.address.slice(0, LOOKALIKE_ENDS) === destination.slice(0, LOOKALIKE_ENDS) &&
      k.address.slice(-LOOKALIKE_ENDS) === destination.slice(-LOOKALIKE_ENDS),
  );
  if (lookalike)
    return { kind: "lookalike", name: lookalike.name, address: lookalike.address };
  if (recentRecipients.includes(destination)) return { kind: "seen-before" };
  return { kind: "first-time" };
}

/// Groups of four, for reading and comparing. Joining the groups gives back
/// the exact input.
export function groupAddress(address: string, size = 4): string[] {
  const out: string[] = [];
  for (let i = 0; i < address.length; i += size) out.push(address.slice(i, i + size));
  return out;
}

/// Three stable hues derived from the address, as a quick visual
/// fingerprint. Not a security control: only a second cue beside the text.
export function addressFingerprint(address: string): [number, number, number] {
  let h = 2166136261;
  const hues: number[] = [];
  for (let i = 0; i < address.length; i++) {
    h ^= address.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
    if (i % Math.max(1, Math.floor(address.length / 3)) === 0 && hues.length < 3)
      hues.push(h % 360);
  }
  while (hues.length < 3) hues.push((h >>> (hues.length * 3)) % 360);
  return [hues[0], hues[1], hues[2]];
}
