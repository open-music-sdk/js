// A listener is a random id in a cookie, which proxy.ts gives with the first
// answer. A real app has its own sessions.
import { cookies } from "next/headers";

export const SESSION_COOKIE = "crate_session";
const UUID = /^[0-9a-f-]{36}$/;

/** Whether a cookie's value is a session id as proxy.ts gives them. */
export function isSession(value: string | undefined): value is string {
  return value !== undefined && UUID.test(value);
}

/** This request's session, if it has one. */
export async function sessionId(): Promise<string | undefined> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return isSession(value) ? value : undefined;
}
