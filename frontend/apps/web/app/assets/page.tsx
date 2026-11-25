import {Assets} from "@/components/assets";
import {firstParam, isWindowLabel} from "@/lib/routes";
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const query=await searchParams;const window=firstParam(query.window);return <Assets initialAssetId={firstParam(query.asset)} initialWindow={isWindowLabel(window)?window:undefined}/>;}
