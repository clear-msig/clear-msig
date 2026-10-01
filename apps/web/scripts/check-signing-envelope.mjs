import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
// Intentionally a narrow translator, not a permissive Rust parser. Any new
// encoding operation or validation must be explicitly supported and reviewed.
export function renderEnvelope(lib, hashing, model) {
  const domain = lib.match(
    /pub const ENVELOPE_DOMAIN: &\[u8\] = b"([a-z0-9:-]+)";/,
  )?.[1];
  const version = lib.match(/pub const INTENT_VERSION: u8 = (\d+);/)?.[1];
  const body = hashing
    .match(/pub fn envelope_hash_fields[^{]+\{([\s\S]*?)\n\}/)?.[1]
    .trim();
  const prefix = `validate_visible_ascii(fields.wallet_name, 64, false)?;
    if fields.approval_required == 0 || fields.approval_required > 16 {
        return Err(Error::InvalidContext);
    }
    let mut hasher = Sha256::new();`;
  const suffix = "Ok(hasher.finalize().into())";
  if (
    !domain ||
    !version ||
    !body?.startsWith(prefix) ||
    !body.endsWith(suffix)
  )
    throw new Error("Unsupported canonical Rust envelope validation.");
  if (
    hashing.match(/fn update_bytes[^\{]+\{([\s\S]*?)\n\}/)?.[1].trim() !==
    `hasher.update((value.len() as u32).to_le_bytes());\n    hasher.update(value);`
  )
    throw new Error("Canonical length-prefix codec changed.");
  const asciiValidator = lib.match(
    /fn validate_visible_ascii[^\{]+\{([\s\S]*?)\n\}/,
  )?.[1];
  const expectedAsciiValidator = `
    if value.len() > max || (!allow_empty && value.is_empty()) {
        return Err(Error::InvalidLength);
    }
    if value
        .iter()
        .any(|byte| !matches!(byte, 0x20..=0x7e) || *byte == b'\\n' || *byte == b'\\r')
    {
        return Err(Error::InvalidText);
    }
    Ok(())`;
  if (asciiValidator !== expectedAsciiValidator)
    throw new Error("Canonical text validation changed.");
  const fields = [
    ...model
      .match(/pub struct EnvelopeFields[^{]+\{([\s\S]*?)\n\}/)[1]
      .matchAll(/pub (\w+): ([^,]+),/g),
  ].map((m) => [m[1], m[2]]);
  const actionImplementation = model.match(/impl ActionKind \{([\s\S]*?)\n\}/)?.[1];
  const actionCode = actionImplementation?.match(/pub const fn code\(self\) -> u8 \{([^}]+)\}/)?.[1].trim();
  if (actionCode !== "self as u8")
    throw new Error("Canonical action code conversion changed.");
  const types = Object.fromEntries(fields);
  const enumCodes = (name) =>
    [
      ...model
        .match(new RegExp(`pub enum ${name} \\{([\\s\\S]*?)\\n\\}`))[1]
        .matchAll(/= (\d+),/g),
    ].map((m) => Number(m[1]));
  const tsType = (type) => {
    if (["ActionKind", "Network", "u8"].includes(type)) return "number";
    if (["u64", "i64"].includes(type)) return "bigint";
    if (["&'a [u8]", "&'a [u8; 32]"].includes(type)) return "Uint8Array";
    throw new Error(`Unsupported Rust envelope field: ${type}`);
  };
  const rows = body
    .slice(prefix.length, -suffix.length)
    .trim()
    .split("\n")
    .map((s) => s.trim())
    .map((line) => {
      if (line === "update_bytes(&mut hasher, ENVELOPE_DOMAIN);")
        return `bytes(new TextEncoder().encode(${JSON.stringify(domain)}))`;
      if (line === "hasher.update([INTENT_VERSION]);")
        return `integer(${version}, 1)`;
      let m;
      if ((m = line.match(/^update_bytes\(&mut hasher, fields\.(\w+)\);$/))) {
        if (!types[m[1]]?.startsWith("&'a [u8"))
          throw new Error("Invalid byte vector.");
        return `bytes(fields.${m[1]})`;
      }
      if (
        (m = line.match(/^hasher.update\(fields\.(\w+)\.to_le_bytes\(\)\);$/))
      ) {
        if (!["u64", "i64"].includes(types[m[1]]))
          throw new Error("Invalid integer.");
        return `integer(fields.${m[1]}, 8, ${types[m[1]] === "i64"})`;
      }
      if (
        (m = line.match(
          /^hasher.update\(\[fields\.(\w+)(?:\.code\(\)| as u8)?\]\);$/,
        ))
      ) {
        if (!["u8", "Network", "ActionKind"].includes(types[m[1]]))
          throw new Error("Invalid byte.");
        return `integer(fields.${m[1]}, 1)`;
      }
      if (
        (m = line.match(/^hasher.update\(fields\.(\w+)\);$/)) &&
        types[m[1]] === "&'a [u8; 32]"
      )
        return `fields.${m[1]}`;
      throw new Error(`Unsupported canonical Rust envelope operation: ${line}`);
    });
  return `// Generated from crates/clear-msig-signing/src/{lib,model,hashing}.rs. Do not edit.
// Verification of an existing on-chain envelope; never prepares signing authority.
import { bytes, integer, digest } from "./envelopeCodec";

export interface CanonicalEnvelopeFields {
${fields.map(([name, type]) => `  ${name}: ${tsType(type)};`).join("\n")}
}
export function canonicalEnvelopeHash(fields: CanonicalEnvelopeFields): string {
  if (!fields.wallet_name.length || fields.wallet_name.length > 64 ||
      fields.wallet_name.some(b => b < 32 || b > 126) ||
      !Number.isInteger(fields.approval_required) || fields.approval_required < 1 || fields.approval_required > 16 ||
      !${JSON.stringify(enumCodes("ActionKind"))}.includes(fields.kind) ||
      !${JSON.stringify(enumCodes("Network"))}.includes(fields.network))
    throw new Error("Invalid canonical envelope context.");
${fields
  .filter(([, type]) => type === "&'a [u8; 32]")
  .map(
    ([name]) =>
      `  if (!(fields.${name} instanceof Uint8Array) || fields.${name}.length !== 32) throw new Error("Invalid ${name} bytes.");`,
  )
  .join("\n")}
  return digest([
${rows.map((row) => `    ${row},`).join("\n")}
  ]);
}
`;
}
export function checkEnvelope(write = false) {
  const output = resolve(
    root,
    "apps/web/src/lib/clearsign/generatedEnvelope.ts",
  );
  const expected = renderEnvelope(
    read("crates/clear-msig-signing/src/lib.rs"),
    read("crates/clear-msig-signing/src/hashing.rs"),
    read("crates/clear-msig-signing/src/model.rs"),
  );
  if (write) writeFileSync(output, expected);
  else if (readFileSync(output, "utf8") !== expected)
    throw new Error(
      "Canonical envelope verifier is stale. Run node scripts/check-signing-envelope.mjs --write in apps/web.",
    );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  checkEnvelope(process.argv.includes("--write"));
  console.log("Canonical envelope verifier matches Rust authority encoding.");
}
