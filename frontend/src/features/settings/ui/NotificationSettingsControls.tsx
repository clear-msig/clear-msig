"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Check, Clock3, Mail, Webhook } from "lucide-react";
import { useActionNotifications } from "@/lib/hooks/useActionNotifications";
import {
  isValidEmailAddress,
  loadEmailPrefs,
  saveEmailPrefs,
  type EmailNotificationPrefs,
} from "@/lib/security/emailNotifications";
import {
  loadApprovalReminderPrefs,
  saveApprovalReminderPrefs,
  type ApprovalReminderPrefs,
} from "@/lib/security/approvalReminders";
import {
  ALL_EVENT_TYPES,
  emptyWebhookPrefs,
  eventTypeLabel,
  fireTestWebhook,
  isValidWebhookUrl,
  loadWebhookPrefs,
  saveWebhookPrefs,
  type WebhookEventType,
  type WebhookPrefs,
} from "@/lib/security/webhookNotifications";

export function NotificationSettingsControls({
  notif,
}: {
  notif: ReturnType<typeof useActionNotifications>;
}) {
  return (
    <>
      <NotificationsSettingRow notif={notif} />
      <EmailNotificationsSettingRow />
      <ApprovalReminderSettingRow />
    </>
  );
}

export function WebhookSettingsControl() {
  return <WebhooksSettingRow />;
}

// ─── Notifications row ────────────────────────────────────────────

function NotificationsSettingRow({
  notif,
}: {
  notif: ReturnType<typeof useActionNotifications>;
}) {
  const Icon = notif.permission === "granted" ? Bell : BellOff;
  const title =
    notif.permission === "granted"
      ? "Notifications on"
      : notif.permission === "denied"
        ? "Notifications blocked"
        : !notif.supported
          ? "Notifications unsupported"
          : "Get notified for pending approvals";
  const body =
    notif.permission === "granted"
      ? "You'll get a browser ping when a new request needs your approval and this tab is in the background."
      : notif.permission === "denied"
        ? "Permission was blocked. Re-enable it in your browser settings, then come back here."
        : !notif.supported
          ? "This browser doesn't support browser notifications. The in-app badge still shows pending requests."
          : "A browser ping when a new request needs your approval. Only fires when this tab is in the background.";
  const showEnableButton = notif.supported && notif.permission === "default";

  return (
    <section className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-strong">{title}</p>
        <p className="mt-0.5 text-xs text-text-soft">{body}</p>
      </div>
      {showEnableButton && (
        <button
          type="button"
          onClick={() => void notif.request()}
          className={
            "shrink-0 inline-flex min-h-tap items-center justify-center rounded-full bg-accent px-4 py-2 text-xs font-medium text-text-on-accent " +
            "transition-[background-color,transform] duration-base ease-out-soft " +
            "hover:bg-accent-hover active:scale-[0.98] " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          }
        >
          Enable
        </button>
      )}
    </section>
  );
}

// ─── Email notifications row ────────────────────────────────────

