-- Step 1: Canonical ramp schema for shared Postgres database
-- Rust service write-owns these ramp_* tables.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ramp_intents (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    intent_type VARCHAR(20) NOT NULL,
    status VARCHAR(64) NOT NULL,
    chain_family VARCHAR(16) NOT NULL,
    chain_id VARCHAR(64) NOT NULL,
    asset_symbol VARCHAR(20) NOT NULL,
    asset_amount_minor BIGINT NOT NULL,
    source_wallet VARCHAR(128),
    destination_wallet VARCHAR(128),
    quote_id UUID,
    bank_snapshot_id UUID,
    fee_config_version INTEGER NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT chk_ramp_intent_type CHECK (intent_type IN ('onramp', 'offramp')),
    CONSTRAINT chk_ramp_status CHECK (
        status IN (
            'intent_created',
            'awaiting_user_transfer_signature',
            'awaiting_user_transfer_confirmation',
            'awaiting_payment',
            'payment_confirmed',
            'settlement_queued',
            'settlement_in_progress',
            'settlement_completed',
            'payout_in_progress',
            'payout_completed',
            'expired',
            'failed',
            'cancelled',
            'manual_review_required'
        )
    ),
    CONSTRAINT chk_ramp_chain_family CHECK (chain_family IN ('evm', 'sui'))
);

