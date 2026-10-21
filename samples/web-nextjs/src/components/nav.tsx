"use client";
// The header's tabs: Dig, your crate, and the Library once someone is signed
// in. Each is a page of its own.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useCrate } from "./crate";

interface tNavProps {
  readonly signedIn: boolean;
  /** The storefront the server asks in. */
  readonly storefront: string;
}

export function Nav({ signedIn, storefront }: tNavProps) {
  const path = usePathname();
  const { storefrontIs } = useCrate();
  // The crate keeps only the songs of the storefront the server asks in.
  useEffect(() => {
    storefrontIs(storefront);
  }, [storefront, storefrontIs]);
  return <Tabs signedIn={signedIn} path={path} />;
}

/**
 * The tabs while the server works out who is signed in. The address is read
 * only once it has: a page is drawn ahead of time up to here, without one.
 */
export function NavWaiting() {
  return <Tabs signedIn={false} path={undefined} />;
}

interface tTabsProps {
  readonly signedIn: boolean;
  /** The page open, by its path; undefined before it can be read. */
  readonly path: string | undefined;
}

function Tabs({ signedIn, path }: tTabsProps) {
  const { picks } = useCrate();
  const onCrate = path === "/crate";
  const onLibrary = path?.startsWith("/library") === true;
  const onDig = path !== undefined && !onCrate && !onLibrary;
  return (
    <nav>
      <Link href="/" aria-current={onDig ? "page" : undefined}>
        Dig
      </Link>
      <Link href="/crate" aria-current={onCrate ? "page" : undefined}>
        Your crate ({picks.length})
      </Link>
      {signedIn && (
        <Link href="/library" aria-current={onLibrary ? "page" : undefined}>
          Library
        </Link>
      )}
    </nav>
  );
}
