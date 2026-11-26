import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {tradingLifecycle} from '@/lib/venue';
import {TradingUnlockBar} from './trading-unlock';

const PAIR = '0x1c42FEF67DC9AeF66f5E5BEE728EF516C97096b9';
const pool = {cash: 10n ** 20n, shares: 10n ** 20n, supply: 1n, lpBalance: 0n, marketPrice: 10n ** 18n};
type V = Parameters<typeof tradingLifecycle>[0];
const html = (v: Partial<V>, aum: number | null) =>
  renderToStaticMarkup(createElement(TradingUnlockBar, {s: tradingLifecycle({closed: false, phase: 3, pair: PAIR, pool, ...v} as V, aum), aum}));

describe('TradingUnlockBar (shared by OpenFour and Flap)', () => {
  it('shows progress below the milestone even when a pool exists', () => {
    const out = html({}, 4_000);
    expect(out).toContain('data-state="locked"');
    expect(out).toContain('40.0% to trading unlock');
    expect(out).toContain('aria-label="Trading unlock progress"');
    expect(out.replace(/<[^>]+>/g, ' ')).not.toMatch(/graduat/i); // visible text (CSS class names are unchanged)
  });
  it('shows pending when the milestone is reached but the market is not operational', () => {
    expect(html({phase: 2}, 12_000)).toContain('data-state="pending_market"');
    expect(html({pool: {...pool, shares: 0n}}, 12_000)).toContain('market not operational yet');
  });
  it('shows unlocked only with milestone and market, and re-locks when AUM falls', () => {
    expect(html({}, 10_000)).toContain('data-state="unlocked"');
    expect(html({}, 9_500)).toContain('data-state="locked"');
  });
});
