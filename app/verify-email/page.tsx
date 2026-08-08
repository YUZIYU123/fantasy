import type { Metadata } from "next";
import { VerifyEmail } from "../auth-forms";
export const metadata: Metadata = { title: "验证邮箱" };
export default function VerifyEmailPage() { return <VerifyEmail />; }
