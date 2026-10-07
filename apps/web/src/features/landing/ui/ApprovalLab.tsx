"use client";

import { useState } from "react";
import { Check, ShieldAlert } from "lucide-react";
import { groupAddress } from "@/lib/review/addressSafety";
import { EXAMPLE_DESTINATION } from "../domain/approvalDocument";
import s from "./ApprovalLab.module.css";

// Same length, same first and last four characters; two stretches of the
// middle are changed, as in an address-poisoning attempt.
const MIDDLE = EXAMPLE_DESTINATION.slice(4, -4);
const LOOKALIKE =
  EXAMPLE_DESTINATION.slice(0, 4) +
  MIDDLE.slice(0, 10) +
  "Zk9m" +
  MIDDLE.slice(14, 26) +
  "Pq7R" +
  MIDDLE.slice(30) +
  EXAMPLE_DESTINATION.slice(-4);

const VAULT_BEFORE = 12.4;
const AMOUNT = 5;
const REQUIRED = 2;

const MEMBERS = [
  { id: "S", name: "Sam" },
  { id: "M", name: "Mara" },
  { id: "A", name: "Alex" },
] as const;

/// A local-only demonstration of the approval screen: nothing here calls a
/// wallet, an RPC, or the network.
export function ApprovalLab() {
  const [approved, setApproved] = useState<ReadonlySet<string>>(new Set(["S"]));
  const [swapped, setSwapped] = useState(false);
  const count = approved.size;
  const met = count >= REQUIRED;
  const destination = swapped ? LOOKALIKE : EXAMPLE_DESTINATION;
  const groups = groupAddress(destination);
  const real = groupAddress(EXAMPLE_DESTINATION);

  const toggle = (id: string) =>
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className={s.lab}>
      <div className={s.bar}>
        <span><i aria-hidden="true" />OPERATIONS WALLET</span>
        <span>Illustrative demo · no transaction</span>
      </div>

      <div className={s.grid}>
        <div className={s.request}>
          <p className={s.label}>You are approving</p>
          <p className={s.amount}>
            {AMOUNT}
            <span>SOL</span>
          </p>

          <p className={s.label}>To</p>
          <div className={s.toRow}>
            <span className={s.pips} aria-hidden="true">
              <i style={{ background: swapped ? "hsl(12 80% 58%)" : "hsl(84 75% 55%)" }} />
              <i style={{ background: swapped ? "hsl(300 60% 60%)" : "hsl(190 70% 55%)" }} />
              <i style={{ background: swapped ? "hsl(48 90% 55%)" : "hsl(265 65% 62%)" }} />
            </span>
            {swapped ? (
              <span className={s.chip} data-tone="bad">
                Looks like Operations vault, but is different
              </span>
            ) : (
              <>
                <strong>Operations vault</strong>
                <span className={s.chip} data-tone="ok">Saved contact</span>
              </>
            )}
          </div>
          <p className={s.addr} aria-label={destination}>
            {groups.map((g, i) => (
              <span
                key={i}
                data-edge={i === 0 || i === groups.length - 1 || undefined}
                data-diff={swapped && g !== real[i] || undefined}
              >
                {g}
              </span>
            ))}
          </p>

          <dl className={s.facts}>
            <div>
              <dt>Vault balance</dt>
              <dd>
                <span className={s.before}>{VAULT_BEFORE} SOL</span>
                <span aria-hidden="true"> → </span>
                <strong>{(VAULT_BEFORE - AMOUNT).toFixed(1)} SOL</strong>
              </dd>
            </div>
            <div>
              <dt>Limit</dt>
              <dd>
                <strong>5 of 10 SOL</strong> this week
              </dd>
            </div>
            <div>
              <dt>Deadline</dt>
              <dd>Expires in 23 hours</dd>
            </div>
          </dl>

          <label className={s.swap}>
            <input
              type="checkbox"
              aria-label="Swap in a look-alike address"
              checked={swapped}
              onChange={(e) => setSwapped(e.target.checked)}
            />
            <span>
              <b>Try to fool it.</b> Swap in a look-alike address.
            </span>
          </label>
        </div>

        <div className={s.people}>
          <p className={s.label}>The people</p>
          <div className={s.meter} role="img" aria-label={`${count} of ${REQUIRED} approvals`}>
            {Array.from({ length: REQUIRED }, (_, i) => (
              <span key={i} data-on={i < count || undefined} />
            ))}
          </div>
          <p className={s.count} aria-live="polite">
            <strong>{count} of {REQUIRED} required approvals</strong>
            <span>
              {met ? "3 members · threshold met in demo" : "3 members · 1 more needed"}
            </span>
          </p>

          <ul className={s.members}>
            {MEMBERS.map((m) => {
              const on = approved.has(m.id);
              return (
                <li key={m.id}>
                  <span className={s.avatar} data-on={on || undefined} aria-hidden="true">
                    {m.id}
                    {on ? <Check size={11} /> : null}
                  </span>
                  <span className={s.memberName}>{m.name}</span>
                  <button
                    type="button"
                    onClick={() => toggle(m.id)}
                    aria-pressed={on}
                    className={s.approve}
                    data-risky={(!on && swapped) || undefined}
                  >
                    {on ? "Approved · undo" : swapped ? "Approve anyway" : "Approve"}
                  </button>
                </li>
              );
            })}
          </ul>

          {swapped ? (
            <p className={s.alert} role="alert">
              <ShieldAlert size={16} aria-hidden="true" />
              The ends match, the middle does not. ClearSig flags this before
              anyone signs, so a swapped address is caught in review.
            </p>
          ) : met ? (
            <p className={s.ready}>
              <Check size={16} aria-hidden="true" />
              Ready to run. With a 1 hour delay it would execute after that wait.
            </p>
          ) : (
            <p className={s.hint}>Approve as Mara to reach the threshold.</p>
          )}

          <button
            type="button"
            className={s.reset}
            onClick={() => {
              setApproved(new Set(["S"]));
              setSwapped(false);
            }}
          >
            Reset demonstration
          </button>
          <p className={s.note}>Local demonstration. No wallet or signature requested.</p>
        </div>
      </div>
    </div>
  );
}
