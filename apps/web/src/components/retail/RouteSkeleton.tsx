import clsx from "clsx";

type RouteSkeletonVariant = "form" | "detail" | "list" | "settings";

interface RouteSkeletonProps {
  variant?: RouteSkeletonVariant;
}

export function RouteSkeleton({ variant = "form" }: RouteSkeletonProps) {
  const rows =
    variant === "list"
      ? 5
      : variant === "settings"
        ? 4
        : variant === "detail"
          ? 3
          : 2;

  return (
    <div
      className={clsx(
        "mx-auto flex w-full animate-pulse flex-col gap-4",
        variant === "form" || variant === "detail" ? "max-w-2xl" : "max-w-4xl",
      )}
      aria-hidden="true"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="h-4 w-28 rounded bg-border-soft/80" />
          <div className="mt-3 h-8 w-2/3 rounded bg-border-soft" />
          <div className="mt-3 h-4 w-full max-w-md rounded bg-border-soft/70" />
        </div>
        <div className="h-10 w-10 shrink-0 rounded-full bg-border-soft/70" />
      </div>

      <div
        className={clsx(
          "rounded-card border border-border-soft bg-surface-raised shadow-card-rest",
          variant === "detail" ? "p-5" : "p-4 sm:p-5",
        )}
      >
        <div className="h-5 w-36 rounded bg-border-soft" />
        <div className="mt-5 flex flex-col gap-3">
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-soft border border-border-soft bg-canvas p-3"
            >
              <div className="h-9 w-9 shrink-0 rounded-full bg-border-soft/70" />
              <div className="min-w-0 flex-1">
                <div className="h-4 w-2/3 rounded bg-border-soft/80" />
                <div className="mt-2 h-3 w-1/2 rounded bg-border-soft/60" />
              </div>
              <div className="h-7 w-20 rounded-full bg-border-soft/70" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