CREATE INDEX IF NOT EXISTS idx_ramp_intents_user_created
    ON ramp_intents(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ramp_intents_status_created
    ON ramp_intents(status, created_at DESC);

CREATE TABLE IF NOT EXISTS ramp_quotes (
    id UUID PRIMARY KEY,
    intent_id UUID NOT NULL REFERENCES ramp_intents(id) ON DELETE CASCADE,
    quote_version INTEGER NOT NULL,
    input_asset_symbol VARCHAR(20) NOT NULL,
    input_asset_amount_minor BIGINT NOT NULL,
    estimated_ngn_amount_minor BIGINT NOT NULL,
    platform_fee_bps INTEGER NOT NULL,
    network_fee_ngn_minor BIGINT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (intent_id, quote_version)
);

CREATE INDEX IF NOT EXISTS idx_ramp_quotes_intent
    ON ramp_quotes(intent_id, quote_version DESC);

CREATE TABLE IF NOT EXISTS ramp_bank_snapshots (
    id UUID PRIMARY KEY,
    intent_id UUID NOT NULL REFERENCES ramp_intents(id) ON DELETE CASCADE,
    snapshot_version INTEGER NOT NULL,
    bank_code VARCHAR(32) NOT NULL,
    bank_name VARCHAR(128),
    account_number VARCHAR(32) NOT NULL,
    account_name VARCHAR(160),
    recipient_code VARCHAR(128),
    currency VARCHAR(8) NOT NULL DEFAULT 'NGN',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (intent_id, snapshot_version)
);

CREATE INDEX IF NOT EXISTS idx_ramp_bank_snapshots_intent
    ON ramp_bank_snapshots(intent_id, snapshot_version DESC);

CREATE TABLE IF NOT EXISTS ramp_treasury_mappings (
    id UUID PRIMARY KEY,
    chain_family VARCHAR(16) NOT NULL,
    chain_id VARCHAR(64) NOT NULL,
    asset_symbol VARCHAR(20) NOT NULL,
    treasury_address VARCHAR(255) NOT NULL,
    mapping_version INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (chain_family, chain_id, asset_symbol, mapping_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ramp_treasury_mapping_active
    ON ramp_treasury_mappings(chain_family, chain_id, asset_symbol)
    WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS ramp_idempotency_keys (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    endpoint VARCHAR(120) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    request_hash VARCHAR(128) NOT NULL,
    intent_id UUID REFERENCES ramp_intents(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, endpoint, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ramp_idempotency_user_created
    ON ramp_idempotency_keys(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ramp_webhook_inbox (
    id UUID PRIMARY KEY,
    provider VARCHAR(32) NOT NULL,
    provider_event_id VARCHAR(128),
    event_type VARCHAR(80) NOT NULL,
    dedupe_key VARCHAR(255) NOT NULL,
    signature_valid BOOLEAN NOT NULL,
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    processing_error TEXT,
    UNIQUE (provider, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_ramp_webhook_inbox_unprocessed
    ON ramp_webhook_inbox(provider, processed_at)
    WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS ramp_outbox_events (
    id UUID PRIMARY KEY,
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    event_version INTEGER NOT NULL DEFAULT 1,
    idempotency_key VARCHAR(255),
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    publish_attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ramp_outbox_unpublished
    ON ramp_outbox_events(created_at)
    WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS ramp_chain_transfers (
    id UUID PRIMARY KEY,
    intent_id UUID NOT NULL REFERENCES ramp_intents(id) ON DELETE CASCADE,
    chain_family VARCHAR(16) NOT NULL,
    chain_id VARCHAR(64) NOT NULL,
    tx_hash VARCHAR(160) NOT NULL,
    event_index INTEGER NOT NULL,
    sender_wallet VARCHAR(255) NOT NULL,
    asset_symbol VARCHAR(20) NOT NULL,
    amount_minor BIGINT NOT NULL,
    confirmations INTEGER NOT NULL DEFAULT 0,
    is_finalized BOOLEAN NOT NULL DEFAULT FALSE,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    UNIQUE (chain_family, chain_id, tx_hash, event_index)
);

CREATE INDEX IF NOT EXISTS idx_ramp_chain_transfers_intent
    ON ramp_chain_transfers(intent_id, detected_at DESC);

CREATE TABLE IF NOT EXISTS ramp_payouts (
    id UUID PRIMARY KEY,
    intent_id UUID NOT NULL REFERENCES ramp_intents(id) ON DELETE CASCADE,
    transfer_reference VARCHAR(180) NOT NULL UNIQUE,
    amount_minor BIGINT NOT NULL,
    currency VARCHAR(8) NOT NULL,
    provider_status VARCHAR(32) NOT NULL,
    provider_payload JSONB,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    webhook_received_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ramp_payouts_intent
    ON ramp_payouts(intent_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS ramp_disbursements (
    id UUID PRIMARY KEY,
    intent_id UUID NOT NULL REFERENCES ramp_intents(id) ON DELETE CASCADE,
    chain_family VARCHAR(16) NOT NULL,
    chain_id VARCHAR(64) NOT NULL,
    asset_symbol VARCHAR(20) NOT NULL,
    amount_minor BIGINT NOT NULL,
    recipient_wallet VARCHAR(255) NOT NULL,
    tx_hash VARCHAR(160) NOT NULL,
    status VARCHAR(32) NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    UNIQUE (intent_id),
    UNIQUE (chain_family, chain_id, tx_hash)
);

CREATE INDEX IF NOT EXISTS idx_ramp_disbursements_requested
    ON ramp_disbursements(requested_at DESC);

CREATE TABLE IF NOT EXISTS ramp_audit_events (
    id UUID PRIMARY KEY,
    actor_type VARCHAR(32) NOT NULL,
    actor_id VARCHAR(128),
    action VARCHAR(120) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id UUID,
    request_id VARCHAR(128),
    idempotency_key VARCHAR(128),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ramp_audit_entity_created
    ON ramp_audit_events(entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ramp_policy_config_versions (
    id UUID PRIMARY KEY,
    version INTEGER NOT NULL UNIQUE,
    platform_fee_bps INTEGER NOT NULL,
    max_daily_limit_ngn_minor BIGINT NOT NULL,
    amount_tolerance_bps INTEGER NOT NULL,
    evm_confirmations_low INTEGER NOT NULL,
    evm_confirmations_medium INTEGER NOT NULL,
    evm_confirmations_high INTEGER NOT NULL,
    sui_requires_finalized_checkpoint BOOLEAN NOT NULL DEFAULT TRUE,
    created_by VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ramp_policy_single_active
    ON ramp_policy_config_versions(is_active)
    WHERE is_active = TRUE;

INSERT INTO ramp_policy_config_versions (
    id,
    version,
    platform_fee_bps,
    max_daily_limit_ngn_minor,
    amount_tolerance_bps,
    evm_confirmations_low,
    evm_confirmations_medium,
    evm_confirmations_high,
    sui_requires_finalized_checkpoint,
    created_by,
    is_active
)
SELECT
    gen_random_uuid(),
    1,
    300,
    30000000,
    0,
    1,
    3,
    6,
    TRUE,
    'bootstrap',
    TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM ramp_policy_config_versions WHERE version = 1
);
