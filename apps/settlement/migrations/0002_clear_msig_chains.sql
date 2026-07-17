-- Step 2: clear-msig integration
--
-- Drop the original chain_family CHECK (evm/sui only) and replace it
-- with the four families clear-msig supports: solana, evm, bitcoin,
-- zcash. Sui is gone.
--
-- Drop the FK on `users(id)` for ramp_intents.user_id and
-- ramp_idempotency_keys.user_id. clear-msig has no users table; the
-- frontend deterministically derives a UUID from the connected
-- wallet's pubkey and passes it via x-user-id. The column stays UUID
-- (so existing indexes + types keep working) — we just no longer
-- enforce referential integrity against a table we don't own.

ALTER TABLE ramp_intents
    DROP CONSTRAINT IF EXISTS chk_ramp_chain_family;

ALTER TABLE ramp_intents
    ADD CONSTRAINT chk_ramp_chain_family
    CHECK (chain_family IN ('solana', 'evm', 'bitcoin', 'zcash'));

ALTER TABLE ramp_intents
    DROP CONSTRAINT IF EXISTS ramp_intents_user_id_fkey;

ALTER TABLE ramp_idempotency_keys
    DROP CONSTRAINT IF EXISTS ramp_idempotency_keys_user_id_fkey;
