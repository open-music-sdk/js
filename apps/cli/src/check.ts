// `check`: the live API asked, as the kept token's listener, through the SDK's own functions. The sweep asks every
// endpoint function client-catalog and client-user export and holds each answer to its generated type; the questions
// ask what the SDK takes on trust about how Apple behaves, each answer printed as what Apple did, worded to go into
// the docs' "Differences from Apple's documentation" as it is. A package, a function, one of its names or a question
// is run by its name too, so that it can be asked again, or asked for in an issue. What writes to the listener's
// library runs only with --write, and a run that wrote ends with how to undo it.
import { inspect } from "node:util";
import manifest from "../package.json" with { type: "json" };
import { createRateLimiter, createServerClient, getCharts, isAppleMusicError } from "@open-music-sdk/server";
import { isOnHost } from "@open-music-sdk/core";
import { PACE, at, brief, itemsOf, list, plural, said, text, whereOf, type tCharts, type tItem, type tLeft, type tMark, type tWritten } from "./check-ask";
import { CHECKS, PACKAGES, type tCheck } from "./check-questions";
import { ROWS, TRIPS, type tAsk, type tOutcome, type tRow } from "./check-sweep";
import { NAME, TIMEOUT_MS, examine, out, paint, say, type tContext, type tFlags } from "./commands";
import { CliError, printable, usage } from "./files";

export { PACE, brief, whereOf } from "./check-ask";
export { CHECKS } from "./check-questions";

const MARKS: Readonly<Record<tMark, readonly [string, Parameters<typeof paint>[1] | undefined]>> = {
  same: ["✓", "green"],
  differs: ["≠", "yellow"],
  report: ["·", undefined],
  skipped: ["-", "dim"],
  failed: ["✗", "red"],
};

/** Every check a run can make by name: the questions, and the sweep's round trips, named for their setters. */
const ALL: readonly tCheck[] = [...CHECKS, ...TRIPS];

/** A row of the sweep as a run asks it: the names it is asked for, or undefined for every one it has. */
interface tPicked {
  readonly pkg: (typeof PACKAGES)[number];
  readonly fn: string;
  readonly row: tRow;
  readonly names: readonly string[] | undefined;
}

/**
 * What is named is repeated only when it looks like a name, which starts with a small letter, as no token does: what
 * was typed may be a token pasted in the wrong place.
 */
const noSuch = (name: string) => usage(`There is no check${/^[a-z][\w:-]{0,63}$/.test(name) ? ` '${name}'` : ""}. '${NAME} help check' lists every one.`);

/**
 * The rows and checks named, each once, in the order a run asks them; with none named, every row, and every check
 * `write` allows. A package is its rows and the checks `write` allows; a function is its row with every name, or the
 * check that asks it; `function:name` is one name of a row.
 *
 * @throws CliError with exit status 2 for a name that is not there, or one check that writes named without --write.
 */
function chosen(names: readonly string[], write: boolean): { readonly rows: readonly tPicked[]; readonly checks: readonly tCheck[] } {
  const rows = new Map<string, Set<string> | "all">();
  const checks = new Set<tCheck>();
  const take = (each: tCheck, alone: boolean) => {
    if (each.writes && !write) {
      if (alone) throw usage(`${each.id} writes to your library, and runs only with --write.`);
      return;
    }
    checks.add(each);
  };
  if (names.length === 0) {
    for (const { fn } of ROWS) rows.set(fn, "all");
    for (const each of ALL) take(each, false);
  }
  for (const name of names) {
    const pkg = PACKAGES.find((each) => each === name);
    if (pkg !== undefined) {
      for (const each of ROWS) if (each.pkg === pkg) rows.set(each.fn, "all");
      for (const each of ALL) if (each.pkg === pkg) take(each, false);
      continue;
    }
    const colon = name.indexOf(":");
    const [fn, sub] = colon === -1 ? [name, undefined] : [name.slice(0, colon), name.slice(colon + 1)];
    const found = ROWS.find((each) => each.fn === fn);
    if (found === undefined) {
      const each = ALL.find((one) => one.id === name);
      if (each === undefined) throw noSuch(name);
      take(each, true);
    } else if (found.entry.kind === "check") {
      const to = found.entry.to;
      const each = ALL.find((one) => one.id === to);
      if (sub !== undefined || each === undefined) throw noSuch(name);
      take(each, true);
    } else if (sub === undefined) rows.set(fn, "all");
    else {
      if (found.entry.names?.includes(sub) !== true) throw noSuch(name);
      const some = rows.get(fn) ?? new Set<string>();
      if (some !== "all") rows.set(fn, some.add(sub));
    }
  }
  const picked: tPicked[] = [];
  for (const { pkg, fn, entry } of ROWS) {
    const some = rows.get(fn);
    if (entry.kind === "row" && some !== undefined) picked.push({ pkg, fn, row: entry, names: some === "all" ? undefined : entry.names?.filter((name) => some.has(name)) });
  }
  return { rows: picked, checks: ALL.filter((each) => checks.has(each)) };
}

