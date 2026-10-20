"use client";
// A page whose server render failed: Next keeps the reason on the server,
// where its log says it, and the page offers to try again.
import { BackToTheCrates } from "./pages";

export default function DigError({ retry }: { retry: () => void }) {
  return (
    <>
      <BackToTheCrates />
      <p>
        Apple could not be asked for this page.{" "}
        <button type="button" onClick={retry}>
          Try again
        </button>
      </p>
    </>
  );
}
