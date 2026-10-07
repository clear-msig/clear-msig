// The example approval shown on the landing page. The hex view is the real
// UTF-8 encoding of the readable document, so "same bytes, two views" is
// literally true. The document follows the ClearSign v4 section layout; the
// amount, wallet and destination are illustrative and move no funds.

export const EXAMPLE_DESTINATION =
  "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

export interface ExampleSection {
  title: string;
  lines: readonly (readonly [label: string | null, value: string])[];
}

export const EXAMPLE_SECTIONS: readonly ExampleSection[] = [
  { title: "ACTION", lines: [[null, "Send 5 SOL"]] },
  {
    title: "DETAILS",
    lines: [
      ["From wallet", "Operations"],
      ["Network", "Solana Devnet"],
      ["Amount", "5 SOL"],
      ["To", EXAMPLE_DESTINATION],
    ],
  },
  {
    title: "POLICY",
    lines: [
      ["Approval", "2 signatures required"],
      ["Execution", "Exact payload, policy and timelock enforced onchain"],
    ],
  },
];

export const EXAMPLE_DOCUMENT: string = [
  "ClearSig Approval",
  ...EXAMPLE_SECTIONS.map(
    (section) =>
      `${section.title}\n${section.lines
        .map(([label, value]) => (label ? `${label}: ${value}` : value))
        .join("\n")}`,
  ),
].join("\n\n");

export function documentBytes(): Uint8Array {
  return new TextEncoder().encode(EXAMPLE_DOCUMENT);
}

/** Hex of the document, as `perLine` bytes per row in 2-byte groups. */
export function documentHexRows(perLine = 12): string[] {
  const bytes = documentBytes();
  const rows: string[] = [];
  for (let i = 0; i < bytes.length; i += perLine) {
    const hex = Array.from(bytes.slice(i, i + perLine), (b) =>
      b.toString(16).padStart(2, "0"),
    );
    const groups: string[] = [];
    for (let j = 0; j < hex.length; j += 2) groups.push(hex.slice(j, j + 2).join(""));
    rows.push(groups.join(" "));
  }
  return rows;
}
