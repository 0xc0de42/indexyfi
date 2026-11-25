import type {Draft} from './model';

/** Fixed initial market liquidity, in the funding token (USDT). */
export const MIN_LIQUIDITY = 1;

export function draftErrors(d: Draft): string[] {
  const e: string[] = [];
  if (d.name.trim().length < 3) e.push('Enter a name of at least 3 characters.');
  if (!/^[A-Z0-9]{2,10}$/.test(d.symbol)) e.push('Use a 2–10 character uppercase ticker.');
  if (d.allocations.length < 2) e.push('Select at least two assets.');
  if (new Set(d.allocations.map(a => a.asset.id)).size !== d.allocations.length) e.push('Duplicate assets are not allowed.');
  if (d.allocations.some(a => !Number.isFinite(a.weight) || a.weight <= 0 || a.weight > 100)) e.push('Every asset needs a positive weight.');
  if (Math.abs(d.allocations.reduce((s, a) => s + a.weight, 0) - 100) > 1e-5) e.push('Weights must total 100%.');
  if (!Number.isFinite(d.funding) || d.funding <= 0) e.push('Funding must be positive.');
  return e;
}

export function equalWeights<T extends {weight: number}>(items: T[]): T[] {
  if (!items.length) return [];
  const base = Math.floor(10000 / items.length);
  return items.map((a, i) => ({...a, weight: (base + (i < 10000 % items.length ? 1 : 0)) / 100}));
}
