import {describe, expect, it} from 'vitest';
import {draftIssues} from '@/domain/policy';
import {portfolios} from '@/domain/fixtures';
import {referenceAssets} from './catalog';
import {applyPrefill, EMPTY_DRAFT, parseDraft, serializeDraft} from './draft';
import {assetHref, createHref, isWindowLabel} from './routes';

const [a, b, c] = referenceAssets;

describe('draft storage', () => {
  it('round-trips a draft by asset ID', () => {
    const draft = {...EMPTY_DRAFT, name: 'Leaders', symbol: 'LEAD', allocations: [{asset: a, weight: 60}, {asset: b, weight: 40}]};
    expect(parseDraft(serializeDraft(draft, 2))).toEqual({draft, step: 2});
  });

  it('drops unknown or duplicate assets and rejects malformed input', () => {
    const raw = JSON.stringify({name: 'X', allocations: [{id: a.id, weight: 50}, {id: a.id, weight: 50}, {id: '56:0xdead', weight: 1}], step: 99});
    const saved = parseDraft(raw);
    expect(saved?.draft.allocations.map(x => x.asset.id)).toEqual([a.id]);
    expect(saved?.step).toBe(4);
    expect(parseDraft('{not json')).toBeNull();
    expect(parseDraft('null')).toBeNull();
    expect(parseDraft(null)).toBeNull();
  });
});

describe('prefill', () => {
  it('adds new assets and re-spreads weights equally', () => {
    const start = {...EMPTY_DRAFT, allocations: [{asset: a, weight: 100}]};
    const result = applyPrefill(start, {assets: [a.id, b.id, c.id, b.id]});
    expect(result.draft.allocations.map(x => x.asset.id)).toEqual([a.id, b.id, c.id]);
    expect(result.draft.allocations.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(100);
    expect(result.notice).toContain(b.symbol);
  });

  it('ignores assets already selected or not in the registry', () => {
    const start = {...EMPTY_DRAFT, allocations: [{asset: a, weight: 100}]};
    expect(applyPrefill(start, {assets: [a.id, 'BTCB']})).toEqual({draft: start, notice: null});
  });

  it('copies a template composition but not its identity', () => {
    const template = portfolios[0];
    const result = applyPrefill({...EMPTY_DRAFT, name: 'Mine'}, {from: template.id});
    expect(result.draft.name).toBe('Mine');
    expect(result.draft.allocations.map(x => [x.asset.id, x.weight])).toEqual(template.allocations.map(x => [x.asset.id, x.weight]));
  });
});

describe('step validation', () => {
  it('assigns each issue to its wizard step', () => {
    const steps = draftIssues({...EMPTY_DRAFT, funding: 0}).map(issue => issue.step);
    expect(new Set(steps)).toEqual(new Set([0, 1, 2, 3]));
  });
});

describe('routes', () => {
  it('builds links by canonical asset ID', () => {
    expect(assetHref(a.id, '1h')).toBe(`/assets?asset=${encodeURIComponent(a.id)}&window=1h`);
    expect(createHref({})).toBe('/create');
    expect(createHref({from: 'blue', assets: [a.id]})).toBe(`/create?from=blue&assets=${encodeURIComponent(a.id)}`);
    expect(isWindowLabel('6h')).toBe(true);
    expect(isWindowLabel('7d')).toBe(false);
  });
});
