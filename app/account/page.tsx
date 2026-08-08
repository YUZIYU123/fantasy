import type { Metadata } from "next";
import { AccountPage } from "../auth-forms";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "读者账号" };
export default function ReaderAccountPage() { return <AccountPage />; }
