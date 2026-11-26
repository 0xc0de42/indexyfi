"use client";
import {useState,type ReactNode} from "react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {WagmiProvider,createConfig,fallback,http} from "wagmi";
import {injected} from "wagmi/connectors";
import {getDefaultConfig,RainbowKitProvider} from "@rainbow-me/rainbowkit";
import {PriceProvider} from "@/lib/prices";
import {CmcProvider} from "@/lib/cmc";
import {AppLoader} from "./app-loader";
import {vaultChain,vaultRpcs} from "@/lib/vaults";
const projectId=process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
// Reads (not wallet writes) go through this transport. On chain 97: fail over across keyless public endpoints after one
// quick retry, so a throttled (429) or slow endpoint is skipped instead of blanking the page. Ranking pings each
// endpoint once a minute (~4 tiny requests/min) and moves slow or failing ones to the back.
const endpoint=(url:string)=>http(url,{retryCount:1,retryDelay:300,timeout:10_000});
const transport=vaultRpcs.length>1?fallback(vaultRpcs.map(endpoint),{rank:{interval:60_000},retryCount:2,retryDelay:300}):endpoint(vaultRpcs[0]);
const chains=[vaultChain] as const;
const transports={97:transport,31337:transport} as const;
// Multicall batching where Multicall3 exists (chain 97): concurrent reads in one ~16 ms window become one eth_call,
// so a vault refresh is ~1-2 requests instead of ~36. The local Hardhat fixture has no Multicall3, so it stays unbatched.
const batch=vaultChain.contracts?.multicall3?{multicall:{batchSize:8_192,wait:16}}:undefined;
const config=projectId?getDefaultConfig({appName:"IndexFi",projectId,chains,transports,batch,ssr:true}):createConfig({chains,connectors:[injected()],transports,batch,ssr:true});
export function Providers({children}:{children:ReactNode}){const [client]=useState(()=>new QueryClient({defaultOptions:{queries:{retry:1,staleTime:5000}}}));return <WagmiProvider config={config}><QueryClientProvider client={client}><RainbowKitProvider><PriceProvider><CmcProvider><AppLoader>{children}</AppLoader></CmcProvider></PriceProvider></RainbowKitProvider></QueryClientProvider></WagmiProvider>;}
