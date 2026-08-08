import type { Metadata } from "next";
import { AdminStudio } from "./studio";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "创作后台" };

export default function AdminPage() { return <AdminStudio />; }
