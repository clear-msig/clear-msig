# State-proof boundary

The July 14 meeting permits a proprietary state-proof system for internal
validation. No implementation matching that description was found in this
repository at commit `c31b787f`.

Existing agent settlement artifact hashes and owner-attested oracle policy
hashes are commitments, not a proprietary state-proof verifier. They must not
be described as cryptographic proof of venue or oracle truth.

## Required boundary if implemented

- Proof generation belongs in a private service or crate.
- Public code receives only a versioned verification request, public inputs,
  verifier result, and test vectors needed to validate integration.
- Authorization must fail closed on malformed, unsupported, expired, or failed
  verification.
- The frontend can display verification status but cannot produce an
  authoritative result.
- No mock verifier may be enabled in production.

Until an implementation and independent specification exist, no transaction
authorization or product claim may depend on this proof system.
