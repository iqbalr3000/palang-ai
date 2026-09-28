"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { endSession, startSession } from "@/lib/auth";
import { dashboardEnv } from "@/lib/env";
import { passwordMatches } from "@/lib/session";

export interface LoginState {
  error: string | null;
}

const FAILED_LOGIN_DELAY_MS = 500;

export async function login(_state: LoginState, formData: FormData): Promise<LoginState> {
  const password = formData.get("password");
  if (
    typeof password !== "string" ||
    !(await passwordMatches(password, dashboardEnv().DASHBOARD_PASSWORD))
  ) {
    // Slows down guessing; v0.1 has no lockout.
    await new Promise((resolve) => setTimeout(resolve, FAILED_LOGIN_DELAY_MS));
    return { error: "Wrong password." };
  }
  const secure = (await headers()).get("x-forwarded-proto") === "https";
  await startSession(secure);
  redirect("/");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/login");
}
