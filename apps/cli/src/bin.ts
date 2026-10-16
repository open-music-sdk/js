#!/usr/bin/env node
// The `open-music-sdk` command. The exit status is set, not forced, so what was written to a pipe is all sent.
import { main } from "./main";

process.exitCode = await main(process.argv.slice(2));