/** A line of the report, before its mark is painted. */
interface tLine {
  readonly mark: tMark;
  readonly label: string;
  readonly words: string;
}

/** What a row came to, as lines; why what was not asked was not, for stderr; and how its answers differed from their types. */
interface tRowLines {
  readonly lines: readonly tLine[];
  readonly whys: readonly string[];
  readonly diffs: readonly { readonly label: string; readonly said: string }[];
}

/**
 * Asks a row, each name at once, and says what it came to: one ✓ line for the names that held, and a line of its own
 * for each that did not. What Apple failed with is a ✗ line of that name, and anything else a bug's; Ctrl+C is handed
 * back as the error, not thrown, since the row is asked before anything awaits it.
 */
async function rowLines(a: tAsk, { fn, row, names }: tPicked): Promise<tRowLines | { readonly error: unknown }> {
  const guarded = (name: string | undefined): Promise<tOutcome> =>
    row.ask(a, name).catch((e: unknown) => {
      if (a.signal.aborted) throw e;
      if (isAppleMusicError(e)) return { mark: "failed", words: `${brief(e)} (at ${whereOf(e)}), so this was not answered.`, diffs: [] };
      // What it threw may name a path of the listener's, so it goes to stderr, with the person, not into the report.
      say(inspect(e));
      return { mark: "failed", words: "something went wrong that check did not expect, so this was not answered. This is a bug: please report it, with what stderr says.", diffs: [] };
    });
  try {
    const asked = names ?? row.names;
    const outcomes = asked === undefined ? [{ label: fn, outcome: await guarded(undefined) }] : await Promise.all(asked.map(async (name) => ({ label: `${fn}:${name}`, outcome: await guarded(name) })));
    const lines: tLine[] = [];
    const held = outcomes.filter(({ outcome }) => outcome.mark === "same").length;
    if (names === undefined && asked !== undefined && held > 0) lines.push({ mark: "same", label: fn, words: `${String(held)} of ${plural(asked.length, row.noun === "views" ? "view" : "relationship")} as the types have them.` });
    for (const { label, outcome } of outcomes) if (asked === undefined || names !== undefined || outcome.mark !== "same") lines.push({ mark: outcome.mark, label, words: outcome.words });
    return {
      lines,
      whys: outcomes.flatMap(({ label, outcome }) => (outcome.why === undefined ? [] : [`${label}: ${outcome.why}.`])),
      diffs: outcomes.flatMap(({ label, outcome }) => outcome.diffs.map((diff) => ({ label, said: said(diff) }))),
    };
  } catch (e) {
    return { error: e };
  }
}

/** A catalog resource as a cleanup step names it, with the link that opens it in Apple Music, where Apple gave one. */
const label = (item: tItem) => {
  const word = { songs: "song", albums: "album", playlists: "playlist", "music-videos": "music video", stations: "station" }[item.type];
  return `the ${word} "${printable(item.name)}"${item.by === undefined ? "" : ` by ${printable(item.by)}`}${item.type === "albums" ? ", with its songs" : ""}`;
};
/** Apple's link to a resource, offered to open only when it is an https address of Apple Music's own: it came in an answer, and the person is told to follow it. */
const link = ({ url }: tItem) => (url !== undefined && isOnHost(url, ["music.apple.com"]) ? printable(url) : "search for it in the Music app");
const UNSURE = " (Apple's answer was lost, so it may not be there)";
const unsure = (written: tWritten<unknown>) => (written.sure ? "" : UNSURE);
// From the page each opens: the lists of the library itself had no Delete from Library on 18 October 2026.
const DELETE = "and choose Delete from Library from the … menu on the page it opens";

