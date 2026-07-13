import { Bot, Building2, KeyRound, ShieldCheck, Users } from "lucide-react";
import clsx from "clsx";
import type { WalletProductSurface } from "@/lib/productWorkspace";

export function ProductDashboardVisual({ surface }: { surface: WalletProductSurface }) {
  return (
    <div
      aria-hidden="true"
      className="relative hidden min-h-[10rem] overflow-hidden rounded-card border border-border-soft bg-canvas/55 p-3 lg:block"
    >
      {surface === "personal" ? <PersonalDashboardVisual /> : null}
      {surface === "pro" ? <ProDashboardVisual /> : null}
      {surface === "agent" ? <AgentDashboardVisual /> : null}
      {surface === "secure" ? <SecureDashboardVisual /> : null}
    </div>
  );
}

function PersonalDashboardVisual() {
  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <div className="flex items-center justify-between">
        <div className="flex -space-x-2">
          {["bg-emerald-300", "bg-sky-200", "bg-lime-300"].map((tone) => (
            <span key={tone} className={clsx("h-8 w-8 rounded-full border-2 border-canvas", tone)} />
          ))}
        </div>
        <span className="rounded-full bg-emerald-300/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">
          Trusted people
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {["Send", "Receive", "Protect"].map((label) => (
          <span key={label} className="rounded-xl border border-border-soft bg-surface-raised px-2 py-2 text-center text-[10px] font-medium text-text-strong">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ProDashboardVisual() {
  return (
    <div className="flex h-full flex-col gap-2.5">
      {["Payroll", "Vendor payout", "Ops budget"].map((label, index) => (
        <div key={label} className="rounded-xl border border-border-soft bg-surface-raised p-2.5">
          <div className="flex items-center justify-between text-[10px] font-medium text-text-soft">
            <span>{label}</span>
            <span>{index + 1}/3</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-border-soft">
            <div className={clsx("h-full rounded-full bg-sky-300", index === 0 ? "w-3/4" : index === 1 ? "w-1/2" : "w-1/3")} />
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentDashboardVisual() {
  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[10px] font-semibold text-accent">
          Live monitor
        </span>
        <span className="h-2 w-2 rounded-full bg-accent" />
      </div>
      <div className="flex items-end gap-1.5">
        {[32, 54, 42, 72, 52, 86, 62].map((height, index) => (
          <span key={index} className="flex-1 rounded-t bg-accent/70" style={{ height }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <span className="rounded-xl border border-accent/20 bg-accent/[0.07] px-2 py-2 text-[10px] font-medium text-accent">
          Safety
        </span>
        <span className="rounded-xl border border-border-soft bg-surface-raised px-2 py-2 text-[10px] font-medium text-text-soft">
          Pause
        </span>
      </div>
    </div>
  );
}

function SecureDashboardVisual() {
  return (
    <div className="flex h-full flex-col justify-between gap-4">
      <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border border-fuchsia-200/20 bg-fuchsia-200/[0.06]">
        <KeyRound className="h-9 w-9 text-fuchsia-200" strokeWidth={1.8} />
      </div>
      <div className="grid gap-2">
        {["Passkey", "Trusted device", "Recovery sweep"].map((label) => (
          <span key={label} className="flex items-center gap-2 rounded-xl border border-border-soft bg-surface-raised px-3 py-2 text-[10px] font-medium text-text-soft">
            <ShieldCheck className="h-3.5 w-3.5 text-fuchsia-200" />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
