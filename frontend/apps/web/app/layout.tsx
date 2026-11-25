import type {Metadata} from "next";
import type {ReactNode} from "react";
import "@rainbow-me/rainbowkit/styles.css";
import "../styles/globals.css";
import {Providers} from "@/components/providers";
import {Shell} from "@/components/shell";
export const metadata:Metadata={title:"IndexFi",description:"A local prototype for programmable portfolio markets."};
export default function Layout({children}:{children:ReactNode}){return <html lang="en" data-theme="light" suppressHydrationWarning><body><a className="skip-link" href="#main">Skip to content</a><Providers><Shell>{children}</Shell></Providers></body></html>;}
