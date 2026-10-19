// Shows: createConnect, as, getUserStorefront. Guides: /guides/sign-in, /guides/store-user-tokens
import { createConnect } from "@open-music-sdk/browser";
import { byId } from "./dom";
import { say, showError } from "./errors";
import { change, music, now, onChange } from "./music";

const signInButton = byId("sign-in", HTMLButtonElement);
const signOutButton = byId("sign-out", HTMLButtonElement);

// #region connect
// Made as the page loads, so that Apple's script is loaded and configured before the click, and its window opens
// inside the click: a browser blocks a window opened later.
const signIn = createConnect(music, { app: { name: "Crate Digger" } });

signInButton.onclick = () => {
  signIn.connect().then(async (token) => {
    // No token: the listener declined, or closed Apple's window.
    if (token !== undefined) await keep(token);
  }).catch(showError);
};
// #endregion connect

// #region restore
// A returning listener: Apple's script restores their token as it loads. The button works either way, since
// connect() loads the script afresh after a load that failed.
signIn.ready.then(async (restored) => {
  if (restored !== undefined) await keep(restored);
}).catch(showError).finally(() => {
  signInButton.disabled = false;
});
// #endregion restore

// #region keep
/** What the server answers when it will not keep a token. */
const REFUSED: Record<number, string> = {
  401: "The server has no session for this page. Reload it and sign in again.",
  422: "Apple did not accept this sign-in. The account may have no Apple Music subscription.",
  502: "The server could not ask Apple about your sign-in. Try again.",
};

/** Hands the token to the server, which asks Apple whether it works and keeps it; then signs the page in. */
async function keep(token: string): Promise<void> {
  const answer = await fetch("/api/music/user-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
  if (!answer.ok) {
    say(REFUSED[answer.status] ?? `The server answered ${String(answer.status)}. Try again.`);
    // Apple's script keeps the token Apple refused, and would hand it back at the next sign-in: leave it, so that the
    // listener can sign in with another account.
    if (answer.status === 422) await signIn.disconnect();
    return;
  }
  // A client for this listener, and the storefront their account is in, from Apple.
  const listener = music.as(token);
  const storefront = await listener.user.getUserStorefront();
  change({ listener, storefront: storefront.id });
  say(`Signed in. You're digging in the ${storefront.attributes?.name ?? storefront.id} storefront.`);
}
// #endregion keep

// #region sign-out
signOutButton.onclick = () => {
  signOut().catch(showError);
};

async function signOut(): Promise<void> {
  // Apple's own sign-out, which ends the token at Apple, and then the server forgets its copy.
  await signIn.disconnect();
  await fetch("/api/music/user-token", { method: "DELETE" });
  change({ listener: undefined, storefront: "us" });
  say("Signed out.");
}
// #endregion sign-out

onChange(() => {
  signInButton.hidden = now.listener !== undefined;
  signOutButton.hidden = now.listener === undefined;
});
