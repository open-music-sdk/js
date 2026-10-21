"use client";
// Shows: playlists.resolve, through a server action. Guide:
// /guides/import-playlist
import type {
  tLibraryPlaylist,
  tSkippedTrack,
  tSong,
  tTrackDescription,
} from "@open-music-sdk/react";
import {
  createContext,
  use,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SubmitEvent,
} from "react";
import { findTracklist } from "@/lib/actions";
import { Crate } from "./box";
import { usePlayFrom } from "./player";
import { SendForm } from "./send";
import type { tSleeve } from "./sleeve";
import { say, showError } from "./status";

type tSkipped = tSkippedTrack<tTrackDescription>;

/** The songs in the crate, and the storefront they were found in. */
interface tHeld {
  readonly storefront: string | undefined;
  readonly picks: readonly tSong[];
  /** Which song is in front: the one last put in or moved. */
  readonly at: number;
  /** Counts each put in, move and take out, each bringing `at` to the front. */
  readonly turn: number;
  /** Whether the songs went because the storefront changed. */
  readonly emptied: boolean;
}

interface tYourCrate {
  /** The songs picked so far, in order. Page state: a reload empties it. */
  readonly picks: readonly tSong[];
  readonly at: number;
  readonly turn: number;
  /** Whether the crate is empty again because the storefront changed. */
  readonly emptied: boolean;
  /** Puts a song in, found in this storefront. */
  readonly pick: (song: tSong, foundIn: string) => void;
  readonly move: (from: number, to: number) => void;
  readonly takeOut: (index: number) => void;
  /** Whether the page asks in this storefront now. */
  readonly isCurrent: (storefront: string) => boolean;
  /** The storefront the server asks in now, once the header has said. */
  readonly storefront: string | undefined;
  /** Tells the crate the storefront the server asks in now. */
  readonly storefrontIs: (storefront: string) => void;
}

/** The lines of a paste with no exact match, and where they were looked for. */
interface tUnmatched {
  readonly storefront: string;
  readonly skipped: readonly tSkipped[];
}

const YourCrate = createContext<tYourCrate | undefined>(undefined);

/** The most songs the crate holds. */
const MOST = 500;

/**
 * Your crate, held for every page: Dig puts songs in, and the crate's own
 * page moves them, takes them out and sends them.
 */
export function CrateProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<string>();
  const [held, setHeld] = useState<tHeld>({
    storefront: undefined,
    picks: [],
    at: 0,
    turn: 0,
    emptied: false,
  });
  // Another storefront has other ids, so the crate empties when the storefront
  // changes, and says why.
  if (current !== undefined && held.storefront !== current) {
    setHeld({
      storefront: current,
      picks: [],
      at: 0,
      turn: held.turn + 1,
      emptied: held.picks.length > 0,
    });
  }
  // The storefront now, for a song found after the page has left the
  // storefront it was asked in.
  const storefrontNow = useRef<string>(undefined);

  const crate = useMemo<tYourCrate>(() => {
    const storefrontIs = (storefront: string) => {
      storefrontNow.current = storefront;
      setCurrent(storefront);
    };
    const isCurrent = (storefront: string) => {
      return storefront === storefrontNow.current;
    };
    const pick = (song: tSong, foundIn: string) => {
      // Found in a storefront the page has left since: its id is not the one
      // the page shows.
      if (!isCurrent(foundIn)) return;
      // The server sends at most 500 songs as a playlist, so the crate holds
      // no more.
      const full = held.picks.length >= MOST;
      if (full && !held.picks.some(({ id }) => id === song.id)) {
        say(`Your crate holds ${String(MOST)} songs at most.`);
        return;
      }
      setHeld((was) => {
        if (was.storefront !== foundIn) return was;
        const turn = was.turn + 1;
        const index = was.picks.findIndex(({ id }) => id === song.id);
        if (index !== -1) return { ...was, at: index, turn };
        const picks = [...was.picks, song];
        const at = was.picks.length;
        return { ...was, picks, at, turn, emptied: false };
      });
      say(`${song.attributes?.name ?? "The song"} is in the crate.`);
    };
    const move = (from: number, to: number) => {
      setHeld((was) => {
        const picks = [...was.picks];
        picks.splice(to, 0, ...picks.splice(from, 1));
        return { ...was, picks, at: to, turn: was.turn + 1 };
      });
    };
    const takeOut = (index: number) => {
      setHeld((was) => {
        const picks = was.picks.filter((_, each) => each !== index);
        return { ...was, picks, at: index, turn: was.turn + 1 };
      });
    };
    return {
      picks: held.picks,
      at: held.at,
      turn: held.turn,
      emptied: held.emptied,
      pick,
      move,
      takeOut,
      isCurrent,
      storefront: current,
      storefrontIs,
    };
  }, [held, current]);
  return <YourCrate value={crate}>{children}</YourCrate>;
}

export function useCrate(): tYourCrate {
  const crate = use(YourCrate);
  if (crate === undefined) throw new Error("useCrate: no CrateProvider above");
  return crate;
}

interface tCrateScreenProps {
  readonly signedIn: boolean;
  /** The listener's playlists they may add to. */
  readonly editable: readonly tLibraryPlaylist[];
}

/**
 * Your crate, drawn as the others are, with the song last put in or moved in
 * front. Its order is the playlist's.
 */
export function CrateScreen({ signedIn, editable }: tCrateScreenProps) {
  const { picks, at, turn, emptied, move, takeOut } = useCrate();
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
        <Crate
          label="Your crate"
          sleeves={sleeves}
          at={at}
          turn={turn}
          empty={empty}
        />
      </div>
      <PasteForm />
      {signedIn && picks.length > 0 && (
        <SendForm picks={picks} editable={editable} />
      )}
    </>
  );
}

function PasteForm() {
  const [text, setText] = useState("");
  const { find, unmatched } = useFindTracklist();
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
          maxLength={20_000}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <button>Find these songs</button>
      </form>
      {unmatched !== undefined && <Unmatched {...unmatched} />}
    </>
  );
}

// #region resolve
/**
 * Finds a pasted tracklist in the catalog, through the server, and puts the
 * songs it finds in the crate.
 */
function useFindTracklist() {
  const crate = useCrate();
  const [unmatched, setUnmatched] = useState<tUnmatched>();

  async function find(text: string): Promise<void> {
    // Looked for in the storefront the page is drawn in, once the header has
    // said which.
    const where = crate.storefront;
    if (where === undefined) return;
    say("Finding songs…");
    const answered = await findTracklist(text, where);
    if (!answered.ok) {
      say(answered.said);
      return;
    }
    const { storefront, tracks, skipped, leftOut } = answered.value;
    // Songs found in a storefront the page has left since have other ids than
    // the ones it shows.
    if (!crate.isCurrent(storefront)) return;
    for (const song of tracks) crate.pick(song, storefront);
    setUnmatched({ storefront, skipped });
    const found = `${String(tracks.length)} of `
      + String(tracks.length + skipped.length);
    const unasked = leftOut > 0
      ? ` The ${String(leftOut)} lines after the first 200 were not looked for.`
      : "";
    say(`Found ${found} songs.${unasked}`);
  }

  // The songs offered for lines found in another storefront are not offered
  // in this one.
  const here = unmatched?.storefront === crate.storefront;
  return { find, unmatched: here ? unmatched : undefined };
}

/**
 * A line with no exact match comes back with the songs its search found, best
 * first: each is offered with a button for the first three.
 */
function Unmatched({ storefront, skipped }: tUnmatched) {
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
