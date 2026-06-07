#!/usr/bin/env python3
"""Isolated Hyperliquid testnet signer for ClearSig-approved trade intents."""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import re
import threading
import time
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_DOWN
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

MAX_BODY_BYTES = 16_000
ORDER_PATH = "/v1/hyperliquid/testnet/orders"
ADDRESS_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
IDEMPOTENCY_RE = re.compile(r"^[a-f0-9]{64}$")


class ValidationError(ValueError):
    pass


class ExchangeError(RuntimeError):
    pass


@dataclass(frozen=True)
class ExecutorSettings:
    account_address: str
    api_wallet_private_key: str
    token: str
    host: str
    port: int
    max_notional_usd: Decimal
    max_leverage: int
    max_approval_age_ms: int

    @classmethod
    def from_env(cls) -> "ExecutorSettings":
        account_address = os.environ.get("HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS", "").strip()
        private_key = os.environ.get("HYPERLIQUID_TESTNET_API_WALLET_PRIVATE_KEY", "").strip()
        token = os.environ.get("CLEARSIG_EXECUTOR_TOKEN", "").strip()
        if not ADDRESS_RE.fullmatch(account_address):
            raise ValidationError("HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS is missing or invalid.")
        if not re.fullmatch(r"0x[a-fA-F0-9]{64}", private_key):
            raise ValidationError("HYPERLIQUID_TESTNET_API_WALLET_PRIVATE_KEY is missing or invalid.")
        if len(token) < 24:
            raise ValidationError("CLEARSIG_EXECUTOR_TOKEN must be at least 24 characters.")
        return cls(
            account_address=account_address.lower(),
            api_wallet_private_key=private_key,
            token=token,
            host=os.environ.get("CLEARSIG_EXECUTOR_HOST", "127.0.0.1").strip(),
            port=positive_int(os.environ.get("CLEARSIG_EXECUTOR_PORT", "4010"), "executor port"),
            max_notional_usd=positive_decimal(
                os.environ.get("CLEARSIG_EXECUTOR_MAX_NOTIONAL_USD", "500"),
                "executor max notional",
            ),
            max_leverage=positive_int(
                os.environ.get("CLEARSIG_EXECUTOR_MAX_LEVERAGE", "2"),
                "executor max leverage",
            ),
            max_approval_age_ms=positive_int(
                os.environ.get("CLEARSIG_EXECUTOR_MAX_APPROVAL_AGE_SECONDS", "1800"),
                "executor max approval age",
            )
            * 1000,
        )


class HyperliquidTestnetClient:
    def __init__(self, settings: ExecutorSettings):
        try:
            from eth_account import Account
            from hyperliquid.exchange import Exchange
            from hyperliquid.info import Info
            from hyperliquid.utils.constants import TESTNET_API_URL
            from hyperliquid.utils.types import Cloid
        except ImportError as exc:
            raise RuntimeError(
                "Install requirements.txt before starting the executor."
            ) from exc

        self._cloid_type = Cloid
        wallet = Account.from_key(settings.api_wallet_private_key)
        self._info = Info(TESTNET_API_URL, skip_ws=True, timeout=6)
        self._exchange = Exchange(
            wallet,
            TESTNET_API_URL,
            account_address=settings.account_address,
            timeout=6,
        )

    def submit_market_order(self, request: dict[str, Any]) -> dict[str, Any]:
        intent = request["intent"]
        coin = coin_from_market(intent["market"])
        meta, contexts = self._info.meta_and_asset_ctxs()
        universe = meta.get("universe", [])
        asset_index = next(
            (index for index, asset in enumerate(universe) if asset.get("name") == coin),
            -1,
        )
        if asset_index < 0 or asset_index >= len(contexts):
            raise ExchangeError(f"Hyperliquid testnet does not list {coin}.")

        asset = universe[asset_index]
        context = contexts[asset_index]
        mark_price = positive_decimal(context.get("markPx"), "mark price")
        venue_max_leverage = positive_int(asset.get("maxLeverage"), "venue max leverage")
        leverage = positive_int(intent["leverage"], "leverage")
        if leverage > venue_max_leverage:
            raise ExchangeError(
                f"Requested leverage {leverage}x exceeds venue maximum {venue_max_leverage}x."
            )
        size_decimals = nonnegative_int(asset.get("szDecimals"), "size decimals")
        size = rounded_size(
            positive_decimal(intent["notionalUsd"], "notional"),
            mark_price,
            size_decimals,
        )

        self._exchange.update_leverage(leverage, coin, is_cross=True)
        cloid = self._cloid_type.from_str(f"0x{request['idempotencyKey'][:32]}")
        result = self._exchange.market_open(
            coin,
            intent["side"] == "long",
            float(size),
            slippage=float(
                Decimal(request["controls"]["maxSlippageBps"]) / Decimal(10_000)
            ),
            cloid=cloid,
        )
        return artifact_from_order_result(result, intent)


