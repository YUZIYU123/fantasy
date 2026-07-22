import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    title: { default: "雾页 · 互动故事", template: "%s · 雾页" },
    description: "创作、发布并阅读分支互动小说。",
    icons: { icon: "/favicon.svg" },
    openGraph: { title: "雾页 · 互动故事", description: "有些故事，会在选择中醒来。", images: [{ url: `${origin}/og.png`, width: 1733, height: 909 }] },
    twitter: { card: "summary_large_image", title: "雾页 · 互动故事", description: "有些故事，会在选择中醒来。", images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