function EmailNotificationsSettingRow() {
  // localStorage-backed prefs. Mount-only read - saves are pushed
  // through saveEmailPrefs immediately so cross-tab pickup works on
  // next render of the consumer (useActionNotifications re-reads on
  // each fire).
  const [prefs, setPrefs] = useState<EmailNotificationPrefs | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const p = loadEmailPrefs();
    setPrefs(p);
    setDraft(p.email);
  }, []);

  if (!prefs) {
    // Pre-hydration on the server / first paint. Render the same
    // shell so the layout doesn't flicker.
    return (
      <section className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Mail className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">
            Email me about pending approvals
          </p>
          <p className="mt-0.5 text-xs text-text-soft">Loading…</p>
        </div>
      </section>
    );
  }

  const trimmed = draft.trim();
  const valid = isValidEmailAddress(trimmed);
  const hasEmail = prefs.email.trim().length > 0;

  const setEnabled = (enabled: boolean) => {
    const next: EmailNotificationPrefs = { ...prefs, enabled };
    setPrefs(next);
    saveEmailPrefs(next);
  };
  const saveEmail = () => {
    if (!valid) return;
    const next: EmailNotificationPrefs = {
      ...prefs,
      email: trimmed,
      // Auto-enable on first save - there's no point asking the user
      // to type their email then flip a separate toggle.
      enabled: true,
    };
    setPrefs(next);
    saveEmailPrefs(next);
    setEditing(false);
  };
  const removeEmail = () => {
    const next: EmailNotificationPrefs = {
      ...prefs,
      email: "",
      enabled: false,
    };
    setPrefs(next);
    saveEmailPrefs(next);
    setDraft("");
    setEditing(false);
  };

  const title = hasEmail
    ? prefs.enabled
      ? "Emails on"
      : "Emails paused"
    : "Email me about pending approvals";
  const body = hasEmail
    ? prefs.enabled
      ? `Sending to ${prefs.email}. One per minute, only when this tab is in the background.`
      : `Saved as ${prefs.email}. Toggle back on to resume.`
    : "Get an email when a new approval lands and you're not on the page. Only fires while Clear is loaded somewhere.";

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Mail className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">{title}</p>
          <p className="mt-0.5 text-xs text-text-soft">{body}</p>
        </div>
        {hasEmail && (
          <button
            type="button"
            onClick={() => setEnabled(!prefs.enabled)}
            aria-pressed={prefs.enabled}
            className={
              "shrink-0 inline-flex min-h-tap items-center justify-center rounded-full px-4 py-2 text-xs font-medium transition-[background-color,transform] duration-base ease-out-soft active:scale-[0.98] " +
              (prefs.enabled
                ? "border border-border-soft bg-canvas text-text-soft hover:border-rose-500 hover:text-rose-600"
                : "bg-accent text-text-on-accent hover:bg-accent-hover")
            }
          >
            {prefs.enabled ? "Pause" : "Resume"}
          </button>
        )}
      </div>

      {(editing || !hasEmail) ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            aria-label="Notification email address"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="you@example.com"
            spellCheck={false}
            autoComplete="email"
            className={
              "min-w-0 flex-1 rounded-soft border border-border-soft bg-canvas px-3 py-2 font-mono text-xs text-text-strong outline-none " +
              "transition-[border-color,box-shadow] duration-base ease-out-soft " +
              "focus:border-accent focus:shadow-accent-rest"
            }
          />
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={saveEmail}
              disabled={!valid}
              className={
                "inline-flex min-h-tap items-center justify-center rounded-full bg-accent px-4 py-2 text-xs font-medium text-text-on-accent " +
                "transition-[background-color,transform] duration-base ease-out-soft " +
                "hover:bg-accent-hover active:scale-[0.98] " +
                "disabled:cursor-not-allowed disabled:opacity-50 " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
              }
            >
              Save
            </button>
            {hasEmail && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraft(prefs.email);
                }}
                className="inline-flex min-h-tap items-center justify-center rounded-full border border-border-soft bg-canvas px-4 py-2 text-xs font-medium text-text-soft hover:text-accent"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex min-h-tap items-center justify-center rounded-full border border-border-soft bg-canvas px-4 py-2 text-xs font-medium text-text-soft hover:text-accent"
          >
            Change email
          </button>
          <button
            type="button"
            onClick={removeEmail}
            className="inline-flex min-h-tap items-center justify-center rounded-full border border-border-soft bg-canvas px-4 py-2 text-xs font-medium text-text-soft hover:border-rose-500 hover:text-rose-600"
          >
            Remove
          </button>
        </div>
      )}
      {trimmed.length > 0 && !valid && (
        <p className="mt-2 text-xs text-warning">
          That doesn&rsquo;t look like a valid email address.
        </p>
      )}
    </section>
  );
}

function ApprovalReminderSettingRow() {
  const [prefs, setPrefs] = useState<ApprovalReminderPrefs | null>(null);

  useEffect(() => {
    const refresh = () => setPrefs(loadApprovalReminderPrefs());
    refresh();
    window.addEventListener("clear:approval-reminders-changed", refresh);
    return () =>
      window.removeEventListener("clear:approval-reminders-changed", refresh);
  }, []);

  if (!prefs) {
    return (
      <section className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Clock3 className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">Approval reminders</p>
          <p className="mt-0.5 text-xs text-text-soft">Loading…</p>
        </div>
      </section>
    );
  }

  const toggle = () => {
    const next = { ...prefs, enabled: !prefs.enabled };
    setPrefs(next);
    saveApprovalReminderPrefs(next);
  };

  return (
    <section className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Clock3 className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-strong">
          {prefs.enabled ? "Approval reminders on" : "Approval reminders paused"}
        </p>
        <p className="mt-0.5 text-xs text-text-soft">
          {prefs.enabled
            ? "ClearSig will keep nudging you while approvals are waiting."
            : "Pending approvals still appear in Home and Notifications."}
        </p>
      </div>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={prefs.enabled}
        className={
          "shrink-0 inline-flex min-h-tap items-center justify-center rounded-full px-4 py-2 text-xs font-medium transition-[background-color,transform] duration-base ease-out-soft active:scale-[0.98] " +
          (prefs.enabled
            ? "border border-border-soft bg-canvas text-text-soft hover:border-rose-500 hover:text-rose-600"
            : "bg-accent text-text-on-accent hover:bg-accent-hover")
        }
      >
        {prefs.enabled ? "Pause" : "Turn on"}
      </button>
    </section>
  );
}

