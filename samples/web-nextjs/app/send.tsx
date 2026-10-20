"use client";
// Shows: playlists.plan and playlists.apply, through server actions. Guide:
// /guides/import-playlist
import type { tLibraryPlaylist, tSong } from "@open-music-sdk/react";
import { useRef, useState, useTransition, type SubmitEvent } from "react";
import { planCrate, sendCrate, type tTarget } from "./actions";
import { say, showError } from "./status";

const APP_NAME = "Vinyl Collector Simulator";

interface tSendFormProps {
  readonly picks: readonly tSong[];
  /** The listener's playlists they may add to. */
  readonly editable: readonly tLibraryPlaylist[];
}

/**
 * The form that sends the crate to Apple Music, and the dialog that shows the
 * plan before anything is sent. The server reads the playlist, plans and
 * applies; the page sends it the songs' ids.
 */
export function SendForm({ picks, editable }: tSendFormProps) {
  const [to, setTo] = useState<"new" | "existing">("new");
  const [name, setName] = useState(APP_NAME);
  const [existing, setExisting] = useState("");
  const [planned, setPlanned] = useState<tPlanned>();
  const [sending, startSending] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);

  /** The playlist the form names. */
  function chosenPlaylist(): tTarget {
    const typed = name.trim() || APP_NAME;
    const picked = existing || editable[0]?.id;
    if (to === "existing" && picked !== undefined) return { id: picked };
    // A playlist this page made is planned by its id, in case Apple does not
    // list it yet.
    const id = made.get(typed);
    return id === undefined ? { name: typed } : { id };
  }

  /** Shows the plan, in a dialog, before anything is sent. */
  function showPlan(next: tPlanned): void {
    setPlanned(next);
    if (dialog.current === null) return;
    // Esc closes the dialog without a value of its own, so the value an
    // earlier "Send it" left must not count.
    dialog.current.returnValue = "";
    dialog.current.showModal();
  }

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const ids = picks.map((song) => song.id);
    planFor(ids, chosenPlaylist()).then(showPlan, showError);
  };

  // The listener closed the dialog: with "Send it" the crate is sent as
  // planned, and with Cancel or Esc nothing is.
  const closed = () => {
    const plan = planned;
    setPlanned(undefined);
    if (dialog.current?.returnValue !== "apply") return;
    if (plan === undefined) return;
    startSending(async () => {
      await send(plan).catch(showError);
    });
  };

  return (
    <>
      <form id="send" onSubmit={submit}>
        <h3>Send the crate to Apple Music</h3>
        <label>
          <input
            type="radio"
            name="to"
            checked={to === "new"}
            onChange={() => {
              setTo("new");
            }}
          />{" "}
          A new playlist named{" "}
          <input
            value={name}
            maxLength={100}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </label>
        <label>
          <input
            type="radio"
            name="to"
            checked={to === "existing"}
            onChange={() => {
              setTo("existing");
            }}
          />{" "}
          One of your playlists{" "}
          <select
            value={existing}
            onChange={(event) => {
              setExisting(event.target.value);
            }}
          >
            {editable.map(({ id, attributes }) => (
              <option key={id} value={id}>
                {attributes?.name}
              </option>
            ))}
          </select>
        </label>
        <button disabled={sending}>Plan it</button>
      </form>
      <dialog ref={dialog} onClose={closed}>
        <form method="dialog">
          <h3>The plan</h3>
          <ul>
            {planned?.lines.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <button value="cancel">Cancel</button>
          <button value="apply">Send it</button>
        </form>
      </dialog>
    </>
  );
}

/** A plan the server made, in words, and what it was made for. */
interface tPlanned {
  readonly ids: readonly string[];
  readonly target: tTarget;
  readonly lines: readonly string[];
}

// #region plan
// Sending starts with a plan the listener sees before anything is written. The
// server reads the playlist and plans; the page shows the plan in words.
async function planFor(
  ids: readonly string[],
  target: tTarget,
): Promise<tPlanned> {
  say("Planning…");
  const answered = await planCrate(ids, target);
  if (!answered.ok) throw new Error(answered.said);
  say("");
  return { ids, target, lines: answered.value };
}
// #endregion plan

// #region apply
/**
 * The ids of the playlists this page made, by name. Apple lists a new playlist
 * only seconds after it is made, and a plan by its name before then would make
 * a second one.
 */
const made = new Map<string, string>();

/**
 * Sends the crate as planned. Plan it waits while a send is pending: a second,
 * before Apple shows what the first wrote, would write it again.
 */
async function send({ ids, target }: tPlanned): Promise<void> {
  say("Sending…");
  const answered = await sendCrate(ids, target);
  if (!answered.ok) throw new Error(answered.said);
  // A playlist this page made is planned by its id from now on.
  if ("name" in target) made.set(target.name, answered.value.id);
  say(answered.value.said);
}
// #endregion apply
