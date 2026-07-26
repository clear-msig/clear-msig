"use client";

import { useState } from "react";
import { Check, ShieldAlert, UserPlus } from "lucide-react";
import { FormField, TextInput } from "@/components/retail/FormField";
import { shortAddress } from "@/lib/retail/contacts";
import type { ResolvedSolanaRecipient } from "@/features/send/domain/solanaSend";

// ─── Recipient status row ──────────────────────────────────────────

export function RecipientStatus({
  resolved,
  savedNewContact,
  onSaveContact,
}: {
  resolved: ResolvedSolanaRecipient;
  savedNewContact: boolean;
  onSaveContact: (name: string, address: string) => void;
}) {
  if (resolved.kind === "empty") {
    // Empty-state hint moved into the To field's info icon. Rendering
    // it inline used to nudge the layout every time the user cleared
    // the field, and on a quiet send view it pulled focus the wrong
    // way. Keep the row hidden so the page stays still when there's
    // nothing to say.
    return null;
  }
  if (resolved.kind === "resolving") {
    return (
      <p className="-mt-1 inline-flex items-center gap-1.5 text-xs text-text-soft">
        Resolving {resolved.name}…
      </p>
    );
  }
  if (resolved.kind === "unknown") {
    return (
      <p className="-mt-1 text-xs text-warning">
        That doesn&rsquo;t look like a contact name, a .sol domain,
        or a valid wallet address.
      </p>
    );
  }
  if (resolved.kind === "contact") {
    return (
      <p className="-mt-1 inline-flex items-center gap-1.5 text-xs text-accent">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
        Sending to {resolved.contact.name} ·{" "}
        <span className="font-mono text-text-soft">
          {shortAddress(resolved.contact.address)}
        </span>
      </p>
    );
  }
  if (resolved.kind === "sns") {
    return (
      <p className="-mt-1 inline-flex items-center gap-1.5 text-xs text-accent">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
        Resolved {resolved.name} ·{" "}
        <span className="font-mono text-text-soft">
          {shortAddress(resolved.address)}
        </span>
      </p>
    );
  }
  // Pasted address - warn explicitly and offer to save as a contact.
  return (
    <PastedAddressNotice
      address={resolved.address}
      savedNewContact={savedNewContact}
      onSaveContact={onSaveContact}
    />
  );
}

function PastedAddressNotice({
  address,
  savedNewContact,
  onSaveContact,
}: {
  address: string;
  savedNewContact: boolean;
  onSaveContact: (name: string, address: string) => void;
}) {
  const [showSave, setShowSave] = useState(false);
  const [name, setName] = useState("");

  return (
    <div className="-mt-1 flex flex-col gap-2 rounded-soft border border-warning/30 bg-warning/5 p-3">
      <p className="inline-flex items-start gap-1.5 text-xs text-text-strong">
        <ShieldAlert
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
          aria-hidden="true"
        />
        <span>
          New address.{" "}
          <span className="font-mono text-text-soft">
            {shortAddress(address)}
          </span>
          . Make sure this is correct. Money sent to the wrong address
          can&rsquo;t be reversed.
        </span>
      </p>
      {!savedNewContact && (
        <div>
          {!showSave ? (
            <button
              type="button"
              onClick={() => setShowSave(true)}
              className="inline-flex items-center gap-1 text-xs font-medium text-accent transition-colors duration-base ease-out-soft hover:text-accent-hover"
            >
              <UserPlus className="h-3 w-3" aria-hidden="true" />
              Save as contact
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name (e.g. Sarah)"
                autoFocus
                maxLength={40}
                className="flex-1 text-xs"
              />
              <button
                type="button"
                disabled={name.trim().length < 2}
                onClick={() => {
                  onSaveContact(name.trim(), address);
                  setShowSave(false);
                  setName("");
                }}
                className={
                  "inline-flex min-h-tap items-center justify-center rounded-soft bg-accent px-4 py-2 text-xs font-semibold text-text-on-accent " +
                  "transition-colors duration-base ease-out-soft hover:bg-accent-hover " +
                  "disabled:cursor-not-allowed disabled:opacity-40"
                }
              >
                Save
              </button>
            </div>
          )}
        </div>
      )}
      {savedNewContact && (
        <p className="inline-flex items-center gap-1.5 text-xs text-accent">
          <Check className="h-3 w-3" strokeWidth={3} />
          Saved to contacts
        </p>
      )}
    </div>
  );
}

// ─── Field row (used for To + Note) ─────────────────────────────────

interface FieldProps {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  optional?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
}

export function SolanaSendField({
  label,
  value,
  onChange,
  placeholder,
  optional,
  autoFocus,
  maxLength,
}: FieldProps) {
  return (
    <FormField label={optional ? `${label} (optional)` : label}>
      <TextInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={maxLength}
        spellCheck={false}
      />
    </FormField>
  );
}
