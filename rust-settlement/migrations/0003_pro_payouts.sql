-- Pro team payouts: one multisig proposal gates one Kora NGN payout batch.
-- The batch stays pending until the linked Clear multisig proposal is
-- independently observed as Executed by rust-settlement.

CREATE TABLE IF NOT EXISTS pro_payout_batches (
    id UUID PRIMARY KEY,
    created_by UUID NOT NULL,
    wallet_name TEXT NOT NULL,
    wallet_address TEXT,
    chain_family TEXT NOT NULL,
    chain_id TEXT NOT NULL,
    asset_symbol TEXT NOT NULL,
    asset_amount_minor BIGINT NOT NULL,
    ngn_amount_minor BIGINT NOT NULL,
    payout_currency TEXT NOT NULL DEFAULT 'NGN',
    status TEXT NOT NULL,
    proposal_address TEXT,
    proposal_status TEXT,
    proposal_verified_at TIMESTAMPTZ,
    proposal_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    reference TEXT,
    narration TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT chk_pro_payout_batch_chain_family CHECK (
        chain_family IN ('solana', 'evm', 'bitcoin', 'zcash', 'sui')
    ),
    CONSTRAINT chk_pro_payout_batch_status CHECK (
        status IN (
            'awaiting_proposal',
            'awaiting_execution',
            'ready_for_disbursement',
            'disbursing',
            'completed',
            'partially_failed',
            'failed',
            'cancelled',
            'manual_review_required'
        )
    ),
    CONSTRAINT chk_pro_payout_batch_amounts CHECK (
        asset_amount_minor > 0 AND ngn_amount_minor > 0
    ),
    CONSTRAINT chk_pro_payout_batch_currency CHECK (payout_currency = 'NGN')
);

CREATE INDEX IF NOT EXISTS idx_pro_payout_batches_created_by
    ON pro_payout_batches(created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pro_payout_batches_status
    ON pro_payout_batches(status, created_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pro_payout_batches_proposal
    ON pro_payout_batches(proposal_address)
    WHERE proposal_address IS NOT NULL;

CREATE TABLE IF NOT EXISTS pro_payout_items (
    id UUID PRIMARY KEY,
    batch_id UUID NOT NULL REFERENCES pro_payout_batches(id) ON DELETE CASCADE,
    row_index INT NOT NULL,
    amount_minor BIGINT NOT NULL,
    bank_code TEXT NOT NULL,
    bank_account_number TEXT NOT NULL,
    account_name TEXT,
    customer_email TEXT,
    narration TEXT,
    reference TEXT,
    status TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'kora',
    provider_reference TEXT NOT NULL,
    provider_status TEXT,
    provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    failure_reason TEXT,
    requested_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    webhook_received_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_pro_payout_item_amount CHECK (amount_minor > 0),
    CONSTRAINT chk_pro_payout_item_status CHECK (
        status IN ('pending', 'disbursing', 'completed', 'failed', 'cancelled')
    ),
    CONSTRAINT chk_pro_payout_item_provider CHECK (provider = 'kora')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pro_payout_items_batch_row
    ON pro_payout_items(batch_id, row_index);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pro_payout_items_provider_reference
    ON pro_payout_items(provider_reference);

CREATE INDEX IF NOT EXISTS idx_pro_payout_items_dispatch
    ON pro_payout_items(status, created_at ASC)
    WHERE status IN ('pending', 'disbursing');

CREATE TABLE IF NOT EXISTS pro_beneficiaries (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL,
    label TEXT NOT NULL,
    bank_code TEXT NOT NULL,
    bank_account_number TEXT NOT NULL,
    account_name TEXT NOT NULL,
    customer_email TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pro_beneficiaries_owner_account
    ON pro_beneficiaries(owner_id, bank_code, bank_account_number);
