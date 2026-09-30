-- Existing unverified rows remain untrusted; do not backfill verifier_version.
ALTER TABLE ramp_chain_transfers
    ADD COLUMN IF NOT EXISTS recipient_wallet TEXT,
    ADD COLUMN IF NOT EXISTS deposit_reference TEXT,
    ADD COLUMN IF NOT EXISTS verifier_version INTEGER,
    ADD COLUMN IF NOT EXISTS verification_evidence JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS uq_verified_deposit_intent
    ON ramp_chain_transfers(intent_id) WHERE verifier_version = 1;

ALTER TABLE ramp_payouts ADD COLUMN IF NOT EXISTS provider TEXT;