class ExecutorService:
    def __init__(self, settings: ExecutorSettings, client: HyperliquidTestnetClient):
        self.settings = settings
        self.client = client
        self._cache: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def submit(self, body: Any) -> tuple[dict[str, Any], bool]:
        request = validate_executor_request(body, self.settings)
        key = request["idempotencyKey"]
        with self._lock:
            cached = self._cache.get(key)
        if cached:
            return cached, True

        artifact = self.client.submit_market_order(request)
        with self._lock:
            self._cache[key] = artifact
        return artifact, False


def validate_executor_request(body: Any, settings: ExecutorSettings) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise ValidationError("Request body must be an object.")
    if body.get("schemaVersion") != 1 or body.get("network") != "testnet":
        raise ValidationError("Unsupported executor request schema or network.")
    key = body.get("idempotencyKey")
    if not isinstance(key, str) or not IDEMPOTENCY_RE.fullmatch(key):
        raise ValidationError("Idempotency key is missing or invalid.")
    if str(body.get("accountAddress", "")).lower() != settings.account_address:
        raise ValidationError("Requested account does not match the configured account.")

    controls = body.get("controls")
    if not isinstance(controls, dict):
        raise ValidationError("Execution controls are missing.")
    slippage_bps = positive_int(controls.get("maxSlippageBps"), "max slippage")
    if slippage_bps > 50:
        raise ValidationError("Executor refuses slippage above 50 basis points.")

    intent = body.get("intent")
    if not isinstance(intent, dict):
        raise ValidationError("Trade intent is missing.")
    required_strings = ["walletName", "agentId", "proposalId", "market"]
    if any(not isinstance(intent.get(field), str) or not intent[field].strip() for field in required_strings):
        raise ValidationError("Trade intent identity or market is missing.")
    if intent.get("venue") != "hyperliquid_testnet":
        raise ValidationError("Trade intent venue must be Hyperliquid testnet.")
    if intent.get("orderType") != "market":
        raise ValidationError("The first executor version accepts market orders only.")
    if intent.get("side") not in ("long", "short"):
        raise ValidationError("Trade side must be long or short.")
    if not str(intent["market"]).upper().endswith("-PERP"):
        raise ValidationError("Trade market must use the standard *-PERP symbol.")

    notional = positive_decimal(intent.get("notionalUsd"), "notional")
    if notional > settings.max_notional_usd:
        raise ValidationError("Trade notional exceeds the executor safety cap.")
    leverage = positive_int(intent.get("leverage"), "leverage")
    if leverage > settings.max_leverage:
        raise ValidationError("Trade leverage exceeds the executor safety cap.")

    approved_at = positive_int(intent.get("approvedAt"), "approved timestamp")
    now = int(time.time() * 1000)
    if approved_at < now - settings.max_approval_age_ms:
        raise ValidationError("Trade approval is stale.")
    if approved_at > now + 120_000:
        raise ValidationError("Trade approval timestamp is too far in the future.")
    return body


def artifact_from_order_result(result: Any, intent: dict[str, Any]) -> dict[str, Any]:
    try:
        if result.get("status") != "ok":
            raise ExchangeError(str(result))
        status = result["response"]["data"]["statuses"][0]
        if "filled" in status:
            order_id = str(status["filled"]["oid"])
            exchange_status = "filled"
        elif "resting" in status:
            order_id = str(status["resting"]["oid"])
            exchange_status = "resting"
        elif "error" in status:
            raise ExchangeError(str(status["error"]))
        else:
            raise ExchangeError("Hyperliquid returned an unknown order status.")
    except (KeyError, IndexError, TypeError, AttributeError) as exc:
        raise ExchangeError("Hyperliquid returned a malformed order result.") from exc
    return {
        "exchange": "hyperliquid_testnet",
        "orderId": order_id,
        "status": exchange_status,
        "market": str(intent["market"]).upper(),
        "side": intent["side"],
        "submittedAt": int(time.time() * 1000),
    }


