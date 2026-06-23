export type ChainSendStatus =
  | "ready"
  | "needs_setup"
  | "needs_binding"
  | "coming_soon";

const SEND_READY_CHAIN_KINDS = new Set([0, 1, 2, 3, 5]);

export function baseChainSendStatus(kind: number): ChainSendStatus {
  if (SEND_READY_CHAIN_KINDS.has(kind)) return "ready";
  return "coming_soon";
}

export function chainSendSubtitle(status: ChainSendStatus): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "needs_setup":
      return "Turn on";
    case "needs_binding":
      return "Turn on";
    case "coming_soon":
      return "Coming soon";
  }
}

export function chainSendActionLabel(status: ChainSendStatus): string {
  switch (status) {
    case "ready":
      return "Send";
    case "needs_setup":
    case "needs_binding":
      return "Turn on";
    case "coming_soon":
      return "Soon";
  }
}
