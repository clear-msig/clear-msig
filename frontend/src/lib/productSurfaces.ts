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

export function isProductSurfaceId(value: string | null | undefined): value is ProductSurfaceId {
  return (
    value === "personal" ||
    value === "pro" ||
    value === "agent" ||
    value === "secure" ||
    value === "p2pdefi" ||
    value === "payments"
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
    headline: "A safer wallet for people you trust.",
    summary: "Create a shared wallet, add trusted people, approve together.",
    ctaLabel: "Enter Personal",
    ctaHref: productConnectHref("personal"),
    secondaryHref: "/security",
    secondaryLabel: "Review security",
    primitives: ["Multisig authority", "Device and wallet approvals", "Shared activity"],
    features: [
      "Create wallet",
      "Add trusted people",
      "Send and approve",
      "Track activity",
    ],
    boundaries: [
      "Advanced policy setup",
      "Agent trading",
      "Company treasury controls",
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
    headline: "Treasury controls for real teams.",
    summary: "Run team wallets with approvers, spending rules, and audit trails.",
    ctaLabel: "Enter Pro",
    ctaHref: productConnectHref("pro"),
    secondaryHref: "/privacy",
    secondaryLabel: "Policy privacy",
    primitives: ["Multisig authority", "Policy engine", "Encrypt commitments"],
    features: [
      "Add teammates",
      "Set policy",
      "Review payouts",
      "Audit activity",
    ],
    boundaries: [
      "Personal recovery",
      "Agent sessions",
      "P2P settlement",
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
    summary: "Let agents trade inside limits you approve. They never get raw custody.",
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
    headline: "Recover your key with trusted devices.",
    summary: "Create a recovery vault, enroll passkeys, recover safely.",
    ctaLabel: "Open Secure",
    ctaHref: productConnectHref("secure"),
    secondaryHref: "/security",
    secondaryLabel: "Review security",
    primitives: ["Recovery vault", "Passkey thresholds", "Sweep flow"],
    features: [
      "Create vault",
      "Pick threshold",
      "Enroll devices",
      "Sweep when needed",
    ],
    boundaries: [
      "Shared spending",
      "Agent permissions",
      "Treasury policy",
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
    summary: "Offer coordination and policy-checked settlement will open after the core flows are sharper.",
    ctaLabel: "Coming soon",
    ctaHref: "/p2pdefi",
    secondaryHref: "/security",
    secondaryLabel: "Review signing model",
    primitives: ["Signed intents", "Policy gates", "Settlement proofs"],
    features: ["Offer discovery", "Counterparty approvals", "Policy-checked settlement"],
    boundaries: [
      "Treasury setup",
      "Personal recovery",
      "Agent sessions",
    ],
  },
  {
    id: "payments",
    name: "ClearSig Payments",
    shortName: "Payments",
    host: "payments.clearsig.xyz",
    path: "/payments",
    status: "live",
    eyebrow: "Being folded into product flows",
    headline: "Payments belong inside the workflows people already use.",
    summary:
      "Payments are being integrated into Personal, Pro, Agents, and P2P DeFi flows instead of living as a separate first-choice product.",
    ctaLabel: "Enter Pro",
    ctaHref: productConnectHref("pro"),
    secondaryHref: "/personal",
    secondaryLabel: "Personal shared payments",
    primitives: ["Payment intents", "Approvals", "Treasury policy"],
    features: ["Invoices inside Pro", "Shared payments inside Personal", "Agent funding approvals"],
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
