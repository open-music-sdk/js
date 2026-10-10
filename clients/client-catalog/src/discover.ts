// The functions for the catalog's endpoints that follow no pattern: search and its hints and suggestions, the
// charts, resources of several types at once, the live radio stations, and the language a storefront answers in.
import { endpoint, got, initOf, listOf, optionsOf, typedIdsOf, type tReadOptions, type tRequestPlan } from "@open-music-sdk/core";
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
import { inStorefront, type tStorefrontOption } from "./storefront";

const OPTIONS = "an options object";
/** Longer than anything typed into a search box. What is searched for is sent in the URL, so it is not left open. */
const MAX_TERM = 256;

/** The text to search for, as the caller gave it: a string with something in it. */
function termOf(fn: string, term: unknown): string {
  if (typeof term === "string" && term !== "" && term.length <= MAX_TERM) return term;
  throw new TypeError(`${fn}: term must be a string of 1 to ${String(MAX_TERM)} characters; got ${got(term)}`);
}

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
 * `offset` apply to every type asked for.
 */
export const searchCatalog = /*#__PURE__*/ endpoint("searchCatalog", "answer", (client, term: string, options: tSearchCatalogOptions) => {
  const text = termOf("searchCatalog", term);
  const bag = optionsOf("searchCatalog", options, OPTIONS);
  const init = initOf<tSearchResponse>("searchCatalog", bag, { term: text, types: listOf("searchCatalog", "types", bag.types) }, ["with"]);
  return inStorefront("searchCatalog", client, bag.storefront, (storefront): tRequestPlan<tSearchResponse> => [`v1/catalog/${storefront}/search`, init]);
});

/** The options of `getSearchHints`. */
export type tSearchHintsOptions = tReadOptions<tSearchHintsResponse> & tStorefrontOption;

/** The terms a search might be for, given the start of one: what to offer as someone types. */
export const getSearchHints = /*#__PURE__*/ endpoint("getSearchHints", "answer", (client, term: string, options?: tSearchHintsOptions) => {
  const text = termOf("getSearchHints", term);
  const bag = optionsOf("getSearchHints", options, OPTIONS);
  const init = initOf<tSearchHintsResponse>("getSearchHints", bag, { term: text });
  return inStorefront("getSearchHints", client, bag.storefront, (storefront): tRequestPlan<tSearchHintsResponse> => [`v1/catalog/${storefront}/search/hints`, init]);
});

/** The options of `getSearchSuggestions`. */
export interface tSearchSuggestionsOptions extends tReadOptions<tSearchSuggestionsResponse>, tStorefrontOption {
  /** The kinds of suggestion to make: `"terms"` to search for, `"topResults"` for resources that match. There is no default: Apple wants one at least. */
  readonly kinds: readonly ("terms" | "topResults")[];
  /** The types of resource the top results may be. It has no effect on the terms. */
  readonly types?: readonly tCatalogSearchType[] | undefined;
}

/** Suggestions for a search, given the start of one: terms to search for, resources that match, or both. */
export const getSearchSuggestions = /*#__PURE__*/ endpoint("getSearchSuggestions", "answer", (client, term: string, options: tSearchSuggestionsOptions) => {
  const text = termOf("getSearchSuggestions", term);
  const bag = optionsOf("getSearchSuggestions", options, OPTIONS);
  const init = initOf<tSearchSuggestionsResponse>("getSearchSuggestions", bag, { term: text, kinds: listOf("getSearchSuggestions", "kinds", bag.kinds) }, ["types"]);
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

/** The charts of a storefront, by type of resource, each one a first page. `limit` and `offset` apply to every chart. */
export const getCharts = /*#__PURE__*/ endpoint("getCharts", "answer", (client, options: tChartsOptions) => {
  const bag = optionsOf("getCharts", options, OPTIONS);
  const init = initOf<tChartResponse>("getCharts", bag, { types: listOf("getCharts", "types", bag.types) }, ["chart", "genre", "with"]);
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

/** Resources of several types in one request, by their ids: `{ songs: [...], albums: [...] }`. One type at least has to be given. */
export const getCatalogResources = /*#__PURE__*/ endpoint("getCatalogResources", "resources", (client, ids: tCatalogIds, options?: tCatalogResourcesOptions) => {
  const lists = typedIdsOf("getCatalogResources", "ids", ids);
  const bag = optionsOf("getCatalogResources", options, OPTIONS);
  const init = initOf<tResourceCollectionResponse>("getCatalogResources", bag, lists);
  return inStorefront("getCatalogResources", client, bag.storefront, (storefront): tRequestPlan<tResourceCollectionResponse> => [`v1/catalog/${storefront}`, init]);
});

/** The options of `getLiveRadioStations`. */
export type tLiveRadioStationsOptions = tReadOptions<tStationsResponse> & tStorefrontOption;

/** The live radio stations of Apple Music, such as Apple Music 1. */
export const getLiveRadioStations = /*#__PURE__*/ endpoint("getLiveRadioStations", "resources", (client, options?: tLiveRadioStationsOptions) => {
  const bag = optionsOf("getLiveRadioStations", options, OPTIONS);
  const init = initOf<tStationsResponse>("getLiveRadioStations", bag, { "filter[featured]": "apple-music-live-radio" });
  return inStorefront("getLiveRadioStations", client, bag.storefront, (storefront): tRequestPlan<tStationsResponse> => [`v1/catalog/${storefront}/stations`, init]);
});

/** The options of `getLanguageTag`. */
export type tLanguageTagOptions = tReadOptions<tLangageTagResponse> & tStorefrontOption;

/**
 * The language a storefront would answer in, given the ones a reader accepts, best first, such as
 * `["fr-CA", "fr", "en"]`: the tag to pass as `language` to the other functions.
 */
export const getLanguageTag = /*#__PURE__*/ endpoint("getLanguageTag", "answer", (client, acceptLanguage: readonly string[], options?: tLanguageTagOptions) => {
  const accepted = listOf("getLanguageTag", "acceptLanguage", acceptLanguage);
  const bag = optionsOf("getLanguageTag", options, OPTIONS);
  const init = initOf<tLangageTagResponse>("getLanguageTag", bag, { acceptLanguage: accepted });
  return inStorefront("getLanguageTag", client, bag.storefront, (storefront): tRequestPlan<tLangageTagResponse> => [`v1/language/${storefront}/tag`, init]);
});