def rounded_size(notional: Decimal, mark_price: Decimal, decimals: int) -> Decimal:
    quantum = Decimal(1).scaleb(-decimals)
    size = (notional / mark_price).quantize(quantum, rounding=ROUND_DOWN)
    if size <= 0:
        raise ExchangeError("Trade notional is too small for the venue size precision.")
    return size


def coin_from_market(market: str) -> str:
    normalized = str(market).strip().upper()
    return normalized[:-5] if normalized.endswith("-PERP") else normalized


def positive_decimal(value: Any, label: str) -> Decimal:
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValidationError(f"{label} must be a number.") from None
    if not parsed.is_finite() or parsed <= 0:
        raise ValidationError(f"{label} must be greater than zero.")
    return parsed


def positive_int(value: Any, label: str) -> int:
    parsed = positive_decimal(value, label)
    if parsed != parsed.to_integral_value():
        raise ValidationError(f"{label} must be a whole number.")
    return int(parsed)


def nonnegative_int(value: Any, label: str) -> int:
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValidationError(f"{label} must be a number.") from None
    if not parsed.is_finite() or parsed < 0 or parsed != parsed.to_integral_value():
        raise ValidationError(f"{label} must be a non-negative whole number.")
    return int(parsed)


def make_handler(service: ExecutorService):
    class Handler(BaseHTTPRequestHandler):
        server_version = "ClearSigHyperliquidExecutor/1"

        def do_GET(self):
            if self.path != "/health":
                return self.respond(404, {"error": "Not found."})
            return self.respond(
                200,
                {
                    "ok": True,
                    "network": "testnet",
                    "accountAddress": service.settings.account_address,
                },
            )

        def do_POST(self):
            if self.path != ORDER_PATH:
                return self.respond(404, {"error": "Not found."})
            if not authorized(self.headers.get("Authorization"), service.settings.token):
                return self.respond(401, {"error": "Unauthorized."})
            try:
                body = self.read_json()
                artifact, duplicate = service.submit(body)
                return self.respond(
                    200,
                    {"ok": True, "artifact": artifact, "duplicate": duplicate},
                )
            except ValidationError as exc:
                return self.respond(400, {"error": str(exc)})
            except ExchangeError as exc:
                return self.respond(502, {"error": str(exc)})
            except Exception:
                return self.respond(500, {"error": "Executor failed."})

        def read_json(self):
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise ValidationError("Content length is invalid.") from None
            if length <= 0 or length > MAX_BODY_BYTES:
                raise ValidationError("Request body is missing or too large.")
            try:
                return json.loads(self.rfile.read(length))
            except json.JSONDecodeError:
                raise ValidationError("Request body must be JSON.") from None

        def respond(self, status: int, body: dict[str, Any]):
            encoded = json.dumps(body, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, format: str, *args):
            print(f"[executor] {self.address_string()} {format % args}")

    return Handler


def authorized(header: str | None, token: str) -> bool:
    if not header or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[7:], token)


def main():
    load_local_env()
    settings = ExecutorSettings.from_env()
    service = ExecutorService(settings, HyperliquidTestnetClient(settings))
    server = ThreadingHTTPServer((settings.host, settings.port), make_handler(service))
    fingerprint = hashlib.sha256(settings.account_address.encode()).hexdigest()[:12]
    print(
        f"ClearSig Hyperliquid testnet executor listening on "
        f"http://{settings.host}:{settings.port} account={fingerprint}"
    )
    server.serve_forever()


def load_local_env():
    try:
        from dotenv import load_dotenv
    except ImportError as exc:
        raise RuntimeError(
            "Install requirements.txt before starting the executor."
        ) from exc
    load_dotenv(Path(__file__).with_name(".env"))


if __name__ == "__main__":
    main()
