// Shows: searchCatalog, getSearchHints.
import { useMusicQueries } from "@open-music-sdk/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type SubmitEvent } from "react";
import { Crate } from "./box";
import { useShowError } from "./errors";
import { useNow } from "./music";
import { sleeves } from "./pages";
import { SongCrate } from "./songs";
import { go, parseAddress, Pulling, useAddress } from "./view";

/**
 * The search box. A search is a page of its own, `#search/<term>`, so Back
 * goes back to the crates.
 */
export function SearchForm() {
  const { storefront } = useNow();
  const queries = useMusicQueries();
  // The term of a search opened by its address, as on a reload or by Back,
  // goes in the box.
  const address = useAddress();
  const searched = searchedIn(address);
  const [typed, setTyped] = useState(searched ?? "");
  const [lastAddress, setLastAddress] = useState(address);
  if (address !== lastAddress) {
    setLastAddress(address);
    if (searched !== undefined) setTyped(searched);
  }

  // Terms offered as the listener types, once typing pauses rather than on
  // every key.
  const text = typed.trim();
  const [paused, setPaused] = useState("");
  useEffect(() => {
    const typing = setTimeout(() => {
      setPaused(text);
    }, 250);
    return () => {
      clearTimeout(typing);
    };
  }, [text]);
  const hints = useQuery({
    ...queries.catalog.getSearchHints(paused, { storefront }),
    enabled: paused !== "",
  });
  useShowError(hints.error);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (text === "") location.hash = "";
    else go("search", text);
  };
  return (
    <form id="search" onSubmit={submit}>
      <input
        id="term"
        type="search"
        list="hints"
        placeholder="Search the catalog"
        autoComplete="off"
        aria-label="Search the catalog"
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
        }}
      />
      <datalist id="hints">
        {hints.data?.results.terms.map((term) => (
          <option key={term} value={term} />
        ))}
      </datalist>
      <button>Search</button>
    </form>
  );
}

/**
 * The term of the search the address opens, if it opens one, spelled as the
 * address has it when it does not decode.
 */
function searchedIn(address: string): string | undefined {
  const { kind, id } = parseAddress(address);
  if (kind !== "search") return undefined;
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

export function SearchPage({ id: text }: { id: string }) {
  const { storefront } = useNow();
  const queries = useMusicQueries();
  const search = useQuery(
    queries.catalog.searchCatalog(text, {
      types: ["songs", "albums", "artists", "playlists"],
      limit: 20,
      storefront,
    }),
  );
  if (search.data === undefined) return <Pulling query={search} />;
  const { songs, albums, artists, playlists } = search.data.results;
  return (
    <>
      <h2>Results for "{text}"</h2>
      <div className="crates">
        <SongCrate label="Songs" tracks={songs?.data ?? []} />
        <Crate label="Albums" sleeves={sleeves(albums?.data ?? [])} />
        <Crate label="Artists" sleeves={sleeves(artists?.data ?? [])} />
        <Crate label="Playlists" sleeves={sleeves(playlists?.data ?? [])} />
      </div>
    </>
  );
}
