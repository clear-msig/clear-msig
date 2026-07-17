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
import { BrandMark } from "@/components/retail/BrandMark";
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
    <main className="min-h-screen bg-[#0c0c0c] text-[#ebebeb]">
      <header className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2" aria-label="ClearSig home">
          <BrandMark size={30} />
          <span className="text-sm font-semibold">ClearSig</span>
        </Link>
        <Link href="/connect" className="text-sm font-medium text-white/62 hover:text-white">
          Sign in
        </Link>
      </header>

      <section className="mx-auto w-full max-w-6xl px-5 pb-16 pt-10 sm:px-8 sm:pt-16">
        <div className="max-w-2xl">
          <p className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-[#ccff00]">
            Choose a product
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">
            What are you setting up?
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-white/58 sm:text-base">
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
                  className="group flex min-h-36 items-start gap-4 rounded-card border border-white/10 bg-white/[0.035] p-5 transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-[#ccff00]/35 hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ccff00]"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-soft bg-[#ccff00]/10 text-[#ccff00]">
                    <Icon className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold text-white">
                      {product.shortName}
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-white/55">
                      {product.summary}
                    </span>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#ccff00]">
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
