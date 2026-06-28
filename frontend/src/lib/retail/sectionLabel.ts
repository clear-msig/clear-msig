// Map a pathname to the friendly section label used in the page
// header on every device. Centralised so the desktop DashboardHeader
// and the mobile HeaderBar pull from the same source - no risk of
// "Activity" on desktop and "Activities" on mobile.

import { toDisplayName } from "@/lib/retail/walletNames";

const SUB_LABELS: Record<string, string> = {
  send: "Send",
  members: "People",
  chains: "Networks",
  setup: "Finish setup",
  policies: "Rules",
  activity: "Activity",
  budget: "Budget",
  add: "Add",
  receive: "Receive",
  buy: "Buy",
  sell: "Sell",
  settings: "Settings",
  rules: "Rules",
  allowances: "Allowances",
  policy: "Rules",
  agents: "Agent Trading",
};

export function getSectionLabel(pathname: string): string {
  if (pathname === "/app/wallet") return "Home";
  if (pathname === "/app/wallet/new") return "New wallet";
  if (pathname === "/app/activity") return "Activity";
  if (pathname.startsWith("/app/notifications")) return "Notifications";
  if (pathname === "/app/contacts") return "People";
  if (pathname.startsWith("/app/settings")) return "Settings";
  if (pathname.startsWith("/app/account")) return "Account";
  if (pathname.startsWith("/app/proposals")) return "Request";
  if (pathname.startsWith("/app/intents")) return "Spending rule";
  if (pathname.startsWith("/app/invitations")) return "Invitation";
  // Secure (ikavery) flow.
  if (pathname === "/app/secure") return "Secure";
  if (pathname === "/app/secure/new") return "New vault";
  if (pathname.startsWith("/app/secure/")) {
    // /app/secure/[recovery] and its sub-routes (/enroll, /sweep).
    const segs = pathname.split("/").filter(Boolean);
    const sub = segs[3] ?? "";
    if (sub === "enroll") return "Vault · Enroll";
    if (sub === "sweep") return "Vault · Sweep";
    return "Vault";
  }
  if (pathname.startsWith("/app/wallet/")) {
    const segs = pathname.split("/").filter(Boolean);
    let slug = "";
    try {
      slug = segs[2] ? decodeURIComponent(segs[2]) : "";
    } catch {
      slug = segs[2] ?? "";
    }
    const name = toDisplayName(slug);
    if (segs.length === 3) return name || "Wallet";
    const sub = segs[3] ?? "";
    const subLabel =
      SUB_LABELS[sub] ?? sub.charAt(0).toUpperCase() + sub.slice(1);
    return name ? `${name} · ${subLabel}` : subLabel;
  }
  return "";
}

/// Predicate: does this pathname belong to the wallet send flow?
/// Used to gate scan affordances that only make sense when the user
/// is composing a transfer (need to scan a recipient QR).
export function isSendRoute(pathname: string): boolean {
  return /^\/app\/wallet\/[^/]+\/send(\/|$)/.test(pathname);
}
