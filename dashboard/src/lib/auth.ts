import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { dashboardEnv } from "./env";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSessionToken,
  revokeSessionToken,
  verifySessionToken,
} from "./session";

export const requireSession = cache(async (): Promise<void> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySessionToken(token, dashboardEnv().PALANG_ADMIN_TOKEN))) {
    redirect("/login");
  }
});

export async function startSession(secure: boolean): Promise<void> {
  (await cookies()).set(
    SESSION_COOKIE,
    await createSessionToken(dashboardEnv().PALANG_ADMIN_TOKEN),
    {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    },
  );
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await revokeSessionToken(token, dashboardEnv().PALANG_ADMIN_TOKEN);
  jar.delete(SESSION_COOKIE);
}
