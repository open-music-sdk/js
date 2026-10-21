// Shows: tokenEndpoint. Guides: /guides/token-endpoint, /guides/nextjs
import { tokenEndpoint, type tTokenEndpoint } from "@open-music-sdk/server";
import { connection } from "next/server";
import { required } from "@/lib/env";

// #region token-route
// The page's developer token, minted for the page's origin alone and
// short-lived, since anyone can read a page. Made on the first request:
// `next build` has no key.
let token: tTokenEndpoint | undefined;

export async function GET(req: Request): Promise<Response> {
  // Answered at each request, never prerendered: a token minted while
  // building would be served to everyone who asked, from the build's output.
  await connection();
  token ??= tokenEndpoint({
    pem: required("APPLE_MUSIC_PRIVATE_KEY"),
    teamId: required("APPLE_MUSIC_TEAM_ID"),
    keyId: required("APPLE_MUSIC_KEY_ID"),
    origin: [required("PAGE_ORIGIN")],
  });
  return token(req);
}
// #endregion token-route
