// Every failure the SDK raises is one class with a `_tag`. Narrow with isAppleMusicError(e, tag).
// What makes a value one of these is its shape, so the guard holds across duplicate copies of the package.
import type { tError } from "@open-music-sdk/types";

/**
 * All but one describe what Apple answered. `DeveloperTokenUnavailable` is raised by a developer token provider
 * that could not obtain a token at all, so its `status` is its own source's, never Apple's.
 *
 * A token that cannot be used is `Invalid`, whichever token it is: `DeveloperTokenInvalid` when Apple answers
 * 401, `UserTokenInvalid` when Apple answers 403 or there is no user token to send. Validating a user token
 * also raises `UserTokenInvalid`, with status 401, when Apple answers 401 for the listener while it accepts
 * the developer token on its own.
 */
export type tErrorTag = "DeveloperTokenInvalid" | "DeveloperTokenUnavailable" | "UserTokenInvalid" | "RateLimited" | "ApiError" | "ValidationError" | "NetworkError";

/** A Standard Schema issue, as any validator reports it. */
export interface tValidationIssue {
  /** What is wrong, in the validator's words. */
  readonly message: string;
  /** Where in the value it is wrong, from the top down; left out for the value as a whole. A step is a key, or an object holding one. */
  readonly path?:
    | readonly (
        | PropertyKey
        | {
            /** The key this step of the path is at. */
            readonly key: PropertyKey;
          }
      )[]
    | undefined;
}

/** What is known about a failure beside its tag and message: each becomes a field of the error, and is left `undefined` where there is nothing to know. */
export interface tErrorDetails {
  /** HTTP status of the response that produced the error. */
  readonly status?: number | undefined;
  /** Apple's parsed `errors` array, when the body had one. */
  readonly errors?: readonly tError[] | undefined;
  /** Validator issues, on a ValidationError. */
  readonly issues?: readonly tValidationIssue[] | undefined;
  /** The delay a Retry-After header asked for, in milliseconds. */
  readonly retryAfterMs?: number | undefined;
  /** What went wrong underneath, such as what `fetch` rejected with on a NetworkError. Given, it becomes the error's `cause`. */
  readonly cause?: unknown;
}

/**
 * Every failure the SDK raises at runtime: what Apple answered, what the network did, or what a token provider
 * could not do. `_tag` says which, as `tErrorTag` lists them, and narrows the type: `isAppleMusicError(e, "RateLimited")`.
 * A caller's mistake in what it hands a function is never one of these; that is a `TypeError`, thrown before anything is sent.
 */
export class AppleMusicError<Tag extends tErrorTag = tErrorTag> extends Error {
  /** Always `"AppleMusicError"`: with `_tag`, what makes a value one of these to `instanceof` and `isAppleMusicError`. */
  override readonly name = "AppleMusicError";
  /** Which kind of failure this is. */
  readonly _tag: Tag;
  /** HTTP status of the answer that produced the error; `undefined` when there was none, as for a NetworkError. */
  readonly status: number | undefined;
  /** Apple's own `errors`, as its answer listed them; `undefined` when the body had none. */
  readonly errors: readonly tError[] | undefined;
  /** What the validator found wrong, on a ValidationError; `undefined` otherwise. */
  readonly issues: readonly tValidationIssue[] | undefined;
  /** How long Apple's Retry-After header asked to wait, in milliseconds; `undefined` when there was no such header. */
  readonly retryAfterMs: number | undefined;

  /**
   * @param tag - Which kind of failure this is.
   * @param message - What happened, in words that repeat no value: never a token, a key or what a caller passed.
   * @param details - What else is known: the status, Apple's errors, the validator's issues, a Retry-After, a cause.
   */
  constructor(tag: Tag, message: string, details: tErrorDetails = {}) {
    super(message, "cause" in details ? { cause: details.cause } : undefined);
    this._tag = tag;
    this.status = details.status;
    this.errors = details.errors;
    this.issues = details.issues;
    this.retryAfterMs = details.retryAfterMs;
  }

  /**
   * `instanceof` goes by shape, not by constructor. Two copies of this package can be installed side
   * by side, and an error made by one has to be recognised by the other's guard.
   *
   * @param value - What is on the left of `instanceof`.
   * @returns Whether `value` is an Error named `"AppleMusicError"` with a string `_tag`, whichever copy of this class made
   * it. Asked of a subclass, whether `value` was made by that subclass: the ordinary prototype check.
   */
  static override [Symbol.hasInstance](value: unknown): boolean {
    // A subclass keeps the ordinary prototype check: not every AppleMusicError is one of those.
    if (this !== AppleMusicError) return Function.prototype[Symbol.hasInstance].call(this, value);
    return value instanceof Error && value.name === "AppleMusicError" && typeof (value as { _tag?: unknown })._tag === "string";
  }
}

/**
 * Whether `e` is an `AppleMusicError`, and of one kind when `tag` names it: the guard to narrow a caught error with.
 *
 * @param e - What was caught.
 * @param tag - The one kind to ask for, such as `"RateLimited"`; left out, any kind will do.
 * @returns Whether `e` is an `AppleMusicError` by shape, from any copy of this package, and its `_tag` is `tag` where one was given.
 */
export const isAppleMusicError = <Tag extends tErrorTag = tErrorTag>(e: unknown, tag?: Tag): e is AppleMusicError<Tag> =>
  e instanceof AppleMusicError && (tag === undefined || e._tag === tag);
