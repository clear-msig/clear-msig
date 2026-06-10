"use client";

import Link from "next/link";
import clsx from "clsx";
import {
  ArrowRight,
  Bot,
  Building2,
  Check,
  CreditCard,
  Handshake,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  PRODUCT_SURFACES,
  productSurfaceById,
  type ProductSurface,
  type ProductSurfaceId,
} from "@/lib/productSurfaces";
import { LandingAtmospherics, LandingNav } from "@/components/landing/LandingChrome";
import { BrandMark } from "@/components/retail/BrandMark";

const ICONS: Record<ProductSurfaceId, LucideIcon> = {
  personal: Users,
  pro: Building2,
  agent: Bot,
  p2pdefi: Handshake,
  payments: CreditCard,
};

export function ProductChooserPage() {
  const live = PRODUCT_SURFACES.filter((surface) => surface.status === "live");
  const planned = PRODUCT_SURFACES.filter((surface) => surface.status === "planned");

  return (
    <ProductShell cta={null}>
      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-96px)] w-full max-w-6xl flex-col justify-center px-5 pb-16 pt-10 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <p className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-[#ccff00]">
            Choose your ClearSig surface
          </p>
          <h1 className="mt-5 text-[clamp(2.4rem,7vw,5.8rem)] font-medium leading-[0.9] text-white">
            One primitive layer. Separate products.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-white/62 sm:text-lg">
            Pick the experience you want. Personal wallets, company treasuries,
            and agent trading should not feel like the same dashboard with
            different labels.
          </p>
        </div>

        <div className="mt-10 grid gap-3 lg:grid-cols-3">
          {live.map((surface) => (
            <SurfaceCard key={surface.id} surface={surface} featured={surface.id === "agent"} />
          ))}
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {planned.map((surface) => (
            <SurfaceCard key={surface.id} surface={surface} compact />
          ))}
        </div>

        <div className="mt-8 rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] p-4">
          <p className="text-sm leading-relaxed text-white/58">
            ClearSig base primitives stay shared underneath: wallet authority,
            signed intents, policy gates, encrypted commitments, execution
            records, and audit trails. The user-facing products stay separate.
          </p>
        </div>
      </section>
    </ProductShell>
  );
}

export function ProductSurfaceLanding({ id }: { id: ProductSurfaceId }) {
  const surface = productSurfaceById(id);
  const Icon = ICONS[surface.id];

  return (
    <ProductShell>
      <section className="relative z-10 mx-auto grid min-h-[calc(100vh-96px)] w-full max-w-6xl gap-8 px-5 pb-14 pt-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_390px] lg:px-10">
        <div className="flex flex-col justify-center">
          <p className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-[#ccff00]">
            {surface.host}
          </p>
          <h1 className="mt-5 max-w-4xl text-[clamp(2.4rem,7vw,5.8rem)] font-medium leading-[0.9] text-white">
            {surface.headline}
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-white/62 sm:text-lg">
            {surface.summary}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={surface.ctaHref}
              aria-disabled={surface.status !== "live"}
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

        <aside className="self-center rounded-[1.4rem] border border-white/[0.1] bg-white/[0.04] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.32)] backdrop-blur-xl">
          <div className="flex items-start gap-3">
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

          <SurfaceList title="This surface includes" items={surface.features} />
          <SurfaceList title="Clear boundaries" items={surface.boundaries} />

          <div className="mt-5 rounded-2xl border border-white/[0.08] bg-black/20 p-4">
            <p className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/42">
              Shared primitives
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
  cta = { href: "/choose", label: "Choose product" },
}: {
  children: React.ReactNode;
  cta?: { href: string; label: string } | null;
}) {
  return (
    <main className="landing-shell relative min-h-screen overflow-hidden bg-[#0c0c0c] text-[#ebebeb]">
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
        <span>Shared primitives. Separate products.</span>
      </footer>
    </main>
  );
}

function SurfaceCard({
  surface,
  featured = false,
  compact = false,
}: {
  surface: ProductSurface;
  featured?: boolean;
  compact?: boolean;
}) {
  const Icon = ICONS[surface.id];
  return (
    <Link
      href={surface.status === "live" ? surface.path : "/choose"}
      className={clsx(
        "group rounded-[1.35rem] border p-4 transition-colors",
        featured
          ? "border-[#ccff00]/40 bg-[#ccff00]/[0.08]"
          : "border-white/[0.09] bg-white/[0.035] hover:border-white/[0.2]",
        surface.status === "planned" && "cursor-default opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={clsx(
            "inline-flex h-10 w-10 items-center justify-center rounded-2xl",
            featured ? "bg-[#ccff00] text-black" : "bg-white/[0.08] text-white",
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="rounded-full border border-white/[0.1] px-2.5 py-1 font-mono-tech text-[9px] uppercase tracking-[0.18em] text-white/46">
          {surface.status === "live" ? surface.host : "planned"}
        </span>
      </div>
      <h2 className={clsx("mt-4 font-semibold text-white", compact ? "text-lg" : "text-xl")}>
        {surface.shortName}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-white/56">{surface.summary}</p>
      {surface.status === "live" ? (
        <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#ccff00]">
          Open surface
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
      ) : null}
    </Link>
  );
}

function SurfaceList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-5">
      <p className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/42">
        {title}
      </p>
      <div className="mt-3 grid gap-2">
        {items.map((item) => (
          <div key={item} className="flex items-start gap-2 text-sm leading-relaxed text-white/64">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#ccff00]" aria-hidden="true" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
