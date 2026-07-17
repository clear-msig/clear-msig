import time
import unittest
import os
import tempfile
from decimal import Decimal
from pathlib import Path

from server import (
    ExecutorSettings,
    ExchangeError,
    ValidationError,
    artifact_from_order_result,
    artifact_from_settlement_fills,
    load_env_file,
    rounded_size,
    validate_executor_request,
    validate_settlement_request,
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
    def test_load_env_file_is_read_only_and_preserves_existing_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / ".env"
            path.write_text(
                "\n".join(
                    [
                        "# comment",
                        "CLEARSIG_TEST_ENV_LOADER=from-file",
                        "CLEARSIG_TEST_ENV_EXISTING=from-file",
                        "QUOTED_VALUE='hello world'",
                    ]
                ),
                encoding="utf-8",
            )
            os.environ["CLEARSIG_TEST_ENV_EXISTING"] = "already-set"
            try:
                load_env_file(path)
                self.assertEqual(os.environ["CLEARSIG_TEST_ENV_LOADER"], "from-file")
                self.assertEqual(os.environ["CLEARSIG_TEST_ENV_EXISTING"], "already-set")
                self.assertEqual(os.environ["QUOTED_VALUE"], "hello world")
            finally:
                os.environ.pop("CLEARSIG_TEST_ENV_LOADER", None)
                os.environ.pop("CLEARSIG_TEST_ENV_EXISTING", None)
                os.environ.pop("QUOTED_VALUE", None)

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
                "response": {
                    "data": {
                        "statuses": [
                            {"filled": {"oid": 123, "totalSz": "0.0037", "avgPx": "67500"}}
                        ]
                    }
                },
            },
            request()["intent"],
        )
        self.assertEqual(artifact["orderId"], "123")
        self.assertEqual(artifact["status"], "filled")
        self.assertEqual(artifact["filledSize"], "0.0037")

    def test_settlement_binds_stored_opening_artifact(self):
        body = request()
        body.update({
            "serverRequestId": "server-request-1",
            "openingArtifact": {
                "exchange": "hyperliquid_testnet",
                "orderId": "123",
                "market": "BTC-PERP",
                "side": "long",
                "filledSize": "0.0037",
            },
        })
        validated = validate_settlement_request(body, SETTINGS)
        self.assertEqual(validated["serverRequestId"], "server-request-1")

        body["openingArtifact"]["market"] = "ETH-PERP"
        with self.assertRaisesRegex(ValidationError, "market"):
            validate_settlement_request(body, SETTINGS)

    def test_settlement_artifact_uses_venue_pnl_and_fill_hashes(self):
        body = request()
        body.update({
            "serverRequestId": "server-request-1",
            "openingArtifact": {
                "exchange": "hyperliquid_testnet",
                "orderId": "123",
                "market": "BTC-PERP",
                "side": "long",
                "filledSize": "0.0037",
            },
        })
        artifact = artifact_from_settlement_fills(
            body,
            {"orderId": "456"},
            [
                {"sz": "0.002", "closedPnl": "-1.25", "hash": "0xabc"},
                {"sz": "0.0017", "closedPnl": "0.25", "hash": "0xdef"},
            ],
        )
        self.assertEqual(artifact["realizedPnlUsd"], "-1")
        self.assertEqual(artifact["closedSize"], "0.0037")
        self.assertEqual(artifact["fillHashes"], ["0xabc", "0xdef"])

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
