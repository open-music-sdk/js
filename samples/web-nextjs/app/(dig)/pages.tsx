// What every page a crate opens shares: the way back, the heading, and what
// it says while Apple is asked.
import type { tArtwork } from "@open-music-sdk/server";
import Link from "next/link";
import { Cover } from "../artwork";

/** The link above every page a crate opens. */
export function BackToTheCrates() {
  return (
    <Link href="/" className="back">
      ‹ Back to the crates
    </Link>
  );
}

export function Pulling() {
  return <p>Pulling it out…</p>;
}

interface tHeadingProps {
  readonly name: string | undefined;
  readonly by: string | undefined;
  readonly artwork: tArtwork | undefined;
}

export function Heading({ name, by, artwork }: tHeadingProps) {
  return (
    <div className="heading">
      <Cover artwork={artwork} size={240} />
      <h2>{name}</h2>
      <p>{by}</p>
    </div>
  );
}
