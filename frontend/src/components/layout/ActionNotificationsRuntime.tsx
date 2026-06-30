"use client";

import { useActionNotifications } from "@/lib/hooks/useActionNotifications";

export function ActionNotificationsRuntime() {
  useActionNotifications();
  return null;
}
