// End-to-end checks against the generated validators: real Apple shapes, real names, real paths.
import { describe, expect, test } from "vitest";
import type { tAnyResource, tResourceType, tSong } from "@open-music-sdk/types";
import * as all from "./index";
import { album, albumRelationshipsAlbumTracksRelationship } from "./generated/album";
import { anyResource } from "./generated/any-resource";
import { emptyBodyResponse, errorsResponse } from "./generated/common";
import { libraryPlaylistCreationRequestRelationshipsTracksData } from "./generated/library-playlist-creation-request";
import { musicVideo } from "./generated/music-video";
import { rating } from "./generated/rating";
import { searchResponse } from "./generated/search-response";
import { song, songAttributes, songsResponse } from "./generated/song";
import type { tIssue, tSchema, tStandardSchemaV1 } from "./runtime";

const report = (schema: tSchema<unknown>, value: unknown): string[] =>
  (schema["~standard"].validate(value).issues ?? []).map((i: tIssue) => `${(i.path ?? []).join(".") || "<root>"}: ${i.message}`);

const artwork = { url: "https://example/{w}x{h}bb.jpg", width: 3000, height: 3000 };
const songFixture = { id: "1613600188", type: "songs", href: "/v1/catalog/us/songs/1613600188" };
const songAttrs = {
  albumName: "Emotional Creature",
  artistName: "Beach Bunny",
  artwork,
  durationInMillis: 221000,
  genreNames: ["Alternative", "Music"],
  hasLyrics: true,
  isAppleDigitalMaster: false,
  name: "Entropy",
  previews: [{ url: "https://example/preview.m4a" }],
  url: "https://music.apple.com/us/album/entropy/1613600186?i=1613600188",
};
const musicVideoFixture = { id: "2", type: "music-videos", href: "/v1/catalog/us/music-videos/2" };

describe("song", () => {
  test("accepts the minimal resource and the full attributes", () => {
    expect(song["~standard"].validate(songFixture)).toEqual({ value: songFixture });
    const full = { ...songFixture, attributes: { ...songAttrs, contentRating: "explicit", audioVariants: ["lossless", "dolby-atmos"] } };
    expect(song["~standard"].validate(full)).toEqual({ value: full });
  });

  test("checks the envelope", () => {
    expect(report(song, {})).toEqual(["id: required", "type: required", "href: required"]);
    expect(report(song, { ...songFixture, type: "albums" })).toEqual(['type: expected "songs"']);
    expect(report(song, { ...songFixture, id: 1613600188 })).toEqual(["id: expected string"]);
    expect(report(song, "1613600188")).toEqual(["<root>: expected object"]);
  });

  test.each(Object.keys(songAttrs))("reports a missing required attribute: %s", (key) => {
    const rest = Object.fromEntries(Object.entries(songAttrs).filter(([k]) => k !== key));
    expect(report(song, { ...songFixture, attributes: rest })).toEqual([`attributes.${key}: required`]);
  });

  test("checks nested dictionaries with full paths", () => {
    const bad = { ...songFixture, attributes: { ...songAttrs, artwork: { ...artwork, width: "3000" }, previews: [{ url: "x" }, {}] } };
    expect(report(song, bad)).toEqual(["attributes.artwork.width: expected number", "attributes.previews.1.url: required"]);
  });

  test("enforces allowed values, including inside arrays", () => {
    expect(report(songAttributes, { ...songAttrs, contentRating: "pg" })).toEqual(['contentRating: expected "clean" | "explicit"']);
    const issues = report(songAttributes, { ...songAttrs, audioVariants: ["lossless", "mp3"] });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^audioVariants\.1: expected "dolby-atmos" \| /);
  });

  test("ignores attributes Apple has not documented yet", () => {
    const future = { ...songFixture, attributes: { ...songAttrs, spatialAudio: true }, meta: { anything: 1 } };
    expect(song["~standard"].validate(future)).toEqual({ value: future });
  });

  test("narrows the output type", () => {
    const result = song["~standard"].validate(songFixture);
    if (!result.issues) {
      const s: tSong = result.value;
      expect(s.type).toBe("songs");
    }
  });
});

describe("album tracks: an array of a union", () => {
  test("accepts songs and music videos in one list", () => {
    const tracks = { data: [songFixture, musicVideoFixture, songFixture] };
    expect(albumRelationshipsAlbumTracksRelationship["~standard"].validate(tracks)).toEqual({ value: tracks });
    expect(albumRelationshipsAlbumTracksRelationship["~standard"].validate({ data: [] })).toEqual({ value: { data: [] } });
  });

  test("reports the closest union member for a bad element", () => {
    const tracks = { data: [songFixture, { id: "3", type: "albums", href: "/x" }] };
    expect(report(albumRelationshipsAlbumTracksRelationship, tracks)).toEqual(['data.1.type: expected "music-videos"']);
  });

  test("checks the relationship envelope", () => {
    expect(report(albumRelationshipsAlbumTracksRelationship, {})).toEqual(["data: required"]);
    expect(report(albumRelationshipsAlbumTracksRelationship, { data: songFixture })).toEqual(["data: expected array"]);
    expect(report(albumRelationshipsAlbumTracksRelationship, { data: [], next: 1 })).toEqual(["next: expected string"]);
  });
});

