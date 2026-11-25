import {z} from 'zod';
import {assetSchema,portfolioSchema,pointSchema} from '@/domain/model';
import {assets,portfolios,demoHistory} from '@/domain/fixtures';
import testnetRegistry from '../data/testnet-assets.json';
export const mode=process.env.NEXT_PUBLIC_DATA_MODE==='api'?'api':'demo';
async function read<T>(path:string,schema:z.ZodType<T>,signal?:AbortSignal):Promise<T>{const r=await fetch(`/backend/v1/${path}`,{signal,cache:'no-store'});if(!r.ok)throw Error(`Backend ${r.status}: ${path}`);return schema.parse(await r.json());}
const registry=z.array(assetSchema).parse(testnetRegistry).filter(a=>a.chainId===97&&a.eligibility==='verified'&&a.oracle==='verified'&&/^0x[0-9a-f]{40}$/i.test(a.tokenAddress??''));
export const data={assets:async()=>mode==='demo'?assets:registry,portfolios:(signal?:AbortSignal)=>mode==='demo'?Promise.resolve(portfolios):read('portfolios',z.array(portfolioSchema),signal),portfolio:(id:string,signal?:AbortSignal)=>mode==='demo'?Promise.resolve(portfolios.find(p=>p.id===id)??null):read(`portfolios/${encodeURIComponent(id)}`,portfolioSchema,signal),history:(p:import('@/domain/model').Portfolio,minutes:number,signal?:AbortSignal)=>mode==='demo'?Promise.resolve(demoHistory(p,minutes)):read(`portfolios/${encodeURIComponent(p.id)}/history?minutes=${minutes}&resolution=1m`,z.array(pointSchema),signal)};
