export type NotificationKind =
  | "pending_approval"
  | "wallet_request"
  | "membership_change"
  | "money_movement";

export interface NotificationFeedEntry {
  id: string;
  sourceId: string;
  kind: NotificationKind;
  walletName: string;
  title: string;
  body: string;
  href?: string;
  createdAt: number;
  seenAt?: number;
}

export interface NotificationEventInput {
  sourceId: string;
  kind: NotificationKind;
  walletName: string;
  title: string;
  body: string;
  href?: string;
  createdAt?: number;
}

export interface NotificationIngestResult {
  entry: NotificationFeedEntry;
  inserted: boolean;
}
