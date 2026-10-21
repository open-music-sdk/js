"use client";
// A page whose server render failed, where no page of its own says why: Next
// keeps the reason on the server, where its log says it. Drawn under the root
// layout, so the header, your crate and the player stay as they were.
export default function AppError({ retry }: { retry: () => void }) {
  return (
    <p>
      Apple could not be asked for this page.{" "}
      <button type="button" onClick={retry}>
        Try again
      </button>
    </p>
  );
}
