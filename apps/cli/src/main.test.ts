import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FileUserTokenStore } from "./files";
import { main } from "./main";

// No browser is opened by these tests: what login asks the system to run is recorded instead.
vi.mock("node:child_process", () => ({ spawn: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })) }));

const TEAM = "DEF123GHIJ";
const KEY_ID = "ABC123DEFG";
const TOKEN = "Ag-music-user-token-from-apple";
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
/** A line of the key's body, which no output may hold. */
const BODY = PEM.split(String.fromCharCode(10))[1] ?? "";
const realFetch = globalThis.fetch;

/** How the fake Apple answers each path, with a status or `HANG` for no answer until the request is aborted, and every request it was asked. */
const HANG = 0;
/** A fetch that fails as undici does when the name does not resolve. */
const UNREACHABLE = -1;
let apple: Record<string, number> = {};
/** The storefront the fake Apple names. */
let storefrontId = "gb";
let asked: Request[] = [];
const responses: Response[] = [];

let dir: string;
let keyPath: string;
let stdout: string;
let stderr: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omsdk-main-"));
  keyPath = join(dir, `AuthKey_${KEY_ID}.p8`);
  await writeFile(keyPath, PEM);
  apple = { "/v1/test": 200, "/v1/me/storefront": 200 };
  storefrontId = "gb";
  asked = [];
  stdout = "";
  stderr = "";
  for (const name of ["APPLE_MUSIC_PRIVATE_KEY", "APPLE_MUSIC_TEAM_ID", "APPLE_MUSIC_KEY_ID"]) vi.stubEnv(name, undefined);
  // Wherever the tests run, the files go to this test's folder.
  vi.stubEnv("LOCALAPPDATA", dir);
  vi.stubEnv("XDG_CONFIG_HOME", dir);
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => ((stdout += String(chunk)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => ((stderr += String(chunk)), true));
  // Apple is faked; anything else, such as the loopback server, is asked for real.
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.origin !== "https://api.music.apple.com") return realFetch(input, init);
    asked.push(req);
    const status = apple[url.pathname] ?? 404;
    if (status === UNREACHABLE) return Promise.reject(new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo ENOTFOUND api.music.apple.com"), { code: "ENOTFOUND" }) }));
    if (status === HANG)
      return new Promise((_resolve, reject) => {
        req.signal.addEventListener("abort", () => {
          reject(req.signal.reason as Error);
        });
      });
    const res =
      status !== 200
        ? Response.json({ errors: [{ status: String(status), title: "Refused", detail: "apple-detail" }] }, { status })
        : url.pathname === "/v1/test"
          ? new Response(null, { status: 200 })
          : Response.json({ data: [{ id: storefrontId, type: "storefronts" }] });
    responses.push(res);
    return Promise.resolve(res);
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
  for (const res of responses.splice(0)) if (res.body !== null) expect(res.bodyUsed).toBe(true);
});

const tokenFile = () => join(dir, "open-music-sdk", "user-token.json");
/** Puts the key and its IDs in the environment, as a project that follows the family's READMEs has them. main takes the key out again. */
const keepInEnvironment = () => {
  vi.stubEnv("APPLE_MUSIC_PRIVATE_KEY", PEM);
  vi.stubEnv("APPLE_MUSIC_TEAM_ID", TEAM);
  vi.stubEnv("APPLE_MUSIC_KEY_ID", KEY_ID);
};
/** Writes the token file as login would have left it. */
const kept = (token = TOKEN) => new FileUserTokenStore(tokenFile()).set("default", token);

/** Starts `login`, and once it prints its page, signs in as the page would: the page, then the token posted with the state. */
async function signIn(argv: string[]): Promise<{ status: number; posted: number }> {
  const running = main(argv);
  const url = await vi.waitFor(
    () => {
      const found = /http:\/\/localhost:\d+\/\?state=[\w-]+/.exec(stderr)?.[0];
      if (found === undefined) throw new Error("no page yet");
      return new URL(found);
    },
    { timeout: 5000 },
  );
  const page = await realFetch(url);
  expect(page.status).toBe(200);
  const secret = /<meta name="login-state" content="([\w-]+)">/.exec(await page.text())?.[1] ?? "";
  const posted = await realFetch(new URL("/user-token", url), {
    method: "POST",
    headers: { "content-type": "application/json", "x-login-state": secret },
    body: JSON.stringify({ token: TOKEN }),
  });
  await posted.arrayBuffer();
  return { status: await running, posted: posted.status };
}

