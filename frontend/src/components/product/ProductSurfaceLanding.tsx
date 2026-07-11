"use client";

import Link from "next/link";
import clsx from "clsx";
import {
  ArrowRight,
  Bot,
  Building2,
  Check,
  CreditCard,
  FileText,
  Handshake,
  KeyRound,
  Layers,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  productSurfaceById,
  type ProductSurface,
  type ProductSurfaceId,
} from "@/lib/productSurfaces";
import { rememberProductSurfaceChoice } from "@/lib/productSession";
import { LandingAtmospherics, LandingNav } from "@/components/landing/LandingChrome";
import { BrandMark } from "@/components/retail/BrandMark";

const ICONS: Record<ProductSurfaceId, LucideIcon> = {
  personal: Users,
  pro: Building2,
  agent: Bot,
  secure: KeyRound,
  p2pdefi: Handshake,
  payments: CreditCard,
};

const FEATURE_ICONS: LucideIcon[] = [
  ShieldCheck,
  Users,
  Layers,
  FileText,
  Sparkles,
  Check,
];

export function ProductSurfaceLanding({ id }: { id: ProductSurfaceId }) {
  const surface = productSurfaceById(id);
  const Icon = ICONS[surface.id];
  const planned = surface.status !== "live";

  return (
    <ProductShell>
      <section className="relative z-10 mx-auto grid min-h-[calc(100vh-96px)] w-full max-w-6xl gap-8 px-5 pb-14 pt-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_390px] lg:px-10">
        <div className="flex flex-col justify-center">
          <p className="flex flex-wrap items-center gap-2 font-mono-tech text-[10px] uppercase tracking-[0.28em] text-[#ccff00]">
            <span>{surface.host}</span>
            {planned ? (
              <span className="rounded-full border border-white/[0.12] px-2 py-0.5 tracking-[0.18em] text-white/46">
                Coming soon
              </span>
            ) : null}
          </p>
          <h1 className="landing-section-heading mt-5 max-w-4xl text-[clamp(2.4rem,7vw,5.8rem)] font-medium leading-[0.9] text-white">
            {surface.headline}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-snug text-white/62 sm:text-lg">
            {surface.summary}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={surface.ctaHref}
              aria-disabled={surface.status !== "live"}
              onClick={() => rememberProductSurfaceChoice(surface.id)}
              className={clsx(
                "inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-bold",
                surface.status === "live"
                  ? "neon-cta"
                  : "pointer-events-none border border-white/[0.08] bg-white/[0.04] text-white/45",
              )}
            >
              {surface.ctaLabel}
              {surface.status === "live" ? (
                <ArrowRight className="h-4 w-4" aria-hidden="true" strokeWidth={2.5} />
              ) : null}
            </Link>
            {surface.secondaryHref && surface.secondaryLabel ? (
              <Link
                href={surface.secondaryHref}
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/15 px-6 text-sm font-medium text-white/76 transition-colors hover:border-white/35 hover:text-white"
              >
                {surface.secondaryLabel}
              </Link>
            ) : null}
          </div>
        </div>

        <aside className="self-center">
          <ProductPreview surfaceId={surface.id} size="lg" />

          <div className="mt-6 flex items-start gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#ccff00] text-black">
              <Icon className="h-5 w-5" aria-hidden="true" strokeWidth={2.2} />
            </span>
            <div>
              <p className="text-sm font-semibold text-white">{surface.name}</p>
              <p className="mt-1 text-xs leading-relaxed text-white/52">
                {surface.eyebrow}
              </p>
            </div>
          </div>

          <SurfaceIconList title="Core actions" items={surface.features} />
          {surface.boundaries.length > 0 ? (
            <SurfaceIconList title="Not here" items={surface.boundaries} muted />
          ) : null}

          <div className="mt-6">
            <p className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/42">
              Simple model
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {surface.primitives.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-white/[0.1] px-2.5 py-1 text-[11px] font-medium text-white/64"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </ProductShell>
  );
}

function ProductShell({
  children,
  cta = { href: "/app/wallet/new", label: "Create wallet" },
}: {
  children: React.ReactNode;
  cta?: { href: string; label: string } | null;
}) {
  return (
    <main className="landing-shell product-experience relative min-h-screen overflow-hidden bg-[#0c0c0c] text-[#ebebeb]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <LandingAtmospherics />
      </div>
      <LandingNav cta={cta} />
      {children}
      <footer className="relative z-10 mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] px-5 py-7 text-xs text-white/45 sm:px-8 lg:px-10">
        <Link href="/" className="flex items-center gap-2 transition-colors hover:text-white">
          <BrandMark size={28} />
          <span className="font-mono-tech uppercase tracking-[0.24em]">clearsig</span>
        </Link>
        <span>Simple wallets. Readable receipts.</span>
      </footer>
    </main>
  );
}

function ProductPreview({
  surfaceId,
  size = "md",
}: {
  surfaceId: ProductSurfaceId;
  size?: "md" | "lg";
}) {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        "product-preview-card relative overflow-hidden rounded-[1.15rem] border",
        size === "lg" ? "min-h-[19rem] p-5" : "min-h-[12rem] p-4",
        surfaceId === "personal" &&
          "border-emerald-300/15 bg-[linear-gradient(135deg,rgba(5,18,14,0.96),rgba(18,42,35,0.72))]",
        surfaceId === "pro" &&
          "border-sky-300/15 bg-[linear-gradient(135deg,rgba(8,13,22,0.98),rgba(22,33,50,0.72))]",
        surfaceId === "agent" &&
          "border-[#ccff00]/20 bg-[linear-gradient(135deg,rgba(5,8,5,0.98),rgba(18,29,12,0.76))]",
        surfaceId === "secure" &&
          "border-fuchsia-200/15 bg-[linear-gradient(135deg,rgba(15,11,18,0.98),rgba(39,25,48,0.72))]",
      )}
    >
      {surfaceId === "personal" ? <PersonalPreview /> : null}
      {surfaceId === "pro" ? <ProPreview /> : null}
      {surfaceId === "agent" ? <AgentPreview /> : null}
      {surfaceId === "secure" ? <SecurePreview /> : null}
    </div>
  );
}

