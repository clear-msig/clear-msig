import { affectsSigningReview } from "./reviewEvents";
/** Lazy browser-only confirmation. It authorizes one handoff, never chain authority. */
let active = false;
export interface PreparedSigningReview {
  document: string;
  signer: string;
  label: string;
  assertCurrent: () => void;
  expiry?: number;
}
export async function requestPreparedSigningReview(review: PreparedSigningReview): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") throw new Error("Signing review requires an active browser page.");
  if (active) throw new Error("Finish or cancel the open signing review first.");
  review.assertCurrent();
  active = true;
  const previous = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-card border border-border-soft bg-surface-raised p-5 text-text-strong shadow-card-rest backdrop:bg-black/60";
  dialog.setAttribute("aria-labelledby", "prepared-signing-title");
  const heading = document.createElement("h2");
  heading.id = "prepared-signing-title"; heading.textContent = "Review before signing";
  heading.className = "font-display text-xl font-semibold"; heading.tabIndex = -1;
  const context = document.createElement("p");
  context.className = "my-3 break-all text-sm";
  context.textContent = `${review.label}\nSigner: ${review.signer}`;
  const note = document.createElement("p");
  note.className = "my-3 text-sm text-text-soft";
  note.textContent = "Check the full action, destination, amount and permissions below. This app review is not independent verification or a guarantee of your device display. Cancel if you cannot verify the requested action.";
  const content = document.createElement("pre");
  content.className = "max-h-[45dvh] overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-soft border border-border-soft bg-canvas p-3 font-mono text-sm";
  content.setAttribute("aria-label", "Exact prepared signing review"); content.textContent = review.document;
  const actions = document.createElement("div"); actions.className = "mt-4 flex flex-wrap gap-3";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel review";
  cancel.className = "min-h-11 rounded-soft border border-border-soft px-4";
  const confirm = document.createElement("button"); confirm.type = "button"; confirm.textContent = "Continue to wallet";
  confirm.className = "min-h-11 rounded-soft bg-accent px-4 font-semibold text-text-on-accent";
  dialog.onkeydown = (event) => {
    if (event.key !== "Tab") return;
    const focused = document.activeElement;
    if (event.shiftKey && (focused === cancel || focused === heading)) {
      event.preventDefault(); confirm.focus();
    } else if (!event.shiftKey && focused === confirm) {
      event.preventDefault(); cancel.focus();
    }
  };
  actions.append(cancel, confirm); dialog.append(heading, context, note, content, actions);
  document.body.append(dialog);
  try {
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const check = () => {
        review.assertCurrent();
        if (review.expiry !== undefined && (!Number.isSafeInteger(review.expiry) || Date.now() / 1000 >= review.expiry - 15))
          throw new Error("Signing review expired. Prepare a new request.");
      };
      const finish = (error?: unknown) => {
        if (done) return;
        done = true; clearInterval(timer);
        window.removeEventListener("popstate", changed);
        window.removeEventListener("input", changed, true);
        window.removeEventListener("storage", changed);
        for (const event of policyEvents) window.removeEventListener(event, changed);
        if (error) reject(error); else resolve();
      };
      const changed = (event: Event) => { if (affectsSigningReview(event)) finish(new Error("Page, form or policy changed. Prepare and review again.")); };
      const policyEvents = ["clear:policies-changed", "clear:spending-budget-changed", "clear:personal-policy-changed"];
      const timer = window.setInterval(() => { try { check(); } catch (error) { finish(error); } }, 100);
      window.addEventListener("popstate", changed);
      window.addEventListener("input", changed, true);
      window.addEventListener("storage", changed);
      for (const event of policyEvents) window.addEventListener(event, changed);
      cancel.onclick = () => finish(new Error("Signing review cancelled. No signature was requested."));
      dialog.oncancel = (event) => { event.preventDefault(); cancel.click(); };
      confirm.onclick = () => { try { check(); finish(); } catch (error) { finish(error); } };
      try { check(); dialog.showModal(); heading.focus(); } catch (error) { finish(error); }
    });
    review.assertCurrent();
  } finally {
    dialog.remove(); active = false;
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
  }
}
