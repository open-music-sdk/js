// A collection of the listener's, walked a page at a time: a playlist's tracks, or their playlists. The verbs here
// read such a collection whole and act on what it held, so a walk that stopped early would be taken for the whole
// of it: a playlist read short would be taken to hold less than it does, and have the rest added again. A walk
// here therefore ends where Apple names no further page, or it fails.
import { AppleMusicError, type tAppleMusicClient } from "@open-music-sdk/core";
import { held } from "./own";

/** What a walk goes by: the verb it is made for, what stops it, and the most pages it may ask for, where the caller set one. */
export interface tWalk {
  readonly fn: string;
  readonly signal: AbortSignal | undefined;
  readonly maxPages: number | undefined;
  /** The relationships the first page was asked to send in full, asked for again with each page after it. */
  readonly include?: readonly string[] | undefined;
}

/**
 * The pages of a walk, one at a time, each as the list it holds under `data`. The first is the one `first` asks
 * for, through a client package's function, so the path and its parameters are that function's. Each one after is
 * asked for by the link the page before it named, through the client, which sends nothing off Apple's host. The
 * link is as Apple wrote it but for `include`, which is put back: the link of a playlist's tracks keeps nothing but
 * its offset, as seen against the live API on 18 October 2026, and a page asked for by it alone has no catalog songs.
 *
 * Reaching `maxPages` with another page named is not an early end but an `ApiError`, named for the verb: what was
 * walked is not all there is, and nothing may be made of it as if it were.
 */
export async function* pagesOf(client: tAppleMusicClient, first: () => Promise<unknown>, walk: tWalk): AsyncGenerator<readonly unknown[], void, undefined> {
  let page = held(await first());
  for (let asked = 1; ; asked++) {
    yield Array.isArray(page.data) ? (page.data as readonly unknown[]) : [];
    const { next } = page;
    if (typeof next !== "string" || next === "") return;
    if (walk.maxPages !== undefined && asked >= walk.maxPages) {
      throw new AppleMusicError("ApiError", `${walk.fn}: Apple names another page after the ${String(walk.maxPages)} that maxPages allows, so what was read is not all there is`, { status: 200 });
    }
    page = held(await client.request(next, { signal: walk.signal, params: { include: walk.include } }));
  }
}
