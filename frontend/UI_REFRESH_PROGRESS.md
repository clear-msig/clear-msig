# UI Refresh - Progress Tracker

Section-by-section refactor of the `frontend/` app to a single, professional design language. This file is the durable record so we can resume cleanly between sessions.

> **Last updated:** 2026-05-09

---

## Design DNA (the kit)

The four "canonical" pages set the visual language. Every other section must match these - no new card shapes, no new accent treatments, no glass-vs-flat mixing.

**Reference pages:**
- `src/app/app/wallet/page.tsx` (wallets home)
- `src/app/app/activity/page.tsx`
- `src/app/app/contacts/page.tsx`
- `src/app/app/settings/page.tsx`

### Page header (top of every page)

Left-aligned, motion-faded, summary opposite the title at `items-end`. No centered kicker, no eyebrow above the title.

```tsx
<motion.div
  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.2 }}
  className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1"
>
  <div className="flex flex-col gap-1">
    <h1 className="font-display text-display-xs leading-tight text-text-strong">{title}</h1>
    <p className="text-xs text-text-soft sm:text-sm">{subtitle}</p>
  </div>
  <p className="text-xs text-text-soft sm:text-sm">{summary}</p>
</motion.div>
```

### Section container (THE card class)

Cards are **flat, not glass**. The single canonical string:

```
rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest
```

Hover lift on interactive cards: `hover:-translate-y-0.5 hover:shadow-card-raised`. Active state swaps `border-border-soft` → `border-accent/40`. Empty states use the same shell with `border-dashed` + `p-8 text-center`.

**No `bg-white/[0.02]` glass on page bodies.** Glass (`backdrop-blur-xl`) is reserved for sticky chrome only.

### Typography tokens

| Use | Class |
|---|---|
| Page title (h1) | `font-display text-display-xs leading-tight text-text-strong` |
| Section eyebrow (h2) | `text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft` |
| Tile/field eyebrow | `text-[11px] font-semibold uppercase tracking-[0.2em] text-text-soft` |
| Card title | `text-sm font-medium text-text-strong` |
| Card subtitle/meta | `text-xs text-text-soft` (mt-0.5 from title) |
| Numeric values | `font-numerals text-2xl font-semibold tabular-nums leading-tight` |
| Currency ticker | `font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-text-soft` |
| Address / hash | `font-mono text-xs text-text-strong` |

### Lime accent - rationed, four contexts only

1. **Icon disc** - `bg-accent/10 text-accent` in a circle (`h-10 w-10` settings rows, `h-12 w-12` empty states, `h-7 w-7` for inline badges).
2. **Active/selected state** - `border-accent/40` on the surface, `text-accent` on the value/label.
3. **Primary CTA** - `bg-accent text-text-on-accent shadow-accent-rest hover:bg-accent-hover`.
4. **Live-state pill** - `bg-accent/10 text-accent` rounded-full with optional ping.

Soft variants: `bg-accent/[0.04]` or `bg-accent/[0.08]` for selected pill backgrounds; `border-accent/30` for accent-soft borders.

**No atmospheric glows. No hairline accent rules (`h-px w-10 bg-accent`) in page bodies.**

### Spacing rhythm

- Page-level vertical: `flex flex-col gap-6` on every root.
- Inside sub-clusters: `flex flex-col gap-3`.
- Stat / wallet grids: `grid grid-cols-1 gap-3 sm:grid-cols-2|3|4`.
- Card internal: `p-5` default, `p-4` compact, `p-8` empty states.
- Eyebrow → first line: `mt-1.5` to `mt-2.5`. Title → meta: `mt-0.5`. List → header: `mt-3`.

### Lists

```
ul: flex flex-col divide-y divide-border-soft rounded-card border border-border-soft bg-surface-raised shadow-card-rest

row link: group flex items-center justify-between gap-3 px-5 py-3.5
          transition-colors duration-base ease-out-soft hover:bg-canvas
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset
```

Right-side affordance is always:
```tsx
<ArrowRight className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent" />
```

Two-line row: `text-sm font-medium text-text-strong` title + `text-xs text-text-soft` meta with mid-dot separators.

### Filters / tabs / chips

- **Pill chip** (filter, tab, "see all"): `rounded-full px-3 py-1.5 text-xs font-medium`. Active = `bg-accent/10 text-accent`. Inactive = `text-text-soft hover:bg-white/[0.04] hover:text-text-strong`.
- **Stat-tile filter** (Activity status row): the full card shell with `aria-pressed`, accent border + accent value when active.
- **Inline accent action**: `rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-text-on-accent hover:bg-accent-hover active:scale-[0.98]`.
- **Secondary chip** ("see all"): `inline-flex items-center gap-1 rounded-full border border-border-soft bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-text-soft hover:-translate-y-0.5 hover:text-accent`.

### Empty states

