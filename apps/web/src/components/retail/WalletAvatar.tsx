import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { avatarGradient } from "@/lib/retail/avatar";
import { gradientFor } from "@/lib/retail/walletAppearance";
import { toDisplayName } from "@/lib/retail/walletNames";

type WalletAvatarSize = "xs" | "sm" | "md" | "lg";

const sizeClass: Record<WalletAvatarSize, string> = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-9 w-9 text-[12px]",
  md: "h-10 w-10 text-[13px]",
  lg: "h-14 w-14 text-xl sm:h-16 sm:w-16 sm:text-2xl",
};

const iconClass: Record<WalletAvatarSize, string> = {
  xs: "h-3.5 w-3.5",
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6 sm:h-7 sm:w-7",
};

type WalletAvatarProps = {
  name: string;
  size?: WalletAvatarSize;
  shapeClass?: string;
  className?: string;
  active?: boolean;
  decorative?: boolean;
  icon?: LucideIcon;
};

export function WalletAvatar({
  name,
  size = "md",
  shapeClass = "rounded-2xl",
  className,
  active = false,
  decorative = true,
  icon: Icon,
}: WalletAvatarProps) {
  const display = toDisplayName(name);
  const initial = display.trim().charAt(0).toUpperCase() || "?";
  const grad = gradientFor(name, avatarGradient(name));

  return (
    <span
      aria-hidden={decorative ? "true" : undefined}
      aria-label={decorative ? undefined : display}
      title={decorative ? undefined : display}
      className={clsx(
        "relative isolate flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br font-semibold text-white",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.34),inset_0_-14px_24px_rgba(0,0,0,0.18),0_16px_34px_-18px_rgba(0,0,0,0.9)]",
        "before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_28%_20%,rgba(255,255,255,0.45),transparent_34%),linear-gradient(145deg,rgba(255,255,255,0.18),transparent_48%)]",
        "after:pointer-events-none after:absolute after:inset-[2px] after:rounded-[inherit] after:bg-[linear-gradient(145deg,rgba(255,255,255,0.18),transparent_34%,rgba(0,0,0,0.16)_100%)] after:mix-blend-soft-light",
        sizeClass[size],
        shapeClass,
        grad.from,
        grad.to,
        active && "ring-2 ring-accent ring-offset-2 ring-offset-surface-raised",
        className,
      )}
    >
      <span className="relative z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.32)]">
        {Icon ? (
          <Icon
            className={iconClass[size]}
            strokeWidth={1.9}
            aria-hidden="true"
          />
        ) : (
          initial
        )}
      </span>
    </span>
  );
}
