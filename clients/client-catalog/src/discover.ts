// The functions for the catalog's endpoints that follow no pattern: search and its hints and suggestions, the
// charts, resources of several types at once, the live radio stations, and the language a storefront answers in.
import { endpoint, inStorefront, initOf, listOf, optionsOf, textOf, typedIdsOf, type tReadOptions, type tRequestPlan, type tStorefrontOption } from "@open-music-sdk/core";
import type {
  tChartResponse,
  tChartResponseResults,
  tLangageTagResponse,
  tResourceCollectionResponse,
  tSearchHintsResponse,
  tSearchResponse,
  tSearchResponseResults,
  tSearchSuggestionsResponse,
  tStationsResponse,
} from "@open-music-sdk/types";
import { NO_LISTENER } from "./storefront";

const OPTIONS = "an options object";

/** A type of resource a search of the catalog can look for. */
export type tCatalogSearchType = Exclude<keyof tSearchResponseResults, "top">;

/** The options of `searchCatalog`. */
export interface tSearchCatalogOptions extends tReadOptions<tSearchResponse>, tStorefrontOption {
  /** The types of resource to look for, such as `["songs", "albums"]`. There is no default: Apple wants one at least. */
  readonly types: readonly tCatalogSearchType[];
  /** What to send beside the results by type: `["topResults"]` for the best matches of any type, under `results.top`. */
  readonly with?: readonly "topResults"[] | undefined;
}

/**
 * Searches the catalog for a term, and resolves to the results by type, each one a first page. `limit` and
 * `offset` apply to every type asked for. A `next` link of a search answers with results by type again, not with a
 * page, so `paginate` stops after the first page: to get more of one type, ask again with a larger `offset`. The link
 * keeps the term and the types and leaves out `limit`, as it did against the live API on 18 October 2026.
 *
 * @function
 * @param client - The client to ask with.
 * @param term - What to search for, 1 to 256 characters.
 * @param options - The types to look for, which have to be given; whether to send the best matches of any type; the
 *   storefront to ask in; and what to send beside the results.
 * @returns What Apple answered: the results by type under `results`, each a first page with a `next` of its own, and
 *   the best matches under `results.top` when they were asked for.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const searchCatalog = /*#__PURE__*/ endpoint("searchCatalog", "answer", (client, term: string, options: tSearchCatalogOptions) => {
  const text = textOf("searchCatalog", "term", term);
  const bag = optionsOf("searchCatalog", options, OPTIONS);
  const init = { ...initOf<tSearchResponse>("searchCatalog", bag, { term: text, types: listOf("searchCatalog", "types", bag.types) }, { with: "list" }), ...NO_LISTENER };
  return inStorefront("searchCatalog", client, bag.storefront, (storefront): tRequestPlan<tSearchResponse> => [`v1/catalog/${storefront}/search`, init]);
});

/** The options of `getSearchHints`. */
export type tSearchHintsOptions = tReadOptions<tSearchHintsResponse> & tStorefrontOption;

/**
 * The terms a search might be for, given the start of one: what to offer as someone types.
 *
 * @function
 * @param client - The client to ask with.
 * @param term - The start of a search, 1 to 256 characters.
 * @param options - The storefront to ask in, and what to send beside the terms.
 * @returns What Apple answered: the terms under `results.terms`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getSearchHints = /*#__PURE__*/ endpoint("getSearchHints", "answer", (client, term: string, options?: tSearchHintsOptions) => {
  const text = textOf("getSearchHints", "term", term);
  const bag = optionsOf("getSearchHints", options, OPTIONS);
  const init = { ...initOf<tSearchHintsResponse>("getSearchHints", bag, { term: text }), ...NO_LISTENER };
  return inStorefront("getSearchHints", client, bag.storefront, (storefront): tRequestPlan<tSearchHintsResponse> => [`v1/catalog/${storefront}/search/hints`, init]);
});

