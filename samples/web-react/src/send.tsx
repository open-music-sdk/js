// Shows: playlists.read, playlists.plan, playlists.apply, listLibraryPlaylists,
// useMutation. Guide: /guides/import-playlist
import {
  useMusic,
  useMusicQueries,
  type tBrowserMusic,
  type tLibraryPlaylist,
  type tNewPlaylist,
  type tPlaylistPlan,
  type tPlaylistSnapshot,
  type tSong,
} from "@open-music-sdk/react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { useRef, useState, type SubmitEvent } from "react";
import { say, showError, useShowError } from "./errors";

const APP_NAME = "Vinyl Collector Simulator";

/**
 * The playlist the form names: one of the listener's, by its id, or a new one,
 * by its name.
 */
interface tChosen {
  readonly name: string;
  readonly id: string | undefined;
}

interface tPlanned {
  readonly plan: tPlaylistPlan;
  /** The plan in words, for the listener to read before anything is sent. */
  readonly lines: readonly string[];
}

/**
 * The form that sends the crate to Apple Music, and the dialog that shows the
 * plan before anything is sent.
 */
export function SendForm({ picks }: { picks: readonly tSong[] }) {
  const music = useMusic();
  const editable = useEditablePlaylists();
  const sending = useSend();
  const [to, setTo] = useState<"new" | "existing">("new");
  const [name, setName] = useState(APP_NAME);
  const [existing, setExisting] = useState("");
  const [planned, setPlanned] = useState<tPlanned>();
  const dialog = useRef<HTMLDialogElement>(null);

  function chosenPlaylist(): tChosen {
    const typed = name.trim() || APP_NAME;
    if (to === "existing") {
      return { name: typed, id: existing || editable[0]?.id };
    }
    // A playlist this page made is planned by its id, in case Apple does not
    // list it yet.
    return { name: typed, id: madeFor(music).get(typed) };
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
    planFor(music, picks, chosenPlaylist()).then(showPlan, showError);
  };

  // The listener closed the dialog: with "Send it" the plan is applied, and
  // with Cancel or Esc nothing is sent.
  const closed = () => {
    const plan = planned?.plan;
    setPlanned(undefined);
    if (dialog.current?.returnValue !== "apply") return;
    if (plan !== undefined) sending.mutate(plan);
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
        <button disabled={sending.isPending}>Plan it</button>
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

/** The listener's playlists they may add to, among the first 100. */
function useEditablePlaylists(): tLibraryPlaylist[] {
  const queries = useMusicQueries();
  const { data, error } = useInfiniteQuery(
    queries.user.listLibraryPlaylists({ limit: 100 }),
  );
  useShowError(error);
  const first = data?.pages[0]?.data ?? [];
  return first.filter(({ attributes }) => attributes?.canEdit === true);
}

// #region plan
// Sending starts with a plan the listener sees before anything is written:
// Apple's API can add songs to the end of a playlist, but can neither take one
// out nor move one.
async function planFor(
  listener: tBrowserMusic,
  picks: readonly tSong[],
  { name, id }: tChosen,
): Promise<tPlanned> {
  // A playlist that is there is read first, for the tracks it holds. A new one
  // is found again by its name and description, so the description carries the
  // app's mark.
  const playlist = id !== undefined
    ? await listener.playlists.read(id)
    : { name, description: `Made with ${APP_NAME}` };
  const plan = listener.playlists.plan(playlist, picks);
  return { plan, lines: describe(plan, playlist, name) };
}

/**
 * The plan in words: what goes on the playlist's end, and what stays as it is.
 */
function describe(
  plan: tPlaylistPlan,
  playlist: tPlaylistSnapshot | tNewPlaylist,
  name: string,
): string[] {
  const lines: string[] = [];
  if ("id" in playlist) {
    lines.push(`Into "${playlist.name ?? name}".`);
  } else {
    lines.push(
      `Into a new playlist named "${name}", `
        + "unless you have one of that name made here.",
    );
  }
  const appended = String(plan.append.length);
  const already = String(plan.tracks.length - plan.append.length);
  lines.push(
    `${appended} songs go on its end, and ${already} are in it already.`,
  );
  if (plan.extra.length > 0) {
    const extra = String(plan.extra.length);
    lines.push(
      `${extra} songs in it that are not in the crate stay, `
        + "since none can be taken out.",
    );
  }
  if (plan.reordered) {
    lines.push(
      "It will hold the songs in another order than the crate, "
        + "since none can be moved.",
    );
  }
  return lines;
}
// #endregion plan

// #region apply
/**
 * The ids of the playlists this page made, by name, for each listener: each
 * sign-in has a client of its own. Apple lists a new playlist only seconds
 * after it is made, and a plan by its name before then would make a second
 * one.
 */
const made = new WeakMap<tBrowserMusic, Map<string, string>>();

function madeFor(listener: tBrowserMusic): Map<string, string> {
  const playlists = made.get(listener) ?? new Map<string, string>();
  made.set(listener, playlists);
  return playlists;
}

/**
 * Applies the plan the listener said "Send it" to. Plan it waits while a send
 * is pending: a second, before Apple shows what the first wrote, would write
 * it again.
 */
function useSend() {
  const music = useMusic();
  return useMutation({
    mutationFn: (plan: tPlaylistPlan) => send(music, plan),
    onError: showError,
  });
}

async function send(
  listener: tBrowserMusic,
  plan: tPlaylistPlan,
): Promise<void> {
  const result = await listener.playlists.apply(plan, {
    onProgress: ({ done, total = 0 }) => {
      say(`Sending: ${String(done)} of ${String(total)} songs added.`);
    },
  });
  // A playlist this page made is planned by its id from now on.
  if ("name" in plan.playlist) {
    madeFor(listener).set(plan.playlist.name, result.id);
  }
  // Apple carries a write out after it answers: verified says whether the write
  // showed before apply returned.
  const songs = `${String(result.appended)} songs`;
  const added = result.created
    ? `Made the playlist, and added ${songs}.`
    : `Added ${songs}.`;
  const shown = result.verified
    ? "Apple shows them already."
    : "They can take a few seconds to show.";
  say(`${added} ${shown}`);
}
// #endregion apply
