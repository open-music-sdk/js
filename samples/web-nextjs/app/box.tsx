"use client";
// The crate every list is drawn as: sleeves standing in a box, flipped through
// one at a time. Nothing here asks Apple.
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type Ref,
} from "react";
import { SleeveButton, type tSleeve } from "./sleeve";

interface tCrateProps {
  /** The label taped on the crate: the list's name. */
  readonly label: string;
  readonly sleeves: readonly tSleeve[];
  /**
   * Which sleeve is in front: to begin with, and again each time it changes,
   * as it does in your crate when a song moves.
   */
  readonly at?: number;
  /**
   * Asks for the next sleeves, as the listener nears the back of the crate.
   * They arrive as more `sleeves`. None means there are no more.
   */
  readonly more?: (() => void) | undefined;
  /** Whether the crate waits for sleeves it has asked for. */
  readonly looking?: boolean;
  /** What the crate says when empty. */
  readonly empty?: string | undefined;
  readonly ref?: Ref<HTMLDivElement>;
}

/** How far a swipe goes, in CSS pixels, to flip one sleeve. */
const SWIPE = 40;

/**
 * A labelled crate of sleeves, flipped through with its buttons, the arrow
 * keys, a swipe, or a click on an edge.
 */
export function Crate(props: tCrateProps) {
  const { label, sleeves, at = 0, more, looking = false, ref } = props;
  const { empty = "Nothing in this one." } = props;
  const [front, setFront] = useState(at);
  // A new `at` brings that sleeve to the front.
  const [lastAt, setLastAt] = useState(at);
  if (at !== lastAt) {
    setLastAt(at);
    setFront(at);
  }
  // Sleeves can go, as a song taken out of your crate does, so the one in
  // front is never past the last.
  const last = sleeves.length - 1;
  const clamp = (index: number) => Math.max(0, Math.min(index, last));
  const shown = clamp(front);
  const sleeve = sleeves[shown];

  const bin = useRef<HTMLDivElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  // Where focus goes once the sleeve in front changes: back to the action of
  // this name, or to the sleeve when it is "".
  const refocus = useRef<string | undefined>(undefined);
  const swipeFrom = useRef<number | undefined>(undefined);
  const swiped = useRef(false);
  const askedAt = useRef(-1);

  // Focus on a sleeve, or on an action of the record that leaves the front,
  // goes to the sleeve in front: the arrow keys keep flipping, and Tab reaches
  // its actions.
  function noteFocus(): void {
    const focused = document.activeElement;
    const inBin = bin.current?.contains(focused) ?? false;
    const inActions = actions.current?.contains(focused) ?? false;
    if (inBin || inActions) refocus.current = "";
  }

  // An action used on the sleeve in front, such as Move earlier in your
  // crate: once the crate is drawn again, focus goes back to the action of the
  // same name, so the song can be moved on with the keyboard.
  function noteAction(event: MouseEvent): void {
    const { target } = event;
    if (target instanceof HTMLButtonElement) {
      refocus.current = target.textContent;
    }
  }

  function flipTo(index: number): void {
    noteFocus();
    setFront(clamp(index));
  }

  function flipBy(step: number): void {
    noteFocus();
    setFront((was) => clamp(clamp(was) + step));
  }

  const frontId = sleeve?.id;
  useEffect(() => {
    const name = refocus.current;
    refocus.current = undefined;
    if (name === undefined) return;
    // Focus the listener has taken somewhere else stays there.
    const focused = document.activeElement;
    const lost = focused === null || focused === document.body;
    const inBin = bin.current?.contains(focused) ?? false;
    const inActions = actions.current?.contains(focused) ?? false;
    if (!lost && !inBin && !inActions) return;
    // An action disabled now, as Move earlier is for the first song, gives
    // focus to the sleeve.
    const all = actions.current?.querySelectorAll("button") ?? [];
    const same = [...all].find(
      (each) => each.textContent === name && !each.disabled,
    );
    (same ?? buttons.current[shown])?.focus({ preventScroll: true });
  }, [shown, frontId]);

  // Asked once for each length the crate reaches: an answer with no more
  // sleeves, or a failure, is not asked for again.
  useEffect(() => {
    const nearTheBack = shown >= sleeves.length - 3;
    if (more === undefined || !nearTheBack) return;
    if (askedAt.current === sleeves.length) return;
    askedAt.current = sleeves.length;
    more();
  }, [more, shown, sleeves.length]);

  // In front, a click pulls the sleeve out; behind, it flips forward to that
  // sleeve. The click that ends a swipe is not a click on a sleeve, though
  // Enter afterwards is: a click from a key has no `detail`.
  function pull(index: number, event: MouseEvent): void {
    if (swiped.current && event.detail > 0) return;
    if (index === shown) sleeves[index]?.open?.();
    else flipTo(index);
  }

  // A swipe across the sleeves flips one for each SWIPE pixels it goes: to the
  // left for the next, to the right back.
  function startSwipe(event: PointerEvent): void {
    swipeFrom.current = event.clientX;
    swiped.current = false;
  }
  function moveSwipe(event: PointerEvent): void {
    const from = swipeFrom.current;
    if (from === undefined) return;
    if (Math.abs(event.clientX - from) < SWIPE) return;
    flipBy(event.clientX < from ? 1 : -1);
    swipeFrom.current = event.clientX;
    swiped.current = true;
  }
  function endSwipe(): void {
    swipeFrom.current = undefined;
  }

  // Left and right only: up and down still scroll the page.
  function onKeyDown(event: KeyboardEvent): void {
    switch (event.key) {
      case "ArrowLeft":
        flipBy(-1);
        break;
      case "ArrowRight":
        flipBy(1);
        break;
      case "Home":
        flipTo(0);
        break;
      case "End":
        flipTo(last);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const count = sleeves.length === 0
    ? ""
    : `${String(shown + 1)} / ${String(sleeves.length)}`;
  return (
    <div
      ref={ref}
      className="crate"
      role="group"
      aria-label={label}
      aria-roledescription="crate"
      onKeyDown={onKeyDown}
    >
      <div
        ref={bin}
        className="bin"
        onPointerDown={startSwipe}
        onPointerMove={moveSwipe}
        onPointerUp={endSwipe}
        onPointerCancel={endSwipe}
        onPointerLeave={endSwipe}
      >
        <p className="empty" hidden={sleeve !== undefined}>
          {looking ? "Looking…" : empty}
        </p>
        {sleeves.map((each, index) => (
          <SleeveButton
            key={each.id}
            ref={(button) => {
              buttons.current[index] = button;
            }}
            sleeve={each}
            d={index - shown}
            onClick={(event) => {
              pull(index, event);
            }}
          />
        ))}
      </div>
      <div className="wall">
        <h3>{label}</h3>
      </div>
      <div className="flip">
        <button
          type="button"
          aria-label="Previous record"
          disabled={shown === 0}
          onClick={() => {
            flipBy(-1);
          }}
        >
          ‹
        </button>
        <span>{count}</span>
        <button
          type="button"
          aria-label="Next record"
          disabled={shown >= last}
          onClick={() => {
            flipBy(1);
          }}
        >
          ›
        </button>
      </div>
      <div className="caption">
        {/* What a screen reader says on a flip: the name and the artist, once
            for each record that comes to the front. */}
        <div className="said" aria-live="polite">
          {sleeve !== undefined && (
            <>
              <strong>{sleeve.name}</strong>
              <small>{sleeve.by ?? ""}</small>
            </>
          )}
        </div>
        {/* Drawn afresh for each record that comes to the front. */}
        <div
          ref={actions}
          key={frontId}
          className="actions"
          onClickCapture={noteAction}
        >
          {sleeve?.actions}
        </div>
      </div>
    </div>
  );
}
