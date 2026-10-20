// Shows: getSongRatings, setSongRating, deleteSongRating, addToLibrary,
// useMusic, useMutation. Guide: /guides/tanstack-query
import {
  useMusic,
  useMusicQueries,
  type tMusicVideo,
  type tSong,
} from "@open-music-sdk/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Crate } from "./box";
import { useCrate } from "./crate";
import { say, showError, useShowError } from "./errors";
import { useNow } from "./music";
import { usePlayFrom } from "./player";
import type { tSleeve } from "./sleeve";

type tTrack = tSong | tMusicVideo;

interface tLoved {
  readonly isLoved: (id: string) => boolean;
  readonly setLoved: (id: string, loving: boolean) => void;
}

interface tSongCrateProps {
  readonly label: string;
  readonly tracks: readonly tTrack[];
  readonly empty?: string | undefined;
}

/**
 * A crate of tracks. Pulling one out plays its preview; the one in front has
 * the buttons of `SongActions`.
 */
export function SongCrate({ label, tracks, empty }: tSongCrateProps) {
  const playFrom = usePlayFrom();
  const loved = useLoved(tracks);
  const sleeves = tracks.map((track): tSleeve => ({
    id: track.id,
    artwork: track.attributes?.artwork,
    name: track.attributes?.name ?? track.id,
    by: track.attributes?.artistName,
    open: () => {
      playFrom(tracks, track);
    },
    actions: <SongActions tracks={tracks} track={track} loved={loved} />,
  }));
  return <Crate label={label} sleeves={sleeves} empty={empty} />;
}

/**
 * An album's or a playlist's tracklist, as the back of its sleeve prints it,
 * each track with its buttons.
 */
export function SongRows({ tracks }: { tracks: readonly tTrack[] }) {
  const loved = useLoved(tracks);
  return (
    <ol className="tracklist">
      {tracks.map((track) => (
        <li key={track.id}>
          <span className="name">
            {track.attributes?.name ?? track.id}
            <small>{track.attributes?.artistName ?? ""}</small>
          </span>
          <SongActions tracks={tracks} track={track} loved={loved} />
        </li>
      ))}
    </ol>
  );
}

interface tSongActionsProps {
  readonly tracks: readonly tTrack[];
  readonly track: tTrack;
  readonly loved: tLoved;
}

/**
 * Play and Into the crate, and, once someone is signed in, Love and Add to
 * library. A music video has neither Into the crate nor Love.
 */
function SongActions({ tracks, track, loved }: tSongActionsProps) {
  const playFrom = usePlayFrom();
  const { pick } = useCrate();
  const { signedIn, storefront } = useNow();
  const play = () => {
    playFrom(tracks, track);
  };
  if (track.type !== "songs") {
    return (
      <>
        <button type="button" onClick={play}>Play</button>
        {signedIn && <AddToLibrary track={track} />}
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
      {signedIn && <Love id={track.id} loved={loved} />}
      {signedIn && <AddToLibrary track={track} />}
    </>
  );
}

/**
 * Which of these songs the listener loves, from one request for all of them,
 * and the hearts clicked since. Songs never rated are left out.
 */
function useLoved(tracks: readonly tTrack[]): tLoved {
  const { signedIn } = useNow();
  const queries = useMusicQueries();
  const songs = tracks.filter((track) => track.type === "songs");
  const ids = songs.map((song) => song.id).slice(0, 300);
  const { data: ratings = [], error } = useQuery({
    ...queries.user.getSongRatings(ids),
    enabled: signedIn && ids.length > 0,
  });
  // The hearts are an extra: songs whose ratings Apple will not give are drawn
  // without them, and the page says why.
  useShowError(error);
  const [clicked, setClicked] = useState<ReadonlyMap<string, boolean>>(
    new Map(),
  );
  const isLoved = (id: string) => {
    const rating = ratings.find((each) => each.id === id);
    return clicked.get(id) ?? rating?.attributes?.value === 1;
  };
  const setLoved = (id: string, loving: boolean) => {
    setClicked((was) => new Map(was).set(id, loving));
  };
  return { isLoved, setLoved };
}

/**
 * A heart that loves the song, a rating of 1, or takes the rating away again.
 * It changes as soon as it is clicked, and back if Apple refuses, so a heart
 * drawn again before Apple answers shows what the listener asked for.
 */
function Love({ id, loved }: { id: string; loved: tLoved }) {
  const music = useMusic();
  const love = useMutation({
    mutationFn: async (loving: boolean) => {
      if (loving) await music.user.setSongRating(id, 1);
      else await music.user.deleteSongRating(id);
    },
    onMutate: (loving) => {
      loved.setLoved(id, loving);
    },
    onError: (e, loving) => {
      loved.setLoved(id, !loving);
      showError(e);
    },
  });
  const loving = loved.isLoved(id);
  return (
    <button
      type="button"
      aria-pressed={loving}
      onClick={() => {
        love.mutate(!loving);
      }}
    >
      {loving ? "Loved" : "Love"}
    </button>
  );
}

// #region add-to-library
/**
 * Adds a track to the listener's library. `useMusic()` is bound to the
 * listener once they have signed in, and Apple accepts the request at once and
 * adds the track afterwards, within seconds.
 */
function AddToLibrary({ track }: { track: tTrack }) {
  const music = useMusic();
  const add = useMutation({
    mutationFn: () => {
      const ids = track.type === "songs"
        ? { songs: [track.id] }
        : { "music-videos": [track.id] };
      return music.user.addToLibrary(ids);
    },
    onSuccess: () => {
      const name = track.attributes?.name ?? "it";
      say(
        `Added ${name} to your library. `
          + "It can take a few seconds to show there.",
      );
    },
    onError: showError,
  });
  return (
    <button
      type="button"
      disabled={add.isPending}
      onClick={() => {
        add.mutate();
      }}
    >
      Add to library
    </button>
  );
}
// #endregion add-to-library
