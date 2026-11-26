'use client';
import Link from 'next/link';
import {isAddress} from 'viem';
import {Empty} from '@indexfi/ui';
import {OnchainVault} from './onchain-vault';

/** /portfolio/<vault address>: every portfolio is an on-chain vault; anything else is not a portfolio. */
export function PortfolioPage({id}: {id: string}) {
  if (isAddress(id)) return <OnchainVault address={id} />;
  return <Empty>Portfolio not found. <Link href="/">Return to Explore</Link></Empty>;
}
