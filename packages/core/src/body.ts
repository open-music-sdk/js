// readBounded: a body someone else chose the size of, read up to a limit this side chose.
import { got } from "./got";

/**
 * The body of a request or a response as text, or undefined once it has run past `maxBytes`. It is counted as it
 * arrives, after any decompression, and what lies beyond the limit is cancelled rather than read: whoever sends a
 * body decides how much is sent, and must not decide how much is kept. A body that cannot be read, since it was read
 * already or the connection dropped, rejects with the runtime's own error, as it is.
 *
 * @param message - The request or response whose body to read.
 * @param maxBytes - The most bytes to keep, a whole number from 0.
 * @returns The whole body as text, or `undefined` when it ran past `maxBytes` or a Content-Length header said it would.
 * @throws TypeError if `maxBytes` is not a whole number from 0.
 * @throws Whatever the runtime rejects with when the body cannot be read, as it is.
 */
export async function readBounded(message: Request | Response, maxBytes: number): Promise<string | undefined> {
  if (!Number.isInteger(maxBytes) || maxBytes < 0) throw new TypeError(`readBounded: maxBytes must be a whole number from 0, got ${got(maxBytes)}`);
  const stream = message.body as ReadableStream<Uint8Array> | null | undefined;
  // A length declared past the limit is taken at its word. One declared within it is not: the bytes are still counted.
  if (Number(message.headers.get("content-length")) > maxBytes) {
    await stream?.cancel();
    return undefined;
  }
  if (typeof stream?.getReader !== "function") {
    // Nothing to count: no body, or a runtime whose messages have no body stream. Read whole, then judge.
    const text = await message.text();
    return text.length > maxBytes ? undefined : text;
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
}
