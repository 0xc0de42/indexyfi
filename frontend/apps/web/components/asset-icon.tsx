'use client';
import {useState} from 'react';import type {Asset} from '@/domain/model';
export function AssetIcon({asset}:{asset:Asset}){const [failed,setFailed]=useState(false);return <span className="asset-icon" style={{'--asset-color':asset.color} as React.CSSProperties}>{asset.logoPath&&!failed?<img src={asset.logoPath} alt="" width={30} height={30} onError={()=>setFailed(true)}/>:asset.symbol.slice(0,2)}</span>;}
