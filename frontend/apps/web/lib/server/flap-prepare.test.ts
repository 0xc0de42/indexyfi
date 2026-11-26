import {describe, expect, it} from 'vitest';
import {parseFlapManifest, type FlapManifest} from './flap-manifest';
import {prepareFlapLaunch, type FlapPrepareInput} from './flap-prepare';

const USD = '0x190C989D5665a0e404B444b53CAE9AbCfb600157';
const TOKEN = '0x71FAca52447053A9441908EF2f4f72A03cf90dEB';
const PORTAL = '0x000042108465206185A077Edc3F3fd2b49060000';
const IMPLEMENTATION = '0x7777c57ff7dc441c1715b2e36fa581c48b782222';
const manifest = parseFlapManifest({schemaVersion:6,provider:'flap-direct-v3',fixture:false,testAssets:true,chainId:97,deploymentBlock:1,
  factory:'0x1111111111111111111111111111111111111111',vaultFactory:'0x2222222222222222222222222222222222222222',vaultImplementation:'0x3333333333333333333333333333333333333333',
  portal:PORTAL,dockRouter:'0x000048E888aBf09f690a952E1b386b2D031a0000',guardian:'0x00004d58290854c5E9880F4b5B1993c6Ad8b0000',settlementToken:USD,settlementDecimals:18,
  adapter:'0x4444444444444444444444444444444444444444',oracle:'0x5555555555555555555555555555555555555555',router:'0xD99D1c33F9fC3444f8101754aBC46c52416550D1',tokenImplementation:IMPLEMENTATION,
  cap:'1000000000000000000000000000',buyTaxBps:0,sellTaxBps:100,taxDuration:86400,antiFarmerDuration:0,minimumSeed:'100000000000000000000',minimumLiquidity:'1000000000000000000',
  salt:{suffix:'7777',lockRequired:false},assets:[{address:TOKEN,symbol:'ETH',decimals:18,referenceAssetId:'56:eth',feedId:632,isMock:true,buyPath:[USD,TOKEN],sellPath:[TOKEN,USD]}]});
const input: FlapPrepareInput = {chainId:97,creator:'0xB64c94312De7Ff21FBb7f323Bfc3d9f1A6A3f1cE',name:'IndexFi Demo',symbol:'IFDEMO',metadataURI:'ipfs://demo',
  constituents:[{token:TOKEN,weightBps:10000}],seed:'1000000000000000000000',liquidity:'100000000000000000000'};

describe('Flap launch preparation', () => {
  it('mines and returns a stateless unlocked authorization', async () => {
    const out = await prepareFlapLaunch(input, manifest as FlapManifest, {getCode: async () => '0x'});
    expect(out.predictedToken.toLowerCase().endsWith('7777')).toBe(true);
    expect(out.launchAuthorization).toBe(out.salt);
    expect(out.feedIds).toEqual([632]);
    expect(out.saltLockTransaction).toBeNull();
    expect(BigInt(out.requestId)).toBeGreaterThan(0n);
  }, 30_000);
  it('rejects an unadmitted token and bad weights', async () => {
    await expect(prepareFlapLaunch({...input,constituents:[{token:'0x9999999999999999999999999999999999999999',weightBps:10000}]}, manifest)).rejects.toThrow('unsupported Flap asset');
    await expect(prepareFlapLaunch({...input,constituents:[{token:TOKEN,weightBps:9999}]}, manifest)).rejects.toThrow('total 10000');
  });
  it('rejects duplicate manifest identities and malformed paths', () => {
    expect(() => parseFlapManifest({...manifest,assets:[manifest.assets[0],manifest.assets[0]]})).toThrow('duplicate');
    expect(() => parseFlapManifest({...manifest,assets:[{...manifest.assets[0],buyPath:[TOKEN,USD]}]})).toThrow('invalid buy path');
  });
});
