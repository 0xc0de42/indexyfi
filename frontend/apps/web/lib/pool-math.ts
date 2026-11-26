/** USD/USDT parity, price per 1e18 share, result 1e18. */
export function marketPrice18(cash:bigint,shares:bigint,decimals:number){
  return shares===0n||cash===0n?null:cash*10n**BigInt(36-decimals)/shares;
}
export function lpAmounts(liquidity:bigint,cash:bigint,shares:bigint,supply:bigint){
  if(supply===0n||liquidity<=0n||liquidity>supply)throw Error('Invalid LP amount');
  return {cash:liquidity*cash/supply,shares:liquidity*shares/supply};
}
