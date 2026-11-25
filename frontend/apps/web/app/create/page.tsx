import {Create} from "@/components/create";
import {firstParam} from "@/lib/routes";
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const query=await searchParams;const assets=firstParam(query.assets);const from=firstParam(query.from);return <Create prefill={{assets:assets?assets.split(",").filter(Boolean).slice(0,50):undefined,from}}/>;}
