"use client";
import {ConnectButton} from "@rainbow-me/rainbowkit";
import {useAccount,useConnect,useDisconnect,useSwitchChain} from "wagmi";
import {Button} from "@indexfi/ui";
import {vaultChain} from "@/lib/vaults";
export function Wallet(){const account=useAccount(),connect=useConnect(),disconnect=useDisconnect(),switchChain=useSwitchChain();if(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID)return <ConnectButton chainStatus="icon" showBalance={false} accountStatus="address"/>;
 return <div className="wallet">{account.isConnected?(account.chainId!==vaultChain.id?<Button variant="secondary" onClick={()=>switchChain.switchChain({chainId:vaultChain.id})}>Switch to {vaultChain.name}</Button>:<Button variant="secondary" title="Disconnect wallet" onClick={()=>disconnect.disconnect()}>{account.address?.slice(0,6)}…{account.address?.slice(-4)}</Button>):<Button variant="secondary" disabled={connect.isPending||!connect.connectors.length} onClick={()=>{const connector=connect.connectors[0];if(connector)connect.connect({connector});}}>{connect.isPending?"Connecting…":"Connect wallet"}</Button>}{(connect.error||switchChain.error)&&<span role="alert" className="wallet__error">Wallet connection or network switch failed.</span>}</div>;
}
