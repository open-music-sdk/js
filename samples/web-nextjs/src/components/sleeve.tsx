"use client";
// One record in a crate: what it holds, how it is drawn, and where it stands.
// Nothing here asks Apple.
import type { tArtwork } from "@open-music-sdk/react";
import type { CSSProperties, MouseEvent, ReactNode, Ref } from "react";
import { Artwork } from "./artwork";

/**
 * A record: its cover and names, what pulling it out does, and what can be done
 * with it while it is in front.
 */
export interface tSleeve {
  /** Tells the sleeve from the others in its crate. */
  readonly id: string;
  readonly artwork: tArtwork | undefined;
  readonly name: string;
  readonly by?: string | undefined;
  readonly open?: (() => void) | undefined;
  readonly actions?: ReactNode;
}

/** How many sleeves stand behind the one in front with their tops showing. */
const BEHIND = 5;

interface tSleeveButtonProps {
  readonly sleeve: tSleeve;
  /** How many places from the front it stands: behind it, or flipped past. */
  readonly d: number;
  readonly onClick: (event: MouseEvent) => void;
  readonly ref: Ref<HTMLButtonElement>;
}

/**
 * A sleeve's button, `d` places from the front: behind it when `d` is
 * positive, flipped past when it is negative. The stylesheet draws each place,
 * from `data-pos` and `--d`. A record with no artwork is a plain sleeve with
 * its name written on.
 */
export function SleeveButton({ sleeve, d, onClick, ref }: tSleeveButtonProps) {
  const { name, by, artwork } = sleeve;
  const label = by === undefined ? name : `${name}, ${by}`;
  // The cover in front is loaded at once, as next/image asks of an image that
  // may be the largest on the screen; the ones behind wait until they near it.
  const face = artwork === undefined
    ? <span>{name}</span>
    : (
      <Artwork
        artwork={artwork}
        width={240}
        alt=""
        loading={d === 0 ? "eager" : "lazy"}
      />
    );
  return (
    <button
      ref={ref}
      type="button"
      className="sleeve"
      aria-label={label}
      data-pos={placeOf(d)}
      style={{ "--d": d } as CSSProperties}
      // Only the sleeve in front is in the Tab order, and only it and the ones
      // whose edges show can be clicked.
      tabIndex={d === 0 ? 0 : -1}
      inert={d < 0 || d > BEHIND}
      onClick={onClick}
    >
      {face}
    </button>
  );
}

function placeOf(d: number): string {
  if (d < 0) return "past";
  if (d === 0) return "front";
  if (d <= BEHIND) return "behind";
  return "far";
}
