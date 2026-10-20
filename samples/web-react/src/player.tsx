// Shows: usePreviewPlayer, artworkUrl. Guide: /guides/previews
import {
  artworkUrl,
  usePreviewPlayer,
  type tMusicVideo,
  type tSong,
} from "@open-music-sdk/react";
import { createContext, use, useCallback, type ReactNode } from "react";
import { say, showError } from "./errors";

type tTrack = tSong | tMusicVideo;
type tPlayFrom = (tracks: readonly tTrack[], track: tTrack) => void;

const PlayFrom = createContext<tPlayFrom | undefined>(undefined);

/**
 * One player for the page, and the bar along its foot. It plays the previews
 * of tracks already fetched, through an audio element of its own, and asks
 * Apple for nothing.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const player = usePreviewPlayer<tTrack>();
  const { state, load, play, pause, next, previous, seek, setVolume } = player;

  // #region play-from
  /**
   * Plays a list of tracks, from one of them. Called from a click: a browser
   * starts sound only after one.
   */
  const playFrom = useCallback(
    (tracks: readonly tTrack[], track: tTrack) => {
      // Tracks with no preview are left out of the queue, so the track's place
      // in the queue can differ from its place in the list.
      const { tracks: queue, skipped } = load(tracks);
      if (skipped.length > 0) {
        const count = String(skipped.length);
        say(`${count} of these tracks have no preview, and are left out.`);
      }
      const place = queue.indexOf(track);
      // The track clicked is one of those with no preview.
      if (place === -1) return;
      play(place).catch(showError);
    },
    [load, play],
  );
  // #endregion play-from

  // The state changes several times a second while a preview plays. Only this
  // component and the bar draw again for it: the pages under it get the same
  // playFrom each time.
  const { status, track, position, duration, volume } = state;
  const artwork = track?.attributes?.artwork;
  const playing = status === "playing";
  const toggle = () => {
    if (playing) pause();
    else play().catch(showError);
  };
  return (
    <PlayFrom value={playFrom}>
      {children}
      <footer id="player">
        {artwork !== undefined && (
          <img alt="" width={48} height={48} src={artworkUrl(artwork, 48)} />
        )}
        <div className="now">
          <strong>{track?.attributes?.name ?? "Nothing playing"}</strong>{" "}
          <span>{track?.attributes?.artistName}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            previous().catch(showError);
          }}
        >
          Previous
        </button>
        <button type="button" onClick={toggle}>
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={() => {
            next().catch(showError);
          }}
        >
          Next
        </button>
        <input
          id="position"
          type="range"
          min={0}
          max={duration || 30}
          step={0.1}
          value={position}
          aria-label="Position in the preview"
          onChange={(event) => {
            seek(Number(event.target.value));
          }}
        />
        <input
          id="volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          aria-label="Volume"
          onChange={(event) => {
            setVolume(Number(event.target.value));
          }}
        />
      </footer>
    </PlayFrom>
  );
}

/** Plays a list of tracks, from one of them: `playFrom(tracks, track)`. */
export function usePlayFrom(): tPlayFrom {
  const playFrom = use(PlayFrom);
  if (playFrom === undefined) {
    throw new Error("usePlayFrom: no PlayerProvider above");
  }
  return playFrom;
}
