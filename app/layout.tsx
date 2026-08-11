import type { Metadata } from "next";
import { headers } from "next/headers";
import "@xyflow/react/dist/style.css";
import "./globals.css";
import "./registration.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    title: { default: "幻界 Fantasy · 互动小说宇宙", template: "%s · 幻界 Fantasy" },
    description: "创作、发布并阅读分支互动小说。",
    icons: { icon: "/favicon.svg" },
    openGraph: { title: "幻界 Fantasy · 互动小说宇宙", description: "穿过裂隙，抵达你的故事宇宙。", images: [{ url: `${origin}/og.svg`, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: "幻界 Fantasy · 互动小说宇宙", description: "穿过裂隙，抵达你的故事宇宙。", images: [`${origin}/og.svg`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