// ─── Webhook notifications row ──────────────────────────────────

function WebhooksSettingRow() {
  const [prefs, setPrefs] = useState<WebhookPrefs | null>(null);
  const [draftUrl, setDraftUrl] = useState("");
  const [draftSecret, setDraftSecret] = useState("");
  const [editing, setEditing] = useState(false);
  const [test, setTest] = useState<
    | { status: "idle" }
    | { status: "running" }
    | { status: "ok" }
    | { status: "fail" }
  >({ status: "idle" });

  useEffect(() => {
    const p = loadWebhookPrefs();
    setPrefs(p);
    setDraftUrl(p.url);
    setDraftSecret(p.secret);
  }, []);

  if (!prefs) {
    return (
      <section className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Webhook className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">Webhook</p>
          <p className="mt-0.5 text-xs text-text-soft">Loading…</p>
        </div>
      </section>
    );
  }

  const trimmedUrl = draftUrl.trim();
  const validUrl = isValidWebhookUrl(trimmedUrl);
  const hasUrl = isValidWebhookUrl(prefs.url);

  const setEnabled = (enabled: boolean) => {
    const next: WebhookPrefs = { ...prefs, enabled };
    setPrefs(next);
    saveWebhookPrefs(next);
  };

  const toggleEvent = (event: WebhookEventType) => {
    const has = prefs.events.includes(event);
    const events = has
      ? prefs.events.filter((e) => e !== event)
      : [...prefs.events, event];
    const next: WebhookPrefs = { ...prefs, events };
    setPrefs(next);
    saveWebhookPrefs(next);
  };

  const saveUrl = () => {
    if (!validUrl) return;
    const next: WebhookPrefs = {
      ...prefs,
      url: trimmedUrl,
      secret: draftSecret,
      enabled: true,
    };
    setPrefs(next);
    saveWebhookPrefs(next);
    setEditing(false);
    setTest({ status: "idle" });
  };
  const removeUrl = () => {
    const next = emptyWebhookPrefs();
    setPrefs(next);
    saveWebhookPrefs(next);
    setDraftUrl("");
    setDraftSecret("");
    setEditing(false);
    setTest({ status: "idle" });
  };

  const runTest = async () => {
    setTest({ status: "running" });
    const ok = await fireTestWebhook();
    setTest({ status: ok ? "ok" : "fail" });
  };

  const title = hasUrl
    ? prefs.enabled
      ? "Webhook on"
      : "Webhook paused"
    : "Pipe events into your ops tools";
  const body = hasUrl
    ? prefs.enabled
      ? `Posting to ${shortenUrl(prefs.url)} on ${prefs.events.length} event ${prefs.events.length === 1 ? "type" : "types"}.`
      : `Saved as ${shortenUrl(prefs.url)}. Toggle back on to resume.`
    : "POST a JSON payload to your Slack / Discord / Zapier / PagerDuty hook for new pending approvals, executes, and failures. Only fires while Clear is loaded.";

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Webhook className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">{title}</p>
          <p className="mt-0.5 text-xs text-text-soft">{body}</p>
        </div>
        {hasUrl && (
          <button
            type="button"
            onClick={() => setEnabled(!prefs.enabled)}
            aria-pressed={prefs.enabled}
            className={
              "shrink-0 inline-flex min-h-tap items-center justify-center rounded-full px-4 py-2 text-xs font-medium transition-[background-color,transform] duration-base ease-out-soft active:scale-[0.98] " +
              (prefs.enabled
                ? "border border-border-soft bg-canvas text-text-soft hover:border-rose-500 hover:text-rose-600"
                : "bg-accent text-text-on-accent hover:bg-accent-hover")
            }
          >
            {prefs.enabled ? "Pause" : "Resume"}
          </button>
        )}
      </div>

      {(editing || !hasUrl) ? (
        <div className="mt-3 flex flex-col gap-2">
          <input
            type="url"
            aria-label="Webhook URL"
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            spellCheck={false}
            autoComplete="off"
            className={
              "rounded-soft border border-border-soft bg-canvas px-3 py-2 font-mono text-xs text-text-strong outline-none " +
              "transition-[border-color,box-shadow] duration-base ease-out-soft " +
              "focus:border-accent focus:shadow-accent-rest"
            }
          />
          <input
            type="text"
            aria-label="Webhook signing secret"
            value={draftSecret}
            onChange={(e) => setDraftSecret(e.target.value)}
            placeholder="Optional: shared secret for HMAC-SHA256 signature"
            spellCheck={false}
            autoComplete="off"
            className={
              "rounded-soft border border-border-soft bg-canvas px-3 py-2 font-mono text-xs text-text-strong outline-none " +
              "transition-[border-color,box-shadow] duration-base ease-out-soft " +
              "focus:border-accent focus:shadow-accent-rest"
            }
          />
          <p className="text-[11px] text-text-soft">
            Receivers verify the <code className="font-mono">X-Clear-Signature</code>{" "}
            header by recomputing HMAC-SHA256 over the raw body using this secret.
            Leave empty to skip signing.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveUrl}
              disabled={!validUrl}
              className={
                "inline-flex min-h-tap items-center justify-center rounded-full bg-accent px-4 py-2 text-xs font-medium text-text-on-accent " +
                "transition-[background-color,transform] duration-base ease-out-soft " +
                "hover:bg-accent-hover active:scale-[0.98] " +
                "disabled:cursor-not-allowed disabled:opacity-50 " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
              }
            >
              Save
            </button>
            {hasUrl && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraftUrl(prefs.url);
                  setDraftSecret(prefs.secret);
                }}
                className="inline-flex min-h-tap items-center justify-center rounded-full border border-border-soft bg-canvas px-4 py-2 text-xs font-medium text-text-soft hover:text-accent"
              >
                Cancel
              </button>
            )}
          </div>
          {trimmedUrl.length > 0 && !validUrl && (
            <p className="text-xs text-warning">
              Must be a valid http(s) URL.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {ALL_EVENT_TYPES.map((ev) => {
              const active = prefs.events.includes(ev);
              return (
                <button
                  key={ev}
                  type="button"
                  onClick={() => toggleEvent(ev)}
                  className={
                    "rounded-soft border px-3 py-2 text-left text-xs font-medium transition-[border-color,background-color,transform] duration-base ease-out-soft " +
                    (active
                      ? "border-accent bg-accent/[0.08] text-text-strong"
                      : "border-border-soft bg-canvas text-text-soft hover:text-text-strong")
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{eventTypeLabel(ev)}</span>
                    {active && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void runTest()}
              disabled={test.status === "running"}
              className={
                "inline-flex min-h-tap items-center justify-center rounded-full border border-border-soft bg-canvas px-4 py-2 text-xs font-medium transition-colors duration-base ease-out-soft " +
                (test.status === "ok"
                  ? "border-accent text-accent"
                  : test.status === "fail"
                    ? "border-warning text-warning"
                    : "text-text-soft hover:text-accent") +
                " disabled:cursor-not-allowed disabled:opacity-50"
              }
            >
              {test.status === "running"
                ? "Sending…"
                : test.status === "ok"
                  ? "Test sent ✓"
                  : test.status === "fail"
                    ? "Test failed"
                    : "Send test"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex min-h-tap items-center justify-center rounded-full border border-border-soft bg-canvas px-4 py-2 text-xs font-medium text-text-soft hover:text-accent"
            >
              Change URL
            </button>
            <button
              type="button"
              onClick={removeUrl}
              className="inline-flex min-h-tap items-center justify-center rounded-full border border-border-soft bg-canvas px-4 py-2 text-xs font-medium text-text-soft hover:border-rose-500 hover:text-rose-600"
            >
              Remove
            </button>
          </div>
          {test.status === "fail" && (
            <p className="mt-2 text-xs text-warning">
              The test POST didn&rsquo;t come back 2xx. Common causes: CORS isn&rsquo;t
              allowed by your destination, the URL changed, or the endpoint
              expects a different body format.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function shortenUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.host + (url.pathname.length > 1 ? url.pathname : "");
  } catch {
    return u;
  }
}
