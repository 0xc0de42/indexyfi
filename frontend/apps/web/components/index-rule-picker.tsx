'use client';
import {referenceCategories} from '@/lib/catalog';
import {capFeasible, capLabel, INDEX_CAPS_BPS, INDEX_SIZES, ruleLabel, type IndexRule, type IndexSelection} from '@/lib/index-rule';
import {cmcUsd} from '@/lib/cmc-format';
import {AssetIcon} from './asset-icon';

/**
 * Composition mode: hand-picked assets, or an index rule (top N of a category by CMC market cap, S&P-style). The preview
 * follows live CMC data; the draft changes only when the creator applies it.
 */
export function IndexRulePicker({rule, onChange, selection, applied, onApply, quotesReady}: {
  rule: IndexRule;
  onChange: (rule: IndexRule) => void;
  selection: IndexSelection;
  /** The current composition equals this selection. */
  applied: boolean;
  onApply: () => void;
  quotesReady: boolean;
}) {
  const set = (patch: Partial<IndexRule>) => {
    const next = {...rule, ...patch};
    // Keep the cap feasible for the chosen size (size × cap must cover 100%).
    onChange(capFeasible(next.size, next.maxWeightBps) ? next : {...next, maxWeightBps: 0});
  };
  return (
    <div className="index-rule" data-testid="index-rule">
      <div className="tabs" role="group" aria-label="Composition mode">
        <button type="button" aria-pressed={rule.kind === 'manual'} onClick={() => set({kind: 'manual'})}>Manual selection</button>
        <button type="button" aria-pressed={rule.kind === 'topCap'} onClick={() => set({kind: 'topCap'})}>Index: top N by market cap</button>
      </div>
      {rule.kind === 'topCap' && (
        <>
          <p className="fine-print">
            Tracks the largest assets of a category by CoinMarketCap market cap, like an S&amp;P-style top-cap index. With rebalancing on, the index is
            re-selected and re-weighted at every rebalance.
          </p>
          <div className="index-rule__grid">
            <label className="field">Universe
              <select aria-label="Index universe" value={rule.universe} onChange={e => set({universe: e.target.value})}>
                <option value="All">All assets</option>
                {referenceCategories.map(c => <option key={c} value={c}>{c === 'Tokenized equity' ? 'Tokenized equity (tech stocks)' : c}</option>)}
              </select>
            </label>
            <div>
              <span className="fine-print">Constituents</span>
              <div className="tabs" role="group" aria-label="Index size">
                {INDEX_SIZES.map(n => <button type="button" key={n} aria-pressed={rule.size === n} onClick={() => set({size: n})}>Top {n}</button>)}
              </div>
            </div>
            <div>
              <span className="fine-print">Weighting</span>
              <div className="tabs" role="group" aria-label="Index weighting">
                <button type="button" aria-pressed={rule.weighting === 'cap'} onClick={() => set({weighting: 'cap'})}>Market cap</button>
                <button type="button" aria-pressed={rule.weighting === 'equal'} onClick={() => set({weighting: 'equal'})}>Equal</button>
              </div>
            </div>
            <div>
              <span className="fine-print">Max weight per asset</span>
              <div className="tabs" role="group" aria-label="Max weight">
                {INDEX_CAPS_BPS.map(c => (
                  <button type="button" key={c} disabled={rule.weighting === 'equal' || !capFeasible(rule.size, c)} aria-pressed={rule.weighting === 'cap' && rule.maxWeightBps === c}
                    title={!capFeasible(rule.size, c) ? `${rule.size} × ${capLabel(c)} is below 100%` : undefined} onClick={() => set({maxWeightBps: c})}>{capLabel(c)}</button>
                ))}
              </div>
            </div>
          </div>

          {(rule.universe === 'Tokenized equity' || rule.universe === 'ETF' || rule.universe === 'All') && (
            <p className="fine-print">Ranking uses CMC market caps of the tokenized listings, not of the underlying companies or funds, so &quot;top tech&quot; means the largest tokenized tech stocks.</p>
          )}
          {!quotesReady ? (
            <p className="muted">Waiting for CMC market caps…</p>
          ) : !selection.constituents.length ? (
            <p className="muted">No asset in this universe has a CMC market cap yet.</p>
          ) : (
            <>
              <div className="table-scroll">
                <table className="index-preview">
                  <thead><tr><th>#</th><th>Asset</th><th>CMC market cap</th><th>Weight</th></tr></thead>
                  <tbody>
                    {selection.constituents.map((c, i) => (
                      <tr key={c.asset.id}>
                        <td>{i + 1}</td>
                        <td><span className="portfolio-name"><AssetIcon asset={c.asset} /><span><strong>{c.asset.symbol}</strong><small>{c.asset.name}</small></span></span></td>
                        <td title={`${c.marketCap} USD`}>{cmcUsd(c.marketCap)}</td>
                        <td>{(c.weightBps / 100).toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {selection.constituents.length < rule.size && (
                <p className="fine-print">Only {selection.constituents.length} of the requested {rule.size} assets have a CMC market cap in this universe; the index uses those.</p>
              )}
              {selection.missing.length > 0 && <p className="fine-print">Skipped without a market cap: {selection.missing.map(a => a.symbol).join(', ')}.</p>}
              <div className="index-rule__apply">
                <span className="muted">{ruleLabel(rule)}</span>
                <button type="button" className="button button--primary" data-testid="apply-index" disabled={applied || selection.constituents.length < 2} onClick={onApply}>
                  {applied ? 'Applied to composition' : 'Apply index to composition'}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
