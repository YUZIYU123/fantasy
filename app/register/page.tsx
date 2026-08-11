import type { Metadata } from "next";
import { AuthForm } from "../auth-forms";
import { accountRegistrationConfig } from "../../db/account-runtime";
export const metadata: Metadata = { title: "注册" };
export default function RegisterPage() {
  return <AuthForm mode="register" registrationEnabled={accountRegistrationConfig().registrationEnabled} />;
}
