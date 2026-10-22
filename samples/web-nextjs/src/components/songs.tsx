"use client";
// Songs in a crate or on the back of a sleeve, and what the listener does with
// them: Love and Add to library run on the server, as server actions.
import type { tMusicVideo, tSong } from "@open-music-sdk/react";
import { useState, useTransition } from "react";
import { addToLibrary, love } from "@/lib/actions";
import { Crate } from "./box";
import { useCrate } from "./crate";
import { usePlayFrom } from "./player";
import type { tSleeve } from "./sleeve";
import { say, showError } from "./status";

type tTrack = tSong | tMusicVideo;

interface tLoved {
  readonly isLoved: (id: string) => boolean;
  readonly setLoved: (id: string, loving: boolean) => void;
}

interface tSongsProps {
  readonly tracks: readonly tTrack[];
  /**
   * The songs among them the listener loves, as the server found them;
   * undefined while no one is signed in.
   */
  readonly loved: readonly string[] | undefined;
  /** The storefront they were asked in, whose ids they carry. */
  readonly storefront: string;
}

interface tSongCrateProps extends tSongsProps {
  readonly label: string;
  readonly empty?: string | undefined;
}

/**
 * A crate of tracks. Pulling one out plays its preview; the one in front has
 * the buttons of `SongActions`.
 */
export function SongCrate(props: tSongCrateProps) {
  const { label, tracks, storefront, empty } = props;
  const playFrom = usePlayFrom();
  const loved = useLoved(props.loved);
  const sleeves = tracks.map((track): tSleeve => ({
    id: track.id,
    artwork: track.attributes?.artwork,
    name: track.attributes?.name ?? track.id,
    by: track.attributes?.artistName,
    open: () => {
      playFrom(tracks, track);
    },
    actions: (
      <SongActions
        tracks={tracks}
        track={track}
        loved={loved}
        storefront={storefront}
      />
    ),
  }));
  return <Crate label={label} sleeves={sleeves} empty={empty} />;
}

/**
 * An album's or a playlist's tracklist, as the back of its sleeve prints it,
 * each track with its buttons.
 */
export function SongRows(props: tSongsProps) {
  const { tracks, storefront } = props;
  const loved = useLoved(props.loved);
  return (
    <ol className="tracklist">
      {/* A playlist can hold the same song twice. */}
      {tracks.map((track, place) => (
        <li key={`${String(place)}:${track.id}`}>
          <span className="name">
            {track.attributes?.name ?? track.id}
            <small>{track.attributes?.artistName ?? ""}</small>
          </span>
          <SongActions
            tracks={tracks}
            track={track}
            loved={loved}
            storefront={storefront}
          />
        </li>
      ))}
    </ol>
  );
}

interface tSongActionsProps extends Omit<tSongsProps, "loved"> {
  readonly track: tTrack;
  /** Undefined while no one is signed in. */
  readonly loved: tLoved | undefined;
}

/**
 * Play and Into the crate, and, once someone is signed in, Love and Add to
 * library. A music video has neither Into the crate nor Love.
 */
function SongActions(props: tSongActionsProps) {
  const { tracks, track, loved, storefront } = props;
  const playFrom = usePlayFrom();
  const { pick } = useCrate();
  const play = () => {
    playFrom(tracks, track);
  };
  if (track.type !== "songs") {
    return (
      <>
        <button type="button" onClick={play}>Play</button>
        {loved !== undefined && <AddToLibrary track={track} />}
      </>
    );
  }
  const intoTheCrate = () => {
    pick(track, storefront);
  };
  return (
    <>
      <button type="button" onClick={play}>Play</button>
      <button type="button" onClick={intoTheCrate}>Into the crate</button>
      {loved !== undefined && <Love id={track.id} loved={loved} />}
      {loved !== undefined && <AddToLibrary track={track} />}
    </>
  );
}

/**
 * The hearts: what the server found the listener loves, and the ones clicked
 * since. Undefined while no one is signed in.
 */
function useLoved(found: readonly string[] | undefined): tLoved | undefined {
  const [clicked, setClicked] = useState<ReadonlyMap<string, boolean>>(
    new Map(),
  );
  if (found === undefined) return undefined;
  return {
    isLoved: (id) => clicked.get(id) ?? found.includes(id),
    setLoved: (id, loving) => {
      setClicked((was) => new Map(was).set(id, loving));
    },
  };
}

/**
 * A heart that loves the song, a rating of 1, or takes the rating away again.
 * It changes as soon as it is clicked, and back if Apple refuses, so a heart
 * drawn again before Apple answers shows what the listener asked for.
 */
function Love({ id, loved }: { id: string; loved: tLoved }) {
  const loving = loved.isLoved(id);
  const toggle = () => {
    const wanted = !loving;
    loved.setLoved(id, wanted);
    love(id, wanted).then(
      (answered) => {
        if (answered.ok) return;
        loved.setLoved(id, !wanted);
        say(answered.said);
      },
      (e: unknown) => {
        loved.setLoved(id, !wanted);
        showError(e);
      },
    );
  };
  return (
    <button type="button" aria-pressed={loving} onClick={toggle}>
      {loving ? "Loved" : "Love"}
    </button>
  );
}

/**
 * Adds a track to the listener's library, through the server action of the
 * same name. Apple accepts the request at once, and adds the track afterwards,
 * within seconds.
 */
function AddToLibrary({ track }: { track: tTrack }) {
  const [pending, startTransition] = useTransition();
  const add = () => {
    startTransition(async () => {
      try {
        const answered = await addToLibrary(track.type, track.id);
        if (!answered.ok) {
          say(answered.said);
          return;
        }
        const name = track.attributes?.name ?? "it";
        say(
          `Added ${name} to your library. `
            + "It can take a few seconds to show there.",
        );
      } catch (e) {
        showError(e);
      }
    });
  };
  return (
    <button type="button" disabled={pending} onClick={add}>
      Add to library
    </button>
  );
}
