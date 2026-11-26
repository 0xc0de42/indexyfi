import {describe, expect, it} from 'vitest';
import {flapToDeployment, parseDeployment} from './vaults';
import {parseFlapManifest} from './flap-manifest';
import openfour from '../public/deployments/97.json';

const USD = '0x190C989D5665a0e404B444b53CAE9AbCfb600157';
const asset = openfour.assets[0];
const flapManifest = {
  schemaVersion: 6, provider: 'flap-direct-v3', fixture: false, testAssets: true, chainId: 97, deploymentBlock: 1,
  factory: '0x1111111111111111111111111111111111111111', vaultFactory: '0x2222222222222222222222222222222222222222', vaultImplementation: '0x3333333333333333333333333333333333333333',
  portal: '0x000042108465206185A077Edc3F3fd2b49060000', dockRouter: '0x000048E888aBf09f690a952E1b386b2D031a0000', guardian: '0x00004d58290854c5E9880F4b5B1993c6Ad8b0000',
  settlementToken: USD, settlementDecimals: 18, adapter: '0x4444444444444444444444444444444444444444', oracle: '0x5555555555555555555555555555555555555555',
  router: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1', tokenImplementation: '0x7777c57ff7dc441c1715b2e36fa581c48b782222',
  cap: '1000000000000000000000000000', buyTaxBps: 0, sellTaxBps: 100, taxDuration: 1, antiFarmerDuration: 0,
  minimumSeed: '100000000000000000000', minimumLiquidity: '1000000000000000000', salt: {suffix: '7777', lockRequired: false},
  assets: [{address: asset.address, symbol: asset.symbol, decimals: asset.decimals, referenceAssetId: asset.referenceAssetId, feedId: asset.feedId, isMock: true, buyPath: [USD, asset.address], sellPath: [asset.address, USD]}],
};

describe('provider-aware deployments', () => {
  it('converts a Flap schema-6 manifest into the shared deployment shape', () => {
    const d = flapToDeployment(parseFlapManifest(flapManifest));
    expect(d.provider).toBe('flap');
    expect(d.supplyModel).toBe('flap-dock-inventory');
    expect(d.features.rebalancing).toBe(false);
    expect(d.settlementToken).toBe(USD);
    expect(d.flap).toMatchObject({saltSuffix: '7777', sellTaxBps: 100, taxDuration: 1});
    expect(d.assets[0]).toMatchObject({address: asset.address, feedId: asset.feedId});
  });
  it('keeps OpenFour manifests on the OpenFour provider by default', () => {
    expect(parseDeployment(openfour, 97).provider).toBe('openfour');
  });
  it('rejects Flap manifests with wrong paths or duplicates', () => {
    expect(() => parseFlapManifest({...flapManifest, assets: [{...flapManifest.assets[0], buyPath: [asset.address, USD]}]})).toThrow('invalid buy path');
    expect(() => parseFlapManifest({...flapManifest, assets: [flapManifest.assets[0], flapManifest.assets[0]]})).toThrow('duplicate');
    expect(() => parseFlapManifest({...flapManifest, salt: {suffix: '8888', lockRequired: false}})).toThrow();
  });
});
