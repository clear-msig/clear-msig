"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listNotificationFeed,
  markAllNotificationSeen,
  markNotificationSeen,
  subscribe,
  type NotificationFeedEntry,
} from "@/lib/security/notificationFeed";

export function useNotificationFeed(userAddress: string) {
  const [rows, setRows] = useState<NotificationFeedEntry[]>([]);

  const refresh = useCallback(() => {
    setRows(listNotificationFeed(userAddress));
  }, [userAddress]);

  useEffect(() => {
    refresh();
    return subscribe(refresh);
  }, [refresh]);

  const unreadCount = rows.filter((r) => !r.seenAt).length;

  const markSeen = useCallback(
    (id: string) => {
      markNotificationSeen(userAddress, id);
      refresh();
    },
    [refresh, userAddress],
  );

  const markAllSeen = useCallback(() => {
    markAllNotificationSeen(userAddress);
    refresh();
  }, [refresh, userAddress]);

  return { rows, unreadCount, refresh, markSeen, markAllSeen };
}
