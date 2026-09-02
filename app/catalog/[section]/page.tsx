import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { CatalogSection } from "../../../lib/story";
import { CatalogScreen } from "../catalog-screen";

export const metadata: Metadata = {
  title: "作品目录 · 幻界 Fantasy",
  description: "穿过世界档案，找到下一部想进入的小说。",
};

export default async function CatalogPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!(["short", "ongoing", "completed"] as string[]).includes(section)) notFound();
  return <CatalogScreen section={section as CatalogSection} />;
}

