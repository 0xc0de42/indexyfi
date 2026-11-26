import type {Draft} from './model';

/** Wizard step an issue belongs to: 0 identity, 1 composition, 2 allocation, 3 funding. */
export type DraftStep = 0 | 1 | 2 | 3;
export interface DraftIssue {
  readonly step: DraftStep;
  readonly message: string;
}

export function draftIssues(d: Draft): DraftIssue[] {
  const e: DraftIssue[] = [];
  if (d.name.trim().length < 3) e.push({step: 0, message: 'Enter a name of at least 3 characters.'});
  if (!/^[A-Z0-9]{2,10}$/.test(d.symbol)) e.push({step: 0, message: 'Use a 2–10 character uppercase ticker.'});
  if (d.allocations.length < 2) e.push({step: 1, message: 'Select at least two assets.'});
  if (new Set(d.allocations.map(a => a.asset.id)).size !== d.allocations.length) e.push({step: 1, message: 'Duplicate assets are not allowed.'});
  if (d.allocations.some(a => !Number.isFinite(a.weight) || a.weight <= 0 || a.weight > 100)) e.push({step: 2, message: 'Every asset needs a positive weight.'});
  if (Math.abs(d.allocations.reduce((s, a) => s + a.weight, 0) - 100) > 1e-5) e.push({step: 2, message: 'Weights must total 100%.'});
  if (!Number.isFinite(d.funding) || d.funding < 100) e.push({step: 3, message: 'Funding must be at least 100 USDT.'});
  return e;
}

export const draftErrors = (d: Draft): string[] => draftIssues(d).map(issue => issue.message);

export function equalWeights<T extends {weight: number}>(items: T[]): T[] {
  if (!items.length) return [];
  const base = Math.floor(10000 / items.length);
  return items.map((a, i) => ({...a, weight: (base + (i < 10000 % items.length ? 1 : 0)) / 100}));
}
