import type { WalletProductSurface } from "@/lib/productWorkspace";

export function productDashboardCopy(surface: WalletProductSurface | null): {
  title: string;
  body: string;
  footer: string;
} {
  switch (surface) {
    case "personal":
      return {
        title: "Shared money, fewer steps.",
        body: "Send, receive, add trusted people, and keep protection simple.",
        footer: "Personal actions",
      };
    case "pro":
      return {
        title: "Treasury control for teams.",
        body: "Review team wallets, approvals, protection, and audit-ready activity before money moves.",
        footer: "Pro treasury",
      };
    case "agent":
      return {
        title: "Trading agents with safety checks.",
        body: "Choose a trader, set a budget, approve the safety checks, and watch every decision.",
        footer: "Agent trading",
      };
    case "secure":
      return {
        title: "Recovery without panic.",
        body: "Create a recovery vault, enroll trusted devices, and keep sweep actions isolated from spending.",
        footer: "Secure recovery",
      };
    default:
      return {
        title: "Product workspaces",
        body: "Choose a product to continue.",
        footer: "ClearSig - all products",
      };
  }
}

export function productOpenLabel(surface: WalletProductSurface | null): string {
  switch (surface) {
    case "pro":
      return "Open treasury";
    case "agent":
      return "Open agent vault";
    case "secure":
      return "Open Secure";
    case "personal":
      return "Open wallet";
    default:
      return "Open wallet";
  }
}

export function surfaceHeroTone(surface: WalletProductSurface): string {
  switch (surface) {
    case "personal":
      return "border-emerald-300/20 bg-[linear-gradient(135deg,var(--clear-surface-raised),rgba(6,78,59,0.16))]";
    case "pro":
      return "border-sky-300/20 bg-[linear-gradient(135deg,var(--clear-surface-raised),rgba(14,116,144,0.16))]";
    case "agent":
      return "border-accent/25 bg-[linear-gradient(135deg,var(--clear-surface-raised),rgba(204,255,0,0.10))]";
    case "secure":
      return "border-fuchsia-200/20 bg-[linear-gradient(135deg,var(--clear-surface-raised),rgba(126,34,206,0.15))]";
  }
}
