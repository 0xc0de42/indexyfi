import {describe, expect, it} from 'vitest';
import {toFunctionSelector, toEventSelector, type AbiFunction, type AbiEvent} from 'viem';
import {factoryAbi, vaultAbi, routerAbi} from './vaults';
import flapFactory from '../../../../contracts/openfour/flap-abi/IndexFiFlapFactory.abi.json';
import flapVault from '../../../../contracts/openfour/flap-abi/IndexFiFlapVault.abi.json';

/**
 * The frontend reads, deposits, redeems and launches Flap vaults with its shared ABIs (lib/vaults.ts). Every item must
 * exist in the generated Flap ABIs with the same selector and outputs, so a contract change fails CI here.
 */
type Item = AbiFunction | AbiEvent;
const items = (abi: readonly unknown[]) => (abi as Item[]).filter(x => x.type === 'function' || x.type === 'event');
const sel = (x: Item) => (x.type === 'function' ? toFunctionSelector(x) : toEventSelector(x));
const outs = (x: Item) => (x.type === 'function' ? x.outputs.map(o => o.type).join(',') : (x as AbiEvent).inputs.map(i => `${i.type}${i.indexed ? ' indexed' : ''}`).join(','));

describe('frontend ABIs match the Flap V3 contracts', () => {
  for (const [name, frontend, flap] of [['IndexFiFlapFactory', factoryAbi, flapFactory], ['IndexFiFlapVault', vaultAbi, flapVault]] as const) {
    it(`${name}: every shared function and event exists with the same selector and outputs`, () => {
      const bySel = new Map(items(flap as unknown as unknown[]).map(x => [sel(x), x]));
      for (const x of items(frontend)) {
        const match = bySel.get(sel(x));
        expect(match, `${name}.${x.name}`).toBeDefined();
        expect(outs(match!), `${name}.${x.name} outputs`).toBe(outs(x));
      }
    });
  }
  it('has the Flap-only entry points the UI uses', () => {
    expect(items(flapVault as unknown as unknown[]).some(x => x.name === 'forwardTaxRevenue')).toBe(true);
    expect(routerAbi.some(x => x.type === 'function' && x.name === 'swapExactTokensForTokensSupportingFeeOnTransferTokens')).toBe(true);
  });
});
