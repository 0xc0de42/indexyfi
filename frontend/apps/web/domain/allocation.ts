/**
 * Allocation editing that always keeps weights at exactly 100%.
 *
 * Weights are percentages with two decimals (stored as numbers, e.g. 33.34). All
 * arithmetic runs in integer basis points (1 bp = 0.01%) so totals never drift.
 * Changing one weight rebalances the other unlocked weights in proportion to their
 * current size; locked weights never move.
 */
export const TOTAL_BPS = 10_000;
/** Smallest weight an included asset can have (0.5%). */
export const MIN_BPS = 50;

export interface Weighted {
  readonly weight: number;
}

const toBps = (weight: number) => Math.round(weight * 100);
const fromBps = (bps: number) => bps / 100;

function withBps<T extends Weighted>(items: readonly T[], bps: readonly number[]): T[] {
  return items.map((item, i) => ({...item, weight: fromBps(bps[i])}));
}

/** Split `amount` bps across `shares` proportionally (largest remainder); equal when all shares are 0. */
function distribute(amount: number, shares: readonly number[]): number[] {
  if (!shares.length) return [];
  const total = shares.reduce((s, x) => s + x, 0);
  const basis = total > 0 ? shares : shares.map(() => 1);
  const basisTotal = total > 0 ? total : shares.length;
  const exact = basis.map(s => (amount * s) / basisTotal);
  const out = exact.map(Math.floor);
  let rest = amount - out.reduce((s, x) => s + x, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) out[order[k][1]]++;
  return out;
}

export function totalOf(items: readonly Weighted[]): number {
  return fromBps(items.reduce((s, item) => s + toBps(item.weight), 0));
}

export function equalize<T extends Weighted>(items: readonly T[], locked: ReadonlySet<number> = new Set()): T[] {
  const bps = items.map(item => toBps(item.weight));
  const free = items.map((_, i) => i).filter(i => !locked.has(i));
  if (!free.length) return [...items];
  const lockedSum = bps.reduce((s, x, i) => s + (locked.has(i) ? x : 0), 0);
  const shares = distribute(Math.max(0, TOTAL_BPS - lockedSum), free.map(() => 1));
  free.forEach((i, k) => (bps[i] = shares[k]));
  return withBps(items, bps);
}

/** Scale weights proportionally to total exactly 100% (equal when all are 0). */
export function normalize<T extends Weighted>(items: readonly T[]): T[] {
  if (!items.length) return [];
  return withBps(items, distribute(TOTAL_BPS, items.map(item => Math.max(0, toBps(item.weight)))));
}

/** Largest weight item `index` can take given the locked weights and the others' minimums. */
export function maxWeight(items: readonly Weighted[], index: number, locked: ReadonlySet<number>): number {
  let lockedSum = 0;
  let free = 0;
  items.forEach((item, i) => {
    if (i === index) return;
    if (locked.has(i)) lockedSum += toBps(item.weight);
    else free++;
  });
  return free ? fromBps(TOTAL_BPS - lockedSum - free * MIN_BPS) : fromBps(TOTAL_BPS - lockedSum);
}

export function minWeight(items: readonly Weighted[], index: number, locked: ReadonlySet<number>): number {
  const free = items.some((_, i) => i !== index && !locked.has(i));
  return free ? fromBps(MIN_BPS) : maxWeight(items, index, locked);
}

/**
 * Set item `index` to `weight` (clamped to what the locks allow) and rebalance the
 * other unlocked items in proportion to their current weights.
 */
export function setWeight<T extends Weighted>(items: readonly T[], index: number, weight: number, locked: ReadonlySet<number> = new Set()): T[] {
  if (!Number.isFinite(weight) || index < 0 || index >= items.length) return [...items];
  const others = items.map((_, i) => i).filter(i => i !== index && !locked.has(i));
  if (!others.length) return [...items];
  const bps = items.map(item => toBps(item.weight));
  const lockedSum = bps.reduce((s, x, i) => s + (i !== index && locked.has(i) ? x : 0), 0);
  const target = Math.min(Math.max(toBps(weight), MIN_BPS), TOTAL_BPS - lockedSum - others.length * MIN_BPS);
  const shares = distributeWithMinimum(TOTAL_BPS - lockedSum - target, others.map(i => bps[i]));
  bps[index] = target;
  others.forEach((i, k) => (bps[i] = shares[k]));
  return withBps(items, bps);
}

/** Proportional split where every share is at least MIN_BPS (amount must allow it). */
function distributeWithMinimum(amount: number, shares: readonly number[]): number[] {
  const out = new Array<number>(shares.length).fill(0);
  let open = shares.map((_, i) => i);
  let remaining = amount;
  for (;;) {
    const split = distribute(remaining, open.map(i => Math.max(0, shares[i])));
    const low = open.filter((_, k) => split[k] < MIN_BPS);
    if (!low.length) {
      open.forEach((i, k) => (out[i] = split[k]));
      return out;
    }
    for (const i of low) out[i] = MIN_BPS;
    remaining -= low.length * MIN_BPS;
    open = open.filter(i => !low.includes(i));
    if (!open.length) return out;
  }
}

/**
 * Move the boundary between item `index` and `index + 1` so that item `index` gets
 * `leftWeight`; only those two change, their sum is preserved.
 */
export function moveBoundary<T extends Weighted>(items: readonly T[], index: number, leftWeight: number, locked: ReadonlySet<number> = new Set()): T[] {
  if (index < 0 || index + 1 >= items.length || locked.has(index) || locked.has(index + 1) || !Number.isFinite(leftWeight)) return [...items];
  const bps = items.map(item => toBps(item.weight));
  const pair = bps[index] + bps[index + 1];
  const left = Math.min(Math.max(toBps(leftWeight), MIN_BPS), pair - MIN_BPS);
  bps[index] = left;
  bps[index + 1] = pair - left;
  return withBps(items, bps);
}

/** Add an item with an equal share (100 / n), taken proportionally from the unlocked others. */
export function addItem<T extends Weighted>(items: readonly T[], item: T, locked: ReadonlySet<number> = new Set()): T[] {
  if (!items.length) return [{...item, weight: 100}];
  const next = [...items, {...item, weight: 0}];
  return setWeight(next, next.length - 1, 100 / next.length, locked);
}

/** Remove item `index`; its weight goes back to the unlocked others proportionally. */
export function removeItem<T extends Weighted>(items: readonly T[], index: number, locked: ReadonlySet<number> = new Set()): T[] {
  const rest = items.filter((_, i) => i !== index);
  if (!rest.length) return [];
  const restLocked = new Set([...locked].filter(i => i !== index).map(i => (i > index ? i - 1 : i)));
  const bps = rest.map(item => toBps(item.weight));
  const free = rest.map((_, i) => i).filter(i => !restLocked.has(i));
  const targets = free.length ? free : rest.map((_, i) => i);
  const lockedSum = bps.reduce((s, x, i) => s + (free.length && restLocked.has(i) ? x : 0), 0);
  const shares = distribute(TOTAL_BPS - lockedSum, targets.map(i => bps[i]));
  targets.forEach((i, k) => (bps[i] = shares[k]));
  return withBps(rest, bps);
}

/** True when the weights are an equal split (within rounding). */
export function isEqualSplit(items: readonly Weighted[]): boolean {
  if (!items.length) return true;
  const bps = items.map(item => toBps(item.weight));
  return Math.max(...bps) - Math.min(...bps) <= 1 && bps.reduce((s, x) => s + x, 0) === TOTAL_BPS;
}
