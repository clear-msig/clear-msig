export class BadRequestError extends Error {}
export class ConfigError extends Error {}

/** Reject oversized identity fields instead of silently changing recipients. */
export function requireField(name: string, value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestError(`Missing ${name}`);
  if (value.length > max) throw new BadRequestError(`${name} is too long`);
  const cleaned = sanitizeHeader(value, max);
  if (!cleaned) throw new BadRequestError(`Missing ${name}`);
  return cleaned;
}

export function sanitizeHeader(value: string, max: number): string {
  return value.replace(/[\r\n\t\v\f\x00-\x1f\x7f]/g, " ").trim().slice(0, max);
}

export function requireEnv(name: string, value: string | undefined): string {
  if (!value?.trim()) throw new ConfigError(name);
  return value;
}
