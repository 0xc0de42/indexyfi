import {describe, expect, it} from 'vitest';
import {flapTaxActive, quoteTaxedSwap, taxOf, type FlapTax} from './flap-quote';

// PancakeSwap V2 getAmountsOut for one hop (0.25% fee), to test against real constant-product pricing.
const amm = (rIn: bigint, rOut: bigint) => async (x: bigint) => (x * 9_975n * rOut) / (rIn * 10_000n + x * 9_975n);
const E18 = 10n ** 18n;
const tax: FlapTax = {buyTaxBps: 0, sellTaxBps: 100, taxDuration: 86_400};

describe('Flap tax-aware quotes', () => {
  it('is active only before launch + taxDuration (exclusive boundary)', () => {
    expect(flapTaxActive(tax, 1_000, 1_000 + 86_399).active).toBe(true);
    expect(flapTaxActive(tax, 1_000, 1_000 + 86_400).active).toBe(false);
    expect(flapTaxActive(tax, null, 5).active).toBe(true); // unknown launch time: assume active (safer minimum)
    expect(flapTaxActive({...tax, sellTaxBps: 0}, null, 5).active).toBe(false);
  });
  it('rounds the tax down like Solidity', () => {
    expect(taxOf(99n, 100)).toBe(0n);
    expect(taxOf(100n, 100)).toBe(1n);
    expect(taxOf(12_345n, 250)).toBe(308n);
  });
  it('quotes an active sell on the NET input, not by trimming the gross output', async () => {
    const quote = amm(1_000n * E18, 1_000n * E18); // token reserve, USD reserve
    const amount = 300n * E18;                     // a large sale (30% of the pool)
    const q = await quoteTaxedSwap({buy: false, amount, tax, active: true, quote});
    expect(q.netInput).toBe(297n * E18);
    expect(q.out).toBe(await quote(297n * E18));
    const outputSideApprox = ((await quote(amount)) * 9_900n) / 10_000n;
    expect(q.out).not.toBe(outputSideApprox); // nonlinear: the two differ for large trades
    expect(q.out > outputSideApprox).toBe(true);
  });
  it('quotes an expired sell on the full input and an active buy on the output', async () => {
    const quote = amm(1_000n * E18, 1_000n * E18);
    const sell = await quoteTaxedSwap({buy: false, amount: 10n * E18, tax, active: false, quote});
    expect(sell).toMatchObject({netInput: 10n * E18, tax: 0n, out: await quote(10n * E18)});
    const buy = await quoteTaxedSwap({buy: true, amount: 10n * E18, tax: {...tax, buyTaxBps: 200}, active: true, quote});
    const raw = await quote(10n * E18);
    expect(buy.out).toBe(raw - (raw * 200n) / 10_000n);
    expect(buy.tax).toBe((raw * 200n) / 10_000n);
  });
});
