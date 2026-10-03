// Where each wallet protection is enforced.
//
// Wording follows docs/product-implementation-status.md: spend caps,
// recipient lists and allowed hours are program-enforced for supported typed
// sends once saved on-chain; browser checks are a preflight, never the
// authority. Keep this list in step with that document.

export type EnforcementLayer = "program" | "program-after-sync";

export interface EnforcementRow {
  id: "threshold" | "delay" | "limits" | "recipients" | "hours";
  label: string;
  layer: EnforcementLayer;
  detail: string;
}

export const ENFORCEMENT_LEGEND: readonly EnforcementRow[] = [
  {
    id: "threshold",
    label: "Approvals needed",
    layer: "program",
    detail: "The program counts approvals before a request can run.",
  },
  {
    id: "delay",
    label: "Send delay",
    layer: "program",
    detail: "The delay is part of the spending rule the program enforces.",
  },
  {
    id: "limits",
    label: "Spending limits",
    layer: "program-after-sync",
    detail:
      "Checked here before you sign. The program enforces them for supported send types once saved on-chain.",
  },
  {
    id: "recipients",
    label: "Allowed recipients",
    layer: "program-after-sync",
    detail:
      "Checked here before you sign. The program rejects other recipients once you use On-chain sync.",
  },
  {
    id: "hours",
    label: "Allowed hours",
    layer: "program-after-sync",
    detail:
      "Checked here before you sign. The program enforces the window once you use On-chain sync.",
  },
];

export const ENFORCEMENT_LAYER_LABEL: Record<EnforcementLayer, string> = {
  program: "Enforced on-chain",
  "program-after-sync": "On-chain once saved",
};
