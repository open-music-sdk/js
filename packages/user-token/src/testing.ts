// Shared by this package's suites: a real core client over a scripted fetch. Not part of the build.
import { createClient, isAppleMusicError, type AppleMusicError, type tClientOptions } from "@open-music-sdk/core";
import { vi } from "vitest";

/** One answer from Apple: a response, a fetch that throws, or `"hang"` for one that never answers until the request aborts. */
export type tReply = { status?: number; body?: unknown; headers?: Record<string, string> } | Error | "hang";

export const storefront = (id = "us") => ({ data: [{ id, type: "storefronts", href: `/v1/storefronts/${id}` }] });

/** Apple's error body for `status`, with a detail no response or message of ours should repeat. */
export const appleError = (status: number, title: string) => ({
  status,
  body: { errors: [{ id: "e1", title, detail: "apple-internal-detail", status: String(status), code: `${String(status)}00` }] },
});

/**
 * A fetch that answers from a queue of replies, then with a storefront, and records every Request
 * it saw. Like the real fetch it rejects with the abort reason when the request is aborted.
 */
export function fakeFetch(replies: tReply[] = []) {
  const calls: Request[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input);
    calls.push(req);
    if (req.signal.aborted) return Promise.reject(req.signal.reason as Error);
    const reply = replies.shift() ?? { body: storefront() };
    if (reply === "hang")
      return new Promise<Response>((_, reject) => {
        req.signal.addEventListener("abort", () => {
          reject(req.signal.reason as Error);
        });
      });
    if (reply instanceof Error) return Promise.reject(reply);
    const body = reply.body === undefined ? null : JSON.stringify(reply.body);
    return Promise.resolve(new Response(body, { status: reply.status ?? 200, headers: reply.headers ?? {} }));
  };
  return { fetch, calls };
}

/** A client over fakeFetch, with retries off unless `options` says otherwise. */
export function fakeClient(replies: tReply[] = [], options: Partial<tClientOptions> = {}) {
  const { fetch, calls } = fakeFetch(replies);
  return { music: createClient({ developerToken: "dev", fetch, retry: false, ...options }), calls };
}

/**
 * The same client built by a second copy of core, as an app on another version of it would pass in.
 * That copy's errors are not instances of this copy's class by prototype.
 */
export async function foreignClient(replies: tReply[] = []) {
  vi.resetModules();
  const core = await import("@open-music-sdk/core");
  const { fetch, calls } = fakeFetch(replies);
  return { core, music: core.createClient({ developerToken: "dev", fetch, retry: false }), calls };
}

/** The AppleMusicError `p` rejects with; anything else fails the test. */
export const failure = async (p: Promise<unknown>): Promise<AppleMusicError> => {
  try {
    await p;
  } catch (e) {
    if (isAppleMusicError(e)) return e;
    throw new Error(`expected an AppleMusicError, got ${String(e)}`, { cause: e });
  }
  throw new Error("expected a rejection");
};

/** Strings that could be a Music-User-Token header value, and values that could not. */
export const shaped: [string, string][] = [
  ["one character", "a"],
  ["4096 characters", "a".repeat(4096)],
  ["base64 with padding", "Ab+/9w=="],
  ["base64url", "Ab-_9w"],
  ["dotted segments", "eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJBIn0.c2ln"],
  ["every visible ASCII character", Array.from({ length: 94 }, (_, i) => String.fromCharCode(0x21 + i)).join("")],
];
export const misshapen: [string, unknown][] = [
  ["empty", ""],
  ["a space", " "],
  ["a leading space", " token"],
  ["an inner space", "to ken"],
  ["a trailing newline", "token\n"],
  ["a header injection", "token\r\nx-injected: 1"],
  ["a tab", "to\tken"],
  ["a NUL", "to\0ken"],
  ["a DEL", "to\x7fken"],
  ["Latin-1", "tokén"],
  ["beyond Latin-1", "tokĀn"],
  ["an emoji", "tok\u{1f3b5}n"],
  ["4097 characters", "a".repeat(4097)],
  ["undefined", undefined],
  ["null", null],
  ["a number", 12345],
  ["true", true],
  ["an object", { token: "abc" }],
  ["an array holding a token", ["abc"]],
];
