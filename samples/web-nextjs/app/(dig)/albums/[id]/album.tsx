"use client";
// Shows: useQuery over what the server prefetched. Guide:
// /guides/tanstack-query
import { schemas } from "@open-music-sdk/react";
import { useQuery } from "@tanstack/react-query";
import { useTransition, type ReactNode } from "react";
import { addToLibrary, favorite } from "../../../actions";
import { catalog } from "../../../providers";
import { SongRows } from "../../../songs";
import { say, showError } from "../../../status";
import { Heading, Pulling } from "../../pages";

interface tAlbumViewProps {
  readonly id: string;
  readonly storefront: string;
  readonly loved: readonly string[] | undefined;
  /** What the listener can do with it, drawn by the server. */
  readonly actions: ReactNode;
}

/**
 * The album, from the query the server prefetched: the same function and the
 * same arguments make the same key, so it is drawn without asking Apple.
 */
export function AlbumView({ id, storefront, loved, actions }: tAlbumViewProps) {
  const { data: album } = useQuery(
    catalog.getAlbum(id, {
      include: ["tracks"],
      storefront,
      schema: schemas.albumsResponse,
    }),
  );
  if (album === undefined) return <Pulling />;
  const { name, artistName, artwork } = album.attributes ?? {};
  const tracks = album.relationships?.tracks?.data ?? [];
  return (
    <>
      <Heading name={name} by={artistName} artwork={artwork} />
      {actions}
      <SongRows tracks={tracks} loved={loved} storefront={storefront} />
    </>
  );
}

/** Add album to library, unless it is there, and Favorite. */
export function AlbumButtons({ id, held }: { id: string; held: boolean }) {
  const [adding, startAdding] = useTransition();
  const [favoriting, startFavoriting] = useTransition();
  const add = () => {
    startAdding(async () => {
      const answered = await addToLibrary("albums", id).catch(showError);
      if (answered === undefined) return;
      if (!answered.ok) say(answered.said);
      else say("Added the album to your library. " + LATER);
    });
  };
  const makeFavorite = () => {
    startFavoriting(async () => {
      const answered = await favorite(id).catch(showError);
      if (answered === undefined) return;
      if (!answered.ok) say(answered.said);
      else say("Made the album a favorite, which adds it to your library "
        + "too. " + LATER);
    });
  };
  const library = held
    ? <span>In your library</span>
    : (
      <button type="button" disabled={adding} onClick={add}>
        Add album to library
      </button>
    );
  return (
    <p className="actions">
      {library}
      <button type="button" disabled={favoriting} onClick={makeFavorite}>
        Favorite
      </button>
    </p>
  );
}

/** Apple carries a write out after it answers, within seconds. */
const LATER = "It can take a few seconds to show.";
