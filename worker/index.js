/**
 * The whole backend: an opaque blob under a key, with a stamp.
 *
 * It has no idea what a task is. Pads arrive already encrypted by the browser,
 * so there is no password here to check or store, no accounts, and nothing
 * worth reading if this store were ever exposed.
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,PUT,OPTIONS",
  "access-control-allow-headers": "content-type,x-pad-auth",
  "access-control-max-age": "86400",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });

/** Generous for a text document, small enough that the store cannot be abused. */
const MAX_BYTES = 512 * 1024;

/** Constant-time compare, so a token cannot be recovered a byte at a time. */
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const match = /^\/pad\/([A-Za-z0-9_-]{3,64})$/.exec(url.pathname);
    if (!match) return json({ error: "not found" }, 404);
    const key = match[1];

    if (request.method === "GET") {
      const stored = await env.PADS.get(key, "json");
      if (stored === null) return json({ error: "not found" }, 404);
      // The write token stays here; the client derives its own to compare.
      return json({ payload: stored.payload, updatedAt: stored.updatedAt });
    }

    if (request.method !== "PUT") return json({ error: "method not allowed" }, 405);

    const text = await request.text();
    if (text.length > MAX_BYTES) return json({ error: "too large" }, 413);

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return json({ error: "invalid json" }, 400);
    }
    if (payload?.v !== 1 || typeof payload.salt !== "string" || typeof payload.iv !== "string" ||
        typeof payload.ct !== "string") {
      return json({ error: "invalid payload" }, 400);
    }

    const auth = request.headers.get("x-pad-auth");
    if (!auth) return json({ error: "missing write token" }, 401);

    const current = await env.PADS.get(key, "json");

    /*
     * Pad names are meant to be memorable, which makes them guessable, so a
     * write has to prove it knows the password. The token is derived from the
     * password alongside the encryption key and is useless for reading -- it
     * only stops a stranger who guessed the name from overwriting the pad.
     *
     * A pad with no token yet is claimed by its first writer. Pads created
     * before tokens existed keep working, and take one on their next write.
     */
    if (current?.auth && !timingSafeEqual(current.auth, auth)) {
      return json({ error: "forbidden" }, 403);
    }

    // Optimistic concurrency: refuse the write if the pad moved on since the
    // client last read it, so one device cannot silently clobber another.
    const prev = url.searchParams.get("prev");
    if (prev !== null && current !== null && String(current.updatedAt) !== prev) {
      return json({ error: "conflict", updatedAt: current.updatedAt }, 409);
    }

    const updatedAt = Date.now();
    await env.PADS.put(key, JSON.stringify({ payload, updatedAt, auth }));
    return json({ updatedAt });
  },
};
