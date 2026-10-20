// The page around every route: the providers, and the header the server draws
// for whoever is signed in.
import { isAppleMusicError } from "@open-music-sdk/server";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { storefronts } from "@/lib/catalog";
import { listener, storefront } from "@/lib/listener";
import { Nav, NavWaiting } from "./nav";
import { Providers } from "./providers";
import { SignIn } from "./sign-in";
import { Status } from "./status";
import { StorefrontPicker } from "./storefront";
import "./styles.css";

export const metadata: Metadata = {
  title: "Vinyl Collector Simulator",
  icons: {
    // The icon Apple's sign-in window shows, here this project's logo: put
    // your own app's in its place, on a public https address.
    other: {
      rel: "apple-music-app-icon",
      url: "https://avatars.githubusercontent.com/u/338387998?s=240",
      sizes: "120x120",
    },
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <header>
            <h1>Vinyl Collector Simulator</h1>
            <Suspense fallback={<NavWaiting />}>
              <ForTheListener />
            </Suspense>
          </header>
          <Status />
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}

/**
 * The parts of the header that depend on who is signed in. Signed in, the
 * storefront is the listener's own, from Apple, and the picker goes.
 */
async function ForTheListener() {
  const you = await listener();
  const where = await storefront();
  const signedIn = you !== undefined;
  const picker = signedIn
    ? undefined
    : <StorefrontPicker current={where} storefronts={await pickable(where)} />;
  return (
    <>
      <Nav signedIn={signedIn} storefront={where} />
      {picker}
      <SignIn signedIn={signedIn} />
    </>
  );
}

/**
 * The storefronts the picker offers. If Apple won't list them, it offers the
 * one the page is in, and the header is drawn all the same.
 */
async function pickable(current: string) {
  try {
    return await storefronts();
  } catch (e) {
    if (!isAppleMusicError(e)) throw e;
    return [{ id: current, name: current }];
  }
}
