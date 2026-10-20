// Runs before every route, the server actions among them: the host check, the
// check of who asks, and the session cookie.
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
  // Only the page itself, or a link the listener follows to it. Every page
  // asks Apple, so a request another site's page makes on its own, as an
  // <img> pointed here does, would spend requests on the developer's key, and
  // the listener's.
  const site = request.headers.get("sec-fetch-site");
  const mode = request.headers.get("sec-fetch-mode");
  const fromElsewhere = site === "cross-site" || site === "same-site";
  if (fromElsewhere && mode !== "navigate") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
  // Next's built scripts and styles, which ask Apple for nothing.
  matcher: ["/((?!_next/static).*)"],
};
