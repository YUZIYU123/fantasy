import type { Metadata } from "next";
import { AuthForm } from "../auth-forms";
export const metadata: Metadata = { title: "找回密码" };
export default function ForgotPasswordPage() { return <AuthForm mode="forgot" />; }