/** The steps that undo what the write checks left, numbered; nothing when they left nothing. */
function cleanup(left: tLeft): void {
  const steps: { readonly step: string; readonly items?: readonly string[] }[] = [];
  // Every playlist of the name: apply may have made a second, and failed before it said so.
  for (const name of new Set(left.playlists.map((each) => each.what))) {
    const sure = left.playlists.some((each) => each.what === name && each.sure);
    steps.push({ step: `Delete every playlist named "${printable(name)}": open each from your playlists, and choose Delete from Library from the … menu on its page.${sure ? "" : UNSURE}` });
  }
  // Where a folder is deleted in the Music app is to be confirmed by a live run.
  for (const folder of left.folders)
    steps.push({ step: `Delete the playlist folder named "${printable(folder.what)}": it is among your playlists in the Music app on a Mac, iPhone or iPad; choose Delete from Library from its … menu, or Control-click or touch and hold it.${unsure(folder)}` });
  if (left.library.length > 0) steps.push({ step: `Delete these from your library: open each, ${DELETE}.`, items: left.library.map((each) => `${label(each.what)}: ${link(each.what)}${unsure(each)}`) });
  for (const { playlist, seen } of left.playlistsSongs) {
    // A playlist is added only when none of its songs was in the library, so every song on its page is one to delete.
    const each = `open ${link(playlist)}, and choose Delete from Library from the … menu of each song on that page. None of them was in your library before.`;
    steps.push({ step: seen ? `Adding ${label(playlist)} put its songs in your library as well. Delete them: ${each}` : `If adding ${label(playlist)} put its songs in your library, delete them: ${each}` });
  }
  for (const favorite of left.favorites) {
    const library = favorite.inLibrary ? " It went into your library as well: choose Delete from Library from the same menu." : " If it shows up in your library, choose Delete from Library from the same menu as well.";
    steps.push({ step: `Undo the favorite on ${label(favorite.what)}: open ${link(favorite.what)}, and choose Undo Favorite from the … menu on its page.${library}${unsure(favorite)}` });
  }
  if (left.ratings.length > 0)
    steps.push({ step: "Take away the dislike check set on each of these, which it could not take away itself: open each, and take it away from the … menu on its page.", items: left.ratings.map((each) => `${label(each.what)}: ${link(each.what)}${each.sure ? "" : UNSURE}`) });
  const songs = left.playlistSongs;
  if (songs !== undefined)
    steps.push({
      step: songs.seen
        ? `The playlist's songs went into your library as well. Delete the albums they are from: open each, ${DELETE}.`
        : `If the playlist's songs show up in your library, delete the albums they are from: open each, ${DELETE}. None of these albums was in your library before.`,
      items: songs.albums.map((album) => `${label(album)}: ${link(album)}`),
    });
  if (steps.length === 0) return;
  // On stderr: the steps are said to the person, and in naming what was not in their library they say what was,
  // which has no place in the report on stdout that goes into an issue.
  say("");
  say("To undo what check left in your library, which Apple's API has no way to take out again, use the Music app on any device signed in to this Apple Account:");
  steps.forEach(({ step, items = [] }, i) => {
    say(`  ${String(i + 1)}. ${step}`);
    for (const item of items) say(`     - ${item}`);
  });
}

/** Takes away, through the API, every rating the run set and has not taken away: those it cannot are left for the steps. */
async function undoRatings(left: tLeft): Promise<void> {
  const ratings = left.ratings.splice(0);
  if (ratings.length > 0) say("Taking away the ratings check set…");
  for (const rating of ratings) {
    try {
      await rating.undo();
    } catch {
      left.ratings.push(rating);
    }
  }
}

/** What the run is made from, for an issue: the CLI's version, Node's and the system's. */
const header = () => `${NAME} ${manifest.version} · Node ${process.versions.node} · ${process.platform} ${process.arch}`;

/** Lines of `words`, a word at a time, none longer than `width` after `indent`. */
function wrapped(words: readonly string[], indent: string, width = 112): string[] {
  const lines: string[] = [];
  let line = indent;
  for (const word of words) {
    if (line.length + word.length > width && line !== indent) {
      lines.push(line.trimEnd());
      line = indent;
    }
    line += `${word} `;
  }
  return [...lines, line.trimEnd()];
}

