// The sign-in page `login` serves on localhost: the browser package's client over the CLI's token route, its
// sign-in helper inside the click, and the token posted back to the CLI with this run's state. Built into
// `dist/page.js` with the browser package bundled in; it carries no signing code, which a test holds it to.
import { createBrowserClient, createConnect } from "@open-music-sdk/browser";

// The secret the server put in the page, for its token routes. The address's own ticket is used up by now.
const state = document.querySelector<HTMLMetaElement>('meta[name="login-state"]')?.content ?? "";
const status = document.getElementById("status") as HTMLParagraphElement;
const button = document.getElementById("connect") as HTMLButtonElement;
const say = (message: string) => {
  status.textContent = message;
};
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The cookies this page can see, by name. */
const cookies = () =>
  new Map(
    document.cookie
      .split(";")
      .map((pair): [string, string] => [pair.slice(0, Math.max(pair.indexOf("="), 0)).trim(), pair.slice(pair.indexOf("=") + 1)])
      .filter(([name]) => name !== ""),
  );
/** What a storage holds, by key. */
const entries = (storage: Storage) =>
  new Map(
    Array.from({ length: storage.length }, (_, i): [string, string | null] => {
      const key = storage.key(i) ?? "";
      return [key, storage.getItem(key)];
    }),
  );

// What this origin held before Apple's script ran, so that afterwards only what it changed is put back: a cookie on
// localhost is shared by every port, and other servers on this machine may have set their own.
const before = { cookies: cookies(), local: entries(localStorage), session: entries(sessionStorage) };

/**
 * Puts the origin back as it was before Apple's script ran, so the copy of the sign-in it kept does not outlive the
 * page: what it added is deleted, and what it changed is given its old value back.
 */
function restore(): void {
  for (const [name, value] of cookies()) {
    const was = before.cookies.get(name);
    if (was === value) continue;
    if (was !== undefined) document.cookie = `${name}=${was}; path=/`;
    // Deleted with the domain and without it, whichever way it was set.
    else for (const domain of ["", `; domain=${location.hostname}`]) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
  }
  for (const [storage, held] of [
    [localStorage, before.local],
    [sessionStorage, before.session],
  ] as const) {
    for (const [key, value] of entries(storage)) {
      const was = held.get(key);
      if (was === value) continue;
      if (was === undefined || was === null) storage.removeItem(key);
      else storage.setItem(key, was);
    }
  }
}
// Whichever way the page is left, the sign-in finished or not.
window.addEventListener("pagehide", restore);

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
const enable = () => {
  button.disabled = false;
};
helper.ready.then(enable, enable);

/** What the CLI's answer to the post means for the person at the page. */
const REFUSED: Record<number, string> = {
  401: "This page is not the one the terminal opened, or its run has ended. Run login again.",
  409: "The terminal has taken a token already, from this page or another. You can close this tab.",
  422: "Apple would not take this account's token: the account may have no Apple Music subscription.",
  502: "Apple could not be asked about the token. Try again.",
  504: "Apple did not answer about the token in time. Try again.",
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
      const answer = await fetch("/user-token", { method: "POST", headers: { "content-type": "application/json", "x-login-state": state }, body: JSON.stringify({ token }) });
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
      // After every try, posted or not: the script may have kept a copy before it was declined or failed.
      restore();
      button.disabled = signedIn;
    }
  })();
});
