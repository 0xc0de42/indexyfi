import {describe, expect, it} from 'vitest';
import {decodeAbiParameters} from 'viem';
import {flapAuthorization, mineFlapSalt, predictFlapToken, taxSummary} from './flap';

const PORTAL = '0x000042108465206185A077Edc3F3fd2b49060000';
const IMPL = '0x7777c57ff7dc441c1715b2e36fa581c48b782222';

describe('Flap token address and salt', () => {
  it('reproduces a real chain-97 Flap launch (tx 0x5e3c…8476)', () => {
    const salt = '0xc0f2925944054356dee3715a999f1ac57e3d0a82479ecce5eb0bf2171ab2ecd3';
    expect(predictFlapToken(PORTAL, IMPL, salt).toLowerCase()).toBe('0xba80c68b1df53119582f189a5f2fefa713fd7777');
  });
  it('mines a salt whose predicted token ends in the suffix', async () => {
    const mined = await mineFlapSalt({portal: PORTAL, implementation: IMPL, suffix: '77'}, {start: 1n});
    expect(mined.token.toLowerCase().endsWith('77')).toBe(true);
    expect(predictFlapToken(PORTAL, IMPL, mined.salt)).toBe(mined.token);
    await expect(mineFlapSalt({portal: PORTAL, implementation: IMPL, suffix: 'zz'})).rejects.toThrow('Invalid vanity suffix');
    await expect(mineFlapSalt({portal: PORTAL, implementation: IMPL, suffix: '7777'}, {maxTries: 10, start: 1n})).rejects.toThrow('No salt found');
  });
  it('encodes the launch authorization as a single bytes32', () => {
    const salt = `0x${'ab'.repeat(32)}` as const;
    const auth = flapAuthorization(salt);
    expect(auth.length).toBe(66);
    expect(decodeAbiParameters([{type: 'bytes32'}], auth)[0]).toBe(salt);
  });
  it('describes the tax schedule', () => {
    expect(taxSummary({buyTaxBps: 0, sellTaxBps: 100, taxDurationSeconds: 1})).toBe('Buy 0% · sell 1% for 1 s after launch, then 0%');
  });
});
