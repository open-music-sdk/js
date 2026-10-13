// What a server installs: this package's client and token endpoint, and the feature tier an app uses, from one path.
// Not here: core's builders and checks, which the clients are declared with, and `createClient`, since an assembly
// of one's own is the feature tier directly.
export { createServerClient } from "./client";
export type { tMusic, tServerClientOptions } from "./client";
export { tokenEndpoint } from "./token-endpoint";
export type { tTokenEndpoint, tTokenEndpointOptions } from "./token-endpoint";

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
export { developerTokenFetcher, developerTokenMinter, mintDeveloperToken } from "@open-music-sdk/developer-token";
export type { tDeveloperTokenProvider, tFetcherOptions, tMinterOptions, tMintOptions } from "@open-music-sdk/developer-token";
export { KvUserTokenStore, MemoryUserTokenStore, acceptUserToken, userTokenIntake, validateUserToken } from "@open-music-sdk/user-token";
export type { tIntakeOptions, tKvNamespace, tKvStoreOptions, tUserTokenIntake, tValidateOptions } from "@open-music-sdk/user-token";
export { artworkImage, artworkSrcSet, artworkUrl } from "@open-music-sdk/util-artwork";
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
export * as schemas from "@open-music-sdk/validate";
export type * from "@open-music-sdk/types";
