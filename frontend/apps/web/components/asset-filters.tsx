'use client';
import {ArrowDown, ArrowUp, Search} from 'lucide-react';
import {referenceCategories} from '@/lib/catalog';
import {ASSET_SORTS, defaultDirection, sortValue, type AssetData, type AssetSort, type SortDirection} from '@/lib/asset-query';
import {cmcPct, cmcUsd, pctTone} from '@/lib/cmc-format';
import {formatPrice, percent} from '@/domain/model';

export interface AssetFilterState {
  readonly search: string;
  readonly category: string;
  readonly sort: AssetSort;
  readonly direction: SortDirection;
}
export const INITIAL_FILTERS: AssetFilterState = {search: '', category: 'All', sort: 'symbol', direction: 'asc'};

/** Search, category, sort metric (Atlas or CMC) and direction for a list of reference assets. */
export function AssetFilters({value, onChange, shown, total}: {
  value: AssetFilterState;
  onChange: (next: AssetFilterState) => void;
  shown: number;
  total: number;
}) {
  const set = (patch: Partial<AssetFilterState>) => onChange({...value, ...patch});
  const filtered = value.search || value.category !== 'All';
  return (
    <div className="asset-filters" role="group" aria-label="Filter and sort assets">
      <label className="search asset-filters__search">
        <Search size={16} />
        <input aria-label="Search assets" placeholder="Name, symbol or address" value={value.search} onChange={e => set({search: e.target.value})} />
      </label>
      <label className="sort">
        <select aria-label="Category" value={value.category} onChange={e => set({category: e.target.value})}>
          <option value="All">All categories</option>
          {referenceCategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label className="sort">
        <select aria-label="Sort by" value={value.sort} onChange={e => { const sort = e.target.value as AssetSort; set({sort, direction: defaultDirection(sort)}); }}>
          {ASSET_SORTS.map(s => <option key={s.value} value={s.value}>{s.source ? `Sort: ${s.label}` : 'Sort: Symbol'}</option>)}
        </select>
      </label>
      <button type="button" className="button button--secondary asset-filters__direction" aria-label={value.direction === 'desc' ? 'Highest first' : 'Lowest first'}
        onClick={() => set({direction: value.direction === 'desc' ? 'asc' : 'desc'})}>
        {value.direction === 'desc' ? <ArrowDown size={15} /> : <ArrowUp size={15} />}
        {value.sort === 'symbol' ? (value.direction === 'asc' ? 'A–Z' : 'Z–A') : value.direction === 'desc' ? 'High first' : 'Low first'}
      </button>
      <span className="muted asset-filters__count">
        {shown} of {total}
        {filtered && <> · <button type="button" className="text-button" onClick={() => onChange({...INITIAL_FILTERS, sort: value.sort, direction: value.direction})}>Clear filters</button></>}
      </span>
    </div>
  );
}

/** The value of the active sort metric for one asset, formatted for a compact list (null for Symbol). */
export function sortMetricLabel(sort: AssetSort, data: AssetData): {text: string; tone: string} | null {
  if (sort === 'symbol' || sort === 'price') return null;
  const label = ASSET_SORTS.find(s => s.value === sort)!.label;
  const v = sortValue(sort, data);
  if (sort === 'atlasChange') {
    const span = data.atlasSpanMs ? `${(data.atlasSpanMs / 3_600_000).toFixed(1)}h` : '';
    return {text: `Atlas ${span} ${percent(typeof v === 'number' ? v : null)}`.replace('  ', ' '), tone: typeof v === 'number' ? (v < 0 ? 'negative' : 'positive') : ''};
  }
  if (sort === 'cap' || sort === 'volume') return {text: `${label.replace('CMC ', '')} ${cmcUsd(v as string | null)}`, tone: ''};
  return {text: `${label} ${cmcPct(v as string | null)}`, tone: pctTone(v as string | null)};
}

