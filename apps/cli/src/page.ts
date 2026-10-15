// The sign-in page `login` serves on localhost: the browser package's client over the CLI's token route, its
// sign-in helper inside the click, and the token posted back to the CLI with this run's state. Built into
// `dist/page.js` with the browser package bundled in; it carries no signing code, which a test holds it to.
import { createBrowserClient, createConnect } from "@open-music-sdk/browser";

const state = new URLSearchParams(location.search).get("state") ?? "";
const status = document.getElementById("status") as HTMLParagraphElement;
const button = document.getElementById("connect") as HTMLButtonElement;
const say = (message: string) => {
  status.textContent = message;
};
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

const cookieNames = () => document.cookie.split(";").map((pair) => pair.split("=")[0]?.trim() ?? "").filter(Boolean);
const keysOf = (storage: Storage) => Array.from({ length: storage.length }, (_, i) => storage.key(i) ?? "");

// What this origin held before Apple's script ran, so that afterwards only what it added is cleared: a cookie on
// localhost is shared by every port, and other servers on this machine may have set their own.
const before = { cookies: new Set(cookieNames()), local: new Set(keysOf(localStorage)), session: new Set(keysOf(sessionStorage)) };

/** Clears what Apple's script kept of the sign-in on this origin, which would otherwise outlive the page. */
function clearAdded(): void {
  for (const name of cookieNames()) if (!before.cookies.has(name)) document.cookie = `${name}=; max-age=0; path=/`;
  for (const key of keysOf(localStorage)) if (!before.local.has(key)) localStorage.removeItem(key);
  for (const key of keysOf(sessionStorage)) if (!before.session.has(key)) sessionStorage.removeItem(key);
}

const music = createBrowserClient({ tokenUrl: `/token?state=${encodeURIComponent(state)}` });
const helper = createConnect(music, { app: { name: "open-music-sdk CLI" } });

helper.ready.then(
  () => {
    say("Ready.");
  },
  (e: unknown) => {
    say(`Apple's sign-in could not be loaded: ${messageOf(e)}. The button tries again.`);
  },
);
// Enabled either way: after a load that failed, `connect()` loads and configures the script afresh.
void helper.ready.finally(() => {
  button.disabled = false;
});

/** What the CLI's answer to the post means for the person at the page. */
const REFUSED: Record<number, string> = {
  401: "This page is not the one the terminal opened, or its run has ended. Run login again.",
  409: "The terminal has taken a token already, from this page or another. You can close this tab.",
  422: "Apple would not take this account's token: the account may have no Apple Music subscription.",
  502: "Apple could not be asked about the token. Try again.",
};

button.addEventListener("click", () => {
  button.disabled = true;
  let signedIn = false;
  void (async () => {
    try {
      const token = await helper.connect();
      if (token === undefined) {
        say("Sign-in was cancelled. Try again, or press Ctrl+C in the terminal to stop.");
        return;
      }
      say("Checking the token with Apple…");
      let answer: Response;
      try {
        answer = await fetch("/user-token", { method: "POST", headers: { "content-type": "application/json", "x-login-state": state }, body: JSON.stringify({ token }) });
      } finally {
        clearAdded();
      }
      if (answer.status === 204) {
        signedIn = true;
        helper.dispose();
        say("Signed in. The terminal has the token, and you can close this tab.");
        return;
      }
      say(REFUSED[answer.status] ?? `The terminal answered ${String(answer.status)}. Try again, or run login again.`);
    } catch (e) {
      say(`Sign-in failed: ${messageOf(e)}`);
    } finally {
      button.disabled = signedIn;
    }
  })();
});
