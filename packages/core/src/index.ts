export { createClient } from "./client.js";
export type {
  tAppleMusicClient,
  tClientOptions,
  tPage,
  tParams,
  tRequestInit,
  tResponseOutcome,
  tSchemaLike,
  tSchemaResult,
  tTokenContext,
  tTokenProvider,
  tUserTokenStore,
} from "./client.js";
export { AppleMusicError, isAppleMusicError } from "./errors.js";
export type { tErrorDetails, tErrorTag, tValidationIssue } from "./errors.js";
export { createRateLimiter } from "./rate-limit.js";
export type { tRateLimiter } from "./rate-limit.js";
export { parseRetryAfter, retry, retryable } from "./retry.js";
export type { tRetryPolicy } from "./retry.js";
