# Sign a listener in

To read or change a listener's library, your app needs their [Music User Token](../glossary#music-user-token),
and only Apple can issue one. In this guide you add a button that opens Apple's sign-in window, take the token it
gives, and sign the listener out again.

To sign yourself in, to try the API with your own account or to run a script, you don't need a page of your own:
the CLI's `login` does it from the terminal. See [The command-line tool](../concepts/packages#the-command-line-tool).

Before you start, you need:

- a route on your server that serves a developer token to your page. See
  [Serve a developer token to a page](./token-endpoint).
- `@open-music-sdk/browser` in your page, or `@open-music-sdk/react` in a React app. For React, read the steps
  below, then [In React](#in-react).

The SDK doesn't run a sign-in of its own. It loads Apple's [MusicKit on the Web](../glossary#musickit-on-the-web)
script from Apple's CDN and runs Apple's sign-in for you.

In the code below, `button`, `signOutButton` and `showWhyNot` stand for your own code. Step 7 shows a `signedIn`.

## 1. Make the client

In your page:

```ts
import { createBrowserClient } from "@open-music-sdk/browser";

const music = createBrowserClient({ tokenUrl: "/api/music/token" });
```

## 2. Create the sign-in helper when the button is shown

Call `createConnect` when you show the sign-in button, not when it's clicked. A browser opens a window only inside
a click, and a download that starts after the click can outlast it. Creating the helper early loads Apple's script
and configures it before the click.

```ts
import { createConnect } from "@open-music-sdk/browser";

const signIn = createConnect(music, { app: { name: "Vinyl Collector Simulator" } });
```

`app` is what Apple's script is configured with. You can add `app.build`, your app's version.

Apple's sign-in window doesn't show `app.name`. It names your app by your page's host, such as `app.example`, or
`localhost:5173` while you develop. The icon beside it comes from your page's `apple-music-app-icon` link, else its
`apple-touch-icon`. Give the icon an HTTPS address: the window is an HTTPS page of Apple's, and loads the icon
itself.

```html
<link rel="apple-music-app-icon" sizes="120x120" href="https://app.example/music-icon-240.png">
```

The script is one download from Apple, about 140 kB compressed as measured on 10 October 2026, made only by a
page that creates the helper. It runs with your page's access, and you can't pin it, bundle it or host it
yourself: see [Apple's script](../concepts/security#apple-s-script) in the security model.

Create one helper per page. A second helper for the same app shares the first one's script and configuration. A
second helper for a different `app` is a `TypeError`.

## 3. Enable the button on `ready`

`ready` settles once the script is loaded and configured. Keep the button disabled until then:

```ts
button.disabled = true;
signIn.ready.then(
  (restored) => {
    button.disabled = false;
    if (restored) signedIn(music.as(restored));
  },
  (e) => showWhyNot(e),
);
```

`ready` resolves to a token when Apple's script restored one for a returning listener, who then needs no click.
Otherwise it resolves to `undefined`.

`ready` rejects with a `NetworkError` when the script can't be loaded, and with a `DeveloperTokenUnavailable`
when the developer token can't be fetched from your route. After a failure, the next `connect()` loads and
configures the script again before it opens the window.

While the helper lives, it keeps Apple's script supplied with a current developer token, so `connect()` has
nothing to wait for at the click. It asks the client's token provider again halfway through the token's life and
when the tab comes back, and gives Apple's script any token that changed. The provider hands back the token it
holds until that one is due to be replaced.

## 4. Call `connect()` inside the click

```ts
button.onclick = async () => {
  try {
    const token = await signIn.connect();
    if (token) signedIn(music.as(token));
  } catch (e) {
    showWhyNot(e);
  }
};
```

`connect()` opens Apple's sign-in window and resolves to the listener's Music User Token.

When the listener declines, or closes Apple's window, `connect()` resolves to `undefined`. Leave the listener
signed out. Apple's script rejects with an error named `AUTHORIZATION_ERROR` then, as it did in Firefox on 18
October 2026, and `connect()` takes that, or an answer of nothing, for a decline.

Anything else Apple's script throws reaches you as it came. Its shape is Apple's and isn't documented, so show
it to the listener, and never print it to a log where a token might end up.

## 5. Sign the listener out

```ts
signOutButton.onclick = () => void signIn.disconnect().catch(showWhyNot);
```

`disconnect()` is Apple's own sign-out, run through the script. It ends the sign-in in the script and the copy of
the token the script kept, so the next page load restores nothing. It also ends the token at Apple, so a copy your
server stored stops working too: tried against the live API on 18 October 2026, Apple refused the token as soon as
the sign-out was done. Forgetting the token in your page alone isn't a sign-out: the script would restore it on the
next visit.

`disconnect()` does nothing where Apple's script has no sign-out function, or where the page holds no
configuration, as after a `ready` that failed.

When you no longer need the helper, call `signIn.dispose()`. It stops keeping the developer token fresh, and
leaves Apple's script in the page.

## 6. Let Apple's script through your security headers

Apple's script is loaded from `MUSICKIT_SCRIPT`, which the package exports: a URL on
`https://js-cdn.music.apple.com`. If your site sends a content security policy, it has to let that script in, and
let it reach Apple's hosts. This policy let a sign-in through in the first live run, from the CLI's page:

```http
Content-Security-Policy: default-src 'self' https://*.apple.com; script-src 'self' https://js-cdn.music.apple.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.apple.com https://*.mzstatic.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'
```

Keep `base-uri 'self'` whatever else you change, so that no `<base>` put into your page can move where anything
is fetched from.

Two more headers matter:

- Don't send `Referrer-Policy: no-referrer`. Developers report that it breaks Apple's sign-in.
- If you send a `Cross-Origin-Opener-Policy`, make it `same-origin-allow-popups`. `same-origin` is expected to cut
  your page off from the sign-in window. The first live run sent none.

If your policy uses a nonce or Trusted Types, load Apple's script yourself, and pass its `MusicKit` global as the
`musicKit` option of `createConnect`.

[Apple's script](../concepts/security#apple-s-script) in the security model says what each header guards against.

::: info Run once against the live API
One sign-in has run against Apple's live script, from the CLI's page on `localhost`, on Windows, in one browser.
[Differences from Apple's documentation](../differences#browser) lists what it settled and what is still open.
:::

## 7. Decide where the token goes

What you do with the token decides how your app is set up.
[Developer tokens and Music User Tokens](../concepts/tokens) compares the setups.

Client only: the page keeps the token in memory and calls Apple itself. `music.as(token)` gives a client for the
listener, which is what `signedIn` received above:

```ts
async function signedIn(listener: typeof music) {
  for await (const playlist of listener.user.listLibraryPlaylists()) console.log(playlist.attributes?.name);
}
```

Never write the token to `localStorage`, `sessionStorage` or a cookie.

Hybrid: the page posts the token to your server, which stores it and calls Apple for the listener. See
[Keep a listener's token on your server](./store-user-tokens). When the listener signs out, also have your server
delete the token it stored.

The [vanilla sample](../samples) does both. It posts the token, and once its server has kept it, it reads the
listener's library from the page too:

<<< @/../../samples/web-vanilla/src/sign-in.ts#after-sign-in{ts}

::: warning Apple's script keeps a copy of the token
Apple's script keeps its own copy of the token in the browser's storage, which is how a returning listener is
still signed in, so a cross-site scripting hole on your origin exposes the token on any later visit. See
[In a page](../concepts/security#in-a-page) in the security model.
:::

## In React

`@open-music-sdk/react` runs the same helper for you. `useConnect` creates it when the component mounts and
disposes of it when the component unmounts. `<MusicProvider>` holds the token in React state, in memory only.
Steps 6 and 7 apply as they are.

```tsx
import { MusicProvider, createBrowserClient, useConnect, useMusicUserToken } from "@open-music-sdk/react";

// Created once, outside the tree.
const music = createBrowserClient({ tokenUrl: "/api/music/token" });

export function App() {
  return (
    <MusicProvider music={music}>
      <SignIn />
    </MusicProvider>
  );
}

function SignIn() {
  const { isReady, error, connect, disconnect } = useConnect({ app: { name: "Vinyl Collector Simulator" } });
  const [token] = useMusicUserToken();
  if (token) return <button onClick={() => void disconnect().catch(showWhyNot)}>Sign out</button>;
  return (
    <>
      <button disabled={!isReady} onClick={() => void connect().catch(showWhyNot)}>
        Connect Apple Music
      </button>
      {error !== undefined && <p>Apple Music sign-in isn't available right now.</p>}
    </>
  );
}
```

- `isReady` is `true` once Apple's script is loaded and configured. `error` says why it isn't, when it can't be.
- The token `connect()` gives, and the one Apple's script restores for a returning listener, go to the provider.
  From then on, `useMusic()` gives every component the client bound to the listener, and `useMusicUserToken()`
  gives the token.
- `disconnect()` is Apple's sign-out, as in step 5, and the provider forgets the token.
- After a `UserTokenInvalid` error, call `setToken(undefined)` from `useMusicUserToken()`. The provider forgets
  the token, and takes no token Apple's script restores until the next `connect()`. The provider doesn't do this
  by itself: the component that made the call sees the error.
- `useConnect` reads its options on the first mount only.

The provider takes no token as a prop, because a prop from a server component is written into the page. A token
your server stored reaches it through `setToken`, after an authenticated `no-store` fetch.

## Next steps

- [Keep a listener's token on your server](./store-user-tokens), for the hybrid setup.
- [Handle errors](./errors), including a token Apple no longer accepts.
- [TanStack Query](./tanstack-query), to read the listener's library from React components.
- The reference for [`createConnect`](../reference/@open-music-sdk/browser/functions/createConnect),
  [`MUSICKIT_SCRIPT`](../reference/@open-music-sdk/browser/variables/MUSICKIT_SCRIPT) and
  [`useConnect`](../reference/@open-music-sdk/react/functions/useConnect).
