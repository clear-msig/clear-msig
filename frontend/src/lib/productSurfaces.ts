export type ProductSurfaceId =
  | "personal"
  | "pro"
  | "agent"
  | "secure"
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
      "Create a simple shared wallet for yourself, family, friends, or a small group. No policy builder in the default path.",
    ctaLabel: "Start personal setup",
    ctaHref: "/app/wallet/new?surface=personal&purpose=share",
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
    ctaHref: "/app/wallet/new?surface=pro&purpose=share",
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
    ctaLabel: "Create agent vault",
    ctaHref: "/app/wallet/new?surface=agent&purpose=agent",
    secondaryHref: "/agents?surface=agent",
    secondaryLabel: "Browse marketplace",
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
    id: "secure",
    name: "ClearSig Secure",
    shortName: "Secure",
    host: "secure.clearsig.com",
    path: "/secure",
    status: "live",
    eyebrow: "For key recovery",
    headline: "Recoverable custody without a seed phrase ritual.",
    summary:
      "Protect a personal key with device and passkey thresholds. Lose one device, recover with the rest.",
    ctaLabel: "Create recovery vault",
    ctaHref: "/app/wallet/new?surface=secure&purpose=secure",
    secondaryHref: "/security",
    secondaryLabel: "Review security",
    primitives: ["Recovery vault", "Passkey thresholds", "Sweep flow"],
    features: [
      "Create a personal recovery vault",
      "Choose 1-of-1, 2-of-3, or 3-of-5 protection",
      "Enroll passkeys and trusted devices",
      "Recover or sweep without exposing a seed phrase in normal use",
    ],
    boundaries: [
      "Not the shared spending wallet flow",
      "No agent permissions in the recovery setup",
      "Recovery actions stay separate from treasury policy",
    ],
  },
  {
    id: "p2pdefi",
    name: "ClearSig P2P DeFi",
    shortName: "P2P DeFi",
    host: "p2pdefi.clearsig.xyz",
    path: "/p2pdefi",
    status: "live",
    eyebrow: "For peer-to-peer coordination",
    headline: "Peer-to-peer DeFi coordination on ClearSig primitives.",
    summary:
      "Coordinate offers, intents, counterparty approvals, and policy-checked settlement from a dedicated product path.",
    ctaLabel: "Create P2P workspace",
    ctaHref: "/app/wallet/new?surface=p2pdefi&purpose=share",
    secondaryHref: "/security",
    secondaryLabel: "Review signing model",
    primitives: ["Signed intents", "Policy gates", "Settlement proofs"],
    features: ["Offer discovery", "Counterparty approvals", "Policy-checked settlement"],
    boundaries: [
      "Counterparty coordination stays separate from treasury setup",
      "Every settlement still passes a readable ClearSig request",
      "Marketplace and escrow claims are not mixed into core wallet UI",
    ],
  },
  {
    id: "payments",
    name: "ClearSig Payments",
    shortName: "Payments",
    host: "payments.clearsig.xyz",
    path: "/payments",
    status: "live",
    eyebrow: "For invoices and payouts",
    headline: "Payment flows coordinated by ClearSig authority.",
    summary:
      "Coordinate invoices, approvals, recurring payments, and business payout controls from a dedicated product path.",
    ctaLabel: "Create payments workspace",
    ctaHref: "/app/wallet/new?surface=payments&purpose=share",
    secondaryHref: "/privacy",
    secondaryLabel: "Policy privacy",
    primitives: ["Payment intents", "Approvals", "Treasury policy"],
    features: ["Invoices", "Recurring approvals", "Payout review"],
    boundaries: [
      "Payment approvals stay separate from personal recovery",
      "Recurring payment controls stay explicit",
      "No agent trading controls in the default payments path",
    ],
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
