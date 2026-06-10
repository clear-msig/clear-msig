import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function WelcomePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const surface = first(params.surface);
  const requestedPurpose = first(params.purpose);
  const purpose =
    surface === "personal"
      ? "share"
      : surface === "secure"
        ? "secure"
        : surface === "p2pdefi" || surface === "payments"
          ? "share"
          : surface === "pro"
            ? "share"
            : surface === "agent"
              ? "agent"
              : requestedPurpose;

  const next = new URLSearchParams();
  if (surface) next.set("surface", surface);
  if (purpose === "share" || purpose === "secure" || purpose === "agent") {
    next.set("purpose", purpose);
  }

  const suffix = next.toString();
  redirect(`/app/wallet/new${suffix ? `?${suffix}` : ""}`);
}
