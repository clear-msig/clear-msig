import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderEnvelope, checkEnvelope } from "./check-signing-envelope.mjs";
const lib = readFileSync("../../crates/clear-msig-signing/src/lib.rs", "utf8");
const hashing = readFileSync(
  "../../crates/clear-msig-signing/src/hashing.rs",
  "utf8",
);
const model = readFileSync(
  "../../crates/clear-msig-signing/src/model.rs",
  "utf8",
);
test("checked verifier exactly matches canonical Rust schema", () =>
  checkEnvelope());
test("canonical field ordering and domain changes alter generated verifier", () => {
  const baseline = renderEnvelope(lib, hashing, model);
  assert.notEqual(
    renderEnvelope(
      lib.replace("policy-engine:v4", "policy-engine:v5"),
      hashing,
      model,
    ),
    baseline,
  );
  assert.notEqual(
    renderEnvelope(
      lib,
      hashing.replace(
        "hasher.update(fields.policy_commitment);\n    hasher.update(fields.payload_hash);",
        "hasher.update(fields.payload_hash);\n    hasher.update(fields.policy_commitment);",
      ),
      model,
    ),
    baseline,
  );
});
test("unknown Rust validation or hashing operations fail generation closed", () => {
  assert.throws(() =>
    renderEnvelope(
      lib,
      hashing.replace(
        "fields.approval_required > 16",
        "fields.approval_required > 12",
      ),
      model,
    ),
  );
  assert.throws(() =>
    renderEnvelope(
      lib,
      hashing.replace(
        "hasher.update(fields.payload_hash);",
        "hasher.update(transform(fields.payload_hash));",
      ),
      model,
    ),
  );
  assert.throws(() =>
    renderEnvelope(
      lib,
      hashing,
      model.replaceAll("pub proposal_index: u64", "pub proposal_index: u128"),
    ),
  );
  assert.throws(() =>
    renderEnvelope(
      lib,
      hashing.replace("(value.len() as u32)", "(value.len() as u64)"),
      model,
    ),
  );
  assert.throws(() =>
    renderEnvelope(lib.replace("0x20..=0x7e", "0x21..=0x7e"), hashing, model),
  );
  assert.throws(() =>
    renderEnvelope(
      lib,
      hashing.replace(
        "hasher.update(value);",
        "hasher.update(value);\n    hasher.update([0]);",
      ),
      model,
    ),
  );
});

test("action-kind conversion changes cannot silently alter canonical bytes", () => {
  assert.throws(() => renderEnvelope(lib, hashing, model.replace("self as u8", "(self as u8) + 1")));
});
