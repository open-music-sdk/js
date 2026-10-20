// Shows: playlists.resolve. Guide: /guides/import-playlist
import {
  useMusic,
  type tSkippedTrack,
  type tSong,
  type tTrackDescription,
} from "@open-music-sdk/react";
import {
  createContext,
  use,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SubmitEvent,
  type ReactNode,
} from "react";
import { Crate } from "./box";
import { say, showError } from "./errors";
import { useNow } from "./music";
import { usePlayFrom } from "./player";
import { SendForm } from "./send";
import type { tSleeve } from "./sleeve";

type tSkipped = tSkippedTrack<tTrackDescription>;

/** The songs in the crate, and the storefront they were found in. */
interface tHeld {
  readonly storefront: string;
  readonly picks: readonly tSong[];
  /** Which song is in front: the one last put in or moved. */
  readonly at: number;
}

interface tYourCrate {
  /** The songs picked so far, in order. Page state: a reload empties it. */
  readonly picks: readonly tSong[];
  readonly at: number;
  /** Whether the crate is empty again because the storefront changed. */
  readonly emptied: boolean;
  /** Puts a song in, found in this storefront. */
  readonly pick: (song: tSong, foundIn: string) => void;
  readonly move: (from: number, to: number) => void;
  readonly takeOut: (index: number) => void;
}

const YourCrate = createContext<tYourCrate | undefined>(undefined);

/**
 * Your crate, held for every screen: Dig puts songs in, and the crate's own
 * tab moves them, takes them out and sends them.
 */
export function CrateProvider({ children }: { children: ReactNode }) {
  const { storefront } = useNow();
  const [held, setHeld] = useState<tHeld>({ storefront, picks: [], at: 0 });
  // Another storefront has other ids, so the songs found in one are not shown
  // in another: the crate is empty again.
  const here = held.storefront === storefront;
  // The storefront now, for a song found after the page has left the
  // storefront it was asked in.
  const storefrontNow = useRef(storefront);
  useLayoutEffect(() => {
    storefrontNow.current = storefront;
  }, [storefront]);

  const crate = useMemo<tYourCrate>(() => {
    const pick = (song: tSong, foundIn: string) => {
      // Found in a storefront the page has left since: its id is not the one
      // the page shows.
      if (foundIn !== storefrontNow.current) return;
      setHeld((was) => {
        const picks = was.storefront === foundIn ? was.picks : [];
        const index = picks.findIndex(({ id }) => id === song.id);
        if (index !== -1) return { storefront: foundIn, picks, at: index };
        const added = [...picks, song];
        return { storefront: foundIn, picks: added, at: picks.length };
      });
      say(`${song.attributes?.name ?? "The song"} is in the crate.`);
    };
    const move = (from: number, to: number) => {
      setHeld((was) => {
        const picks = [...was.picks];
        picks.splice(to, 0, ...picks.splice(from, 1));
        return { ...was, picks, at: to };
      });
    };
    const takeOut = (index: number) => {
      setHeld((was) => {
        const picks = was.picks.filter((_, each) => each !== index);
        return { ...was, picks, at: index };
      });
    };
    return {
      picks: here ? held.picks : [],
      at: here ? held.at : 0,
      emptied: !here && held.picks.length > 0,
      pick,
      move,
      takeOut,
    };
  }, [held, here]);
  return <YourCrate value={crate}>{children}</YourCrate>;
}

export function useCrate(): tYourCrate {
  const crate = use(YourCrate);
  if (crate === undefined) throw new Error("useCrate: no CrateProvider above");
  return crate;
}

/**
 * Your crate, drawn as the others are, with the song last put in or moved in
 * front. Its order is the playlist's.
 */
