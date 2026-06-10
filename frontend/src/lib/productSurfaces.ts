export type ProductSurfaceId =
  | "personal"
  | "pro"
  | "agent"
  | "p2pdefi"
  | "payments";

export type ProductSurfaceStatus = "live" | "planned";

export interface ProductSurface {
  id: ProductSurfaceId;
  name: string;
  shortName: string;
  host: string;
  path: string;
  status: ProductSurfaceStatus;
  eyebrow: string;
  headline: string;
  summary: string;
  ctaLabel: string;
  ctaHref: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  primitives: string[];
  features: string[];
  boundaries: string[];
}

export const PRODUCT_SURFACES: ProductSurface[] = [
  {
    id: "personal",
    name: "ClearSig Personal",
    shortName: "Personal",
    host: "personal.clearsig.com",
    path: "/personal",
    status: "live",
    eyebrow: "For people and families",
    headline: "Shared wallet protection without policy stress.",
    summary:
      "Use multiple devices or wallets to protect one multisig. No policy setup is required for the personal path.",
    ctaLabel: "Start personal setup",
    ctaHref: "/welcome?surface=personal",
    secondaryHref: "/security",
    secondaryLabel: "Review security",
    primitives: ["Multisig authority", "Device and wallet approvals", "Shared activity"],
    features: [
      "Create a simple shared wallet",
      "Invite trusted people or devices",
      "Send only after the required approvals",
      "Keep policy controls out of the default flow",
    ],
    boundaries: [
      "No policy builder in the first-run path",
      "No agent trading controls",
      "No company treasury language",
    ],
  },
  {
    id: "pro",
    name: "ClearSig Pro",
    shortName: "Pro",
    host: "pro.clearsig.com",
    path: "/pro",
    status: "live",
    eyebrow: "For companies and teams",
    headline: "Multisig treasury controls with optional encrypted policies.",
    summary:
      "Protect company wallets with multiple approvers, spending rules, transparent policy controls, or encrypted policy commitments.",
    ctaLabel: "Create pro workspace",
    ctaHref: "/app/wallet/new?surface=pro",
    secondaryHref: "/privacy",
    secondaryLabel: "Policy privacy",
    primitives: ["Multisig authority", "Policy engine", "Encrypt commitments"],
    features: [
      "Configure approvers and thresholds",
      "Add allowlists, limits, roles, and review flows",
      "Choose transparent or encrypted policy values",
      "Keep treasury operations separate from consumer onboarding",
    ],
    boundaries: [
      "Policies belong here, not in the personal default path",
      "Company controls can be explicit or confidential",
      "Agent execution is a separate product surface",
    ],
  },
  {
    id: "agent",
    name: "ClearSig Agents",
    shortName: "Agents",
    host: "agent.clearsig.com",
    path: "/agent",
    status: "live",
    eyebrow: "For trading agents and allocators",
    headline: "Policy-bound agent trading without giving agents custody.",
    summary:
      "Agents are not multisigs. They are identities that submit signed trade decisions into ClearSig policy gates.",
    ctaLabel: "Open agent marketplace",
    ctaHref: "/agents?surface=agent",
    secondaryHref: "/app/wallet?surface=agent",
    secondaryLabel: "Manage my agents",
    primitives: ["Agent identity", "Policy grants", "Decision journal"],
    features: [
      "Publish or browse agent profiles",
      "Give agents bounded allowances and venues",
      "Track why trades were proposed, opened, blocked, or closed",
      "Separate paper, testnet, and verified live records",
    ],
    boundaries: [
      "Agents never directly hold user funds",
      "Every action passes ClearSig rules before execution",
      "Transparent or encrypted policies are creator and user choices",
    ],
  },
  {
    id: "p2pdefi",
    name: "ClearSig P2P DeFi",
    shortName: "P2P DeFi",
    host: "p2pdefi.clearsig.xyz",
    path: "/p2pdefi",
    status: "planned",
    eyebrow: "Coming next",
    headline: "Peer-to-peer DeFi coordination on ClearSig primitives.",
    summary:
      "A future surface for offers, intents, escrow-like coordination, and policy-checked settlement.",
    ctaLabel: "Not live yet",
    ctaHref: "/choose",
    primitives: ["Signed intents", "Policy gates", "Settlement proofs"],
    features: ["Offer discovery", "Counterparty approvals", "Policy-checked settlement"],
    boundaries: ["Not part of the current beta", "No live trading or escrow claim yet"],
  },
  {
    id: "payments",
    name: "ClearSig Payments",
    shortName: "Payments",
    host: "payments.clearsig.xyz",
    path: "/payments",
    status: "planned",
    eyebrow: "Coming next",
    headline: "Payment flows coordinated by ClearSig authority.",
    summary:
      "A future surface for invoices, approvals, recurring payments, and business payout controls.",
    ctaLabel: "Not live yet",
    ctaHref: "/choose",
    primitives: ["Payment intents", "Approvals", "Treasury policy"],
    features: ["Invoices", "Recurring approvals", "Payout review"],
    boundaries: ["Not part of the current beta", "No production payments promise yet"],
  },
];

export function productSurfaceById(id: ProductSurfaceId): ProductSurface {
  return PRODUCT_SURFACES.find((surface) => surface.id === id) ?? PRODUCT_SURFACES[0];
}

export function liveProductSurfaces(): ProductSurface[] {
  return PRODUCT_SURFACES.filter((surface) => surface.status === "live");
}

export function plannedProductSurfaces(): ProductSurface[] {
  return PRODUCT_SURFACES.filter((surface) => surface.status === "planned");
}
