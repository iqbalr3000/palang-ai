"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { endSession, startSession } from "@/lib/auth";
import { dashboardEnv } from "@/lib/env";
import { createLoginThrottle, type LoginThrottle } from "@/lib/login-throttle";
import { passwordMatches } from "@/lib/session";

export interface LoginState {
  error: string | null;
}

const FAILED_LOGIN_DELAY_MS = 500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// On globalThis: Next can load this module more than once per process.
const throttle: LoginThrottle = ((
  globalThis as { __palangLoginThrottle?: LoginThrottle }
).__palangLoginThrottle ??= createLoginThrottle());

export async function login(_state: LoginState, formData: FormData): Promise<LoginState> {
  const expected = dashboardEnv().DASHBOARD_PASSWORD;
  const slot = throttle.reserve(Date.now());
  if ("rejected" in slot) {
    return { error: "Too many sign-in attempts. Try again in a moment." };
  }
  await sleep(slot.waitMs);

  const password = formData.get("password");
  if (typeof password !== "string" || !(await passwordMatches(password, expected))) {
    throttle.recordFailure(Date.now());
    await sleep(FAILED_LOGIN_DELAY_MS);
    return { error: "Wrong password." };
  }
  throttle.recordSuccess();
  const secure = (await headers()).get("x-forwarded-proto") === "https";
  await startSession(secure);
  redirect("/");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/login");
}
