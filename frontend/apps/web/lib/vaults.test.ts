import {describe,expect,it} from 'vitest';
import {exactAmount,floorOutput,parseDeployment,marketPrice18,lpAmounts,legMinimums,newRequestId,authorizeLaunch,gasLimit,GAS_CAP} from './vaults';

const manifest={
  schemaVersion:5, fixture:true, supplyModel:"standard-openfour-inventory",
  chainId:31337,
  factory:'0x0000000000000000000000000000000000000001',
  deploymentBlock:1,
  settlementToken:'0x0000000000000000000000000000000000000002',
  settlementDecimals:6,
  adapter:'0x0000000000000000000000000000000000000003',
  oracle:"0x0000000000000000000000000000000000000005",router:"0x0000000000000000000000000000000000000006",
  assets:[{address:'0x0000000000000000000000000000000000000004',symbol:'ETH',decimals:18,referenceAssetId:'56:0x2170ed0880ac9a755fd29b2688956bd959f933f8',feedId:632}],
};

describe('vault boundary helpers',()=>{
  it('parses exact token units without floating point',()=>{
    expect(exactAmount('100.000001',6)).toBe(100_000_001n);
    expect(exactAmount('0.0000001',6)).toBeUndefined();
    expect(exactAmount('-1',6)).toBeUndefined();
  });
  it('sends explicit gas limits that cover measured usage and stay under the per-transaction cap',()=>{
    // Measured on the fixture (gas used): launch 2→4.03M, 14→7.10M, 32→11.88M; deposit 32→4.66M; redeem 32→4.56M; in-kind 32→2.61M.
    expect(gasLimit('create',2)).toBeGreaterThan(4_034_840n);
    expect(gasLimit('create',14)).toBeGreaterThan(7_104_304n);
    expect(gasLimit('create',32)).toBeGreaterThan(11_881_394n);
    expect(gasLimit('deposit',32)).toBeGreaterThan(4_659_758n);
    expect(gasLimit('redeem',32)).toBeGreaterThan(4_559_928n);
    expect(gasLimit('redeemInKind',32)).toBeGreaterThan(2_606_148n);
    for(const kind of ['create','deposit','redeem','redeemInKind','swap','addLiquidity','removeLiquidity'] as const)
      expect(gasLimit(kind,32)).toBeLessThanOrEqual(GAS_CAP);
    expect(GAS_CAP).toBeLessThan(16_777_216n);
    expect(gasLimit('deposit',9,1_000_000n)).toBe(1_200_000n); // node estimate +20%
    expect(gasLimit('create',14,20_000_000n)).toBe(GAS_CAP); // never above the cap
    expect(()=>gasLimit('create',-1)).toThrow();
  });
  it('floors output protections',()=>{
    expect(floorOutput(100_000_000n,100)).toBe(99_000_000n);
    expect(()=>floorOutput(1n,1001)).toThrow();
  });
  it('normalizes reserve prices and LP claims',()=>{
    expect(marketPrice18(10_000_000n,10n*10n**18n,6)).toBe(10n**18n);
    expect(marketPrice18(10n*10n**18n,10n*10n**18n,18)).toBe(10n**18n);
    expect(marketPrice18(0n,1n,6)).toBeNull();
    expect(lpAmounts(2n,100n,200n,10n)).toEqual({cash:20n,shares:40n});
  });
  it('rejects legacy and mislabeled fixture manifests',()=>{
    expect(()=>parseDeployment({...manifest,schemaVersion:1},31337)).toThrow();
    expect(()=>parseDeployment({...manifest,fixture:false},31337)).toThrow('Fixture network mismatch');
  });
  it('rejects the wrong chain, duplicate assets and invalid feed mappings',()=>{
    expect(parseDeployment(manifest,31337).assets[0].feedId).toBe(632);
    expect(()=>parseDeployment(manifest,97)).toThrow('Deployment chain mismatch');
    expect(()=>parseDeployment({...manifest,assets:[manifest.assets[0],manifest.assets[0]]},31337)).toThrow('Duplicate execution asset');
    expect(()=>parseDeployment({...manifest,assets:[{...manifest.assets[0],feedId:999}]},31337)).toThrow('Invalid reference mapping');
  });
  it('applies slippage to every redemption leg independently',()=>{
    expect(legMinimums([100_000_000n,0n,1n],100)).toEqual([99_000_000n,0n,1n]);
    expect(()=>legMinimums([1n],1001)).toThrow();
  });
  it('issues high-entropy nonzero request IDs that fit uint256',()=>{
    const ids=Array.from({length:64},newRequestId);
    expect(new Set(ids).size).toBe(64);
    for(const id of ids){expect(id>0n).toBe(true);expect(id<2n**256n).toBe(true);}
    expect(ids.some(id=>id>2n**128n)).toBe(true);
  });
  it('authorizes launches only on the local fixture',async()=>{
    const auth=await authorizeLaunch({fixture:true});
    expect(auth.authorization).toBe('0x');expect(auth.requestId>0n).toBe(true);
    await expect(authorizeLaunch({fixture:false})).rejects.toThrow('Public launch authorization is not configured');
  });
});
