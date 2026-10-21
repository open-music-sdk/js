// Shows: userTokenIntake. Guides: /guides/store-user-tokens, /guides/nextjs
import {
  userTokenIntake,
  type tUserTokenIntake,
} from "@open-music-sdk/server";
import { getMusic, getStore } from "@/lib/music";
import { sessionId } from "@/lib/session";

// #region user-token
// The listener's Music User Token, posted by the page after Apple's sign-in.
// The intake asks Apple whether it works, and stores it under this listener's
// session only then. Made on the first request: `next build` has no key.
let intake: tUserTokenIntake | undefined;

export function POST(req: Request): Promise<Response> {
  intake ??= userTokenIntake(getMusic(), {
    store: getStore(),
    userId: () => sessionId(),
  });
  return intake(req);
}
// #endregion user-token

// #region sign-out
// The listener signed out of Apple Music in the page: the server forgets its
// copy of their token.
export async function DELETE(): Promise<Response> {
  const session = await sessionId();
  if (session !== undefined) await getStore().delete(session);
  return new Response(null, { status: 204 });
}
// #endregion sign-out
