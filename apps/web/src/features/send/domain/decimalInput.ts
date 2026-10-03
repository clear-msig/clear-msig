/** Accept decimal editing states without silently stripping signs/exponents or truncating units. */
export function acceptsDecimalInput(value: string, decimals: number, wholeDigits: number): boolean {
  const match = /^(\d*)(?:\.(\d*))?$/.exec(value);
  return !!match && match[1].length <= wholeDigits && (match[2]?.length ?? 0) <= decimals;
}
