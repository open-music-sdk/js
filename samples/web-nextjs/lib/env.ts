/** A setting from .env.local, which has to be there. */
export function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy samples/.env.example to `
        + "samples/web-nextjs/.env.local and fill it in.",
    );
  }
  return value;
}
