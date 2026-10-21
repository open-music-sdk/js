// What every page a crate opens shares: the way back, the heading, and what
// it says while Apple is asked.
import { isAppleMusicError, type tArtwork } from "@open-music-sdk/server";
import Link from "next/link";
import { Artwork } from "../artwork";
import { explain } from "../errors";

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

/**
 * A page that could not be pulled out, said in words: Apple's error, such as
 * a 404 for an album the storefront doesn't sell, or the SDK's refusal of an
 * id typed into the address. Anything else is thrown on, to the error page.
 */
export function CouldNot({ error }: { error: unknown }) {
  if (!isAppleMusicError(error) && !(error instanceof TypeError)) throw error;
  return <p>{explain(error)}</p>;
}

interface tHeadingProps {
  readonly name: string | undefined;
  readonly by: string | undefined;
  readonly artwork: tArtwork | undefined;
}

export function Heading({ name, by, artwork }: tHeadingProps) {
  return (
    <div className="heading">
      <Artwork artwork={artwork} width={240} alt="" loading="eager" />
      <h2>{name}</h2>
      <p>{by}</p>
    </div>
  );
}
