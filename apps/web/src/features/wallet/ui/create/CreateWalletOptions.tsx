import { Bot, Building2, CreditCard, Handshake, Users, type LucideIcon } from "lucide-react";
import { BackendApiError, BackendTimeoutError } from "@/lib/api/client";
import { backendApi } from "@/lib/api/endpoints";

export const SOL_TRANSFER_TEMPLATE = "examples/intents/solana_transfer.json";

export function isAlreadyInitializedCreateError(err: unknown): boolean {
  const message =
    err instanceof BackendApiError
      ? `${err.message} ${err.payload?.stderr ?? ""}`
      : err instanceof Error
        ? err.message
        : String(err);
  const hay = message.toLowerCase();
  return (
    hay.includes("already exists") ||
    hay.includes("alreadyinitialized") ||
    hay.includes("account already in use") ||
    hay.includes("instruction requires an uninitialized account")
  );
}

function isMaybeLandedCreateError(err: unknown): boolean {
  if (err instanceof BackendTimeoutError) return true;
  if (err instanceof BackendApiError) {
    const statusish = `${err.message} ${err.payload?.kind ?? ""} ${err.payload?.error ?? ""}`.toLowerCase();
    return (
      statusish.includes("status 502") ||
      statusish.includes("status 504") ||
      statusish.includes("proxy_timeout") ||
      statusish.includes("backend is unavailable") ||
      statusish.includes("timed out")
    );
  }
  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    return message.includes("timed out") || message.includes("failed to fetch");
  }
  return false;
}

export async function walletExistsAfterCreateFailure(walletSlug: string, err: unknown): Promise<boolean> {
  const attempts = isMaybeLandedCreateError(err) ? 4 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
    try {
      await backendApi.showWallet(walletSlug);
      return true;
    } catch {
      /* keep polling briefly; the write may be one confirmation behind */
    }
  }
  return false;
}

export type ShapeId = "just_me" | "couple" | "family" | "roommates" | "team";

export interface WalletShape {
  id: ShapeId;
  label: string;
  blurb: string;
  defaultName: string;
  expectedMembers: number;
}

export const SHAPES: WalletShape[] = [
  {
    id: "just_me",
    label: "Just me",
    blurb: "Solo wallet.",
    defaultName: "My wallet",
    expectedMembers: 1,
  },
  {
    id: "couple",
    label: "Me + a partner",
    blurb: "Two signers.",
    defaultName: "Us",
    expectedMembers: 2,
  },
  {
    id: "family",
    label: "Family",
    blurb: "Household wallet.",
    defaultName: "Family",
    expectedMembers: 4,
  },
  {
    id: "roommates",
    label: "Roommates",
    blurb: "Shared expenses.",
    defaultName: "Roommates",
    expectedMembers: 3,
  },
  {
    id: "team",
    label: "Team",
    blurb: "Team approvals.",
    defaultName: "Team",
    expectedMembers: 5,
  },
];

export const PERSONAL_SHAPES = SHAPES.filter((s) => s.id !== "team");

export function defaultNameFor(surface: string | null, purpose: "share" | "secure" | "agent" | null): string {
  if (purpose === "agent") return "Agent vault";
  if (surface === "personal") return "My wallet";
  if (surface === "pro") return "Team treasury";
  if (surface === "p2pdefi") return "P2P workspace";
  if (surface === "payments") return "Payments";
  if (purpose === "share") return "Team";
  return "";
}

export function productSetupFor(surface: string | null): {
  label: string;
  body: string;
  Icon: LucideIcon;
} {
  if (surface === "pro") {
    return {
      label: "Team treasury",
      body: "People and protection come next.",
      Icon: Building2,
    };
  }
  if (surface === "p2pdefi") {
    return {
      label: "P2P DeFi workspace",
      body: "Counterparty coordination.",
      Icon: Handshake,
    };
  }
  if (surface === "payments") {
    return {
      label: "Payments workspace",
      body: "Payment approvals.",
      Icon: CreditCard,
    };
  }
  return {
    label: "Shared wallet",
    body: "Invite people next.",
    Icon: Users,
  };
}

export function agentSetupInfo(): {
  label: string;
  body: string;
  Icon: LucideIcon;
} {
  return {
    label: "Agent vault",
    body: "Choose agent and limits next.",
    Icon: Bot,
  };
}

export type ProductChoiceId = "personal" | "pro" | "agent";

export const PRODUCT_CHOICES: Array<{
  id: ProductChoiceId;
  label: string;
  Icon: LucideIcon;
}> = [
  {
    id: "personal",
    label: "Personal",
    Icon: Users,
  },
  {
    id: "pro",
    label: "Team",
    Icon: Building2,
  },
  {
    id: "agent",
    label: "Agent",
    Icon: Bot,
  },
];