export function CrateScreen() {
  const { picks, at, emptied, move, takeOut } = useCrate();
  const { signedIn } = useNow();
  const playFrom = usePlayFrom();

  const sleeves = picks.map((song, index): tSleeve => {
    const play = () => {
      playFrom(picks, song);
    };
    return {
      id: song.id,
      artwork: song.attributes?.artwork,
      name: song.attributes?.name ?? song.id,
      by: song.attributes?.artistName,
      open: play,
      actions: (
        <>
          <button type="button" onClick={play}>Play</button>
          <button
            type="button"
            disabled={index === 0}
            onClick={() => {
              move(index, index - 1);
            }}
          >
            Move earlier
          </button>
          <button
            type="button"
            disabled={index === picks.length - 1}
            onClick={() => {
              move(index, index + 1);
            }}
          >
            Move later
          </button>
          <button
            type="button"
            onClick={() => {
              takeOut(index);
            }}
          >
            Take out
          </button>
        </>
      ),
    };
  });

  const empty = emptied
    ? "Empty again: songs have other ids in another storefront."
    : "Empty. Put songs in from Dig, or paste a tracklist below.";
  return (
    <>
      <p>Songs you picked while digging. A reload empties the crate.</p>
      <div className="crates">
        <Crate label="Your crate" sleeves={sleeves} at={at} empty={empty} />
      </div>
      <PasteForm />
      {signedIn && picks.length > 0 && <SendForm picks={picks} />}
    </>
  );
}

function PasteForm() {
  const [text, setText] = useState("");
  const { find, skipped } = useFindTracklist();
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    find(text).catch(showError);
  };
  return (
    <>
      <form id="paste" onSubmit={submit}>
        <label htmlFor="tracklist">
          Or paste a tracklist, one track a line, as <em>Artist - Title</em>
        </label>
        <textarea
          id="tracklist"
          rows={5}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <button>Find these songs</button>
      </form>
      <Unmatched skipped={skipped} />
    </>
  );
}

/**
 * A description for each line written "Artist - Title", where the title may
 * hold " - " too. Any other line is left out.
 */
function parseTracklist(text: string): tTrackDescription[] {
  const descriptions: tTrackDescription[] = [];
  for (const line of text.split("\n")) {
    const [artistName = "", ...title] = line.split(" - ");
    if (title.length === 0) continue;
    descriptions.push({
      artistName: artistName.trim(),
      name: title.join(" - ").trim(),
    });
  }
  return descriptions;
}

// #region resolve
/**
 * Finds a pasted tracklist, one "Artist - Title" a line, in the catalog, and
 * puts the songs it finds in the crate. No sign-in needed: it asks the catalog
 * only.
 */
function useFindTracklist() {
  const music = useMusic();
  const { storefront } = useNow();
  const { pick } = useCrate();
  const [unmatched, setUnmatched] = useState<{
    readonly storefront: string;
    readonly skipped: readonly tSkipped[];
  }>({ storefront, skipped: [] });

  async function find(text: string): Promise<void> {
    const descriptions = parseTracklist(text);
    const { tracks, skipped } = await music.playlists.resolve(descriptions, {
      storefront,
      onProgress: ({ done, total = 0 }) => {
        say(`Finding songs: ${String(done)} of ${String(total)}.`);
      },
    });
    for (const song of tracks) pick(song, storefront);
    setUnmatched({ storefront, skipped });
    const found = `${String(tracks.length)} of ${String(descriptions.length)}`;
    say(`Found ${found} songs.`);
  }

  // The songs offered for lines found in another storefront are not offered
  // in this one.
  const here = unmatched.storefront === storefront;
  return { find, skipped: here ? unmatched.skipped : [] };
}

/**
 * A line with no exact match comes back with the songs its search found, best
 * first: each is offered with a button for the first three.
 */
function Unmatched({ skipped }: { skipped: readonly tSkipped[] }) {
  const { storefront } = useNow();
  const { pick } = useCrate();
  return (
    <ul>
      {skipped.map(({ track, candidates }, line) => (
        <li key={line}>
          Not found: {track.artistName ?? ""} - {track.name ?? ""}.{" "}
          {candidates.slice(0, 3).map((song) => (
            <button
              key={song.id}
              type="button"
              onClick={() => {
                pick(song, storefront);
              }}
            >
              Take {song.attributes?.name ?? song.id} by{" "}
              {song.attributes?.artistName ?? ""}
            </button>
          ))}
        </li>
      ))}
    </ul>
  );
}
// #endregion resolve
