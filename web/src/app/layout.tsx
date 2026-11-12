import type { Metadata } from "next";
import { Instrument_Sans, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { StoreProvider } from "@/lib/store";
import { Shell } from "@/components/Shell";
import { AppearanceLayer } from "@/components/Appearance";
import { CACHE_KEY } from "@/lib/appearance";

const ui = Instrument_Sans({ variable: "--font-ui", subsets: ["latin"] });
const display = Instrument_Serif({ variable: "--font-display", subsets: ["latin"], weight: "400" });

const THEME_BOOT = `try{var a=JSON.parse(localStorage.getItem(${JSON.stringify(CACHE_KEY)})||"null");if(a){var t=a.theme==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):a.theme;var r=document.documentElement;r.dataset.theme=t||"dark";r.dataset.glass=a.glass?"on":"off";if(a.glass){r.style.setProperty("--panel-alpha",Math.min(100,Math.max(20,a.panelOpacity||60))+"%");r.style.setProperty("--glass-blur",(a.blur||18)+"px")}}}catch(e){}`;

export const metadata: Metadata = {
  title: "Where MyLife",
  description: "AI-built learning roadmaps, scheduled into your day.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Set the last-used theme before the page paints, so it never flashes dark then light */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className={`${ui.variable} ${display.variable} antialiased`}>
        <StoreProvider>
          <AppearanceLayer />
          <Shell>{children}</Shell>
        </StoreProvider>
      </body>
    </html>
  );
}
