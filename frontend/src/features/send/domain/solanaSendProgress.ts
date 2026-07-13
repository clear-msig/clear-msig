export type SolanaSendingPhase =
  | "preparing"
  | "signing"
  | "submitting"
  | "approving"
  | "cooldown"
  | "executing";

export const SOLANA_SEND_PHASE_LABEL: Record<
  SolanaSendingPhase,
  { primary: string; hint: string }
> = {
  preparing: {
    primary: "Building your request",
    hint: "Pulling the latest wallet state from Solana.",
  },
  signing: {
    primary: "Waiting for your signature",
    hint: "Approve the message in your wallet or on your Ledger.",
  },
  submitting: {
    primary: "Sending to Solana",
    hint: "This usually takes 2-5 seconds.",
  },
  approving: {
    primary: "Approving the request",
    hint: "Approve the second prompt in your wallet to flip your bit.",
  },
  cooldown: {
    primary: "Waiting for the wallet rule",
    hint: "This rule adds extra wait time before the transfer can finish.",
  },
  executing: {
    primary: "Releasing the funds",
    hint: "Enough approvals collected. Finishing the send.",
  },
};
