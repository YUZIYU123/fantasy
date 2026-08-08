import type { Metadata } from "next";
import { AdminStudio } from "../admin/studio";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "作者工作台" };

export default function StudioPage() {
  return <AdminStudio scope="author" />;
}
