# Core Use Case

`clear-msig-ika` is a **clear-sign multisig platform** that lets teams control treasury and operational actions with transparent approvals.

Instead of signing opaque transactions, users approve **human-readable messages** tied to predefined intents (for example: transfer SOL, approve ERC-20 transfer, sign Bitcoin spend).

## Why this matters

- **Security:** no blind signing; every signer sees exactly what they approve.
- **Governance:** threshold and timelock rules enforce team consensus.
- **Cross-chain control:** Solana-native multisig policy can trigger signatures for EVM/BTC flows via Ika dWallet.
- **Auditability:** proposal lifecycle (create, approve/cancel, execute, cleanup) is traceable on-chain.

## How a user uses it

1. Connect wallet.
2. Create a multisig wallet (proposers, approvers, thresholds, timelock).
3. Add intent templates that define allowed actions.
4. Create proposal from an intent with real parameters.
5. Approvers review and approve.
6. Execute when policy conditions are met:
   - local Solana execution, or
   - remote-chain signing path (Ika) with optional broadcast.

In short: this project gives teams a practical way to run treasury and cross-chain operations with strong governance, clear signer UX, and on-chain accountability.

https://solana-pre-alpha.ika.xyz/







cd /home/spectre/Documents/clear-msig/clear-msig-ika

python3 - <<'PY'
import getpass, json, pathlib
ALPH="2YHS16EL4SsPKuFWtzQ8GqZkKUdfmvDhynCLgDWpRjf4jtd5sa2NnY3z9BMX7Cf6P5uc3fBvuDmFVUj4g5zW5dxE"
def b58decode(s):
    n=0
    for c in s:
        n=n*58+ALPH.index(c)
    out=bytearray()
    while n>0:
        n,r=divmod(n,256); out.append(r)
    out=bytes(reversed(out))
    pad=0
    for ch in s:
        if ch=='1': pad+=1
        else: break
    return b'\x00'*pad + out

k=getpass.getpass("Paste base58 private key (hidden): ").strip()
raw=b58decode(k)
if len(raw) != 64:
    raise SystemExit(f"Expected 64 bytes, got {len(raw)}")
p=pathlib.Path("backend-api/keys/signer-funded.json")
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text(json.dumps(list(raw)))
print(f"Wrote {p}")
PY

solana-keygen pubkey backend-api/keys/signer-funded.json