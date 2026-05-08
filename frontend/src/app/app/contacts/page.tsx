"use client";

// Contacts — the local-first name → address book.
//
// Until a server-synced layer exists, these live in localStorage on
// this device only. The page is straight CRUD: list, add, remove.
// Saved contacts power /send's recipient resolver (typing "Sarah"
// jumps straight to her address) so this is the canonical place to
// audit them, fix typos, or remove someone you don't send to anymore.

import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Plus, Trash2, UserPlus } from "lucide-react";
import { useContacts } from "@/lib/hooks/useContacts";
import {
  isValidSolanaAddress,
  shortAddress,
  type Contact,
} from "@/lib/retail/contacts";
import { Button } from "@/components/retail/Button";
import { MemberAvatar } from "@/components/retail/MemberAvatar";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { useToast } from "@/components/ui/Toast";

export default function ContactsPage() {
  const reduce = useReducedMotion();
  const contacts = useContacts();
  const toast = useToast();

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  const isEmpty = contacts.hydrated && contacts.contacts.length === 0;

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

  return (
    <div className="flex flex-col gap-6">
      <StickyTopBar offset="header">
        <Link
          href="/app/wallet"
          className={
            "-ml-2 inline-flex w-fit items-center gap-1.5 rounded-soft px-2 py-1 text-sm text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:text-text-strong " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Home
        </Link>
      </StickyTopBar>

      <motion.section
        {...motionProps}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center text-center"
      >
        <span aria-hidden="true" className="block h-px w-10 bg-accent" />
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
          Address book
        </p>
        <h1 className="mt-2 font-display text-display-xs leading-tight text-text-strong">
          Contacts
        </h1>
        <p className="mt-1 text-base text-text-soft">
          Names you&rsquo;ve saved for sending money. Saved on this
          device only.
        </p>
      </motion.section>

      <AddContactForm onAdd={handleAdd} />

      {contacts.tamperedCount > 0 ? (
        <div
          role="alert"
          className="rounded-card border border-danger/40 bg-danger/[0.06] p-3 text-sm text-text-strong"
        >
          <p className="font-medium">
            {contacts.tamperedCount === 1
              ? "1 contact failed an integrity check and was removed."
              : `${contacts.tamperedCount} contacts failed an integrity check and were removed.`}
          </p>
          <p className="mt-1 text-xs text-text-soft">
            Something edited the saved list outside this app. Re-add the
            person from a trusted source before sending.
          </p>
        </div>
      ) : null}

      {!contacts.hydrated ? (
        <div className="space-y-2">
          <ContactRowSkeleton />
          <ContactRowSkeleton />
        </div>
      ) : isEmpty ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-2">
          {contacts.contacts.map((c, i) => (
            <ContactRow
              key={c.id}
              contact={c}
              delay={i * 0.04}
              reduce={!!reduce}
              onRemove={() => handleRemove(c.id, c.name)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Add form ──────────────────────────────────────────────────────

function AddContactForm({
  onAdd,
}: {
  onAdd: (name: string, address: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");

  const trimmedName = name.trim();
  const trimmedAddress = address.trim();
  const addressValid = isValidSolanaAddress(trimmedAddress);
  const canSubmit = trimmedName.length >= 2 && addressValid;

  const submit = () => {
    if (!canSubmit) return;
    onAdd(trimmedName, trimmedAddress);
    setName("");
    setAddress("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          "group inline-flex w-full items-center justify-center gap-2 self-start rounded-card border border-dashed border-border-soft bg-surface-raised px-5 py-4 text-sm font-medium text-text-strong shadow-card-rest " +
          "transition-[transform,box-shadow,border-color] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-raised " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add a contact
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-accent">
          <UserPlus className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <p className="font-display text-base text-text-strong">
          New contact
        </p>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <label className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-xs font-medium uppercase tracking-wide text-text-soft">
            Name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sarah"
            autoFocus
            maxLength={40}
            className="flex-1 bg-transparent py-1.5 text-base text-text-strong outline-none placeholder:text-text-soft/60"
          />
        </label>
        <div className="h-px bg-border-soft" />
        <label className="flex items-start gap-3">
          <span className="w-16 shrink-0 pt-2 text-xs font-medium uppercase tracking-wide text-text-soft">
            Address
          </span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Solana wallet address"
            spellCheck={false}
            maxLength={64}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            className="flex-1 bg-transparent py-1.5 font-mono text-sm text-text-strong outline-none placeholder:font-sans placeholder:text-text-soft/60"
          />
        </label>
        {address.trim().length > 0 && !addressValid && (
          <p className="ml-[4.5rem] text-xs text-warning">
            That doesn&rsquo;t look like a valid Solana address.
          </p>
        )}
      </div>

      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setName("");
            setAddress("");
          }}
          className="rounded-soft px-3 py-2 text-sm font-medium text-text-soft transition-colors duration-base ease-out-soft hover:text-text-strong"
        >
          Cancel
        </button>
        <Button type="submit" size="md" disabled={!canSubmit}>
          Save contact
        </Button>
      </div>
    </form>
  );
}

// ─── Row ───────────────────────────────────────────────────────────

interface ContactRowProps {
  contact: Contact;
  delay: number;
  reduce: boolean;
  onRemove: () => void;
}

function ContactRow({ contact, delay, reduce, onRemove }: ContactRowProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 } };
  const [confirming, setConfirming] = useState(false);

  return (
    <motion.li
      {...motionProps}
      transition={{ duration: 0.3, delay, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest"
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
            className={
              "rounded-soft bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-600 " +
              "transition-colors duration-base ease-out-soft hover:bg-rose-500/15 " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
            }
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`Remove ${contact.name}`}
          className={
            "flex h-8 w-8 items-center justify-center rounded-soft text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:bg-rose-500/10 hover:text-rose-600 " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          }
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </motion.li>
  );
}

function ContactRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-border-soft" />
      <div className="flex-1 space-y-1.5">
        <div className="h-4 w-1/4 animate-pulse rounded bg-border-soft" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-border-soft" />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-card border border-dashed border-border-soft bg-surface-raised p-8 text-center shadow-card-rest">
      <p className="font-display text-base text-text-strong">
        No contacts yet
      </p>
      <p className="mt-2 max-w-sm text-sm text-text-soft mx-auto">
        Save a friend&rsquo;s name and address here, or do it inline
        the first time you send them money.
      </p>
      <Link href="/app/wallet" className="mt-5 inline-block">
        <Button size="md" variant="secondary">
          Back home
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </Link>
    </div>
  );
}
