import { readFile } from "node:fs/promises";
import { redacted, type tRedacted } from "./redacted.js";

/** Reads AuthKey_XXXXXXXXXX.p8 from disk, redacted so the key cannot be logged by accident. Pass the result as `pem`. */
export const fromKeyFile = async (path: string | URL): Promise<tRedacted<string>> => redacted(await readFile(path, "utf8"));
