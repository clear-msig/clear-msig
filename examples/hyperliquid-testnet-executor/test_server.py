import time
import unittest
from decimal import Decimal

from server import (
    ExecutorSettings,
    ExchangeError,
    ValidationError,
    artifact_from_order_result,
    rounded_size,
    validate_executor_request,
)


SETTINGS = ExecutorSettings(
    account_address="0x1111111111111111111111111111111111111111",
    api_wallet_private_key="0x" + "2" * 64,
    token="a" * 32,
    host="127.0.0.1",
    port=4010,
    max_notional_usd=Decimal("500"),
    max_leverage=2,
    max_approval_age_ms=1_800_000,
)


def request():
    return {
        "schemaVersion": 1,
        "network": "testnet",
        "idempotencyKey": "a" * 64,
        "accountAddress": SETTINGS.account_address,
        "controls": {"maxSlippageBps": 50},
        "intent": {
            "walletName": "vault",
            "agentId": "agent-alpha",
            "proposalId": "proposal-1",
            "venue": "hyperliquid_testnet",
            "market": "BTC-PERP",
            "side": "long",
            "orderType": "market",
            "notionalUsd": "250",
            "leverage": 1,
            "approvedAt": int(time.time() * 1000),
        },
    }


class ExecutorTests(unittest.TestCase):
    def test_accepts_bounded_fresh_request(self):
        self.assertEqual(validate_executor_request(request(), SETTINGS)["network"], "testnet")

    def test_blocks_executor_cap_violations(self):
        body = request()
        body["intent"]["notionalUsd"] = "501"
        with self.assertRaisesRegex(ValidationError, "safety cap"):
            validate_executor_request(body, SETTINGS)

    def test_rounds_size_down_to_venue_precision(self):
        self.assertEqual(rounded_size(Decimal("250"), Decimal("67500"), 5), Decimal("0.00370"))

    def test_parses_verified_exchange_result(self):
        artifact = artifact_from_order_result(
            {
                "status": "ok",
                "response": {"data": {"statuses": [{"filled": {"oid": 123}}]}},
            },
            request()["intent"],
        )
        self.assertEqual(artifact["orderId"], "123")
        self.assertEqual(artifact["status"], "filled")

    def test_rejects_exchange_errors(self):
        with self.assertRaises(ExchangeError):
            artifact_from_order_result(
                {
                    "status": "ok",
                    "response": {"data": {"statuses": [{"error": "bad order"}]}},
                },
                request()["intent"],
            )


if __name__ == "__main__":
    unittest.main()
