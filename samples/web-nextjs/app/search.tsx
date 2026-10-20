"use client";
// The search box, with terms offered as the listener types. A search is a
// page of its own, /search?term=, so Back goes back to the crates.
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type SubmitEvent } from "react";
import { searchHints } from "./actions";
import { useCrate } from "./crate";
import { say, showError } from "./status";

export function SearchForm() {
  const router = useRouter();
  // The term of the search open, as on a reload or by Back, in the box.
  const searched = useSearchParams().get("term") ?? "";
  const [typed, setTyped] = useState(searched);
  const [lastSearched, setLastSearched] = useState(searched);
  if (searched !== lastSearched) {
    setLastSearched(searched);
    setTyped(searched);
  }

  // Terms offered once typing pauses, rather than on every key, in the
  // storefront the page is drawn in.
  const text = typed.trim();
  const { storefront } = useCrate();
  const [hints, setHints] = useState<readonly string[]>([]);
  useEffect(() => {
    if (text === "" || storefront === undefined) return;
    let current = true;
    const typing = setTimeout(() => {
      searchHints(text, storefront).then((answered) => {
        if (!current) return;
        if (answered.ok) setHints(answered.value);
        else say(answered.said);
      }, showError);
    }, 250);
    return () => {
      current = false;
      clearTimeout(typing);
    };
  }, [text, storefront]);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (text === "") router.push("/");
    else router.push(`/search?term=${encodeURIComponent(text)}`);
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
        maxLength={200}
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
        }}
      />
      <datalist id="hints">
        {hints.map((term) => (
          <option key={term} value={term} />
        ))}
      </datalist>
      <button>Search</button>
    </form>
  );
}
