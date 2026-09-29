import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./lib/session";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const adminToken = process.env.PALANG_ADMIN_TOKEN;
  if (token && adminToken && (await verifySessionToken(token, adminToken))) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)"],
};
