"use client";

import Link from "next/link";
import s from "./ProductChooser.module.css";
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

      <section className={s.page}>
        <div className={s.introduction}>
          <p className="font-mono-tech text-xs uppercase tracking-[0.24em] text-accent">
            Choose a product
          </p>
          <h1 className={s.title}>What are you setting up?</h1>
          <p className={s.description}>
            Pick the product that matches the job. You will sign in before any
            wallet is created.
          </p>
          <p className={s.disclosure}>
            Devnet preview · Test funds only. Nothing is created until you
            choose a product and complete its setup.
          </p>
        </div>

        <ul className={s.products}>
          {products.map((product, index) => {
            const Icon = PRODUCT_ICONS[product.id];
            return (
              <li key={product.id}>
                <Link
                  href={product.ctaHref}
                  onClick={() => rememberProductSurfaceChoice(product.id)}
                  className={s.product}
                >
                  <span className={s.icon}>
                    <Icon
                      className="h-5 w-5"
                      strokeWidth={1.9}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={s.productName}>{product.shortName}</span>
                    <span className={s.productDescription}>
                      {product.summary}
                    </span>
                    <span className={s.continue}>
                      Continue
                      <ArrowRight
                        className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </span>
                  </span>
                  <span className={s.index} aria-hidden="true">
                    0{index + 1}
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