/** The help's list of what can be named: the questions, the functions by package, and the packages. */
export function checkHelp(): string[] {
  const width = Math.max(...CHECKS.map((each) => each.id.length)) + 2;
  const reads = (pkg: string) => ROWS.filter((each) => each.pkg === pkg && each.entry.kind === "row").map((each) => `${each.fn},`);
  return [
    "Questions, by their names:",
    ...CHECKS.map((each) => `  ${each.id.padEnd(width)}${each.about}${each.writes ? " (--write)" : ""}`),
    "",
    "Functions, by their names in the SDK, each answer held to its generated type; <function>:<name> for one",
    "relationship or view of one:",
    ...wrapped(["client-catalog:", ...reads("client-catalog")], "  "),
    ...wrapped(["client-user:", ...reads("client-user")], "  "),
    ...wrapped(
      [
        "client-user, round trips with --write, each named for the function it writes with, and run by the others it asks:",
        ...TRIPS.flatMap((trip) => {
          const others = ROWS.filter(({ fn, entry }) => entry.kind === "check" && entry.to === trip.id && fn !== trip.id).map(({ fn }) => fn);
          return others.length === 0 ? [`${trip.id},`] : [trip.id, `(${others.join(", ")}),`];
        }),
      ],
      "  ",
    ),
    ...wrapped(["The functions a question asks run that question:", ...ROWS.flatMap(({ fn, entry }) => (entry.kind === "check" && !TRIPS.some((each) => each.id === entry.to) ? [`${fn} (${entry.to}),`] : []))], "  "),
    "",
    `Packages, each its functions and its questions: ${PACKAGES.join(", ")}.`,
  ];
}

/**
 * Asks the live API every function the sweep holds and every question, and prints for each what Apple did. Named
 * ones are asked alone; with none named, all that read, and those that write too with --write.
 *
 * @throws CliError with exit status 2 for a name that is not there, or a write named without --write; with 130 for Ctrl+C.
 */
