"use client";

// Contacts - the local-first name → address book.
//
// Until a server-synced layer exists, these live in localStorage on
// this device only. The page is straight CRUD: list, add, remove.
// Saved contacts power /send's recipient resolver (typing "Sarah"
// jumps straight to her address) so this is the canonical place to
// audit them, fix typos, or remove someone you don't send to anymore.
//
// User-first redesign:
//   • Compact left-aligned header consistent with the new Home / Activity
//     pages - count + "saved on this device only" privacy reminder.
//   • Search by name OR address - alphabetical sort + filter so users
//     with a long list can find someone in two keystrokes.
//   • Add CTA is an accent button in the toolbar; the add form
//     expands inline below.
//   • Single-card divided list (same pattern as Activity rows) for
//     denser, more scannable browsing once the list grows.
//   • Distinct empty / no-match states - never a dead-end.

import { useMemo, useState } from "react";
import clsx from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Plus, Search, Trash2, UserPlus, Users } from "lucide-react";
import { useContacts } from "@/lib/hooks/useContacts";
import {
  isValidSolanaAddress,
  shortAddress,
  type Contact,
} from "@/lib/retail/contacts";
import { Button } from "@/components/retail/Button";
import { MemberAvatar } from "@/components/retail/MemberAvatar";
import { useToast } from "@/components/ui/Toast";

