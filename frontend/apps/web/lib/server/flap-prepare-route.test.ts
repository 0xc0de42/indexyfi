import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import {parseFlapManifest} from './flap-manifest';
import {handlePrepare} from './flap-prepare-route';

const USD = '0x190C989D5665a0e404B444b53CAE9AbCfb600157';
const TOKEN = '0x71FAca52447053A9441908EF2f4f72A03cf90dEB';
const manifest = parseFlapManifest({schemaVersion:6,provider:'flap-direct-v3',fixture:false,testAssets:true,chainId:97,deploymentBlock:1,
  factory:'0x1111111111111111111111111111111111111111',vaultFactory:'0x2222222222222222222222222222222222222222',vaultImplementation:'0x3333333333333333333333333333333333333333',
  portal:'0x000042108465206185A077Edc3F3fd2b49060000',dockRouter:'0x000048E888aBf09f690a952E1b386b2D031a0000',guardian:'0x00004d58290854c5E9880F4b5B1993c6Ad8b0000',settlementToken:USD,settlementDecimals:18,
  adapter:'0x4444444444444444444444444444444444444444',oracle:'0x5555555555555555555555555555555555555555',router:'0xD99D1c33F9fC3444f8101754aBC46c52416550D1',tokenImplementation:'0x7777c57ff7dc441c1715b2e36fa581c48b782222',
  cap:'1000000000000000000000000000',buyTaxBps:0,sellTaxBps:100,taxDuration:86400,antiFarmerDuration:0,minimumSeed:'100000000000000000000',minimumLiquidity:'1000000000000000000',
  salt:{suffix:'7777',lockRequired:false},assets:[{address:TOKEN,symbol:'ETH',decimals:18,referenceAssetId:'56:eth',feedId:632,isMock:true,buyPath:[USD,TOKEN],sellPath:[TOKEN,USD]}]});
const body = {provider:'flap',chainId:97,creator:'0x0cdf9fa9934aC2F8615d2ccD2b65A9968a275C1b',name:'Top 3 Market Cap',symbol:'T3MC',metadataURI:'ipfs://t3mc',
  constituents:[{token:TOKEN,weightBps:10000}],seed:'1000000000000000000000',liquidity:'100000000000000000000'};
const free = async () => '0x';
const post = (b: unknown, deps = {}) => handlePrepare(new Request('http://x/api/flap/launch/prepare', {method:'POST', body: typeof b === 'string' ? b : JSON.stringify(b)}),
  {loadManifest: async () => manifest, getCode: free, ...deps});
const json = async (r: Response) => ({status: r.status, body: await r.json() as Record<string, unknown>, cache: r.headers.get('cache-control')});

describe('POST /api/flap/launch/prepare', () => {
  it('returns provider, chain, predicted …7777 token, salt authorization and expiry', async () => {
    const r = await json(await post(body, {now: () => Date.parse('2026-11-26T10:00:00Z')}));
    expect(r.status).toBe(200);
    expect(r.cache).toBe('no-store');
    expect(r.body).toMatchObject({provider:'flap', chainId:97, feedIds:[632], expiresAt:'2026-11-26T10:10:00.000Z', collisionChecked:true, saltLockTransaction:null});
    expect(String(r.body.predictedToken).toLowerCase().endsWith('7777')).toBe(true);
    expect(String(r.body.launchAuthorization).toLowerCase()).toBe(String(r.body.salt).toLowerCase());
  }, 30_000);
  it.each([
    ['not JSON', '{', 'invalid_json'],
    ['a non-object body', [1], 'invalid_request'],
    ['an invalid venue', {...body, provider:'openfour'}, 'invalid_venue'],
    ['an unsupported chain', {...body, chainId:56}, 'invalid_chain'],
    ['a zero creator', {...body, creator:'0x0000000000000000000000000000000000000000'}, 'invalid_creator'],
    ['an empty name', {...body, name:' '}, 'invalid_identity'],
    ['no constituents', {...body, constituents:[]}, 'invalid_basket'],
    ['an unadmitted token', {...body, constituents:[{token:'0x9999999999999999999999999999999999999999',weightBps:10000}]}, 'invalid_basket'],
    ['weights not totalling 100%', {...body, constituents:[{token:TOKEN,weightBps:9000}]}, 'invalid_basket'],
    ['a duplicate token', {...body, constituents:[{token:TOKEN,weightBps:5000},{token:TOKEN.toLowerCase(),weightBps:5000}]}, 'invalid_basket'],
    ['a non-integer seed', {...body, seed:'1.5'}, 'invalid_funding'],
    ['a numeric seed', {...body, seed:1000}, 'invalid_funding'],
    ['a seed below the minimum', {...body, seed:'1'}, 'invalid_funding'],
    ['liquidity below the minimum', {...body, liquidity:'0'}, 'invalid_funding'],
  ])('rejects %s with 400 before mining', async (_name, b, code) => {
    const mine = vi.fn();
    const r = await json(await post(b, {mine}));
    expect(r).toMatchObject({status: 400, body: {error: code}});
    expect(mine).not.toHaveBeenCalled();
  });
  it('returns 503 when the manifest is missing or salt mining fails', async () => {
    expect(await json(await post(body, {loadManifest: async () => { throw Error('ENOENT flap.json'); }}))).toMatchObject({status: 503, body: {error: 'flap_unavailable'}});
    expect(await json(await post(body, {mine: async () => { throw Error('No salt found for suffix 7777 within 5 tries'); }}))).toMatchObject({status: 503, body: {error: 'salt_generation_failed'}});
  });
  it('retries from the next salt when the predicted token already has code, and gives up after repeated collisions', async () => {
    const taken = new Set<string>();
    const first = await json(await post(body, {getCode: async (a: string) => { if (!taken.size) { taken.add(a); return '0x6080'; } return '0x'; }}));
    expect(first.status).toBe(200);
    expect(taken.has(String(first.body.predictedToken))).toBe(false);
    expect(await json(await post(body, {getCode: async () => '0x6080'}))).toMatchObject({status: 503, body: {error: 'salt_generation_failed'}});
  }, 60_000);
  it('does not block on an unreachable RPC and reports the check as skipped', async () => {
    const r = await json(await post(body, {getCode: async () => { throw Error('fetch failed'); }}));
    expect(r).toMatchObject({status: 200, body: {collisionChecked: false}});
  }, 30_000);
  it('never reads or exposes operator credentials', async () => {
    const src = ['flap-prepare.ts', 'flap-prepare-route.ts', 'flap-manifest.ts'].map(f => readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
    expect(src).not.toMatch(/process\.env|PRIVATE_KEY|MNEMONIC|signMessage|privateKeyToAccount/);
    const r = await json(await post(body));
    expect(Object.keys(r.body).sort()).toEqual(['chainId','collisionChecked','expiresAt','feedIds','launchAuthorization','predictedToken','provider','requestId','salt','saltLockTransaction']);
  }, 30_000);
});
