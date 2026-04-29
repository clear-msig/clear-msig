"use client";

// Typed input for a single intent parameter. Picks the right form
// control (number stepper, base58 address, hex buffer, etc.) based on
// the parameter's declared `ParamType`.
//
// The component is deliberately presentation-only. State lives in the
// parent form so it can rebuild the message body on every keystroke
// and display the live preview.

import { useMemo } from "react";
import { ParamType } from "@/lib/msig";

interface Props {
  name: string;
  type: ParamType;
  value: string;
  onChange: (value: string) => void;
  /// Optional decoded name for the form label (e.g. the pool-stored
  /// name rather than a hard-coded label). Defaults to `name`.
  displayName?: string;
  /// If the parent knows this param's decimal-shift spec (e.g.
  /// `{2:10^18}` → 18 decimals on ETH), passing it here renders a
  /// "0.0001 ETH"-style hint under the input.
  decimals?: number;
  unitHint?: string;
}

export function TypedParamInput({
  name,
  type,
  value,
  onChange,
  displayName,
  decimals,
  unitHint,
}: Props) {
  const label = displayName ?? name;
  const { placeholder, hint, inputMode, inputType, fontClass } = useMemo(
    () => controlHints(type),
    [type]
  );

  const computedPreview = useMemo(() => {
    if (!value) return null;
    if ((type === ParamType.U64 || type === ParamType.U128) && decimals) {
      return formatDecimalHint(value, decimals, unitHint);
    }
    return null;
  }, [type, value, decimals, unitHint]);

  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">
        <span>{label}</span>
        <span className="font-mono text-[10px] normal-case tracking-normal text-text-muted/70">
          {paramTypeLabel(type)}
        </span>
      </span>
      <input
        inputMode={inputMode}
        type={inputType}
        value={value}
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={[
          "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-brand-white outline-none transition-colors",
          "placeholder:text-white/20",
          "focus:border-brand-green/50 focus:bg-white/10",
          fontClass,
        ].join(" ")}
      />
      {(hint || computedPreview) && (
        <span className="text-[11px] leading-snug text-text-muted">
          {computedPreview ?? hint}
        </span>
      )}
    </label>
  );
}

// ── internals ─────────────────────────────────────────────────────────

function controlHints(type: ParamType): {
  placeholder: string;
  hint?: string;
  inputMode: "text" | "numeric" | "decimal";
  inputType: "text" | "number";
  fontClass: string;
} {
  switch (type) {
    case ParamType.Address:
      return {
        placeholder: "Wallet address",
        hint: "Solana wallet address (base58, 32 bytes).",
        inputMode: "text",
        inputType: "text",
        fontClass: "font-mono text-xs",
      };
    case ParamType.U64:
      return {
        placeholder: "0",
        hint: "Unsigned integer, fits in u64.",
        inputMode: "numeric",
        inputType: "text",
        fontClass: "",
      };
    case ParamType.I64:
      return {
        placeholder: "0",
        hint: "Signed integer, fits in i64.",
        inputMode: "numeric",
        inputType: "text",
        fontClass: "",
      };
    case ParamType.U128:
      return {
        placeholder: "0",
        hint: "Unsigned 128-bit integer (e.g. ERC-20 amounts in base units).",
        inputMode: "numeric",
        inputType: "text",
        fontClass: "",
      };
    case ParamType.String:
      return {
        placeholder: "text, max 255 bytes",
        inputMode: "text",
        inputType: "text",
        fontClass: "",
      };
    case ParamType.Bool:
      return {
        placeholder: "true or false",
        inputMode: "text",
        inputType: "text",
        fontClass: "",
      };
    case ParamType.U8:
      return {
        placeholder: "0-255",
        inputMode: "numeric",
        inputType: "text",
        fontClass: "",
      };
    case ParamType.U16:
      return {
        placeholder: "0-65535",
        inputMode: "numeric",
        inputType: "text",
        fontClass: "",
      };
    case ParamType.U32:
      return {
        placeholder: "0-4_294_967_295",
        inputMode: "numeric",
        inputType: "text",
        fontClass: "",
      };
    case ParamType.Bytes20:
      return {
        placeholder: "0x… 20 bytes",
        hint: "EVM address or Bitcoin HASH160 (hex, 40 chars, 0x optional).",
        inputMode: "text",
        inputType: "text",
        fontClass: "font-mono text-xs",
      };
    case ParamType.Bytes32:
      return {
        placeholder: "0x… 32 bytes",
        hint: "Tx hash / scriptPubKey hash / durable nonce (hex, 64 chars).",
        inputMode: "text",
        inputType: "text",
        fontClass: "font-mono text-xs",
      };
    default: {
      const exhaustive: never = type;
      return {
        placeholder: String(exhaustive),
        inputMode: "text",
        inputType: "text",
        fontClass: "",
      };
    }
  }
}

function paramTypeLabel(type: ParamType): string {
  switch (type) {
    case ParamType.Address:
      return "address";
    case ParamType.U64:
      return "u64";
    case ParamType.I64:
      return "i64";
    case ParamType.String:
      return "string";
    case ParamType.Bool:
      return "bool";
    case ParamType.U8:
      return "u8";
    case ParamType.U16:
      return "u16";
    case ParamType.U32:
      return "u32";
    case ParamType.U128:
      return "u128";
    case ParamType.Bytes20:
      return "bytes20";
    case ParamType.Bytes32:
      return "bytes32";
    default:
      return "";
  }
}

function formatDecimalHint(raw: string, decimals: number, unit?: string): string | null {
  // Empty / non-numeric → no preview.
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let big: bigint;
  try {
    big = BigInt(trimmed);
  } catch {
    return null;
  }
  if (big < 0n) return null;
  let scale = 1n;
  for (let i = 0; i < decimals; i++) scale *= 10n;
  const intPart = (big / scale).toString(10);
  const fracPart = (big % scale).toString(10).padStart(decimals, "0");
  // Trim trailing zeros.
  let trimmedFrac = fracPart;
  while (trimmedFrac.length > 0 && trimmedFrac.endsWith("0")) {
    trimmedFrac = trimmedFrac.slice(0, -1);
  }
  const formatted = trimmedFrac ? `${intPart}.${trimmedFrac}` : intPart;
  return unit ? `≈ ${formatted} ${unit}` : `≈ ${formatted}`;
}
