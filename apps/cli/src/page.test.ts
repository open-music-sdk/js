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

const signedIn = () => {
  document.cookie = "media-user-token=copy; path=/";
  localStorage.setItem("music.ABC123DEFG.u", "copy");
  sessionStorage.setItem("mk-session", "copy");
  return Promise.resolve(TOKEN);
};

beforeEach(async () => {
  vi.resetModules();
  authorize = signedIn;
  intakeStatus = 204;
  posted = [];
  history.replaceState(null, "", `/?state=${STATE}`);
  document.body.innerHTML = '<p id="status"></p><button id="connect" type="button" disabled></button>';
  // What other servers on localhost keep, which share its cookies, and what this origin held before.
  document.cookie = "other-app-session=theirs; path=/";
  localStorage.setItem("left-by-an-earlier-app", "theirs");
  // Apple's script, already on the page: the helper takes the global rather than loading it from Apple's CDN.
  configuredWith = [];
  vi.stubGlobal("MusicKit", {
    configure: ({ developerToken }: { developerToken: string }) => {
      configuredWith.push(developerToken);
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
  for (const name of ["media-user-token", "other-app-session"]) document.cookie = `${name}=; max-age=0; path=/`;
  localStorage.clear();
  sessionStorage.clear();
});

const button = () => document.getElementById("connect") as HTMLButtonElement;
const status = () => document.getElementById("status")?.textContent ?? "";
const ready = () => vi.waitFor(() => { expect(button().disabled).toBe(false); });

describe("the sign-in page", () => {
  test("the button is enabled once Apple's script is configured, with a developer token from this run's token route", async () => {
    await ready();
    expect(status()).toBe("Ready.");
    expect(configuredWith).toEqual([JWT]);
  });

  test("a sign-in posts the token as JSON with this run's state, says the tab can close, and leaves the button off", async () => {
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
    expect(button().disabled).toBe(true);
  });

  test("what Apple's script kept on the origin is cleared once the token is posted, and nothing it did not add", async () => {
    await ready();
    button().click();
    await vi.waitFor(() => { expect(status()).toContain("Signed in"); });
    expect(document.cookie).not.toContain("media-user-token");
    expect(localStorage.getItem("music.ABC123DEFG.u")).toBeNull();
    expect(sessionStorage.getItem("mk-session")).toBeNull();
    expect(document.cookie).toContain("other-app-session=theirs");
    expect(localStorage.getItem("left-by-an-earlier-app")).toBe("theirs");
  });

  test("a sign-in the listener cancels posts nothing and lets them try again", async () => {
    authorize = () => Promise.resolve(undefined);
    await ready();
    button().click();
    await vi.waitFor(() => { expect(status()).toContain("cancelled"); });
    expect(posted).toEqual([]);
    expect(button().disabled).toBe(false);
  });

  test("a token Apple refuses says why, still clears Apple's copy, and lets them try again", async () => {
    intakeStatus = 422;
    await ready();
    button().click();
    await vi.waitFor(() => { expect(status()).toContain("no Apple Music subscription"); });
    expect(button().disabled).toBe(false);
    expect(document.cookie).not.toContain("media-user-token");
  });

  test("a sign-in that fails says so and lets them try again", async () => {
    authorize = () => Promise.reject(new Error("popup blocked"));
    await ready();
    button().click();
    await vi.waitFor(() => { expect(status()).toContain("popup blocked"); });
    expect(button().disabled).toBe(false);
  });
});
