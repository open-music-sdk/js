# export-check

A test that holds the sample apps to the integrations' exports. It fails when an export of `server`, `browser` or
`react` is used by name in no sample and is not on its list of exceptions. Each exception carries the reason no
sample uses it.

```sh
pnpm --filter samples-export-check test
```

The endpoint functions, which every integration also exports one by one, are counted apart. The samples call some
of them, and the test prints how many. The CLI's `check` asks every one against the live API.
