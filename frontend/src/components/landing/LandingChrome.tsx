"use client";

// Landing chrome - shared Nav + Atmospherics for any page that opts
// into the Obsidian & Lime aesthetic by wrapping content in a
// `.landing-shell` container. Both `/` and `/welcome` use these so
// the brand stays identical across the marketing surface and the
// onboarding wizard.
//
// Pill-nav anchors are absolute (`/#bento`, `/#why`) so they
// resolve correctly when the user is on `/welcome` and clicks back to
// a landing section.
//
// Mobile: the desktop pill-nav is hidden (md:flex). Below that
// breakpoint a hamburger trigger sits left of the CTA; tapping it
// opens a glass drop-down panel with the same nav items + a status
// pulse line. Tap-outside / Escape / link-tap dismisses.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import { ArrowRight, ChevronDown, Menu, X } from "lucide-react";
import { BrandMark } from "@/components/retail/BrandMark";
import { ThemeModeButton } from "@/components/security/ThemeModeButton";
import {
  productSurfaceById,
  type ProductSurface,
  type ProductSurfaceId,
} from "@/lib/productSurfaces";
import { PRODUCT_SURFACE_ICON } from "@/lib/productIcons";

const NAV_ITEMS: {
  href: string;
  label: string;
  external?: boolean;
  tag?: string;
}[] = [
  { href: "/", label: "Home" },
  { href: "/#why", label: "Why Clear" },
];

const NAV_PRODUCT_IDS: ProductSurfaceId[] = [
  "personal",
  "pro",
  "agent",
  "secure",
  "p2pdefi",
];

const NAV_PRODUCTS = NAV_PRODUCT_IDS.map((id) => {
  const surface = productSurfaceById(id);
  return {
    surface,
    href: id === "p2pdefi" ? surface.path : surface.ctaHref,
  };
});

export function LandingAtmospherics() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* 60px grid */}
      <div className="grid-bg absolute inset-0 opacity-[0.35]" />
      {/* noise overlay */}
      <div className="noise-bg absolute inset-0 opacity-[0.15] mix-blend-overlay" />
      {/* glow sphere - top-left lime */}
      <div
        className="glow-drift absolute -left-32 -top-40 h-[520px] w-[520px] rounded-full opacity-30"
        style={{
          background:
            "radial-gradient(circle at center, rgba(204, 255, 0, 0.12) 0%, rgba(204, 255, 0, 0) 70%)",
          filter: "blur(120px)",
        }}
      />
      {/* glow sphere - bottom-right emerald */}
      <div
        className="glow-drift absolute -bottom-40 -right-32 h-[600px] w-[600px] rounded-full opacity-25"
        style={{
          background:
            "radial-gradient(circle at center, rgba(16, 185, 129, 0.14) 0%, rgba(16, 185, 129, 0) 70%)",
          filter: "blur(120px)",
          animationDelay: "-3s",
        }}
      />
    </div>
  );
}

interface LandingNavProps {
  /** Right-side primary CTA. Defaults to product choice. Pass
   *  `null` to suppress (e.g. on /welcome itself, where the user is
   *  already inside the app surface). */
  cta?: { href: string; label: string } | null;
  /** Optional lime status pulse + label (e.g. "LOADING",
   *  "SIGNING IN"). When omitted, no pill is rendered. */
  status?: string;
}

