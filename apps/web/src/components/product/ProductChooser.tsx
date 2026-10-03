"use client";

import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Building2,
  KeyRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { LandingNav } from "@/components/landing/LandingChrome";
import {
  liveProductSurfaces,
  type ProductSurfaceId,
} from "@/lib/productSurfaces";
import { rememberProductSurfaceChoice } from "@/lib/productSession";

const PRODUCT_ICONS: Record<ProductSurfaceId, LucideIcon> = {
  personal: Users,
  pro: Building2,
  agent: Bot,
  secure: KeyRound,
  p2pdefi: Users,
  payments: Building2,
};

export function ProductChooser() {
  const products = liveProductSurfaces();

  return (
    <main className="public-brand-surface min-h-screen bg-canvas text-text-strong">
      <LandingNav cta={{ href: "/connect", label: "Sign in" }} />

      <section className="mx-auto w-full max-w-6xl px-5 pb-16 pt-10 sm:px-8 sm:pt-16">
        <div className="max-w-2xl">
          <p className="font-mono-tech text-xs uppercase tracking-[0.24em] text-accent">
            Choose a product
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">
            What are you setting up?
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-text-soft sm:text-base">
            Pick the product that matches the job. You will sign in before any wallet is created.
          </p>
        </div>

        <ul className="mt-8 grid gap-3 md:grid-cols-2">
          {products.map((product) => {
            const Icon = PRODUCT_ICONS[product.id];
            return (
              <li key={product.id}>
                <Link
                  href={product.ctaHref}
                  onClick={() => rememberProductSurfaceChoice(product.id)}
                  className="group flex min-h-36 items-start gap-4 rounded-card border border-border-soft bg-surface-raised p-5 transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-accent/35 hover:bg-glass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-soft bg-accent/10 text-accent">
                    <Icon className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold text-text-strong">
                      {product.shortName}
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-text-soft">
                      {product.summary}
                    </span>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-accent">
                      Continue
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
