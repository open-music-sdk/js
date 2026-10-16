// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const STATE = "this-runs-state";
const TOKEN = "Ag-music-user-token-from-apple";
/** A developer token as the token route hands it out: a JWT whose `exp` the browser client reads. */
const JWT = `e30.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 900 })).replaceAll("=", "")}.c2ln`;

/** What Apple's script does when asked to sign in: keep a copy of the token on the origin, and give it, or nothing. */
let authorize: () => Promise<string | undefined>;
/** What the CLI answers the post with. */
let intakeStatus: number;
let posted: Request[];
/** The developer tokens Apple's script was configured with: only the token route hands out this one. */
let configuredWith: string[];
/** The app's name Apple's script was configured with. */
let configuredAs: string | undefined;

/** Keeps copies on the origin as Apple's script might: under names of its own, and over names that were there before. */
const keepCopies = () => {
  document.cookie = "media-user-token=copy; path=/";
  document.cookie = "shared-name=copy; path=/";
  localStorage.setItem("music.ABC123DEFG.u", "copy");
  localStorage.setItem("left-by-an-earlier-app", "copy");
  sessionStorage.setItem("mk-session", "copy");
};
const signedIn = () => {
  keepCopies();
  return Promise.resolve(TOKEN);
};

/** Whether the origin is as it was before the page loaded. */
function asBefore(): void {
  expect(document.cookie).not.toContain("media-user-token");
  expect(document.cookie).toContain("other-app-session=theirs");
  expect(document.cookie).toContain("shared-name=theirs");
  expect(localStorage.getItem("music.ABC123DEFG.u")).toBeNull();
  expect(localStorage.getItem("left-by-an-earlier-app")).toBe("theirs");
  expect(sessionStorage.getItem("mk-session")).toBeNull();
}

beforeEach(async () => {
  vi.resetModules();
  authorize = signedIn;
  intakeStatus = 204;
  posted = [];
  // The page as the server sends it: the secret for the token routes in a meta element, and the address's ticket,
  // which is not that secret, in the address.
  history.replaceState(null, "", "/?state=the-address-ticket");
  document.head.innerHTML = `<meta name="login-state" content="${STATE}">`;
  document.body.innerHTML = '<p id="intro">The command line is waiting.</p><p id="status"></p><button id="connect" type="button" disabled></button>';
  // What other servers on localhost keep, which share its cookies, and what this origin held before.
  document.cookie = "other-app-session=theirs; path=/";
  document.cookie = "shared-name=theirs; path=/";
  localStorage.setItem("left-by-an-earlier-app", "theirs");
  // Apple's script, already on the page: the helper takes the global rather than loading it from Apple's CDN.
  configuredWith = [];
  vi.stubGlobal("MusicKit", {
    configure: ({ developerToken, app }: { developerToken: string; app: { name: string } }) => {
      configuredWith.push(developerToken);
      configuredAs = app.name;
      return { musicUserToken: undefined, authorize: () => authorize() };
    },
  });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(new URL(String(input instanceof Request ? input.url : input), location.href), init);
    const url = new URL(req.url);
    if (url.pathname === "/token") return Promise.resolve(url.searchParams.get("state") === STATE ? Response.json({ token: JWT }) : new Response(null, { status: 404 }));
    posted.push(req);
    return Promise.resolve(new Response(intakeStatus === 204 ? null : JSON.stringify({ error: "x" }), { status: intakeStatus }));
  });
  await import("./page");
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ["media-user-token", "other-app-session", "shared-name"]) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  localStorage.clear();
  sessionStorage.clear();
});

const button = () => document.getElementById("connect") as HTMLButtonElement;
const status = () => document.getElementById("status")?.textContent ?? "";
/** How the status line is printed: "success" or "error" in large print, "" in the small print of a step. */
const outcome = () => document.getElementById("status")?.className ?? "";
const intro = () => document.getElementById("intro") as HTMLParagraphElement;
const ready = () => vi.waitFor(() => { expect(button().disabled).toBe(false); });

