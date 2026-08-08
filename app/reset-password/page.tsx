import type { Metadata } from "next";
import { AuthForm } from "../auth-forms";
export const metadata: Metadata = { title: "重置密码" };
export default function ResetPasswordPage() { return <AuthForm mode="reset" />; }
