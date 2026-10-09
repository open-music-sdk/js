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
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
}

export interface tErrorDetails {
  /** HTTP status of the response that produced the error. */
  readonly status?: number | undefined;
  /** Apple's parsed `errors` array, when the body had one. */
  readonly errors?: readonly tError[] | undefined;
  /** Validator issues, on a ValidationError. */
  readonly issues?: readonly tValidationIssue[] | undefined;
  /** The delay a Retry-After header asked for, in milliseconds. */
  readonly retryAfterMs?: number | undefined;
  readonly cause?: unknown;
}

export class AppleMusicError<Tag extends tErrorTag = tErrorTag> extends Error {
  override readonly name = "AppleMusicError";
  readonly _tag: Tag;
  readonly status: number | undefined;
  readonly errors: readonly tError[] | undefined;
  readonly issues: readonly tValidationIssue[] | undefined;
  readonly retryAfterMs: number | undefined;

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
   */
  static override [Symbol.hasInstance](value: unknown): boolean {
    // A subclass keeps the ordinary prototype check: not every AppleMusicError is one of those.
    if (this !== AppleMusicError) return Function.prototype[Symbol.hasInstance].call(this, value);
    return value instanceof Error && value.name === "AppleMusicError" && typeof (value as { _tag?: unknown })._tag === "string";
  }
}

export const isAppleMusicError = <Tag extends tErrorTag = tErrorTag>(e: unknown, tag?: Tag): e is AppleMusicError<Tag> =>
  e instanceof AppleMusicError && (tag === undefined || e._tag === tag);