describe("the sign-in page", () => {
  test("the button is enabled once Apple's script is configured, with a developer token from this run's token route", async () => {
    await ready();
    expect(status()).toBe("Ready.");
    expect(configuredWith).toEqual([JWT]);
    // The app as Apple's script is configured with it. Its sign-in window shows the page's host instead.
    expect(configuredAs).toBe("Open Music CLI");
  });

  test("a sign-in posts the token as JSON with this run's state", async () => {
    await ready();
    button().click();
    await vi.waitFor(() => { expect(status()).toContain("Signed in"); });
    expect(posted).toHaveLength(1);
    const [req] = posted;
    expect(new URL(req?.url ?? "").pathname).toBe("/user-token");
    expect(req?.method).toBe("POST");
    expect(req?.headers.get("content-type")).toBe("application/json");
    expect(req?.headers.get("x-login-state")).toBe(STATE);
    expect(await req?.json()).toEqual({ token: TOKEN });
  });

  test("once signed in, the page says only, in large print, to return to the terminal: the small print and the button are gone", async () => {
    await ready();
    button().click();
    await vi.waitFor(() => { expect(status()).toBe("Signed in. Return to the terminal."); });
    expect(outcome()).toBe("success");
    expect(intro().hidden).toBe(true);
    expect(button().hidden).toBe(true);
  });

  test("a terminal that has a token already, from this page or another, is a success too: what is left to do is in the terminal", async () => {
    intakeStatus = 409;
    await ready();
    button().click();
    await vi.waitFor(() => { expect(outcome()).toBe("success"); });
    expect(status()).toBe("Signed in. Return to the terminal.");
    expect(button().hidden).toBe(true);
  });

  test("once the token is posted, the origin is as it was: what Apple's script added is gone, and what it wrote over has its old value", async () => {
    await ready();
    button().click();
    await vi.waitFor(() => { expect(status()).toContain("Signed in"); });
    asBefore();
  });

  test("a sign-in the listener cancels posts nothing, leaves the origin as it was, and lets them try again", async () => {
    authorize = () => {
      keepCopies();
      return Promise.resolve(undefined);
    };
    await ready();
    button().click();
    await vi.waitFor(() => { expect(status()).toContain("cancelled"); });
    expect(outcome()).toBe("error");
    expect(posted).toEqual([]);
    expect(button().disabled).toBe(false);
    asBefore();
  });

  test("a token Apple refuses says why in large print, with the small print gone and the button there to try again, and leaves the origin as it was", async () => {
    intakeStatus = 422;
    await ready();
    button().click();
    await vi.waitFor(() => { expect(status()).toContain("no Apple Music subscription"); });
    expect(outcome()).toBe("error");
    expect(intro().hidden).toBe(true);
    expect(button().hidden).toBe(false);
    expect(button().disabled).toBe(false);
    asBefore();
  });

  test("after an error the button tries again, and a sign-in that then goes through is a success", async () => {
    intakeStatus = 422;
    await ready();
    button().click();
    await vi.waitFor(() => { expect(outcome()).toBe("error"); });
    intakeStatus = 204;
    button().click();
    await vi.waitFor(() => { expect(outcome()).toBe("success"); });
    expect(posted).toHaveLength(2);
  });

  test("an answer from the terminal the page has no words for is given by its status, with the button there to try again", async () => {
    intakeStatus = 500;
    await ready();
    button().click();
    await vi.waitFor(() => { expect(outcome()).toBe("error"); });
    expect(status()).toBe("The terminal answered 500. Try again, or run login again.");
    expect(button().disabled).toBe(false);
  });

  test.each([
    ["an Error", new Error("popup blocked")],
    ["something that is not an Error", "popup blocked"],
  ])("a sign-in that fails with %s says so, leaves the origin as it was, and lets them try again", async (_kind, reason) => {
    authorize = () => {
      keepCopies();
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Apple's script may reject with something of its own, not an Error
      return Promise.reject(reason);
    };
    await ready();
    button().click();
    await vi.waitFor(() => { expect(status()).toBe("Sign-in failed: popup blocked"); });
    expect(outcome()).toBe("error");
    expect(button().disabled).toBe(false);
    asBefore();
  });

  test("a tab closed in the middle of a sign-in leaves the origin as it was", async () => {
    authorize = () => {
      keepCopies();
      return new Promise<undefined>(() => undefined);
    };
    await ready();
    button().click();
    await vi.waitFor(() => { expect(document.cookie).toContain("media-user-token"); });
    window.dispatchEvent(new Event("pagehide"));
    asBefore();
  });

  test("a load of Apple's script that fails still enables the button, which tries again, and leaves no rejection unhandled", async () => {
    vi.resetModules();
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      document.body.innerHTML = '<p id="intro">The command line is waiting.</p><p id="status"></p><button id="connect" type="button" disabled></button>';
      vi.stubGlobal("fetch", () => Promise.resolve(new Response(null, { status: 503 })));
      await import("./page");
      await ready();
      expect(status()).toContain("could not be loaded");
      expect(outcome()).toBe("error");
      expect(button().hidden).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });

  test("a page served without its state still loads, and says Apple's sign-in could not be loaded, since the token route refuses it", async () => {
    vi.resetModules();
    document.head.innerHTML = "";
    document.body.innerHTML = '<p id="intro">The command line is waiting.</p><p id="status"></p><button id="connect" type="button" disabled></button>';
    await import("./page");
    await ready();
    expect(status()).toContain("could not be loaded");
    expect(outcome()).toBe("error");
  });
});