describe("anyResource", () => {
  const types: tResourceType[] = ["songs", "albums", "artists", "playlists", "stations", "library-songs", "music-summaries", "album-period-summaries"];
  test.each(types)("accepts a %s resource", (type) => {
    const value = { id: "1", type, href: "/v1/x" };
    expect(anyResource["~standard"].validate(value)).toEqual({ value });
  });

  test("accepts a specific resource and narrows to the union", () => {
    const result = anyResource["~standard"].validate({ ...songFixture, attributes: songAttrs });
    if (!result.issues) {
      const resource: tAnyResource = result.value;
      expect(resource.type).toBe("songs");
    }
  });

  test("rejects unknown types and non-objects", () => {
    expect(report(anyResource, { id: "1", type: "podcasts", href: "/x" })).toEqual(['type: expected "activities"']);
    // The closest member wins: the period summaries need only id and type, so no "href: required".
    expect(report(anyResource, {})).toEqual(["id: required", "type: required"]);
    expect(report(anyResource, "songs")).toEqual(["<root>: expected object"]);
    expect(report(anyResource, undefined)).toEqual(["<root>: expected object"]);
  });
});

describe("rating: a numeric allowed-values property", () => {
  const base = { id: "1613600188", type: "ratings", href: "/v1/me/ratings/songs/1613600188" };
  test.each([1, -1])("accepts value %s", (value) => {
    const v = { ...base, attributes: { value } };
    expect(rating["~standard"].validate(v)).toEqual({ value: v });
  });
  test.each([0, 2, "1", "-1", true])("rejects value %s", (value) => {
    expect(report(rating, { ...base, attributes: { value } })).toEqual(["attributes.value: expected -1 | 1"]);
  });
});

describe("dictionaries with no documented properties", () => {
  test.each([{}, { anything: [1, 2, 3] }])("emptyBodyResponse accepts %j", (v) => {
    expect(emptyBodyResponse["~standard"].validate(v)).toEqual({ value: v });
  });
  test.each([null, [], "", 0])("emptyBodyResponse rejects %s", (v) => {
    expect(report(emptyBodyResponse, v)).toEqual(["<root>: expected object"]);
  });
});

describe("response envelopes", () => {
  test("songsResponse wraps a data array", () => {
    expect(songsResponse["~standard"].validate({ data: [songFixture] })).toEqual({ value: { data: [songFixture] } });
    expect(report(songsResponse, {})).toEqual(["data: required"]);
    expect(report(songsResponse, { data: songFixture })).toEqual(["data: expected array"]);
    expect(report(songsResponse, { data: [songFixture, { id: "2" }] })).toEqual(["data.1.type: required", "data.1.href: required"]);
  });

  test("errorsResponse checks each error", () => {
    const errors = { errors: [{ id: "abc", title: "Resource Not Found", status: "404", code: "40400" }] };
    expect(errorsResponse["~standard"].validate(errors)).toEqual({ value: errors });
    expect(report(errorsResponse, { errors: [{ id: "abc", status: "404", code: "40400" }] })).toEqual(["errors.0.title: required"]);
    expect(report(errorsResponse, { errors: [{ id: "abc", title: "x", status: 404, code: "40400" }] })).toEqual(["errors.0.status: expected string"]);
  });

  test("searchResponse groups results by type, including hyphenated keys", () => {
    const ok = { results: { songs: { data: [songFixture], next: "/v1/catalog/us/search?offset=25" }, "music-videos": { data: [musicVideoFixture] } } };
    expect(searchResponse["~standard"].validate(ok)).toEqual({ value: ok });
    expect(searchResponse["~standard"].validate({ results: {} })).toEqual({ value: { results: {} } });
    expect(report(searchResponse, {})).toEqual(["results: required"]);
    expect(report(searchResponse, { results: { songs: { data: "x" } } })).toEqual(["results.songs.data: expected array"]);
    expect(report(searchResponse, { results: { "music-videos": { data: [songFixture] } } })).toEqual([
      'results.music-videos.data.0.type: expected "music-videos"',
    ]);
  });
});

describe("request bodies", () => {
  test("playlist track identifiers accept the four allowed types", () => {
    for (const type of ["library-music-videos", "library-songs", "music-videos", "songs"]) {
      const v = { id: "1", type };
      expect(libraryPlaylistCreationRequestRelationshipsTracksData["~standard"].validate(v)).toEqual({ value: v });
    }
    expect(report(libraryPlaylistCreationRequestRelationshipsTracksData, { id: "1", type: "albums" })).toEqual([
      'type: expected "library-music-videos" | "library-songs" | "music-videos" | "songs"',
    ]);
  });
});

describe("Standard Schema interop", () => {
  function parse<T>(schema: tStandardSchemaV1<unknown, T>, value: unknown): T {
    const result = schema["~standard"].validate(value);
    if (result instanceof Promise) throw new Error("async");
    if (result.issues) throw new Error(result.issues.map((i) => i.message).join(", "));
    return result.value;
  }

  test("a generic consumer gets a typed value", () => {
    const s = parse(song, songFixture);
    expect(s.type).toBe("songs");
    const v = parse(musicVideo, musicVideoFixture);
    expect(v.type).toBe("music-videos");
    expect(() => parse(album, songFixture)).toThrow('expected "albums"');
  });
});

describe("every generated validator", () => {
  const schemas = Object.entries(all as Record<string, unknown>)
    .filter(([, v]) => typeof v === "object" && v !== null && "~standard" in v)
    .map(([name, v]) => [name, v as tSchema<unknown>] as const);

  test("is exported", () => {
    expect(schemas.length).toBeGreaterThan(270);
    expect(schemas.map(([name]) => name)).toEqual(expect.arrayContaining(["song", "album", "artwork", "anyResource", "songsResponse"]));
  });

  test.each(schemas)("%s handles garbage without throwing", (_name, schema) => {
    for (const garbage of [undefined, null, 0, "", [], {}, { id: 1, type: null, attributes: "x", data: 1, relationships: [] }]) {
      const result = schema["~standard"].validate(garbage);
      expect(result).toHaveProperty(result.issues ? "issues" : "value");
    }
  });
});
