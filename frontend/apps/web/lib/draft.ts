import type {Asset, Draft} from '@/domain/model';
import {categories} from '@/domain/model';
import {equalWeights} from '@/domain/policy';
import {referenceAssetById} from './catalog';

/**
 * Create-wizard draft kept in this browser tab, so researching an asset or a
 * portfolio and coming back does not lose work. Stored by asset ID; anything that
 * no longer resolves against the registry is dropped on load.
 */
export const DRAFT_KEY = 'indexfi-create-draft';
export const EMPTY_DRAFT: Draft = {name: '', symbol: '', description: '', category: 'Crypto', allocations: []};

export interface SavedDraft {
  readonly draft: Draft;
  readonly step: number;
}

export function serializeDraft(draft: Draft, step: number): string {
  return JSON.stringify({...draft, allocations: draft.allocations.map(a => ({id: a.asset.id, weight: a.weight})), step});
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');
const finite = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

export function parseDraft(raw: string | null): SavedDraft | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const seen = new Set<string>();
  const allocations: Draft['allocations'] = [];
  for (const item of Array.isArray(record.allocations) ? record.allocations : []) {
    if (typeof item !== 'object' || item === null) continue;
    const {id, weight} = item as Record<string, unknown>;
    const asset = typeof id === 'string' ? referenceAssetById(id) : undefined;
    if (!asset || seen.has(asset.id)) continue;
    seen.add(asset.id);
    allocations.push({asset, weight: finite(weight, 0)});
  }
  const category = text(record.category, 40);
  return {
    draft: {
      name: text(record.name, 64),
      symbol: text(record.symbol, 10),
      description: text(record.description, 300),
      category: categories.includes(category) ? category : EMPTY_DRAFT.category,
      allocations,
    },
    step: Math.min(3, Math.max(0, Math.trunc(finite(record.step, 0)))),
  };
}

export interface Prefill {
  readonly assets?: readonly string[];
  /** On-chain vault address whose composition to copy (resolved by the caller into a Template). */
  readonly from?: string;
}

/** Composition of an existing basket, read from chain by the caller. */
export interface Template {
  readonly name: string;
  readonly allocations: readonly {readonly asset: Asset; readonly weight: number}[];
}

export interface PrefillResult {
  readonly draft: Draft;
  /** What changed, for a one-line notice; null when the prefill had no effect. */
  readonly notice: string | null;
}

/**
 * Apply a link's prefill to the current draft. A `template` (the on-chain basket named by `from`) copies its
 * composition and weights (identity stays the creator's); `assets` adds assets that are not already selected and
 * re-spreads weights equally.
 */
export function applyPrefill(draft: Draft, prefill: Prefill, template?: Template | null): PrefillResult {
  if (prefill.from && template && template.allocations.length) {
    return {
      draft: {...draft, allocations: template.allocations.map(a => ({asset: a.asset, weight: a.weight}))},
      notice: `Composition copied from ${template.name}. Give your portfolio its own name and ticker.`,
    };
  }
  const added = (prefill.assets ?? [])
    .map(id => referenceAssetById(id))
    .filter((asset): asset is NonNullable<typeof asset> => asset !== undefined)
    .filter((asset, i, all) => all.findIndex(a => a.id === asset.id) === i && !draft.allocations.some(a => a.asset.id === asset.id));
  if (!added.length) return {draft, notice: null};
  return {
    draft: {...draft, allocations: equalWeights([...draft.allocations, ...added.map(asset => ({asset, weight: 0}))])},
    notice: `${added.map(a => a.symbol).join(', ')} added to your draft.`,
  };
}