describe("help and version: every form shows it, and it goes to stdout", () => {
  test("no arguments, --help, -h, help and help help show the commands, the files and the exit statuses", async () => {
    for (const argv of [[], ["--help"], ["-h"], ["help"], ["help", "help"], ["--help", "--bogus"]]) {
      stdout = "";
      expect(await main(argv), argv.join(" ")).toBe(0);
      for (const command of ["login", "token", "doctor", "logout"]) expect(stdout).toContain(command);
      expect(stdout).toContain(join(dir, "open-music-sdk"));
      expect(stdout).toContain("130 stopped with Ctrl+C");
      expect(stdout).toContain("https://github.com/open-music-sdk/js/issues");
    }
    expect(stderr).toBe("");
  });

  test("help <command>, <command> --help and <command> -h show that command's options, whatever else was passed", async () => {
    for (const argv of [["help", "login"], ["login", "--help"], ["login", "-h", "--port", "nonsense"], ["-h", "login"], ["login", "-h", "--bogus"], ["login", "--bogus", "--help"]]) {
      stdout = "";
      expect(await main(argv), argv.join(" ")).toBe(0);
      expect(stdout).toContain("--no-browser");
      expect(stdout).toContain("APPLE_MUSIC_PRIVATE_KEY");
      expect(stdout).toContain("the key first, then the team ID, then the key ID");
      expect(stdout).toContain("AuthKey_<key id>.p8 comes before APPLE_MUSIC_KEY_ID");
    }
    expect(asked).toEqual([]);
  });

  test("--version prints the version alone", async () => {
    expect(await main(["--version"])).toBe(0);
    expect(stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  test("help for a command that is not there is a mistake in how the CLI was run", async () => {
    expect(await main(["help", "logn"])).toBe(2);
    expect(stderr).toContain("There is no command 'logn'");
  });

  test("--no-color prints without color where color would otherwise be used", async () => {
    const escape = String.fromCharCode(27);
    // FORCE_COLOR stands in for a terminal: stdout here is none, and without it nothing is colored either way.
    vi.stubEnv("FORCE_COLOR", "1");
    await main(["--help"]);
    expect(stdout).toContain(escape);
    stdout = "";
    await main(["--help", "--no-color"]);
    expect(stdout).not.toContain(escape);
    stdout = "";
    await main(["login", "--no-color", "--bogus", "-h"]);
    expect(stdout).not.toContain(escape);
  });
});

describe("mistakes in how the CLI was run: exit status 2, and a pointer to the help", () => {
  test.each([
    [["logn"], "There is no command 'logn'", "open-music-sdk --help"],
    [["login", "--bogus"], "There is no option '--bogus'", "open-music-sdk login --help"],
    [["doctor", "--port", "3000"], "--port is not an option of doctor", "open-music-sdk doctor --help"],
    [["doctor", "--no-browser"], "--no-browser is not an option of doctor", "open-music-sdk doctor --help"],
    [["logout", "extra"], "logout takes no arguments", "open-music-sdk logout --help"],
    [["login", "--port", "70000", "--key-file", "k", "--team-id", TEAM], "--port must be a whole number from 1 to 65535", "open-music-sdk login --help"],
    [["login", "--key-file"], "--key-file", "open-music-sdk login --help"],
    [["doctor"], "No key", "open-music-sdk doctor --help"],
    [["token", "--key-file", "k"], "go with --developer", "open-music-sdk token --help"],
    [["doctor", "--color"], "There is no option '--color'", "open-music-sdk doctor --help"],
    [["login", "--browser"], "There is no option '--browser'", "open-music-sdk login --help"],
    [["token", "--no-developer"], "There is no option '--no-developer'", "open-music-sdk token --help"],
    [["--no-help"], "There is no option '--no-help'", "open-music-sdk --help"],
  ])("%j", async (argv, message, hint) => {
    expect(await main(argv)).toBe(2);
    expect(stderr).toContain(message);
    expect(stderr).toContain(hint);
    expect(stdout).toBe("");
    expect(asked).toEqual([]);
  });

  test("a token pasted where a command or a flag goes is not repeated", async () => {
    expect(await main([TOKEN.repeat(4)])).toBe(2);
    expect(await main([`--${TOKEN.repeat(4)}`])).toBe(2);
    expect(stderr).not.toContain(TOKEN);
  });
});

describe("token: the kept token on stdout, and nothing else there", () => {
  test("prints the kept token and a line break, for $(...) to read", async () => {
    await kept();
    expect(await main(["token"])).toBe(0);
    expect(stdout).toBe(`${TOKEN}\n`);
    expect(stderr).toBe("");
    expect(asked).toEqual([]);
  });

  test("with nothing kept, it fails and says how to get one, on stderr", async () => {
    expect(await main(["token"])).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("open-music-sdk login");
  });

  test("--developer mints from a key in SEC1 form as well as Apple's PKCS8", async () => {
    await writeFile(keyPath, generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "sec1", format: "pem" }).toString());
    expect(await main(["token", "--developer", "--key-file", keyPath, "--team-id", TEAM])).toBe(0);
    expect(stdout).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+\n$/);
    expect(stderr).toBe("");
  });

  test("--developer mints a developer token from the key, signed with its ID, without asking Apple", async () => {
    expect(await main(["token", "--developer", "--key-file", keyPath, "--team-id", TEAM])).toBe(0);
    const [header, claims] = stdout.trim().split(".").slice(0, 2).map((part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>);
    expect(header).toMatchObject({ alg: "ES256", kid: KEY_ID });
    expect(claims).toMatchObject({ iss: TEAM });
    expect(asked).toEqual([]);
  });
});

describe("logout: forgets the kept token", () => {
  test("forgets it, says so on stderr, and token then has nothing to print", async () => {
    await kept();
    expect(await main(["logout"])).toBe(0);
    expect(stderr).toContain("Forgot the Music User Token");
    expect(stderr).not.toContain(TOKEN);
    expect(await main(["token"])).toBe(1);
  });

  test("with nothing kept it is done already", async () => {
    expect(await main(["logout"])).toBe(0);
    expect(stderr).toContain("nothing to forget");
  });
});

describe("doctor: the key, then the token, asked of Apple", () => {
  test("both accepted: two passes on stdout, exit 0, and nothing secret printed", async () => {
    await kept();
    expect(await main(["doctor", "--key-file", keyPath, "--team-id", TEAM])).toBe(0);
    expect(stdout).toMatch(/✓ Key: .*ABC123DEFG.*DEF123GHIJ/);
    expect(stdout).toMatch(/✓ Music User Token: .*storefront gb/);
    expect(stdout + stderr).not.toContain(TOKEN);
    expect(stdout + stderr).not.toContain("PRIVATE KEY");
    expect(asked.map((req) => new URL(req.url).pathname)).toEqual(["/v1/test", "/v1/me/storefront"]);
    expect(asked[0]?.headers.get("music-user-token")).toBeNull();
  });

  test("a key Apple refuses fails, and the token is not asked about: Apple would refuse that too", async () => {
    await kept();
    apple["/v1/test"] = 401;
    expect(await main(["doctor", "--key-file", keyPath, "--team-id", TEAM])).toBe(1);
    expect(stdout).toMatch(/✗ Key: Apple refused the developer token/);
    expect(stdout).toContain("not asked about");
    expect(asked.map((req) => new URL(req.url).pathname)).toEqual(["/v1/test"]);
  });

  test("a token Apple refuses fails, and says to sign in again", async () => {
    await kept();
    apple["/v1/me/storefront"] = 403;
    expect(await main(["doctor", "--key-file", keyPath, "--team-id", TEAM])).toBe(1);
    expect(stdout).toMatch(/✓ Key/);
    expect(stdout).toMatch(/✗ Music User Token: Apple refused the Music User Token.*open-music-sdk login/);
    expect(stdout + stderr).not.toContain("apple-detail");
  });

  test("Apple out of reach is named by the system's own reason, not only fetch's", async () => {
    apple["/v1/test"] = UNREACHABLE;
    expect(await main(["doctor", "--key-file", keyPath, "--team-id", TEAM])).toBe(1);
    expect(stdout).toMatch(/✗ Key: Apple could not be reached: .*\(ENOTFOUND\)/);
  });

  test("what Apple sends reaches the terminal without the control characters a terminal would act on", async () => {
    await kept();
    const escape = String.fromCharCode(27);
    storefrontId = `gb${escape}[2J${escape}]0;owned${String.fromCharCode(7)}`;
    expect(await main(["doctor", "--key-file", keyPath, "--team-id", TEAM])).toBe(0);
    expect(stdout).toContain("storefront gb[2J]0;owned.");
    expect(stdout).not.toContain(escape);
    expect(stdout).not.toContain(String.fromCharCode(7));
  });

  test("no token kept fails, and says how to get one", async () => {
    expect(await main(["doctor", "--key-file", keyPath, "--team-id", TEAM])).toBe(1);
    expect(stdout).toMatch(/✗ Music User Token: none is kept\. Run 'open-music-sdk login'/);
  });

  test("the key and its IDs come from the environment with no flags at all, and the key is named by where it came from, not by what it holds", async () => {
    keepInEnvironment();
    await kept();
    expect(await main(["doctor"])).toBe(0);
    expect(stderr).toContain("the key from APPLE_MUSIC_PRIVATE_KEY");
    expect(stdout + stderr).not.toContain(BODY);
  });

  test("with nothing in the flags or the environment, and no terminal to ask at, each value is named with its flag and its variable", async () => {
    // Vitest runs its workers with stdin piped, which is what makes this no terminal.
    expect(process.stdin.isTTY).not.toBe(true);
    expect(await main(["doctor"])).toBe(2);
    for (const name of ["--team-id or set APPLE_MUSIC_TEAM_ID", "--key-id or set APPLE_MUSIC_KEY_ID", "set APPLE_MUSIC_PRIVATE_KEY", "--key-file <path>"]) expect(stderr).toContain(name);
    expect(asked).toEqual([]);
  });
});

describe("login: Apple's sign-in on a page served on localhost", () => {
  test("a token file the store cannot write over fails before Apple is asked or a page is served, not after the sign-in", async () => {
    await mkdir(join(dir, "open-music-sdk"), { recursive: true });
    await writeFile(tokenFile(), "not json");
    expect(await main(["login", "--no-browser", "--key-file", keyPath, "--team-id", TEAM])).toBe(1);
    expect(stderr).toContain(tokenFile());
    expect(stderr).not.toContain("http://localhost");
    expect(asked).toEqual([]);
  });

  test.runIf(process.platform === "win32")("on Windows, a variable is found however its name is cased, as Windows finds it", async () => {
    vi.stubEnv("apple_music_private_key", PEM);
    vi.stubEnv("Apple_Music_Team_Id", TEAM);
    vi.stubEnv("apple_music_key_id", KEY_ID);
    await kept();
    expect(await main(["doctor"])).toBe(0);
  });

  test("--no-input is taken by every command, so a script can pass it to all of them", async () => {
    await kept();
    expect(await main(["token", "--no-input"])).toBe(0);
    expect(await main(["logout", "--no-input"])).toBe(0);
    expect(await main(["--no-input", "--version"])).toBe(0);
  });

  test("the key is taken out of the process's environment, so the browser, and anything it starts, is not handed it", async () => {
    keepInEnvironment();
    let handed: string | undefined = "not asked";
    vi.mocked(spawn).mockImplementationOnce(() => {
      handed = process.env.APPLE_MUSIC_PRIVATE_KEY;
      return { on: vi.fn(), unref: vi.fn() } as unknown as ReturnType<typeof spawn>;
    });
    expect((await signIn(["login"])).status).toBe(0);
    expect(handed).toBeUndefined();
    expect(process.env.APPLE_MUSIC_PRIVATE_KEY).toBeUndefined();
  });

  test("--key is no option: a key file is named with --key-file", async () => {
    expect(await main(["login", "--key", keyPath])).toBe(2);
    expect(stderr).toContain("There is no option '--key'");
  });

  test("a key Apple refuses fails before any page is served", async () => {
    apple["/v1/test"] = 401;
    expect(await main(["login", "--no-browser", "--key-file", keyPath, "--team-id", TEAM])).toBe(1);
    expect(stderr).toContain("Apple refused the developer token");
    expect(stderr).not.toContain("http://localhost");
  });

  test("signs in: the token Apple accepted is kept for this user alone, nothing else is kept, and the storefront is said", async () => {
    const { status, posted } = await signIn(["login", "--no-browser", "--key-file", keyPath, "--team-id", TEAM]);
    expect(posted).toBe(204);
    expect(status).toBe(0);
    expect(JSON.parse(await readFile(tokenFile(), "utf8"))).toEqual({ default: TOKEN });
    if (process.platform !== "win32") expect((await stat(tokenFile())).mode & 0o777).toBe(0o600);
    // Neither the key, nor its path, nor its IDs: the next command finds them where this one did.
    expect(await readdir(join(dir, "open-music-sdk"))).toEqual(["user-token.json"]);
    expect(stderr).toContain("Signed in, storefront gb");
    expect(stderr).toContain("open-music-sdk token");
    expect(stdout).toBe("");
    expect(stderr).not.toContain(TOKEN);
  });

  test("the browser is opened with the system's own command, the address one argument of it and no shell between", async () => {
    vi.mocked(spawn).mockClear();
    const { status } = await signIn(["login", "--key-file", keyPath, "--team-id", TEAM]);
    expect(status).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = vi.mocked(spawn).mock.calls[0] ?? [];
    expect(command).toBe(process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open");
    expect(args).toEqual([expect.stringMatching(/^http:\/\/localhost:\d+\/\?state=[\w-]{43}$/)]);
    expect(options).toEqual({ stdio: "ignore", detached: true });
    // The address is printed as well, whether or not a browser opens.
    expect(stderr).toContain((args as string[])[0]);
  });

  test("--no-browser opens nothing and prints the address", async () => {
    vi.mocked(spawn).mockClear();
    expect((await signIn(["login", "--no-browser", "--key-file", keyPath, "--team-id", TEAM])).status).toBe(0);
    expect(spawn).not.toHaveBeenCalled();
  });

  test("--port is the port the page is served on", async () => {
    const probe = createServer();
    const port = await new Promise<number>((resolve) => {
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });
    await new Promise((resolve) => probe.close(resolve));
    const { status } = await signIn(["login", "--no-browser", "--port", String(port), "--key-file", keyPath, "--team-id", TEAM]);
    expect(status).toBe(0);
    expect(stderr).toContain(`http://localhost:${String(port)}/?state=`);
  });

  test("after it, token needs nothing, and doctor finds the key where login did", async () => {
    keepInEnvironment();
    await signIn(["login", "--no-browser"]);
    stdout = "";
    expect(await main(["token"])).toBe(0);
    expect(stdout).toBe(`${TOKEN}\n`);
    keepInEnvironment();
    expect(await main(["doctor"])).toBe(0);
  });

  test("Ctrl+C while Apple is asked about the key stops it too: exit 130, and no page", async () => {
    apple["/v1/test"] = HANG;
    const before = new Set(process.listeners("SIGINT"));
    const running = main(["login", "--no-browser", "--key-file", keyPath, "--team-id", TEAM]);
    await vi.waitFor(() => {
      expect(asked).toHaveLength(1);
    });
    const added = process.listeners("SIGINT").filter((listener) => !before.has(listener));
    expect(added).toHaveLength(1);
    added[0]?.("SIGINT");
    expect(await running).toBe(130);
    expect(stderr).toContain("Stopped. Nothing was kept.");
    expect(stderr).not.toContain("http://localhost");
    expect(process.listeners("SIGINT")).toHaveLength(before.size);
  });

  test("no sign-in within five minutes ends it: exit 1, nothing kept, and the page is gone", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const running = main(["login", "--no-browser", "--key-file", keyPath, "--team-id", TEAM]);
      const url = await vi.waitFor(
        () => {
          const found = /http:\/\/localhost:\d+\/\?state=[\w-]+/.exec(stderr)?.[0];
          if (found === undefined) throw new Error("no page yet");
          return found;
        },
        { timeout: 5000, interval: 10 },
      );
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(await running).toBe(1);
      expect(stderr).toContain("No sign-in within 5 minutes");
      await expect(readFile(tokenFile(), "utf8")).rejects.toThrow(/ENOENT/);
      await expect(realFetch(url)).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  test("Ctrl+C stops it: exit 130, nothing kept, and the page is gone", async () => {
    const before = new Set(process.listeners("SIGINT"));
    const running = main(["login", "--no-browser", "--key-file", keyPath, "--team-id", TEAM]);
    const url = await vi.waitFor(
      () => {
        const found = /http:\/\/localhost:\d+\/\?state=[\w-]+/.exec(stderr)?.[0];
        if (found === undefined) throw new Error("no page yet");
        return found;
      },
      { timeout: 5000 },
    );
    const added = process.listeners("SIGINT").filter((listener) => !before.has(listener));
    expect(added).toHaveLength(1);
    added[0]?.("SIGINT");
    expect(await running).toBe(130);
    expect(stderr).toContain("Stopped. Nothing was kept.");
    expect(process.listeners("SIGINT")).toHaveLength(before.size);
    await expect(readFile(tokenFile(), "utf8")).rejects.toThrow(/ENOENT/);
    await expect(realFetch(url)).rejects.toThrow();
  });
});
