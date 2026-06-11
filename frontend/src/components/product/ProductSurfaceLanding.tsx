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

export function ProductChooserPage() {
  return (
    <ProductShell cta={null}>
      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-96px)] w-full max-w-6xl flex-col justify-center px-5 pb-16 pt-10 sm:px-8 lg:px-10">
        <div className="max-w-4xl">
          <p className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-[#ccff00]">
            Choose product
          </p>
          <h1 className="mt-5 text-[clamp(2.4rem,7vw,5.8rem)] font-medium leading-[0.9] text-white">
            What are you here to do?
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-white/62 sm:text-lg">
            Pick the product first. Sign in happens after this, and ClearSig
            brings you back to the exact setup path you chose.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
          {PRODUCT_SURFACES.map((surface) => (
            <ProductIconLink key={surface.id} surface={surface} />
          ))}
        </div>

        <ul className="mt-10 grid gap-3 border-t border-white/[0.08] pt-6 text-sm text-white/56 sm:grid-cols-3">
          <li>One primitive layer underneath.</li>
          <li>Six separate product paths above it.</li>
          <li>Your login returns to the product you picked.</li>
        </ul>
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

        <aside className="self-center">
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

          <SurfaceIconList title="This surface includes" items={surface.features} />
          <SurfaceIconList title="Clear boundaries" items={surface.boundaries} muted />

          <div className="mt-6">
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

function ProductIconLink({ surface }: {
  surface: ProductSurface;
}) {
  const Icon = ICONS[surface.id];
  return (
    <Link
      href={surface.ctaHref}
      className={clsx(
        "group flex min-h-44 flex-col items-center justify-start text-center",
        "transition-[transform,color] duration-200 hover:-translate-y-1",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ccff00]/60 focus-visible:ring-offset-4 focus-visible:ring-offset-[#0c0c0c]",
      )}
    >
      <span className="inline-flex h-16 w-16 items-center justify-center rounded-[1.35rem] border border-white/[0.12] bg-white/[0.045] text-white transition-colors group-hover:border-[#ccff00]/45 group-hover:bg-[#ccff00]/10 group-hover:text-[#ccff00]">
        <Icon className="h-7 w-7" aria-hidden="true" strokeWidth={1.85} />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-white">
        {surface.shortName}
      </h2>
      <p className="mt-2 max-w-[11rem] text-xs leading-relaxed text-white/50">
        {surface.eyebrow}
      </p>
      <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-xs font-semibold text-[#ccff00]">
        Choose
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
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
              className="flex items-start gap-2 text-sm leading-relaxed text-white/64"
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
