// Shows: createConnect, as, getUserStorefront. Guides: /guides/sign-in,
// /guides/store-user-tokens
// #region file
import { createConnect } from "@open-music-sdk/browser";
import { byId } from "./dom";
import { fromServer, say, showError } from "./errors";
import { change, music, now, onChange } from "./music";

const signInButton = byId("sign-in", HTMLButtonElement);
const signOutButton = byId("sign-out", HTMLButtonElement);

// Made as the page loads, so that Apple's script is loaded and configured
// before the click, and its window opens inside the click: a browser blocks a
// window opened later.
const signIn = createConnect(music, {
  app: { name: "Vinyl Collector Simulator" },
});

signInButton.onclick = () => {
  signIn
    .connect()
    .then(async (token) => {
      // No token: the listener declined, or closed Apple's window.
      if (token !== undefined) await keep(token);
    })
    .catch(showError);
};

// A returning listener: Apple's script restores their token as it loads. The
// button works either way, since connect() loads the script afresh after a load
// that failed.
signIn.ready
  .then(async (restored) => {
    if (restored !== undefined) await keep(restored);
  })
  .catch(showError)
  .finally(() => {
    signInButton.disabled = false;
  });

// #region after-sign-in
/**
 * Hands the token to the server, which asks Apple whether it works and keeps
 * it; then signs the page in.
 */
async function keep(token: string): Promise<void> {
  const answer = await fetch("/api/music/user-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!answer.ok) {
    say(fromServer(answer.status));
    // Apple's script keeps the token Apple refused, and would hand it back at
    // the next sign-in: leave it, so that the listener can sign in with another
    // account.
    if (answer.status === 422) await signIn.disconnect();
    return;
  }
  // A client for this listener, and the storefront their account is in, from
  // Apple.
  const listener = music.as(token);
  const storefront = await listener.user.getUserStorefront();
  change({ listener, storefront: storefront.id });
  const where = storefront.attributes?.name ?? storefront.id;
  say(`Signed in. You're digging in the ${where} storefront.`);
}
// #endregion after-sign-in

signOutButton.onclick = () => {
  signOut().catch(showError);
};

async function signOut(): Promise<void> {
  // The server forgets its copy first, so that a sign-out Apple's script then
  // fails leaves no token on the server.
  const forgotten = await forgetOnServer();
  // Apple's own sign-out, which ends the token at Apple.
  await signIn.disconnect();
  change({ listener: undefined, storefront: "us" });
  say(forgotten ? "Signed out." : NOT_TOLD);
}

/** Whether the server says it has forgotten the listener's token. */
async function forgetOnServer(): Promise<boolean> {
  const forget = fetch("/api/music/user-token", { method: "DELETE" });
  return forget.then((answer) => answer.ok, () => false);
}

const NOT_TOLD = "Signed out. The server could not be told, "
  + "but Apple no longer takes the token it kept.";

onChange(() => {
  signInButton.hidden = now.listener !== undefined;
  signOutButton.hidden = now.listener === undefined;
});
// #endregion file
