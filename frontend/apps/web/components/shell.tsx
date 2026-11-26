"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect,useState,type ReactNode} from "react";
import {Layers3,Compass,PlusCircle,WalletCards,Coins,Sun,Moon,FlaskConical} from "lucide-react";
import {Wallet} from "./wallet";
import {usePriceState} from "@/lib/prices";
import {apiStatusText} from "./api-status";
import {useDeployment} from "@/lib/use-vaults";
import {vaultChain} from "@/lib/vaults";
const nav=[{href:"/",label:"Explore",icon:Compass},{href:"/assets",label:"Assets",icon:Coins},{href:"/create",label:"Create",icon:PlusCircle},{href:"/investments",label:"My investments",icon:WalletCards}];
export function Shell({children}:{children:ReactNode}){const path=usePathname(),[theme,setTheme]=useState("light"),api=apiStatusText(usePriceState()),deployment=useDeployment();
 const network=vaultChain.id===31337?"Local fixture · 31337":"BSC Testnet · 97";
 const mode=deployment.data?(deployment.data.fixture?"local fixture contracts":deployment.data.testAssets?"OpenFour preset · test assets":"OpenFour preset"):deployment.isError?"no deployment on this network":"loading deployment";useEffect(()=>{try{const stored=localStorage.getItem("portfolio-theme");if(stored==="light"||stored==="dark"){setTheme(stored);document.documentElement.dataset.theme=stored;}}catch{}},[]);
 function toggle(){const next=theme==="dark"?"light":"dark";setTheme(next);document.documentElement.dataset.theme=next;try{localStorage.setItem("portfolio-theme",next);}catch{}}
 return <div className="app-shell"><header className="topbar"><div className="topbar__inner"><Link className="brand" href="/"><span className="brand__mark"><Layers3 size={17} strokeWidth={2.25}/></span><span className="brand__name"><strong>{process.env.NEXT_PUBLIC_BRAND_NAME||"IndexFi"}</strong><small>Portfolio markets</small></span></Link><nav aria-label="Main navigation" className="nav">{nav.map(({href,label,icon:Icon})=><Link key={href} href={href} className="nav__link" aria-current={(href==="/"?(path==="/"||path.startsWith("/portfolio/")):path===href)?"page":undefined}><Icon size={15}/>{label}</Link>)}</nav><div className="topbar__actions"><button aria-label={`Switch to ${theme==="dark"?"light":"dark"} theme`} className="icon-button" onClick={toggle}>{theme==="dark"?<Sun size={16}/>:<Moon size={16}/>}</button><Wallet/></div></div></header><div className="environment"><FlaskConical size={12}/><strong className={`environment__status environment__status--${api.tone}`} role="status">{api.label}</strong><span>Atlas reference prices via IndexFi API · {mode}</span><span>{network.toUpperCase()}</span></div><main className="main" id="main">{children}</main><footer className="footer"><span>IndexFi · Many assets. One token.</span><span>OpenFour · Atlas · PancakeSwap</span></footer></div>;
}