function PersonalPreview() {
  return (
    <div className="flex h-full flex-col justify-between gap-4">
      <div className="flex items-center justify-between">
        <div className="flex -space-x-2">
          {["bg-emerald-300", "bg-cyan-200", "bg-lime-300"].map((tone) => (
            <span
              key={tone}
              className={clsx("h-8 w-8 rounded-full border-2 border-black/35", tone)}
            />
          ))}
        </div>
        <span className="rounded-full bg-emerald-300/14 px-2.5 py-1 text-[10px] font-semibold text-emerald-100">
          Family
        </span>
      </div>
      <div>
        <div className="text-2xl font-semibold text-white">$2,480</div>
        <div className="mt-1 text-[11px] text-emerald-100/55">Shared wallet</div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {["Send", "Receive", "Protect"].map((label) => (
          <span
            key={label}
            className="rounded-xl border border-white/[0.08] bg-white/[0.06] px-2 py-2 text-center text-[10px] font-medium text-white/72"
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ProPreview() {
  return (
    <div className="flex h-full flex-col justify-between gap-4">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-sky-300/12 px-2.5 py-1 text-[10px] font-semibold text-sky-100">
          Treasury
        </span>
        <span className="text-[10px] text-white/45">3 approvals</span>
      </div>
      <div className="space-y-2">
        {[
          ["Payroll", "w-[78%]", "bg-sky-300"],
          ["Vendor", "w-[54%]", "bg-cyan-200"],
          ["Ops", "w-[36%]", "bg-white/55"],
        ].map(([label, width, tone]) => (
          <div key={label} className="rounded-xl border border-white/[0.08] bg-white/[0.055] p-2.5">
            <div className="flex items-center justify-between text-[10px] text-white/62">
              <span>{label}</span>
              <span>Queued</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-white/[0.08]">
              <div className={clsx("h-full rounded-full", width, tone)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentPreview() {
  return (
    <div className="flex h-full flex-col justify-between gap-4">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-[#ccff00]/12 px-2.5 py-1 text-[10px] font-semibold text-[#ccff00]">
          Live desk
        </span>
        <span className="h-2 w-2 rounded-full bg-[#ccff00]" />
      </div>
      <div className="flex items-end gap-1.5">
        {[34, 58, 42, 76, 62, 88, 70].map((height, index) => (
          <span
            key={index}
            className="flex-1 rounded-t bg-[#ccff00]/70"
            style={{ height }}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <span className="rounded-xl border border-[#ccff00]/15 bg-[#ccff00]/[0.08] px-2 py-2 text-[#ccff00]">
          Rules
        </span>
        <span className="rounded-xl border border-white/[0.08] bg-white/[0.055] px-2 py-2 text-white/68">
          Kill switch
        </span>
      </div>
    </div>
  );
}

function SecurePreview() {
  return (
    <div className="flex h-full flex-col justify-between gap-4">
      <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border border-fuchsia-200/20 bg-fuchsia-200/[0.06]">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-fuchsia-200/30 bg-black/25">
          <KeyRound className="h-6 w-6 text-fuchsia-100" strokeWidth={1.9} />
        </div>
      </div>
      <div className="space-y-2">
        {["Passkey", "Trusted device", "Recovery sweep"].map((label) => (
          <div
            key={label}
            className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.055] px-3 py-2 text-[10px] text-white/68"
          >
            <span>{label}</span>
            <Check className="h-3.5 w-3.5 text-fuchsia-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductSupportLink({ surface }: { surface: ProductSurface }) {
  const Icon = ICONS[surface.id];
  const planned = surface.status !== "live";
  return (
    <Link
      href={surface.path}
      className={clsx(
        "group flex min-h-24 items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4",
        "transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.055]",
      )}
    >
      <span
        className={clsx(
          "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border",
          planned
            ? "border-white/[0.08] bg-white/[0.04] text-white/42"
            : "border-[#ccff00]/25 bg-[#ccff00]/10 text-[#ccff00]",
        )}
      >
        <Icon className="h-5 w-5" aria-hidden="true" strokeWidth={1.85} />
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-white">{surface.shortName}</span>
          <span className="rounded-full border border-white/[0.1] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/46">
            {planned ? "Coming soon" : "Capability"}
          </span>
        </span>
        <span className="mt-1 block text-xs leading-snug text-white/50">
          {surface.eyebrow}
        </span>
      </span>
      <ArrowRight
        className="ml-auto h-4 w-4 shrink-0 text-white/35 transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}

function SurfaceIconList({
  title,
  items,
  muted = false,
}: {
  title: string;
  items: string[];
  muted?: boolean;
}) {
  return (
    <div className="mt-6">
      <p className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/42">
        {title}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {items.map((item, index) => {
          const ItemIcon = FEATURE_ICONS[index % FEATURE_ICONS.length];
          return (
            <div
              key={item}
              className="flex items-center gap-2 text-sm text-white/64"
            >
              <span
                className={clsx(
                  "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg",
                  muted
                    ? "bg-white/[0.05] text-white/40"
                    : "bg-[#ccff00]/10 text-[#ccff00]",
                )}
              >
                <ItemIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span>{item}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
