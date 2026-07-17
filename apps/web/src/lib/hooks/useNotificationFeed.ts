"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchNotificationFeed,
  markAllServerNotificationsRead,
  markServerNotificationRead,
  NotificationClientError,
  subscribeToNotificationChanges,
} from "@/lib/notifications/client";
import type { NotificationFeedEntry } from "@/lib/notifications/types";
import { getNotificationSessionKey } from "@/lib/notifications/sessionToken";

export function useNotificationFeed(userAddress: string) {
  const queryClient = useQueryClient();
  const sessionKey = getNotificationSessionKey();
  const queryKey = useMemo(
    () => ["notification-feed", userAddress, sessionKey] as const,
    [sessionKey, userAddress],
  );
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchNotificationFeed(signal),
    enabled: userAddress.length > 0,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const rows = query.data ?? [];

  useEffect(
    () =>
      subscribeToNotificationChanges(() => {
        void queryClient.invalidateQueries({ queryKey });
      }),
    [queryClient, queryKey],
  );

  const markSeen = useCallback(
    async (id: string) => {
      const seenAt = Date.now();
      queryClient.setQueryData<NotificationFeedEntry[]>(queryKey, (current = []) =>
        current.map((entry) => (entry.id === id ? { ...entry, seenAt } : entry)),
      );
      try {
        await markServerNotificationRead(id);
      } catch {
        await queryClient.invalidateQueries({ queryKey });
      }
    },
    [queryClient, queryKey],
  );

  const markAllSeen = useCallback(async () => {
    const seenAt = Date.now();
    queryClient.setQueryData<NotificationFeedEntry[]>(queryKey, (current = []) =>
      current.map((entry) => ({ ...entry, seenAt: entry.seenAt ?? seenAt })),
    );
    try {
      await markAllServerNotificationsRead();
    } catch {
      await queryClient.invalidateQueries({ queryKey });
    }
  }, [queryClient, queryKey]);

  const error = query.error
    ? query.error instanceof NotificationClientError
      ? query.error.message
      : "Notifications are temporarily unavailable."
    : null;

  return {
    rows,
    unreadCount: rows.filter((entry) => !entry.seenAt).length,
    loading: query.isLoading,
    error,
    refresh: query.refetch,
    markSeen,
    markAllSeen,
  };
}
