import {describe,expect,it} from 'vitest';
import {exactAmount,floorOutput,parseDeployment} from './vaults';

const manifest={
  chainId:31337,
  factory:'0x0000000000000000000000000000000000000001',
  deploymentBlock:1,
  settlementToken:'0x0000000000000000000000000000000000000002',
  settlementDecimals:6,
  adapter:'0x0000000000000000000000000000000000000003',
  assets:[{address:'0x0000000000000000000000000000000000000004',symbol:'ETH',decimals:18,referenceAssetId:'56:0x2170ed0880ac9a755fd29b2688956bd959f933f8',feedId:632}],
};

describe('vault boundary helpers',()=>{
  it('parses exact token units without floating point',()=>{
    expect(exactAmount('100.000001',6)).toBe(100_000_001n);
    expect(exactAmount('0.0000001',6)).toBeUndefined();
    expect(exactAmount('-1',6)).toBeUndefined();
  });
  it('floors output protections',()=>{
    expect(floorOutput(100_000_000n,100)).toBe(99_000_000n);
    expect(()=>floorOutput(1n,1001)).toThrow();
  });
  it('rejects the wrong chain, duplicate assets and invalid feed mappings',()=>{
    expect(parseDeployment(manifest,31337).assets[0].feedId).toBe(632);
    expect(()=>parseDeployment(manifest,97)).toThrow('Deployment chain mismatch');
    expect(()=>parseDeployment({...manifest,assets:[manifest.assets[0],manifest.assets[0]]},31337)).toThrow('Duplicate execution asset');
    expect(()=>parseDeployment({...manifest,assets:[{...manifest.assets[0],feedId:999}]},31337)).toThrow('Invalid reference mapping');
  });
});
