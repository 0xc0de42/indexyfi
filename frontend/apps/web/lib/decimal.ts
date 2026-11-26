/**
 * Exact comparison of plain decimal strings ("-12.5", "0.000949964021"), so sorting and ranking never depend on
 * float rounding. Numbers are produced only for bounded display and chart coordinates.
 */
const SIGNED_DECIMAL = /^-?\d+(\.\d+)?$/;
export const isDecimal = (value: string) => SIGNED_DECIMAL.test(value);

function parts(value: string): {negative: boolean; int: string; frac: string} {
  const negative = value.startsWith('-');
  const [int, frac = ''] = (negative ? value.slice(1) : value).split('.');
  return {negative, int: int.replace(/^0+(?=\d)/, ''), frac: frac.replace(/0+$/, '')};
}
function compareMagnitude(a: {int: string; frac: string}, b: {int: string; frac: string}): number {
  if (a.int.length !== b.int.length) return a.int.length < b.int.length ? -1 : 1;
  if (a.int !== b.int) return a.int < b.int ? -1 : 1;
  const len = Math.max(a.frac.length, b.frac.length);
  const fa = a.frac.padEnd(len, '0'), fb = b.frac.padEnd(len, '0');
  return fa === fb ? 0 : fa < fb ? -1 : 1;
}
const isZero = (p: {int: string; frac: string}) => p.int === '0' && p.frac === '';

/** -1, 0 or 1 for a < b, a = b, a > b. Both must be valid decimal strings. */
export function compareDecimal(a: string, b: string): number {
  const pa = parts(a), pb = parts(b);
  const na = pa.negative && !isZero(pa), nb = pb.negative && !isZero(pb);
  if (na !== nb) return na ? -1 : 1;
  const m = compareMagnitude(pa, pb);
  return na ? -m : m;
}

/** Descending by value, nulls last, ties broken by key (ascending). */
export function byDecimalDesc<T>(value: (item: T) => string | null | undefined, key: (item: T) => string) {
  return (a: T, b: T): number => {
    const va = value(a), vb = value(b);
    if (va == null || vb == null) return va == null && vb == null ? key(a).localeCompare(key(b)) : va == null ? 1 : -1;
    return compareDecimal(vb, va) || key(a).localeCompare(key(b));
  };
}