/** The options of `getSearchSuggestions`. */
export interface tSearchSuggestionsOptions extends tReadOptions<tSearchSuggestionsResponse>, tStorefrontOption {
  /** The kinds of suggestion to make: `"terms"` to search for, `"topResults"` for resources that match. There is no default: Apple wants one at least. */
  readonly kinds: readonly ("terms" | "topResults")[];
  /** The types of resource the top results may be. It has no effect on the terms. */
  readonly types?: readonly tCatalogSearchType[] | undefined;
}

/**
 * Suggestions for a search, given the start of one: terms to search for, resources that match, or both.
 *
 * @function
 * @param client - The client to ask with.
 * @param term - The start of a search, 1 to 256 characters.
 * @param options - The kinds of suggestion to make, which have to be given; the types the top results may be; the
 *   storefront to ask in; and what to send beside the suggestions.
 * @returns What Apple answered: the suggestions under `results.suggestions`, each saying its `kind`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getSearchSuggestions = /*#__PURE__*/ endpoint("getSearchSuggestions", "answer", (client, term: string, options: tSearchSuggestionsOptions) => {
  const text = textOf("getSearchSuggestions", "term", term);
  const bag = optionsOf("getSearchSuggestions", options, OPTIONS);
  const init = { ...initOf<tSearchSuggestionsResponse>("getSearchSuggestions", bag, { term: text, kinds: listOf("getSearchSuggestions", "kinds", bag.kinds) }, { types: "list" }), ...NO_LISTENER };
  return inStorefront("getSearchSuggestions", client, bag.storefront, (storefront): tRequestPlan<tSearchSuggestionsResponse> => [`v1/catalog/${storefront}/search/suggestions`, init]);
});

/** The options of `getCharts`. */
export interface tChartsOptions extends tReadOptions<tChartResponse>, tStorefrontOption {
  /** The types of resource to get the charts of, such as `["songs", "albums"]`. There is no default: Apple wants one at least. */
  readonly types: readonly (keyof tChartResponseResults)[];
  /** The one chart to get, by the name it has in an answer, such as `"most-played"`. Default: every chart of each type. */
  readonly chart?: string | undefined;
  /** The genre to keep the charts to, by its id. Default: every genre. */
  readonly genre?: string | undefined;
  /** Charts that are not sent by default: `"cityCharts"` for each city's, `"dailyGlobalTopCharts"` for the world's. */
  readonly with?: readonly ("cityCharts" | "dailyGlobalTopCharts")[] | undefined;
}

/**
 * The charts of a storefront, by type of resource, each one a first page. Each type is a list of charts, since one
 * type can have several. `limit` and `offset` apply to every chart. A `next` link of a chart answers with charts by
 * type again, not with a page, as it did against the live API on 18 October 2026, so `paginate` stops after the
 * first page: to get more of a chart, ask again with a larger `offset`.
 *
 * @function
 * @param client - The client to ask with.
 * @param options - The types to chart, which have to be given; one chart by name; one genre by id; the city or global
 *   charts; the storefront to ask in; and what to send beside the charts.
 * @returns What Apple answered: the charts by type under `results`, each a first page with a `next` of its own.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getCharts = /*#__PURE__*/ endpoint("getCharts", "answer", (client, options: tChartsOptions) => {
  const bag = optionsOf("getCharts", options, OPTIONS);
  const init = { ...initOf<tChartResponse>("getCharts", bag, { types: listOf("getCharts", "types", bag.types) }, { chart: "name", genre: "name", with: "list" }), ...NO_LISTENER };
  return inStorefront("getCharts", client, bag.storefront, (storefront): tRequestPlan<tChartResponse> => [`v1/catalog/${storefront}/charts`, init]);
});

/** A type of resource the catalog can be asked for by id, beside others. */
export type tCatalogType =
  | "activities"
  | "albums"
  | "apple-curators"
  | "artists"
  | "curators"
  | "genres"
  | "music-videos"
  | "playlists"
  | "ratings"
  | "record-labels"
  | "songs"
  | "station-genres"
  | "stations";

