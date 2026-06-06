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
openssl rand -hex 32
```

Put the same result in two private, ignored files:

- `CLEARSIG_EXECUTOR_TOKEN` in `examples/hyperliquid-testnet-executor/.env`
- `CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_TOKEN` in `frontend/.env.local`

Never put the result in an `.env.example` file.

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
openssl rand -hex 32
```

Start the helper:

```bash
.venv/bin/python server.py
```

Give ClearSig the practice account address, helper address, and same shared
password by adding these to `frontend/.env.local`:

```env
CLEARSIG_HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS=<main-practice-account-address>
CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_URL=http://127.0.0.1:4010
CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_TOKEN=<same-shared-password>
```

Restart ClearSig on port `3000`.

Check the helper’s safety rules:

```bash
python3 -m unittest test_server.py
```

Before using real money, this helper still needs lasting records, stronger
access protection, alerts, and a full safety review.
