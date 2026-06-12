export type ProductSurfaceId =
  | "personal"
  | "pro"
  | "agent"
  | "secure"
  | "p2pdefi";

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

export function isProductSurfaceId(value: string | null | undefined): value is ProductSurfaceId {
  return (
    value === "personal" ||
    value === "pro" ||
    value === "agent" ||
    value === "secure" ||
    value === "p2pdefi"
  );
}

export function productSetupHref(id: ProductSurfaceId): string {
  const purpose = id === "secure" ? "secure" : id === "agent" ? "agent" : "share";
  return `/app/wallet/new?surface=${id}&purpose=${purpose}`;
}

export function productWorkspaceHref(id: ProductSurfaceId): string {
  if (id === "secure") return "/app/secure?surface=secure";
  return `/app/wallet?surface=${id}`;
}

export function productConnectHref(id: ProductSurfaceId): string {
  return `/connect?next=${encodeURIComponent(productWorkspaceHref(id))}`;
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
      "Create a simple shared wallet for yourself, family, friends, or a small group. Shared payments can come later without turning the first run into a treasury console.",
    ctaLabel: "Enter Personal",
    ctaHref: productConnectHref("personal"),
    secondaryHref: "/security",
    secondaryLabel: "Review security",
    primitives: ["Multisig authority", "Device and wallet approvals", "Shared activity"],
    features: [
      "Create a simple shared wallet",
      "Invite trusted people or devices",
      "Coordinate shared bills and simple payments",
      "Send only after the required approvals",
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
    headline: "Team treasury, approvals, and payouts in one Pro workspace.",
    summary:
      "Protect company wallets with multiple approvers, policy controls, batch transfers, and bank payouts that only move after the multisig approves.",
    ctaLabel: "Enter Pro",
    ctaHref: productConnectHref("pro"),
    secondaryHref: "/privacy",
    secondaryLabel: "Policy privacy",
    primitives: ["Multisig authority", "Policy engine", "Settlement approvals"],
    features: [
      "Configure approvers and thresholds",
      "Add allowlists, limits, roles, and review flows",
      "Prepare single or batch payouts for teams and vendors",
      "Send approved NGN payouts through Kora after treasury approval",
      "Choose transparent or encrypted policy values",
    ],
    boundaries: [
      "Policies belong here, not in the personal default path",
      "Business payouts belong here, not in the personal default path",
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
      "Let agents propose or execute only inside rules you approve. They never get raw custody.",
    ctaLabel: "Enter Agents",
    ctaHref: productConnectHref("agent"),
    secondaryHref: "/agents?surface=agent",
    secondaryLabel: "Browse marketplace",
    primitives: ["Agent identity", "Policy grants", "Kill switch"],
    features: [
      "Choose an agent and set its limits",
      "Gate trades, funding, and payouts",
      "Pause agent activity instantly",
    ],
    boundaries: [],
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
    ctaLabel: "Open Secure",
    ctaHref: productConnectHref("secure"),
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
    status: "planned",
    eyebrow: "For peer-to-peer coordination",
    headline: "Peer-to-peer DeFi coordination is coming soon.",
    summary:
      "P2P DeFi will bring offers, counterparty approvals, and policy-checked settlement into ClearSig after the core agent, treasury, personal, and recovery flows are sharper.",
    ctaLabel: "Coming soon",
    ctaHref: "/p2pdefi",
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