export async function check(flags: tFlags, ctx: tContext, names: readonly string[]): Promise<number> {
  const { rows, checks } = chosen(names, flags.write === true);
  out(header());
  const examined = await examine(flags, ctx);
  if (examined === undefined) return 1;
  const { key, token, storefront } = examined;

  // The CLI's limit is on each request, so that a function that makes many, such as apply, is not cut off whole.
  const timed = (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    return fetch(req, { signal: AbortSignal.any([req.signal, AbortSignal.timeout(TIMEOUT_MS)]) });
  };
  // Ctrl+C, or a SIGTERM, stops what is under way, and the steps to undo it are printed all the same. Pressed again
  // before they are, it is let go by, not left to end the process with them unprinted.
  const stop = new AbortController();
  // The key is most likely the one the developer's app asks with too, and Apple counts its limit by the key: the run
  // keeps to a pace that leaves the app room, and stops at the first 429, since a run that went on would keep the key
  // limited for the app's listeners too.
  const limited = () => {
    stop.abort(new CliError("Apple is limiting requests for this key, so check stopped rather than keep it limited for your app's listeners too. Try again later.", 1));
  };
  const music = createServerClient({
    pem: key.pem,
    teamId: key.teamId,
    keyId: key.keyId,
    userToken: token,
    storefront,
    fetch: timed,
    rateLimit: createRateLimiter(PACE),
    onResponse: (res) => {
      if (res.status === 429) limited();
    },
  });

  const interrupt = () => {
    stop.abort(new CliError("Stopped.", 130));
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  let charts: Promise<tCharts> | undefined;
  const fromCharts = () =>
    (charts ??= getCharts(music, { types: ["songs", "albums", "playlists", "music-videos"], limit: 50, signal: stop.signal }).then(
      (body) => {
        const first = (type: string) => list(at(body, "results", type))[0];
        return {
          songs: itemsOf("songs", at(first("songs"), "data"), storefront),
          albums: itemsOf("albums", at(first("albums"), "data"), storefront),
          playlists: itemsOf("playlists", at(first("playlists"), "data"), storefront),
          musicVideos: itemsOf("music-videos", at(first("music-videos"), "data"), storefront),
          songsNext: text(at(first("songs"), "next")),
        };
      },
      (e: unknown) => {
        // Asked for again by the next check that needs them, rather than failing it too.
        charts = undefined;
        throw e;
      },
    ));
  const left: tLeft = { playlists: [], library: [], favorites: [], playlistsSongs: [], playlistSongs: undefined, ratings: [], folders: [] };
  const memo = new Map<string, Promise<unknown>>();
  const name = `${NAME} check ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`;
  const ask: tAsk = { music, storefront, signal: stop.signal, charts: fromCharts, memo };
  const counts = new Map<tMark, number>();
  const differences = new Map<string, Set<string>>();
  const print = ({ mark, label: id, words }: tLine) => {
    counts.set(mark, (counts.get(mark) ?? 0) + 1);
    const [sign, format] = MARKS[mark];
    out(`${format === undefined ? sign : paint(ctx, format, sign, process.stdout)} ${id}: ${words}`);
  };
  try {
    if (names.length === 0 && flags.write !== true) say("What writes to your library is left out; --write adds it.");
    if (checks.some((each) => each.writes))
      say(
        "--write: what is added stays, since Apple's API has no way to take it out of the library again: up to four things added to it, an album's songs with it, one song made a favorite, a playlist of up to 300 songs, which may put them in the library too, an empty playlist and a playlist folder. Ratings set are taken away again. The steps to remove the rest are printed at the end.",
      );
    if (rows.length > 0) say(`Asking ${plural(rows.length, "function")}, ten requests at a time…`);
    // Every row is asked at once, at the run's pace, and printed in order as the ones before it are done.
    const answers = new Map(rows.map((picked) => [picked, rowLines(ask, picked)]));
    for (const pkg of PACKAGES) {
      const own = rows.filter((each) => each.pkg === pkg);
      const asked = checks.filter((each) => each.pkg === pkg);
      if (own.length === 0 && asked.length === 0) continue;
      out("");
      out(pkg);
      for (const picked of own) {
        const done = await (answers.get(picked) as Promise<tRowLines | { readonly error: unknown }>);
        // Ctrl+C ends the run: core hands on the reason the signal aborted with, as it is.
        if ("error" in done) throw stop.signal.reason as Error;
        for (const why of done.whys) say(`  ${why}`);
        done.lines.forEach(print);
        for (const diff of done.diffs) differences.set(diff.said, (differences.get(diff.said) ?? new Set()).add(diff.label));
      }
      for (const each of asked) {
        const line = (mark: tMark, words: string) => {
          print({ mark, label: each.id, words });
        };
        say(`Asking: ${each.id}…`);
        try {
          await each.run({ music, storefront, signal: stop.signal, left, line, charts: fromCharts, memo, name, fetch: timed });
        } catch (e) {
          if (stop.signal.aborted) throw stop.signal.reason as Error;
          if (isAppleMusicError(e)) line("failed", `${brief(e)} (at ${whereOf(e)}), so this was not answered.`);
          else {
            // A bug, of check's or in what it was handed: said, and the checks after it still asked. What it threw may
            // name a path of the listener's, so it goes to stderr, with the person, not into the report.
            line("failed", "something went wrong that check did not expect, so this was not answered. This is a bug: please report it, with what stderr says.");
            say(inspect(e));
          }
        }
      }
    }
    out("");
    const tally = (["same", "differs", "failed", "skipped", "report"] as const).map((mark) => `${String(counts.get(mark) ?? 0)} ${MARKS[mark][0]}`).join(", ");
    out(`Asked ${plural(rows.length, "function")} and ${plural(checks.length, "check")}: ${tally}.`);
    if (differences.size > 0) {
      out("");
      out(`Differences from the types (${String(differences.size)}):`);
      for (const [diff, labels] of differences) {
        out(`  ${diff}`);
        out(`    ${[...labels].join(", ")}`);
      }
    }
  } finally {
    // Ratings are taken away through the API, each with the CLI's limit of its own: the run's signal may be the one
    // Ctrl+C aborted, and a second press is still let go by while they are.
    await undoRatings(left);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    cleanup(left);
  }
  return counts.has("differs") || counts.has("failed") ? 1 : 0;
}
