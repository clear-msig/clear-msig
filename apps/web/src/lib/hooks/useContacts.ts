"use client";

// React wrapper around the localStorage-backed contacts store.
// Keeps a state mirror so React re-renders when contacts change.

import { useCallback, useEffect, useState } from "react";
import {
  type Contact,
  loadContacts,
  saveContact as saveContactRaw,
  removeContact as removeContactRaw,
  getIntegrityReport,
} from "@/lib/retail/contacts";

export function useContacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [tamperedCount, setTamperedCount] = useState(0);

  useEffect(() => {
    setContacts(loadContacts());
    setTamperedCount(getIntegrityReport().tamperedIds.length);
    setHydrated(true);
  }, []);

  const refresh = useCallback(() => {
    setContacts(loadContacts());
    setTamperedCount(getIntegrityReport().tamperedIds.length);
  }, []);

  const save = useCallback(
    (input: { name: string; address: string; email?: string }) => {
      const created = saveContactRaw(input);
      refresh();
      return created;
    },
    [refresh],
  );

  const remove = useCallback(
    (id: string) => {
      removeContactRaw(id);
      refresh();
    },
    [refresh],
  );

  return { contacts, hydrated, save, remove, refresh, tamperedCount };
}