export default function ContactsPage() {
  const reduce = useReducedMotion();
  const contacts = useContacts();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  // Alphabetical sort + search filter. Locale-aware so non-ASCII
  // names ("Élise") sort correctly. Sensitivity:base ignores accents
  // for the comparison, so "elise" and "Élise" land next to each other.
  const ordered = useMemo(() => {
    const sorted = [...contacts.contacts].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q),
    );
  }, [contacts.contacts, search]);

  const handleAdd = (name: string, address: string) => {
    try {
      contacts.save({ name, address });
      toast.success(`Saved ${name.trim()}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save contact",
      );
    }
  };

  const handleRemove = (id: string, name: string) => {
    contacts.remove(id);
    toast.info(`Removed ${name}`);
  };

  const total = contacts.contacts.length;
  const hydrated = contacts.hydrated;
  const isEmpty = hydrated && total === 0;
  const noMatch = hydrated && !isEmpty && ordered.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <Hero count={total} hydrated={hydrated} reduce={!!reduce} />

      {!isEmpty && (
        <Toolbar
          search={search}
          onSearchChange={setSearch}
          onAdd={() => setAdding(true)}
          adding={adding}
          searchEnabled={total > 0}
        />
      )}

      <AnimatePresence initial={false}>
        {adding && (
          <AddContactForm
            key="add-form"
            onAdd={(n, a) => {
              handleAdd(n, a);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        )}
      </AnimatePresence>

      {contacts.tamperedCount > 0 && (
        <TamperedAlert count={contacts.tamperedCount} />
      )}

      {!hydrated ? (
        <ListSkeleton />
      ) : isEmpty ? (
        // Vertically center the empty state on mobile so the
        // first-time view doesn't read as a tiny card stranded at
        // the top of an otherwise blank screen. min-h is sized to
        // the mobile available area (viewport minus floating header
        // pill + BottomNav). Desktop reverts to natural flow.
        <div className="flex min-h-[calc(100dvh-12rem)] flex-col justify-center md:min-h-0 md:block">
          <EmptyState onAdd={() => setAdding(true)} />
        </div>
      ) : noMatch ? (
        <NoMatchState query={search} onClear={() => setSearch("")} />
      ) : (
        <ContactList
          rows={ordered}
          onRemove={handleRemove}
          reduce={!!reduce}
        />
      )}
    </div>
  );
}

// ─── Hero ──────────────────────────────────────────────────────────

function Hero({
  count,
  hydrated,
  reduce,
}: {
  count: number;
  hydrated: boolean;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const summary = !hydrated
    ? "Loading…"
    : count === 0
      ? "No people saved yet."
      : `${count} ${count === 1 ? "person" : "people"} saved`;
  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.2 }}
      // Mobile: stack centred. md+: keep the original split row
      // (title/subtitle on the left, count summary on the right).
      className="flex flex-col items-center gap-1 text-center md:flex-row md:flex-wrap md:items-end md:justify-between md:gap-x-4 md:gap-y-1 md:text-left"
    >
      <div className="flex flex-col items-center gap-1 md:items-start">
        <h1 className="hidden md:block font-display text-display-xs leading-tight text-text-strong">
          People
        </h1>
        <p className="text-xs text-text-soft sm:text-sm">
          People you trust to receive money.
        </p>
      </div>
      <p className="text-xs text-text-soft sm:text-sm">{summary}</p>
    </motion.div>
  );
}

// ─── Toolbar ───────────────────────────────────────────────────────

function Toolbar({
  search,
  onSearchChange,
  onAdd,
  adding,
  searchEnabled,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  onAdd: () => void;
  adding: boolean;
  searchEnabled: boolean;
}) {
  return (
    <div className="flex items-stretch gap-2">
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-soft"
          aria-hidden="true"
        />
        <input
          type="search"
          aria-label="Search people"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search people…"
          disabled={!searchEnabled}
          className={clsx(
            "h-full w-full rounded-soft border border-border-soft bg-surface-raised py-2 pl-9 pr-3 text-sm text-text-strong shadow-card-rest outline-none",
            "transition-[border-color,box-shadow] duration-base ease-out-soft",
            "placeholder:text-text-soft/60",
            "focus:border-accent focus:shadow-accent-rest",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        />
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={adding}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-soft bg-accent px-3 text-xs font-medium text-text-on-accent shadow-accent-rest",
          "transition-[background-color,box-shadow,transform] duration-base ease-out-soft",
          "hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        )}
      >
        <Plus size={13} aria-hidden="true" />
        <span className="hidden sm:inline">Add person</span>
        <span className="sm:hidden">Add</span>
      </button>
    </div>
  );
}

// ─── Add form ──────────────────────────────────────────────────────

function AddContactForm({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, address: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");

  const trimmedName = name.trim();
  const trimmedAddress = address.trim();
  const addressValid = isValidSolanaAddress(trimmedAddress);
  const canSubmit = trimmedName.length >= 2 && addressValid;

  const submit = () => {
    if (!canSubmit) return;
    onAdd(trimmedName, trimmedAddress);
  };

  return (
    <motion.form
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-accent">
          <UserPlus
            className="h-4 w-4"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </span>
        <p className="font-display text-base font-semibold text-text-strong">
          New person
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Field label="Name">
          <input
            aria-label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sarah"
            autoFocus
            maxLength={40}
            className={clsx(
              "w-full rounded-soft border border-border-soft bg-canvas px-3 py-2 text-sm text-text-strong outline-none",
              "transition-[border-color,box-shadow] duration-base ease-out-soft",
              "placeholder:text-text-soft/60",
              "focus:border-accent focus:shadow-accent-rest",
            )}
          />
        </Field>
        <Field
          label="Address"
          hint={
            address.trim().length > 0 && !addressValid
              ? {
                  tone: "warn",
                  text: "That doesn't look like a valid Solana address.",
                }
              : undefined
          }
        >
          <input
            aria-label="Solana wallet address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Solana wallet address"
            spellCheck={false}
            maxLength={64}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            className={clsx(
              "w-full rounded-soft border border-border-soft bg-canvas px-3 py-2 font-mono text-xs text-text-strong outline-none",
              "transition-[border-color,box-shadow] duration-base ease-out-soft",
              "placeholder:font-sans placeholder:text-text-soft/60",
              "focus:border-accent focus:shadow-accent-rest",
            )}
          />
        </Field>
      </div>

      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            onCancel();
            setName("");
            setAddress("");
          }}
          className="rounded-soft px-3 py-2 text-sm font-medium text-text-soft transition-colors duration-base ease-out-soft hover:text-text-strong"
        >
          Cancel
        </button>
        <Button type="submit" size="md" disabled={!canSubmit}>
          Save
        </Button>
      </div>
    </motion.form>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: { tone: "warn" | "info"; text: string };
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-soft">
        {label}
      </span>
      {children}
      {hint && (
        <span
          role={hint.tone === "warn" ? "alert" : undefined}
          className={clsx(
            "text-xs",
            hint.tone === "warn" ? "text-warning" : "text-text-soft",
          )}
        >
          {hint.text}
        </span>
      )}
    </label>
  );
}

// ─── Tampered integrity alert ──────────────────────────────────────

function TamperedAlert({ count }: { count: number }) {
  return (
    <div
      role="alert"
      className="rounded-card border border-danger/40 bg-danger/[0.06] p-4 text-sm text-text-strong shadow-card-rest"
    >
      <p className="font-medium">
        {count === 1
          ? "1 person was removed for safety."
          : `${count} people were removed for safety.`}
      </p>
      <p className="mt-1 text-xs text-text-soft">
        Re-add them from a trusted source before sending.
      </p>
    </div>
  );
}

// ─── List ──────────────────────────────────────────────────────────

function ContactList({
  rows,
  onRemove,
  reduce,
}: {
  rows: Contact[];
  onRemove: (id: string, name: string) => void;
  reduce: boolean;
}) {
  return (
    <ul className="flex flex-col divide-y divide-border-soft rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
      {rows.map((c, i) => (
        <ContactRow
          key={c.id}
          contact={c}
          // Cap the stagger at 8 - long lists shouldn't cascade for
          // half a second on slow networks.
          delay={Math.min(i, 8) * 0.02}
          reduce={reduce}
          onRemove={() => onRemove(c.id, c.name)}
        />
      ))}
    </ul>
  );
}

function ContactRow({
  contact,
  delay,
  reduce,
  onRemove,
}: {
  contact: Contact;
  delay: number;
  reduce: boolean;
  onRemove: () => void;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } };
  const [confirming, setConfirming] = useState(false);

  return (
    <motion.li
      {...motionProps}
      transition={{ duration: 0.25, delay, ease: [0.22, 1, 0.36, 1] }}
      className="group/row flex items-center gap-3 px-4 py-3 transition-colors duration-base ease-out-soft hover:bg-canvas"
    >
      <MemberAvatar address={contact.address} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text-strong">
          {contact.name}
        </p>
        <p className="mt-0.5 truncate font-mono text-xs text-text-soft">
          {shortAddress(contact.address)}
        </p>
      </div>
      {confirming ? (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-soft px-2 py-1 text-xs font-medium text-text-soft transition-colors duration-base ease-out-soft hover:text-text-strong"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onRemove}
            className={clsx(
              "rounded-soft bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-500",
              "transition-colors duration-base ease-out-soft hover:bg-rose-500/15",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
            )}
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`Remove ${contact.name}`}
          className={clsx(
            // Mobile: always visible (no hover affordance on touch).
            // Desktop (md+): hidden until row hover/focus so the resting
            // list reads cleanly.
            "flex h-9 w-9 items-center justify-center rounded-soft text-text-soft",
            "transition-[opacity,color,background-color] duration-base ease-out-soft",
            "md:opacity-0 md:group-hover/row:opacity-100",
            "hover:bg-rose-500/10 hover:text-rose-500",
            "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
          )}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </motion.li>
  );
}

function ListSkeleton() {
  return (
    <ul className="flex flex-col divide-y divide-border-soft rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-border-soft" />
          <div className="flex-1 space-y-1.5">
            <div className="h-4 w-1/4 animate-pulse rounded bg-border-soft" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-border-soft" />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Empty / no-match ──────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-card border border-dashed border-border-soft bg-surface-raised p-8 text-center shadow-card-rest">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Users className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <p className="mt-4 font-display text-base font-semibold text-text-strong">
        No people yet
      </p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-text-soft">
        Add someone once, then send to their name next time.
      </p>
      <Button size="md" className="mt-5" onClick={onAdd}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add your first person
      </Button>
    </div>
  );
}

function NoMatchState({
  query,
  onClear,
}: {
  query: string;
  onClear: () => void;
}) {
  return (
    <div className="rounded-card border border-border-soft bg-surface-raised p-8 text-center shadow-card-rest">
      <p className="text-sm text-text-soft">
        No people matching{" "}
        <span className="font-medium text-text-strong">
          &ldquo;{query}&rdquo;
        </span>
        .
      </p>
      <button
        type="button"
        onClick={onClear}
        className={clsx(
          "mt-3 inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-xs font-medium text-text-soft",
          "transition-colors duration-base ease-out-soft hover:text-accent",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
        )}
      >
        Clear search
      </button>
    </div>
  );
}
