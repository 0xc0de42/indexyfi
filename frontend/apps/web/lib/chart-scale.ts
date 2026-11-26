/**
 * Axis scales for price charts. Pure display helpers: they choose readable tick
 * positions and labels for observed values; they never alter or smooth the data.
 */

export interface PriceScale {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly ticks: readonly number[];
  /** Decimal places that distinguish adjacent ticks. */
  readonly decimals: number;
}

/** 1, 2, 2.5 or 5 × 10^n closest to `raw` from above. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / magnitude;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * magnitude;
}

/**
 * Domain and ticks covering [low, high] with about `count` intervals. A flat
 * series gets a small symmetric band so the line sits mid-chart.
 */
export function priceScale(low: number, high: number, count = 4): PriceScale {
  let lo = Math.min(low, high);
  let hi = Math.max(low, high);
  if (hi - lo <= Math.abs(hi) * 1e-9) {
    const band = Math.abs(hi) * 0.001 || 1e-6;
    lo -= band;
    hi += band;
  }
  const step = niceStep((hi - lo) / count);
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let i = 0, v = min; v <= max + step / 2 && i < 50; i++, v = min + i * step) ticks.push(Number(v.toPrecision(12)));
  return {min, max, step, ticks, decimals: decimalsOf(step)};
}

/** Fewest decimal places that represent `step` exactly (2.5 → 1, 0.005 → 3, 50 → 0). */
function decimalsOf(step: number): number {
  for (let d = 0; d < 12; d++) {
    const scaled = step * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6 * Math.max(1, scaled)) return d;
  }
  return 12;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const TIME_STEPS = [15 * SECOND, 30 * SECOND, MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR];

export interface TimeScale {
  readonly step: number;
  readonly ticks: readonly number[];
  readonly withSeconds: boolean;
}

/** Ticks on round local clock times (e.g. every minute, every 2 h) inside [from, to]. */
export function timeScale(from: number, to: number, count = 5): TimeScale {
  const span = Math.max(to - from, SECOND);
  const step = TIME_STEPS.find(s => span / s <= count) ?? TIME_STEPS[TIME_STEPS.length - 1];
  // Align to the local clock, not to the Unix epoch, so 2 h ticks land on even local hours.
  const offset = new Date(from).getTimezoneOffset() * MINUTE;
  const first = Math.ceil((from - offset) / step) * step + offset;
  const ticks: number[] = [];
  for (let t = first; t <= to; t += step) ticks.push(t);
  return {step, ticks, withSeconds: step < MINUTE};
}

export function formatClock(ms: number, withSeconds: boolean): string {
  return new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', ...(withSeconds ? {second: '2-digit'} : {}), hour12: false});
}

export function formatTick(value: number, decimals: number): string {
  return new Intl.NumberFormat('en-US', {minimumFractionDigits: decimals, maximumFractionDigits: decimals}).format(value);
}

/** Index of the point whose time is closest to `t`; points must be sorted by time. */
export function nearestIndex(times: readonly number[], t: number): number {
  if (!times.length) return -1;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && t - times[lo - 1] < times[lo] - t ? lo - 1 : lo;
}

/** The browser's UTC offset at a given time, e.g. "UTC+2" or "UTC−5:30", so local clock times are unambiguous. */
export function utcOffsetLabel(ms = Date.now()): string {
  const minutes = -new Date(ms).getTimezoneOffset();
  if (minutes === 0) return 'UTC';
  const sign = minutes > 0 ? '+' : '−', abs = Math.abs(minutes);
  return `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : ''}`;
}
/** Local clock time with its UTC offset, e.g. "20:17:03 (UTC+2)". */
export const localTimeWithZone = (ms: number) => `${new Date(ms).toLocaleTimeString([], {hour12: false})} (${utcOffsetLabel(ms)})`;
/** "8 min ago" style age of a past time. */
export function ageText(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  return s < 90 ? `${s} s ago` : s < 5_400 ? `${Math.round(s / 60)} min ago` : `${(s / 3_600).toFixed(1)} h ago`;
}
