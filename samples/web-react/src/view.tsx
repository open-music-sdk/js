// Where the Dig screen draws: the floor of crates, and a page pulled out of
// one, opened over the floor as a step the browser's Back goes back from.
// Nothing here asks Apple.
import {
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import { explain, useShowError } from "./errors";

/** A page a sleeve can open, drawn for the id in its address. */
export type tPage = ComponentType<{ id: string }>;

/**
 * Opens a page: `go("albums", "1440857781")` goes to the address
 * `#albums/1440857781`.
 */
export function go(kind: string, id: string): void {
  location.hash = `#${kind}/${encodeURIComponent(id)}`;
}

function subscribe(changed: () => void): () => void {
  addEventListener("hashchange", changed);
  return () => {
    removeEventListener("hashchange", changed);
  };
}

/** The address, as `#albums/1440857781`, or "" on the floor. */
export function useAddress(): string {
  return useSyncExternalStore(subscribe, () => location.hash);
}

/**
 * The kind of page the address names, and its id: everything after the first
 * slash, slashes and all.
 */
export function parseAddress(address: string): { kind: string; id: string } {
  const path = address.slice(1);
  const slash = path.indexOf("/");
  if (slash === -1) return { kind: path, id: "" };
  return { kind: path.slice(0, slash), id: path.slice(slash + 1) };
}

// Where the floor was scrolled to when a page opened over it, to go back to.
// Read as the address changes, before React hides the floor, which shortens
// the page and moves the scroll.
let floorScroll = 0;
addEventListener("hashchange", (event) => {
  const from = parseAddress(new URL(event.oldURL).hash);
  const floor = document.querySelector(".floor");
  // The scroll belongs to the Dig screen: while another tab is open over it,
  // that tab keeps its place.
  if (from.kind === "" && floor?.checkVisibility() === true) {
    floorScroll = scrollY;
  }
});

interface tViewProps {
  readonly floor: ReactNode;
  /** The pages a sleeve can open, by the kind its address names. */
  readonly pages: Readonly<Record<string, tPage>>;
}

/**
 * The floor, or the page the address names over it. The floor stays as the
 * listener left it while a page is open, each crate at the sleeve they were
 * on.
 */
export function View({ floor, pages }: tViewProps) {
  const address = useAddress();
  const { kind, id } = parseAddress(address);
  const Page = pages[kind];
  const floorRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (floorRef.current?.closest("section")?.hidden === true) return;
    scrollTo(0, Page === undefined ? floorScroll : 0);
  }, [address, Page]);

  return (
    <>
      <div ref={floorRef} className="floor" hidden={Page !== undefined}>
        {floor}
      </div>
      {Page !== undefined && (
        <div className="page">
          <a href="#" className="back">
            ‹ Back to the crates
          </a>
          <Opened key={address} page={Page} id={id} />
        </div>
      )}
    </>
  );
}

/**
 * The page, for its id as the address spells it. An address typed by hand can
 * hold a % that decodes to nothing, which is said like any other error.
 */
function Opened({ page, id }: { page: tPage; id: string }) {
  const Page = page;
  let decoded: string;
  try {
    decoded = decodeURIComponent(id);
  } catch (e) {
    return <p>{explain(e)}</p>;
  }
  return <Page id={decoded} />;
}

interface tPullingProps {
  /** A query still pending, or one that failed. */
  readonly query: {
    readonly error: Error | null;
    readonly refetch: () => unknown;
  };
}

/** A page still being pulled out, or one that failed, to be tried again. */
export function Pulling({ query }: tPullingProps) {
  useShowError(query.error);
  if (query.error === null) return <p>Pulling it out…</p>;
  const again = () => {
    void query.refetch();
  };
  return (
    <p>
      <button type="button" onClick={again}>
        Try again
      </button>
    </p>
  );
}