/** Ids by type of resource, such as `{ songs: ["1"], albums: ["2"] }`. */
export type tCatalogIds = Readonly<Partial<Record<tCatalogType, readonly string[] | undefined>>>;

/** The options of `getCatalogResources`. */
export type tCatalogResourcesOptions = tReadOptions<tResourceCollectionResponse> & tStorefrontOption;

/**
 * Resources of several types in one request, by their ids: `{ songs: [...], albums: [...] }`. One type at least has to be given.
 *
 * @function
 * @param client - The client to ask with.
 * @param ids - The ids by type, such as `{ songs: ["1"], albums: ["2"] }`: 1 to 32 types with 1 to 300 ids between
 *   them; a type whose list is `undefined` is left out.
 * @param options - The storefront to ask in, and what to send beside the resources.
 * @returns What Apple answered: the resources under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getCatalogResources = /*#__PURE__*/ endpoint("getCatalogResources", "resources", (client, ids: tCatalogIds, options?: tCatalogResourcesOptions) => {
  const lists = typedIdsOf("getCatalogResources", "ids", ids);
  const bag = optionsOf("getCatalogResources", options, OPTIONS);
  const init = { ...initOf<tResourceCollectionResponse>("getCatalogResources", bag, lists), ...NO_LISTENER };
  return inStorefront("getCatalogResources", client, bag.storefront, (storefront): tRequestPlan<tResourceCollectionResponse> => [`v1/catalog/${storefront}`, init]);
});

/** The options of `getLiveRadioStations`. */
export type tLiveRadioStationsOptions = tReadOptions<tStationsResponse> & tStorefrontOption;

/**
 * The live radio stations of Apple Music, such as Apple Music 1.
 *
 * @function
 * @param client - The client to ask with.
 * @param options - The storefront to ask in, and what to send beside the stations.
 * @returns What Apple answered: the live stations under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getLiveRadioStations = /*#__PURE__*/ endpoint("getLiveRadioStations", "resources", (client, options?: tLiveRadioStationsOptions) => {
  const bag = optionsOf("getLiveRadioStations", options, OPTIONS);
  const init = { ...initOf<tStationsResponse>("getLiveRadioStations", bag, { "filter[featured]": "apple-music-live-radio" }), ...NO_LISTENER };
  return inStorefront("getLiveRadioStations", client, bag.storefront, (storefront): tRequestPlan<tStationsResponse> => [`v1/catalog/${storefront}/stations`, init]);
});

/** The options of `getLanguageTag`. */
export type tLanguageTagOptions = tReadOptions<tLangageTagResponse> & tStorefrontOption;

/**
 * The language a storefront would answer in, given the ones a reader accepts, best first, such as
 * `["fr-CA", "fr", "en"]`: the tag to pass as `language` to the other functions.
 *
 * @function
 * @param client - The client to ask with.
 * @param acceptLanguage - The languages a reader accepts, best first, as tags such as `"fr-CA"`, 1 to 300 of them.
 * @param options - The storefront to ask about, and what to send beside the tag.
 * @returns What Apple answered: the tag under `results.tag`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getLanguageTag = /*#__PURE__*/ endpoint("getLanguageTag", "answer", (client, acceptLanguage: readonly string[], options?: tLanguageTagOptions) => {
  const accepted = listOf("getLanguageTag", "acceptLanguage", acceptLanguage);
  const bag = optionsOf("getLanguageTag", options, OPTIONS);
  const init = { ...initOf<tLangageTagResponse>("getLanguageTag", bag, { acceptLanguage: accepted }), ...NO_LISTENER };
  return inStorefront("getLanguageTag", client, bag.storefront, (storefront): tRequestPlan<tLangageTagResponse> => [`v1/language/${storefront}/tag`, init]);
});
