# Connect a Hyperliquid Practice Account

This helper lets ClearSig place trades in a Hyperliquid practice account.

Your automated trader never receives the wallet secret and can never send
trades by itself. ClearSig checks every idea first, and this helper checks it
again before placing the practice trade.

## The Simple Flow

1. Your trader sends an idea to ClearSig.
2. ClearSig checks the idea against your trading plan, safety rules, and current
   allowance.
3. This helper checks the approved idea one more time.
4. Hyperliquid places the practice trade.
5. ClearSig receives proof that the trade was placed.
6. A wallet-approved close uses the recorded filled size, reads realized P/L
   from Hyperliquid fills, and commits the normalized artifact to typed
   on-chain settlement.

## What Owns What

- **Your main Hyperliquid practice account** owns the practice funds, open
  trades, and profit or loss.
- **The separate API wallet** can place trades for that main account. It does
  not own the account's funds.
- **The trader** only sends ideas. It receives neither wallet secret.
- **ClearSig** decides whether an idea is allowed before asking the separate API
  wallet to place it.
- **The ClearSig wallet shown in the app** currently groups the trader, rules,
  allowance, and history. It does not currently hold the Hyperliquid funds.

The main account address and API wallet address are usually different. Put the
main account address in `HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS`. Put only the API
wallet private key in `HYPERLIQUID_TESTNET_API_WALLET_PRIVATE_KEY`.

## The Shared Password

`CLEARSIG_EXECUTOR_TOKEN` is not supplied by Hyperliquid. It is a private,
random password between ClearSig and this helper. It stops another program on
the computer from asking the helper to place a trade.

Create one:

```bash
python3 generate_token.py
```

Put the same result in two private, ignored files:

- `CLEARSIG_EXECUTOR_TOKEN` in `examples/hyperliquid-testnet-executor/.env`
- `CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_TOKEN` in `apps/web/.env.local`

Never put the result in an `.env.example` file.

## Where To Get Each Value

Use these three values for `apps/web/.env.local`:

```env
CLEARSIG_HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS=<1-main-practice-account-address>
CLEARSIG_HYPERLIQUID_TESTNET_AGENT_WALLET_ADDRESS=<2-api-wallet-public-address>
CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_URL=http://127.0.0.1:4010
CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_TOKEN=<3-shared-password-you-created>
```

Use these three values for `examples/hyperliquid-testnet-executor/.env`:

```env
HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS=<1-same-main-practice-account-address>
HYPERLIQUID_TESTNET_API_WALLET_PRIVATE_KEY=<2-separate-api-wallet-private-key>
CLEARSIG_EXECUTOR_TOKEN=<3-same-shared-password-you-created>
```

1. `HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS` /
   `CLEARSIG_HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS`
   - Get it from the main Hyperliquid practice account that owns the practice
     funds.
   - It is public. ClearSig uses it to read balance, open trades, and live
     practice P/L.
   - It should look like `0x` followed by 40 letters or numbers.

2. `HYPERLIQUID_TESTNET_API_WALLET_PRIVATE_KEY`
   - Get it from the separate API wallet approved by that main Hyperliquid
     practice account.
   - Keep it only in the helper `.env` file. Do not put it in
     `apps/web/.env.local`, browser code, chat, or GitHub.
   - If this value was ever pasted somewhere public, revoke that API wallet and
     create a fresh one.

3. `CLEARSIG_EXECUTOR_TOKEN` /
   `CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_TOKEN`
   - Create it yourself with `python3 generate_token.py`.
   - Hyperliquid does not provide this value.
   - Paste the exact same generated value into both private env files.

`CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_URL` is the helper address. For local
testing, use `http://127.0.0.1:4010`.

## Where Trades And Profit Appear

For Hyperliquid practice, the open trades and live profit or loss currently
appear in the main Hyperliquid practice account. ClearSig also reads that
account and shows the account value, withdrawable balance, open positions, and
current practice P/L in the **Start trading** control room.

Any profit stays in the main Hyperliquid account. ClearSig does not
automatically move it to a ClearSig wallet.

Built-in ClearSig practice is different: it uses pretend trades and no funds.
Its profit or loss is entered when the pretend trade is closed.

## Your Part

1. Create or sign in to a main Hyperliquid practice account.
2. Add practice funds to that main account.
3. Create and approve a separate API wallet for that main account.
4. Keep the API wallet secret only inside this helper.
5. Start the helper, then restart ClearSig on port `3000`.
6. Open Automated Trading in ClearSig and confirm that the outside practice
   account says it is connected.

ClearSig's **Start trading** screen checks these steps for you. It confirms the
account, practice funds, protected connection, first trader idea, and first
placed practice trade in order.

Never give the practice wallet secret to your trader, your browser, or any
setting whose name starts with `NEXT_PUBLIC_`. Never use your main wallet here.

## Built-In Safety

- Practice trades only.
- Small trades only, with a default maximum of `$500`.
- Low borrowing only, with a default maximum of `2x`.
- Old approvals are refused.
- Repeated requests cannot place the same trade twice.
- Closing uses the exact recorded fill size and refuses old opening artifacts
  that do not contain one.
- Venue-reported closing fills, P/L, order ids, and transaction hashes are
  normalized and hashed before threshold-approved on-chain accounting.
- The kill switch cancels outstanding orders. It does not close positions.
- The helper is available only on this computer unless you deliberately change it.

## Advanced Setup

Create the helper’s private workspace and install what it needs:

```bash
cd examples/hyperliquid-testnet-executor
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
```

Fill in the values in `.env`. The helper reads this private file automatically.
Do not put real values in `.env.example`.

Create a strong shared password with a password manager or:

```bash
python3 generate_token.py
```

Start the helper:

```bash
.venv/bin/python server.py
```

Give ClearSig the practice account address, helper address, and same shared
password by adding these to `apps/web/.env.local`:

```env
CLEARSIG_HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS=<main-practice-account-address>
CLEARSIG_HYPERLIQUID_TESTNET_AGENT_WALLET_ADDRESS=<api-wallet-public-address>
CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_URL=http://127.0.0.1:4010
CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_TOKEN=<same-shared-password>
```

Restart ClearSig on port `3000`.

Check the helper’s safety rules:

```bash
python3 -m unittest test_server.py
```

Before using real money, this helper still needs durable idempotency across
executor restarts, native venue/oracle attestation that the Solana program can
verify, stronger access protection, alerts, and a full safety review. Redis
persists the ClearSig request and artifact records, but the helper's response
cache itself is process-local.
