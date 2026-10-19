// Shows: how a web-standard handler, such as tokenEndpoint, is mounted on Express. Guide: /guides/token-endpoint
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";

/**
 * Express hands a route Node's request and response; tokenEndpoint takes a web Request and gives a web Response.
 * This carries the method and the headers across, and the answer back. It carries no body, since the token route
 * reads none.
 */
export function web(handler: (req: Request) => Promise<Response>) {
  return async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      for (const each of [value ?? []].flat()) headers.append(name, each);
    }
    const answer = await handler(new Request(new URL(req.originalUrl, "http://localhost"), { method: req.method, headers }));
    res.status(answer.status);
    answer.headers.forEach((value, name) => res.setHeader(name, value));
    res.end(Buffer.from(await answer.arrayBuffer()));
  };
}