export function LandingNav({
  cta = { href: "/choose", label: "Choose product" },
  status,
}: LandingNavProps = {}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [mobileProductsOpen, setMobileProductsOpen] = useState(false);
  // Scroll-driven nav state. Above the threshold, nav stays roomy
  // and transparent (sits over the hero); past it, the nav becomes
  // a thin glass band - tighter padding, backdrop blur, soft border.
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let raf = 0;
    const onScroll = () => {
      // rAF debounce - Safari fires scroll events at ~120Hz on
      // ProMotion displays; this keeps the state flip to one
      // commit per frame.
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        setScrolled(window.scrollY > 16);
        raf = 0;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  // Close-on-Escape + body scroll lock while the mobile menu is open.
  useEffect(() => {
    if (!menuOpen && !productOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setProductOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    if (menuOpen) document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [menuOpen, productOpen]);

  // Close-on-route-change. Without this, tapping a hash link inside
  // the open panel would scroll under the still-visible scrim. The
  // ref tracks the menu surface so a click that DOES land on a link
  // (which we can't intercept in a Next.js Link) closes the panel.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const productRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!productOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!productRef.current?.contains(event.target as Node)) {
        setProductOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [productOpen]);

  return (
    <>
      {/* Fixed-on-scroll nav. The bar is always pinned to the top
          of the viewport (position: fixed), so it stays visible as
          the user scrolls through every section - the resting state
          is transparent so it overlays the hero cleanly, and the
          `scrolled` state morphs into a tight glass band once the
          user has committed to scrolling. A sibling spacer below
          reserves the nav's height in the document flow so the
          first section doesn't slide under the bar on load. */}
      <div
        className={clsx(
          "fixed inset-x-0 top-0 z-40 transition-[background-color,backdrop-filter,border-color] duration-300 ease-out",
          scrolled
            ? "border-b border-white/[0.06] bg-[#0c0c0c]/80 backdrop-blur-xl"
            : "border-b border-transparent bg-transparent",
        )}
      >
        <nav
          className={clsx(
            "relative mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 transition-[padding] duration-300 ease-out",
            scrolled ? "px-4 py-3 sm:px-10 sm:py-4" : "px-4 py-4 sm:px-10 sm:py-7",
          )}
        >
        {/* Logo. The new ClearCMark sits directly on the dark nav
            with its dark arcs flipped to white and the lime accent
            kept as the brand primary. No surface tile needed. The
            wordmark sits to the right at sm+. Landing-only at this
            stage; wider product rollout is pending review. */}
        <Link
          href="/"
          aria-label="Clear home"
          className="group flex items-center gap-3"
          onClick={() => {
            setMenuOpen(false);
            setProductOpen(false);
          }}
        >
          <span className="inline-flex items-center justify-center transition-transform duration-300 group-hover:scale-105">
            <BrandMark size={36} />
          </span>
          <span className="hidden font-mono-tech text-[11px] uppercase tracking-[0.28em] text-white/70 sm:block">
            clearsig
          </span>
        </Link>

        {/* Desktop nav. Product opens the actual chooser list. */}
        <div className="hidden items-center gap-1 rounded-full bg-white/[0.035] px-2 py-2 shadow-[0_18px_60px_-28px_rgba(0,0,0,0.65)] backdrop-blur-xl md:flex">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] text-white/70 transition-colors duration-200 hover:bg-white/[0.06] hover:text-white"
          >
            Home
          </Link>

          <div
            ref={productRef}
            className="relative"
            onMouseEnter={() => setProductOpen(true)}
            onMouseLeave={() => setProductOpen(false)}
          >
            <button
              type="button"
              onClick={() => setProductOpen((value) => !value)}
              aria-expanded={productOpen}
              aria-controls="landing-product-menu"
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] transition-colors duration-200 hover:bg-white/[0.06] hover:text-white",
                productOpen ? "bg-white/[0.07] text-white" : "text-white/70",
              )}
            >
              Products
              <ChevronDown
                className={clsx(
                  "h-3.5 w-3.5 transition-transform duration-300",
                  productOpen && "rotate-180",
                )}
                aria-hidden="true"
                strokeWidth={2.2}
              />
            </button>

            <AnimatePresence>
              {productOpen && (
                <ProductDropdown
                  id="landing-product-menu"
                  products={NAV_PRODUCTS}
                  onNavigate={() => setProductOpen(false)}
                />
              )}
            </AnimatePresence>
          </div>

          {NAV_ITEMS.slice(1).map((item) => (
            <Link
              key={item.label}
              href={item.href}
              target={item.external ? "_blank" : undefined}
              rel={item.external ? "noreferrer" : undefined}
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] text-white/70 transition-colors duration-200 hover:bg-white/[0.06] hover:text-white"
            >
              {item.label}
              {item.tag && (
                <span className="rounded-full bg-[#ccff00] px-1.5 py-[1px] font-mono-tech text-[8px] font-bold uppercase tracking-[0.18em] text-black shadow-[0_0_8px_rgba(204,255,0,0.4)]">
                  {item.tag}
                </span>
              )}
            </Link>
          ))}
        </div>

        {/* Right cluster - status (only when caller passes one),
            CTA, mobile menu trigger. */}
        <div className="flex items-center gap-2 sm:gap-3 md:gap-4">
          {status && (
            <div className="hidden items-center sm:flex">
              <span className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/60">
                {status}
              </span>
            </div>
          )}
          {/* CTA shows from md+ only. On mobile the same link lives
              inside the menu panel so the navbar stays clean. */}
          {cta && (
            <Link
              href={cta.href}
              className="hidden rounded-full bg-white px-4 py-2 text-[12px] font-semibold text-black transition-colors duration-200 hover:bg-[#ccff00] md:inline-flex sm:px-5 sm:text-[13px]"
            >
              {cta.label}
            </Link>
          )}

          {/* Mobile hamburger - only below md (where the desktop pill
              nav is hidden). Reuses the glass surface so it sits in
              the same visual register as the rest of the chrome. */}
          <button
            type="button"
            onClick={() => {
              setMenuOpen((v) => !v);
              setProductOpen(false);
            }}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="landing-mobile-menu"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/80 backdrop-blur-md transition-colors duration-200 hover:border-white/30 hover:text-white md:hidden"
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
        </nav>
      </div>

      {/* Layout spacer - reserves the resting nav height in the
          document flow so the page's first section starts below
          the fixed bar on load. Heights match the nav's resting
          padding (py-4 on mobile, py-7 on sm+) plus the 40px logo. */}
      <div aria-hidden="true" className="h-[72px] sm:h-[100px]" />

      {/* Mobile menu drop-down panel. Slides in from the top with a
          full-width glass surface; tapping the scrim or any link
          inside closes the panel. */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm md:hidden"
              onClick={() => setMenuOpen(false)}
              aria-hidden="true"
            />
            <motion.div
              ref={panelRef}
              id="landing-mobile-menu"
              role="dialog"
              aria-modal="true"
              aria-label="Site navigation"
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="fixed left-3 right-3 top-[5.5rem] z-50 overflow-hidden rounded-[1.5rem] border border-white/[0.08] bg-[#0c0c0c]/95 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl md:hidden"
            >
              <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3.5">
                {status ? (
                  <div className="flex items-center">
                    <span className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-white/60">
                      {status}
                    </span>
                  </div>
                ) : (
                  <span className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-white/60">
                    Menu
                  </span>
                )}
                {/* Explicit close button inside the panel - clearer
                    affordance than relying on the hamburger toggle
                    behind the open panel. */}
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Close menu"
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/80 transition-colors duration-200 hover:border-white/30 hover:text-white"
                >
                  <X size={16} strokeWidth={2.2} />
                </button>
              </div>

              <ul className="flex flex-col py-2">
                <li>
                  <Link
                    href="/"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center justify-between gap-3 px-5 py-3.5 text-[15px] font-medium text-white/85 transition-colors duration-200 hover:bg-white/[0.05] hover:text-white"
                  >
                    <span>Home</span>
                    <ArrowRight className="h-4 w-4 text-white/30" aria-hidden="true" />
                  </Link>
                </li>

                <li>
                  <button
                    type="button"
                    onClick={() => setMobileProductsOpen((value) => !value)}
                    className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left text-[15px] font-medium text-white/85 transition-colors duration-200 hover:bg-white/[0.05] hover:text-white"
                    aria-expanded={mobileProductsOpen}
                    aria-controls="landing-mobile-products"
                  >
                    <span>Product</span>
                    <ChevronDown
                      className={clsx(
                        "h-4 w-4 text-white/40 transition-transform duration-300",
                        mobileProductsOpen && "rotate-180 text-[#ccff00]",
                      )}
                      aria-hidden="true"
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {mobileProductsOpen && (
                      <motion.div
                        id="landing-mobile-products"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="mx-3 mb-2 grid gap-1 rounded-2xl bg-white/[0.035] p-2">
                          {NAV_PRODUCTS.map(({ surface, href }) => (
                            <ProductMenuLink
                              key={surface.id}
                              surface={surface}
                              href={href}
                              onClick={() => setMenuOpen(false)}
                            />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>

                {NAV_ITEMS.slice(1).map((item) => (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      target={item.external ? "_blank" : undefined}
                      rel={item.external ? "noreferrer" : undefined}
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center justify-between gap-3 px-5 py-3.5 text-[15px] font-medium text-white/85 transition-colors duration-200 hover:bg-white/[0.05] hover:text-white"
                    >
                      <span className="inline-flex items-center gap-2">
                        {item.label}
                        {item.tag && (
                          <span className="rounded-full bg-[#ccff00] px-1.5 py-[1px] font-mono-tech text-[8px] font-bold uppercase tracking-[0.18em] text-black shadow-[0_0_8px_rgba(204,255,0,0.4)]">
                            {item.tag}
                          </span>
                        )}
                      </span>
                      <ArrowRight className="h-4 w-4 text-white/30" aria-hidden="true" />
                      <span className="hidden font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/30">
                        {item.external ? "↗" : "→"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>

              {cta && (
                <div className="border-t border-white/[0.08] p-4">
                  <Link
                    href={cta.href}
                    onClick={() => setMenuOpen(false)}
                    className="neon-cta inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-[13px] font-bold tracking-tight"
                  >
                    {cta.label}
                  </Link>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function ProductDropdown({
  id,
  products,
  onNavigate,
}: {
  id: string;
  products: { surface: ProductSurface; href: string }[];
  onNavigate: () => void;
}) {
  return (
    <motion.div
      id={id}
      role="menu"
      initial={{ opacity: 0, x: "-50%", y: 12, scale: 0.96, filter: "blur(8px)" }}
      animate={{ opacity: 1, x: "-50%", y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, x: "-50%", y: 8, scale: 0.97, filter: "blur(6px)" }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="absolute left-1/2 top-[calc(100%+0.7rem)] z-50 w-[min(92vw,24rem)] overflow-hidden rounded-[1.5rem] bg-[#0c0c0c]/100 p-4 shadow-[0_28px_80px_-24px_rgba(0,0,0,0.9)] ring-1 ring-white/[0.08] backdrop-blur-2xl"
    >
      <div className="px-1 pb-3">
      </div>
      <div className="grid gap-2">
        {products.map(({ surface, href }, index) => (
          <motion.div
            key={surface.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: index * 0.035 }}
          >
            <ProductMenuLink
              surface={surface}
              href={href}
              onClick={onNavigate}
            />
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

function ProductMenuLink({
  surface,
  href,
  onClick,
}: {
  surface: ProductSurface;
  href: string;
  onClick: () => void;
}) {
  const Icon = PRODUCT_SURFACE_ICON[surface.id];

  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className="group flex items-center gap-3 rounded-[1.05rem] px-1 py-2.5 text-left transition-colors duration-200 hover:bg-white/[0.045] focus-visible:bg-white/[0.055] focus-visible:outline-none"
    >
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/[0.055] text-white/72 transition-colors duration-200 group-hover:bg-[#ccff00] group-hover:text-black">
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">
            {surface.shortName}
          </span>
          {surface.status === "planned" ? (
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono-tech text-[8px] uppercase tracking-[0.18em] text-white/42">
              Soon
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-white/46">
          {surface.eyebrow}
        </span>
      </span>
      <ArrowRight
        className="h-4 w-4 shrink-0 text-white/26 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#ccff00]"
        aria-hidden="true"
      />
    </Link>
  );
}
