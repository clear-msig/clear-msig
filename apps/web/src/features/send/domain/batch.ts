import {
  isValidSolanaAddress,
  shortAddress,
  type Contact,
} from "@/lib/retail/contacts";

export { MAX_BATCH_RECIPIENTS } from "@/lib/sendLimits";
const LAMPORTS_PER_SOL = 1_000_000_000n;

export function parseBatchAmountToLamports(value: string): bigint | null {
  const amount = value.trim();
  // CSV input bypasses the text field's maxLength. Bound work before regex and
  // BigInt conversion, while leaving ample room for supported decimal amounts.
  if (amount.length > 64) return null;
  if (!/^(?:\d+(?:\.\d{0,9})?|\.\d{1,9})$/.test(amount)) return null;
  const [whole, fraction = ""] = amount.split(".");
  const lamports = BigInt(whole || "0") * LAMPORTS_PER_SOL
    + BigInt(fraction.padEnd(9, "0"));
  // The execution adapter currently accepts safe integer JSON amounts.
  if (lamports <= 0n || lamports > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return lamports;
}

export function totalBatchLamports(rows: ResolvedValid[]): bigint {
  return rows.reduce((total, row) => total + BigInt(row.lamports), 0n);
}

export interface DraftRow {
  id: string;
  recipient: string;
  amount: string;
}

export interface ResolvedValid {
  kind: "valid";
  label: string;
  destination: string;
  lamports: string;
}

export type ResolvedRow =
  | ResolvedValid
  | { kind: "empty" }
  | { kind: "invalid-address" }
  | { kind: "invalid-amount" };

export function resolveRow(draft: DraftRow, contacts: Contact[]): ResolvedRow {
  const recipientRaw = draft.recipient.trim();
  const amountRaw = draft.amount.trim();
  if (recipientRaw.length === 0 && amountRaw.length === 0) {
    return { kind: "empty" };
  }

  const contact = contacts.find(
    (candidate) => candidate.name.toLowerCase() === recipientRaw.toLowerCase(),
  );
  const destination = contact
    ? contact.address
    : isValidSolanaAddress(recipientRaw)
      ? recipientRaw
      : null;
  if (!destination) return { kind: "invalid-address" };

  const lamports = parseBatchAmountToLamports(amountRaw);
  if (lamports === null) return { kind: "invalid-amount" };
  return {
    kind: "valid",
    label: contact ? contact.name : shortAddress(destination),
    destination,
    lamports: lamports.toString(),
  };
}

export function validRows(resolved: ResolvedRow[]): number {
  return resolved.filter((row) => row.kind === "valid").length;
}

export function emptyRow(): DraftRow {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2, 10),
    recipient: "",
    amount: "",
  };
}

export function parseBatchCsv(raw: string): {
  rows: DraftRow[];
  skipped: number;
} {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { rows: [], skipped: 0 };

  const first = parseCsvLine(lines[0] ?? "").map((cell) =>
    cell.trim().toLowerCase(),
  );
  const hasHeader =
    first.includes("amount") ||
    first.includes("address") ||
    first.includes("recipient");
  const header = hasHeader
    ? first
    : ["name", "address", "asset", "amount", "note"];
  const body = hasHeader ? lines.slice(1) : lines;
  const indexOf = (...keys: string[]) =>
    keys.map((key) => header.indexOf(key)).find((index) => index >= 0) ?? -1;
  const nameIndex = indexOf("name", "recipient", "payee");
  const addressIndex = indexOf("address", "wallet", "wallet_address");
  const assetIndex = indexOf("asset", "token", "ticker");
  const amountIndex = indexOf("amount", "sol");

  const rows: DraftRow[] = [];
  let skipped = 0;
  for (const line of body) {
    const cells = parseCsvLine(line).map((cell) => cell.trim());
    const asset =
      assetIndex >= 0 ? (cells[assetIndex] ?? "").toUpperCase() : "SOL";
    const recipient =
      (addressIndex >= 0 ? cells[addressIndex] : "") ||
      (nameIndex >= 0 ? cells[nameIndex] : "");
    const amount = amountIndex >= 0 ? (cells[amountIndex] ?? "") : "";
    if (!recipient || !amount || (asset && asset !== "SOL")) {
      skipped += 1;
      continue;
    }
    rows.push({
      ...emptyRow(),
      recipient,
      // Never rewrite imported financial intent. Invalid syntax remains visible
      // in the draft and blocks review until the user corrects it.
      amount,
    });
  }
  return { rows, skipped };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current);
  return cells;
}
