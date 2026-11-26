"use client";
import {useState,type ReactNode} from "react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {WagmiProvider,createConfig,http} from "wagmi";
import {injected} from "wagmi/connectors";
import {getDefaultConfig,RainbowKitProvider} from "@rainbow-me/rainbowkit";
import {PriceProvider} from "@/lib/prices";
import {AppLoader} from "./app-loader";
import {vaultChain,vaultRpc} from "@/lib/vaults";
const projectId=process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const transport=http(vaultRpc);
const chains=[vaultChain] as const;
const transports={97:transport,31337:transport} as const;
const config=projectId?getDefaultConfig({appName:"IndexFi",projectId,chains,transports,ssr:true}):createConfig({chains,connectors:[injected()],transports,ssr:true});
export function Providers({children}:{children:ReactNode}){const [client]=useState(()=>new QueryClient({defaultOptions:{queries:{retry:1,staleTime:5000}}}));return <WagmiProvider config={config}><QueryClientProvider client={client}><RainbowKitProvider><PriceProvider><AppLoader>{children}</AppLoader></PriceProvider></RainbowKitProvider></QueryClientProvider></WagmiProvider>;}
