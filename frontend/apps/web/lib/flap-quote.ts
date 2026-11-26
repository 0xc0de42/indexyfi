/**
 * Transfer-tax-aware PancakeSwap quotes for Flap tax tokens. The token charges its tax on transfer:
 *  - sell (token → USD): the tax is taken from the input before it reaches the pair, so the AMM is quoted on the NET
 *    input (constant-product pricing is nonlinear; subtracting a percentage from the gross-input output is wrong);
 *  - buy (USD → token): the tax is taken from the tokens leaving the pair, so it applies to the AMM output.
 * Integer rounding follows Solidity division (floor). The contract simulation remains the final authority.
 */
export interface FlapTax {
  readonly buyTaxBps: number;
  readonly sellTaxBps: number;
  readonly taxDuration: number;
}

export const taxOf = (amount: bigint, bps: number): bigint => (amount * BigInt(bps)) / 10_000n;

/** The tax is active from launch until launch + taxDuration (exclusive); unknown launch time counts as active. */
export function flapTaxActive(t: FlapTax, launchSeconds: number | null, nowSeconds: number): {active: boolean; endsAt: number | null} {
  if (t.buyTaxBps === 0 && t.sellTaxBps === 0) return {active: false, endsAt: null};
  if (launchSeconds === null) return {active: true, endsAt: null};
  const endsAt = launchSeconds + t.taxDuration;
  return {active: nowSeconds < endsAt, endsAt};
}

export interface TaxedQuote {
  /** Amount the trader receives. */
  readonly out: bigint;
  /** Input the pair actually receives (gross minus sell tax). */
  readonly netInput: bigint;
  /** Tax charged, in the taxed token's units (input token for sells, output token for buys). */
  readonly tax: bigint;
  readonly taxBps: number;
}

/** Quote a swap through `quote(amountIn)` (router.getAmountsOut) with the Flap tax applied on the correct side. */
export async function quoteTaxedSwap({buy, amount, tax, active, quote}: {
  buy: boolean; amount: bigint; tax: FlapTax; active: boolean; quote: (amountIn: bigint) => Promise<bigint>;
}): Promise<TaxedQuote> {
  const taxBps = active ? (buy ? tax.buyTaxBps : tax.sellTaxBps) : 0;
  if (buy) {
    const raw = await quote(amount);
    const t = taxOf(raw, taxBps);
    return {out: raw - t, netInput: amount, tax: t, taxBps};
  }
  const t = taxOf(amount, taxBps);
  const netInput = amount - t;
  return {out: netInput > 0n ? await quote(netInput) : 0n, netInput, tax: t, taxBps};
}
