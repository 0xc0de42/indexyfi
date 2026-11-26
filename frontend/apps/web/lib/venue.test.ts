import {describe, expect, it} from 'vitest';
import {canTrade, depositImpactPct, tradingLifecycle, tradingState, vaultErrorMessage, venuePresentation} from './venue';

const PAIR = '0x1c42FEF67DC9AeF66f5E5BEE728EF516C97096b9';
const ready = {closed: false, phase: 3, pair: PAIR, pool: {cash: 10n ** 20n, shares: 10n ** 20n, supply: 1n, lpBalance: 0n, marketPrice: 10n ** 18n}};
type V = Parameters<typeof tradingLifecycle>[0];

describe('venue presentation', () => {
  it('derives settlement label and notices from the deployment', () => {
    const of = venuePresentation({provider: 'openfour', fixture: false}), fl = venuePresentation({provider: 'flap', fixture: false});
    expect(of.settlementLabel).toBe('USDT');
    expect(fl.settlementLabel).toBe('Flap USD');
    expect(of.launchAuthorizationNotice).toMatch(/signature authorizing the OpenFour launch/);
    expect(fl.launchAuthorizationNotice).not.toMatch(/OpenFour|signature authorizing/);
    expect(fl.externalTradingNotice).toMatch(/outside IndexFi/);
    expect(of.externalTradingNotice).toBeNull();
    expect(venuePresentation({provider: 'openfour', fixture: true}).launchAuthorizationNotice).toBeNull();
  });
});

describe('trading lifecycle (shared $10k unlock)', () => {
  it('needs both the milestone and an operational market', () => {
    expect(canTrade(tradingLifecycle(ready as V, 9_999))).toBe(false);                       // below milestone, pool exists
    expect(tradingState(tradingLifecycle(ready as V, 10_000))).toBe('unlocked');
    expect(tradingState(tradingLifecycle({...ready, phase: 2} as V, 12_000))).toBe('pending_market'); // migration pending
    expect(tradingState(tradingLifecycle({...ready, pair: '0x0000000000000000000000000000000000000000'} as V, 12_000))).toBe('pending_market');
    expect(tradingState(tradingLifecycle({...ready, pool: {...ready.pool, cash: 0n}} as V, 12_000))).toBe('pending_market'); // unusable pool
    expect(tradingState(tradingLifecycle({...ready, pool: null} as unknown as V, 12_000))).toBe('pending_market');
    expect(canTrade(tradingLifecycle({...ready, closed: true} as V, 12_000))).toBe(false);
  });
  it('re-locks dynamically when AUM falls back below the milestone', () => {
    expect(canTrade(tradingLifecycle(ready as V, 10_500))).toBe(true);
    expect(canTrade(tradingLifecycle(ready as V, 9_800))).toBe(false);
    expect(tradingLifecycle(ready as V, null).milestoneReached).toBe(false);
  });
});

describe('readable vault errors and deposit impact', () => {
  it('maps Flap and shared failures, passes unknown ones through', () => {
    expect(vaultErrorMessage({provider: 'flap'}, 'The contract function "quoteDepositWithPrices" reverted.\ncustom error 0x7dd37f70')).toMatch(/5% away from the Atlas price/);
    expect(vaultErrorMessage({provider: 'openfour'}, 'reverted with custom error StalePrice(address,uint256,uint256)')).toMatch(/oracle price is older/);
    expect(vaultErrorMessage({provider: 'openfour'}, 'execution reverted: ERC20: insufficient allowance')).toMatch(/approval is too small/);
    expect(vaultErrorMessage({provider: 'openfour'}, 'User rejected the request.')).toBe('User rejected the request.');
  });
  it('computes deposit price impact from the quoted shares at NAV', () => {
    expect(depositImpactPct(10_000, 9_400, 1)).toBeCloseTo(6);
    expect(depositImpactPct(100, 99.6, 1)).toBeCloseTo(0.4);
    expect(depositImpactPct(100, 0, 1)).toBeNull();
    expect(depositImpactPct(100, 99, null)).toBeNull();
  });
});
