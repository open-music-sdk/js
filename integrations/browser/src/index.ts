// What a page installs: this package's client and sign-in helper, and what a page uses of the feature tier, from one
// path. Not here: signing code of any kind, the token stores and the intake, which are a server's, and core's
// builders and checks, which the clients are declared with.
export { createBrowserClient } from "./client";
export type { tBrowserClientOptions, tBrowserMusic, tMusic } from "./client";
export { MUSICKIT_SCRIPT, createConnect } from "./connect";
export type { tConnect, tConnectApp, tConnectOptions, tMusicKit, tMusicKitInstance } from "./connect";

export { AppleMusicError, createRateLimiter, isAppleMusicError } from "@open-music-sdk/core";
export type {
  tAppleMusicClient,
  tClientOptions,
  tErrorDetails,
  tErrorTag,
  tPage,
  tPaginateInit,
  tParams,
  tRateLimiter,
  tRequestInit,
  tResponseOutcome,
  tRetryPolicy,
  tSchemaLike,
  tSchemaResult,
  tTokenContext,
  tTokenProvider,
  tUserTokenStore,
  tValidationIssue,
} from "@open-music-sdk/core";
export { developerTokenFetcher } from "@open-music-sdk/developer-token/fetcher";
export type { tDeveloperTokenProvider, tFetcherOptions } from "@open-music-sdk/developer-token/fetcher";
export { validateUserToken } from "@open-music-sdk/user-token";
export type { tValidateOptions } from "@open-music-sdk/user-token";
export { FORMATS, artworkImage, artworkSrcSet, artworkUrl } from "@open-music-sdk/util-artwork";
export type { tArtworkFormat, tArtworkImage, tArtworkOptions, tArtworkSource, tArtworkSrcSetOptions } from "@open-music-sdk/util-artwork";
export * from "@open-music-sdk/client-catalog";
export * from "@open-music-sdk/client-user";
export { playlists } from "@open-music-sdk/lib-playlists";
export type {
  tAppliedPlan,
  tApplyOptions,
  tAskOptions,
  tLimitOptions,
  tNewPlaylist,
  tPaceOptions,
  tPlaylistPlan,
  tPlaylistSnapshot,
  tPlaylistSnapshotTrack,
  tPlaylists,
  tProgress,
  tReadPlaylistOptions,
  tResolveOptions,
  tResolvedTracks,
  tSettleOptions,
  tSkippedTrack,
  tTrackDescription,
} from "@open-music-sdk/lib-playlists";
export { previewPlayer } from "@open-music-sdk/lib-preview-player";
export type { tLoadedPreviews, tPreviewAudio, tPreviewPlayer, tPreviewPlayerOptions, tPreviewPlayerState, tPreviewStatus, tPreviewable, tSkippedPreview } from "@open-music-sdk/lib-preview-player";
/** Every validator of {@link "@open-music-sdk/validate"! | @open-music-sdk/validate}, such as `schemas.song`, to pass as a function's `schema`. */
export * as schemas from "@open-music-sdk/validate";
export type * from "@open-music-sdk/types";
