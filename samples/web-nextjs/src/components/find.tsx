"use client";
// The box that searches the listener's library: the search is in the address,
// /library?find=, and the server draws what it finds.
import { useRouter } from "next/navigation";
import { useState, type SubmitEvent } from "react";

export function FindForm() {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const text = typed.trim();
    if (text !== "") router.push(`/library?find=${encodeURIComponent(text)}`);
  };
  return (
    <form id="library-search" onSubmit={submit}>
      <input
        id="library-term"
        type="search"
        placeholder="Find in your library"
        aria-label="Find in your library"
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
        }}
      />
      <button>Find</button>
    </form>
  );
}
