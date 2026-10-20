// Runs before every route, the server actions among them: the host check, and
// the session cookie.
import { NextResponse, type NextRequest } from "next/server";
import { required } from "./lib/env";
import { SESSION_COOKIE, isSession } from "./lib/session";

export function proxy(request: NextRequest): NextResponse {
  // Only requests sent to the page's own name: a site whose name a DNS trick
  // points at this machine would otherwise reach the app from the listener's
  // browser as if it were the page.
  const host = new URL(required("PAGE_ORIGIN")).host;
  if (request.headers.get("host") !== host) {
    return NextResponse.json(
      { error: "MisdirectedRequest" },
      { status: 421 },
    );
  }
  const response = NextResponse.next();
  // A listener is a random id in a cookie, given with the first answer.
  if (!isSession(request.cookies.get(SESSION_COOKIE)?.value)) {
    response.cookies.set(SESSION_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  }
  return response;
}

export const config = {
  // Next's own files need neither.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
