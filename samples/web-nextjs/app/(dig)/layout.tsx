// The Dig pages: the floor, and every page a crate or a search opens, under
// one search box.
import { Suspense, type ReactNode } from "react";
import { SearchForm } from "../search";

export default function DigLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* The box reads the search open from the address, in the browser. */}
      <Suspense fallback={null}>
        <SearchForm />
      </Suspense>
      {children}
    </>
  );
}
