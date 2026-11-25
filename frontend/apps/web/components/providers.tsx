"use client";
import {useState,type ReactNode} from "react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {WagmiProvider,createConfig,http} from "wagmi";
import {bscTestnet} from "wagmi/chains";
import {injected} from "wagmi/connectors";
import {getDefaultConfig,RainbowKitProvider} from "@rainbow-me/rainbowkit";
import {PriceProvider} from "@/lib/prices";
const projectId=process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const transport=http(process.env.NEXT_PUBLIC_BSC_TESTNET_RPC_URL||undefined);
const config=projectId?getDefaultConfig({appName:"IndexFi",projectId,chains:[bscTestnet],transports:{[bscTestnet.id]:transport},ssr:true}):createConfig({chains:[bscTestnet],connectors:[injected()],transports:{[bscTestnet.id]:transport},ssr:true});
export function Providers({children}:{children:ReactNode}){const [client]=useState(()=>new QueryClient({defaultOptions:{queries:{retry:1,staleTime:5000}}}));return <WagmiProvider config={config}><QueryClientProvider client={client}><RainbowKitProvider><PriceProvider>{children}</PriceProvider></RainbowKitProvider></QueryClientProvider></WagmiProvider>;}
