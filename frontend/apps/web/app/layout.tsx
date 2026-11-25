import type {Metadata} from "next";
import type {ReactNode} from "react";
import {Manrope, Instrument_Sans, JetBrains_Mono} from "next/font/google";
import "@rainbow-me/rainbowkit/styles.css";
import "../styles/globals.css";
import {Providers} from "@/components/providers";
import {Shell} from "@/components/shell";
const display=Manrope({subsets:["latin"],variable:"--font-manrope",display:"swap"});
const body=Instrument_Sans({subsets:["latin"],variable:"--font-instrument",display:"swap"});
const mono=JetBrains_Mono({subsets:["latin"],variable:"--font-jetbrains",display:"swap",weight:["400","500"]});
export const metadata:Metadata={title:"IndexFi",description:"A local prototype for programmable portfolio markets."};
export default function Layout({children}:{children:ReactNode}){return <html lang="en" data-theme="light" className={`${display.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning><body><a className="skip-link" href="#main">Skip to content</a><Providers><Shell>{children}</Shell></Providers></body></html>;}