Centered, in the same card shell with `p-8 text-center`, often `border-dashed`:

```
mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent
icon h-5 w-5 strokeWidth={1.75}
mt-4 font-display text-base font-semibold text-text-strong   ← title
mx-auto mt-2 max-w-sm text-sm text-text-soft                 ← copy
mt-5 Button size="md"                                         ← CTA
```

### Summary in one line

**Flat surface-raised cards, hierarchy carried by typography (display + uppercase eyebrows + tabular nums), lime accent rationed to four moves (icon disc, active border, primary CTA, live pulse) - no glass, no atmospheric glows, no decorative accent rules in page bodies.**

---

## Section status

| Section | Path | Status | Notes |
|---|---|---|---|
| Wallets home | `app/wallet/page.tsx` | ✅ Canonical | Reference page |
| Activity | `app/activity/page.tsx` | ✅ Canonical | Reference page |
| Contacts | `app/contacts/page.tsx` | ✅ Canonical | Reference page |
| Settings | `app/settings/page.tsx` | ✅ Canonical | Reference page |
| **Wallet detail** | `app/wallet/[name]/page.tsx` | 🔧 In progress | This pass |
| Wallet send (eth/erc20/batch/sol root) | `app/wallet/[name]/send/**` | ⏳ Pending | Mobile parity recently landed; visual pass next |
| Wallet receive | `app/wallet/[name]/receive/page.tsx` | ⏳ Pending | |
| Wallet members + add | `app/wallet/[name]/members/**` | ⏳ Pending | |
| Wallet chains + add | `app/wallet/[name]/chains/**` | ⏳ Pending | |
| Wallet policies + detail | `app/wallet/[name]/policies/**`, `policy/page.tsx`, `rules/page.tsx` | ⏳ Pending | |
| Wallet activity | `app/wallet/[name]/activity/page.tsx` | ⏳ Pending | |
| Wallet budget | `app/wallet/[name]/budget/page.tsx` | ⏳ Pending | |
| Wallet settings | `app/wallet/[name]/settings/page.tsx` | ⏳ Pending | |
| Wallet setup (sol/eth/erc20/root) | `app/wallet/[name]/setup/**` | ⏳ Pending | |
| Proposal detail | `app/proposals/[proposal]/page.tsx` | ⏳ Pending | |
| Welcome / connect | `app/welcome/**`, `app/connect/page.tsx` | ⏳ Pending | Onboarding surfaces |

Legend: ✅ canonical · 🔧 in progress · ⏳ pending · ❄️ blocked

---

## Pass log

### 2026-05-09 - Wallet detail (`app/wallet/[name]/page.tsx`)

**Targets refactored:**
1. **Hero** - replaced centered glass card (`rounded-3xl bg-white/[0.02] backdrop-blur-xl` + lime atmospheric glow) with the kit's flat surface (`rounded-card border border-border-soft bg-surface-raised shadow-card-rest`). Switched to left-aligned layout: avatar + identity on the left, members count + pending pill opposite at `items-end`. Removed the lime atmospheric glow div entirely.
2. **HeroActionTile (Send / Receive / Policies)** - flipped from glass tiles with hover lime glow to flat tiles using the kit's accent disc icon pattern (`bg-accent/10 text-accent` circle). Hover = `border-accent/40` + lift, no neon glow.
3. **PortfolioPanel** - removed the `h-px w-10 bg-accent` hairline rule (not in the kit). Kept the eyebrow + value + breakdown structure, normalized to kit typography.
4. **TabBar** - flipped from glass `rounded-2xl bg-white/[0.02] backdrop-blur-md` to the kit's pill chip pattern: `rounded-full px-3 py-1.5 text-xs font-medium`, active = `bg-accent/10 text-accent`, inactive = `text-text-soft hover:bg-white/[0.04] hover:text-text-strong`. Matches the Settings nav vocabulary.
5. **ActionNeededSection** - flipped from glass `rounded-2xl border-accent/20 bg-white/[0.02] backdrop-blur-xl shadow-[0_24px_48px_-24px_rgba(204,255,0,0.12)]` to flat surface with `border-accent/40` (kit "active" border). Kept the live-pulse Bell icon disc.
6. **DetailSkeleton** - re-aligned geometry to the new left-aligned Hero so the loading state doesn't reflow.

**Untouched (already kit-compliant):**
- BackLink, BudgetStripe, NextStepsStripe, TxAttemptsSection, Erc20HoldingsSection, ChainTxHistorySection, ActivitySection, ActivityEmptyState, HoldingsEmptyState, NotFound, BatchProgressRow, Actions, WalletDetailTabs control flow.

**What's next:** Refresh the wallet detail's child routes (`/send`, `/receive`, `/members`, `/chains`, `/policies`, `/activity`, `/budget`, `/settings`, `/setup`) since they all live under the same wallet shell.
