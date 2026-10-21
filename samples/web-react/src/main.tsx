// The page: the providers every screen reads from, and the header's tabs, which
// show one screen at a time.
import { MusicProvider } from "@open-music-sdk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { CrateProvider, CrateScreen, useCrate } from "./crate";
import { Dig, StorefrontPicker } from "./dig";
import { Status } from "./errors";
import { Library } from "./library";
import { music, NowProvider, useNow } from "./music";
import { PlayerProvider } from "./player";
import { SignIn } from "./sign-in";

// Apple's catalog changes a few times a day. Asking again each time the tab
// comes back would spend the rate limit every listener shares.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60_000 } },
});

type tScreen = "dig" | "crate" | "library";

function App() {
  const [screen, setScreen] = useState<tScreen>("dig");
  const { signedIn } = useNow();
  const { picks } = useCrate();
  // Signed out with the Library open: back to Dig, since nothing of a
  // listener's is left to show.
  const shown = screen === "library" && !signedIn ? "dig" : screen;

  // The address changed, by a sleeve, a link or the browser's Back: the Dig
  // screen shows what it names.
  useEffect(() => {
    const toDig = () => {
      setScreen("dig");
    };
    addEventListener("hashchange", toDig);
    return () => {
      removeEventListener("hashchange", toDig);
    };
  }, []);

  const tab = (name: tScreen, label: ReactNode) => (
    <button
      type="button"
      aria-pressed={shown === name}
      onClick={() => {
        setScreen(name);
      }}
    >
      {label}
    </button>
  );
  return (
    <>
      <header>
        <h1>Vinyl Collector Simulator</h1>
        <nav>
          {tab("dig", "Dig")}
          {tab("crate", `Your crate (${String(picks.length)})`)}
          {signedIn && tab("library", "Library")}
        </nav>
        <StorefrontPicker />
        <SignIn />
      </header>
      <Status />
      <main>
        <section hidden={shown !== "dig"}>
          <Dig />
        </section>
        <section hidden={shown !== "crate"}>
          <CrateScreen />
        </section>
        {signedIn && (
          <section hidden={shown !== "library"}>
            <Library />
          </section>
        )}
      </main>
    </>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no element with id root");

// StrictMode mounts every component twice in development, the provider, the
// hooks and the player among them, to show what an effect forgot to undo.
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MusicProvider music={music}>
        <NowProvider>
          <CrateProvider>
            <PlayerProvider>
              <App />
            </PlayerProvider>
          </CrateProvider>
        </NowProvider>
      </MusicProvider>
    </QueryClientProvider>
  </StrictMode>,
);
