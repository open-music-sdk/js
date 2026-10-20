// Shows: listRecentlyPlayed, listHeavyRotation, listPersonalRecommendations,
// listRecentlyAdded, listLibraryPlaylists, getLibraryPlaylist, searchLibrary,
// each asked by the server for the listener. Guide: /guides/store-user-tokens
import { isAppleMusicError, type tMusic } from "@open-music-sdk/server";
import { Suspense } from "react";
import { listener } from "@/lib/listener";
import { cards, playlistSleeves, type tSleeveData } from "@/lib/sleeves";
import { morePlaylists } from "../actions";
import { LinkCrate } from "../catalog";
import { explain } from "../errors";
import { FindForm } from "./find";

type tSearchParams = Promise<{
  playlist?: string | string[] | undefined;
  find?: string | string[] | undefined;
}>;

export default function LibraryPage({
  searchParams,
}: {
  searchParams: tSearchParams;
}) {
  return (
    <Suspense fallback={<p>Looking…</p>}>
      <Library searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * The listener's side, drawn on the server: each crate is streamed into the
 * page as its list arrives, and a list Apple won't give says why in its own
 * crate.
 */
async function Library({ searchParams }: { searchParams: tSearchParams }) {
  const you = await listener();
  if (you === undefined) {
    return <p>Sign in with Apple Music to see your library.</p>;
  }
  const { playlist, find } = await searchParams;
  const { user } = you.music;
  return (
    <>
      <FindForm />
      {typeof find === "string" && find.trim() !== "" && (
        <Found music={you.music} text={find.trim()} />
      )}
      <div className="crates">
        <ListCrate
          label="Recently played"
          read={() => recentlyPlayed(you.music)}
        />
        <ListCrate
          label="Heavy rotation"
          read={async () => cards(await first(
            user.listHeavyRotation({ limit: 10, maxPages: 1 }),
          ))}
        />
        <Suspense fallback={null}>
          <Recommended music={you.music} />
        </Suspense>
        <ListCrate
          label="Recently added"
          read={async () => cards(await first(
            user.listRecentlyAdded({ limit: 10, maxPages: 1 }),
          ))}
        />
        <ListCrate
          label="Your playlists"
          read={async () => playlistSleeves(await first(
            user.listLibraryPlaylists({ limit: 25, maxPages: 1 }),
          ))}
          more={morePlaylists}
          empty="No playlists in your library."
        />
      </div>
      {typeof playlist === "string" && (
        <Suspense fallback={<p>Looking…</p>}>
          <PlaylistTracks music={you.music} id={playlist} />
        </Suspense>
      )}
    </>
  );
}

// #region act-for-listener
/**
 * What the listener played lately, asked by the server with the token it
 * stored for them.
 */
async function recentlyPlayed(listener: tMusic): Promise<tSleeveData[]> {
  const played = listener.user.listRecentlyPlayed({ limit: 10, maxPages: 1 });
  return cards(await first(played));
}
// #endregion act-for-listener

interface tListCrateProps {
  readonly label: string;
  readonly read: () => Promise<tSleeveData[]>;
  readonly more?: Parameters<typeof LinkCrate>[0]["more"];
  readonly empty?: string;
}

/** A crate of one of the listener's lists, streamed in once it is read. */
function ListCrate(props: tListCrateProps) {
  const waiting = (
    <LinkCrate label={props.label} sleeves={[]} empty="Looking…" />
  );
  return (
    <Suspense fallback={waiting}>
      <ReadCrate {...props} />
    </Suspense>
  );
}

async function ReadCrate({ label, read, more, empty }: tListCrateProps) {
  let sleeves: tSleeveData[];
  try {
    sleeves = await read();
  } catch (e) {
    if (!isAppleMusicError(e)) throw e;
    return <LinkCrate label={label} sleeves={[]} empty={explain(e)} />;
  }
  return (
    <LinkCrate label={label} sleeves={sleeves} more={more} empty={empty} />
  );
}

/** A crate for each list Apple recommends, under the name Apple gives it. */
async function Recommended({ music }: { music: tMusic }) {
  let recommendations;
  try {
    recommendations = await first(
      music.user.listPersonalRecommendations({ limit: 3, maxPages: 1 }),
    );
  } catch (e) {
    if (!isAppleMusicError(e)) throw e;
    return <LinkCrate label="Made for you" sleeves={[]} empty={explain(e)} />;
  }
  return recommendations.map(({ id, attributes, relationships }) => (
    <LinkCrate
      key={id}
      label={attributes?.title?.stringForDisplay ?? "Made for you"}
      sleeves={cards(relationships?.contents?.data ?? [])}
    />
  ));
}

/**
 * A playlist of the listener's, with its tracks, under the crates. Songs in a
 * library have no previews.
 */
async function PlaylistTracks({ music, id }: { music: tMusic; id: string }) {
  let playlist;
  try {
    playlist = await music.user.getLibraryPlaylist(id, { include: ["tracks"] });
  } catch (e) {
    if (!isAppleMusicError(e)) throw e;
    return <p>{explain(e)}</p>;
  }
  const tracks = playlist.relationships?.tracks?.data ?? [];
  return (
    <>
      <h2>{playlist.attributes?.name ?? id}</h2>
      <ol className="tracklist">
        {/* A playlist can hold the same song twice. */}
        {tracks.map((track, place) => (
          <li key={`${String(place)}:${track.id}`}>
            <span className="name">
              {track.attributes?.name ?? track.id}
              <small>{track.attributes?.artistName ?? ""}</small>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

/** What the listener's library holds of a search. */
function Found({ music, text }: { music: tMusic; text: string }) {
  const nothing = "Nothing. Apple's library search finds a song by the first "
    + "word of its name more often than by the whole name.";
  return (
    <div className="crates">
      <ListCrate
        label={`In your library: "${text}"`}
        read={() => searchYourLibrary(music, text)}
        empty={nothing}
      />
    </div>
  );
}

async function searchYourLibrary(
  listener: tMusic,
  text: string,
): Promise<tSleeveData[]> {
  const { results } = await listener.user.searchLibrary(text, {
    types: ["library-songs", "library-albums"],
    limit: 10,
  });
  return cards([
    ...(results["library-songs"]?.data ?? []),
    ...(results["library-albums"]?.data ?? []),
  ]);
}

/** Every item of a walk, which here is one page of it. */
async function first<T>(walk: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of walk) items.push(item);
  return items;
}
