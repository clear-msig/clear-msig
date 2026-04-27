// Solana offchain-message header.
//
// Format (20 bytes total, then message body):
//   [0..16]  `\xffsolana offchain`
//   [16]     version = 0
//   [17]     format  = 0 (restricted ASCII)
//   [18..20] body-length u16 LE
//
// Mirror of programs/clear-wallet/src/utils/message.rs::{OFFCHAIN_SIGNING_DOMAIN,
// OFFCHAIN_HEADER_LEN, finalize}. The on-chain `brine_ed25519::sig_verify`
// call hashes the entire wrapped buffer, so every byte here must match
// what the program writes . any drift (endianness, format flag, domain
// string) means signatures fail verification on chain.

/// `\xffsolana offchain` literal . the domain prefix the Solana wallet
/// adapters and the Ledger Solana app both require on offchain messages.
export const OFFCHAIN_DOMAIN = new Uint8Array([
  0xff, 0x73, 0x6f, 0x6c, 0x61, 0x6e, 0x61, 0x20,
  0x6f, 0x66, 0x66, 0x63, 0x68, 0x61, 0x69, 0x6e,
]);

export const OFFCHAIN_HEADER_LEN = 20;
export const OFFCHAIN_VERSION = 0;
export const OFFCHAIN_FORMAT_RESTRICTED_ASCII = 0;

/// Maximum body length . bound by the u16 length field in the header.
export const MAX_OFFCHAIN_BODY_LEN = 0xffff;

/// Wrap a message body in the Solana offchain header. Returns a new
/// 20 + body.length byte array.
export function wrapOffchain(body: Uint8Array): Uint8Array {
  if (body.length > MAX_OFFCHAIN_BODY_LEN) {
    throw new Error(
      `wrapOffchain: body too large (${body.length} bytes, max ${MAX_OFFCHAIN_BODY_LEN})`
    );
  }
  const out = new Uint8Array(OFFCHAIN_HEADER_LEN + body.length);
  out.set(OFFCHAIN_DOMAIN, 0);
  out[16] = OFFCHAIN_VERSION;
  out[17] = OFFCHAIN_FORMAT_RESTRICTED_ASCII;
  // u16 little-endian length.
  out[18] = body.length & 0xff;
  out[19] = (body.length >> 8) & 0xff;
  out.set(body, OFFCHAIN_HEADER_LEN);
  return out;
}

/// Split a wrapped offchain message back into its body. Primarily used
/// by tests + debug tooling; production code treats the wrapped buffer
/// as opaque bytes for signing.
export function unwrapOffchain(wrapped: Uint8Array): Uint8Array {
  if (wrapped.length < OFFCHAIN_HEADER_LEN) {
    throw new Error(
      `unwrapOffchain: buffer too short (${wrapped.length} < ${OFFCHAIN_HEADER_LEN})`
    );
  }
  for (let i = 0; i < OFFCHAIN_DOMAIN.length; i++) {
    if (wrapped[i] !== OFFCHAIN_DOMAIN[i]) {
      throw new Error("unwrapOffchain: domain prefix mismatch");
    }
  }
  if (wrapped[16] !== OFFCHAIN_VERSION) {
    throw new Error(`unwrapOffchain: unexpected version ${wrapped[16]}`);
  }
  const bodyLen = wrapped[18] | (wrapped[19] << 8);
  if (OFFCHAIN_HEADER_LEN + bodyLen > wrapped.length) {
    throw new Error("unwrapOffchain: declared body length exceeds buffer");
  }
  return wrapped.slice(OFFCHAIN_HEADER_LEN, OFFCHAIN_HEADER_LEN + bodyLen);
}
