"""Independent integer arithmetic checks; not Solidity execution."""
from fractions import Fraction
from random import Random

r=Random(59)
for _ in range(20000):
    value=r.randint(1,10**25); supply=r.randint(1,10**25); acquired=r.randint(0,10**25)
    issued=acquired*supply//value
    assert Fraction(value+acquired,supply+issued)>=Fraction(value,supply)
    shares=r.randint(1,supply); qty=r.randint(0,10**25)
    out=qty*shares//supply
    assert out*supply<=qty*shares
    if shares==supply: assert out==qty

# Seed 100 USD + 10 USDT reserves (frictionless), LP token count included in denominator.
E=10**18
inventory=10**9*E-100*E; outstanding=100*E
assert (90*E+10*E)==outstanding
assert inventory+outstanding==10**9*E
# Actual mixed-decimal contribution after 10 bps fee and BTC truncation.
net=100_000_000-100_000
eth=(net//2)*10**18//2_000_000_000
btc=(net-net//2)*10**8//80_000_000_000
contributed=eth*2000*E//10**18+btc*80000*E//10**8
assert contributed==998996*10**14
print("PASS: 20,000 randomized integer accounting cases; mixed-decimal and seed examples")
