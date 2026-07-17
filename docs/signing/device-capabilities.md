# ClearSign device capability profiles

## Implemented profiles

| Profile | Canonical label | Document limit | Behavior |
| --- | --- | ---: | --- |
| Full | `clearsig-full-v2@1` | 1792 UTF-8 bytes | Full action, policy, risk, and purpose document |
| Ledger Solana | `clearsig-ledger-solana-v2@1` | 1024 UTF-8 bytes | Compact deterministic document; optional purpose omitted |

The profile is part of canonical bytes and therefore changes the document hash
and envelope. Unknown profile codes are rejected.

## Character and length rules

- Limits are byte limits. Canonical visible fields are ASCII, so byte and
  character length cannot diverge.
- Control characters, Unicode, newlines, delimiters, and NUL bytes are rejected
  in user-controlled labels.
- Authoritative amounts, asset identities, destinations, network, proposal,
  expiry, threshold, policy commitment, and execution evidence are never
  truncated.
- Solana addresses are rendered in full base58. Remote text addresses are also
  shown in full.
- The compact renderer fails with `MessageTooLong` if mandatory fields do not
  fit. It never silently substitutes a hash-only signature.
- A caller-provided output buffer that cannot hold the chosen document fails
  with `BufferTooSmall`.
- The 1,792-byte full limit leaves deterministic headroom below Solana's 4 KB
  SBF stack ceiling while preserving all mandatory fields. Oversized reviews
  fail closed; callers must not substitute a hash-only approval.

## Current limitation

Only the Ledger Solana constrained profile is implemented because it is the
hardware path currently represented in the repository. Additional device
families require measured firmware limits and their own versioned profile;
ClearSig must not guess those limits.
