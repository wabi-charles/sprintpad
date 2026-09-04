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
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });

/** Generous for a text document, small enough that the store cannot be abused. */
const MAX_BYTES = 512 * 1024;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const match = /^\/pad\/([A-Za-z0-9_-]{8,64})$/.exec(url.pathname);
    if (!match) return json({ error: "not found" }, 404);
    const key = match[1];

    if (request.method === "GET") {
      const stored = await env.PADS.get(key, "json");
      return stored === null ? json({ error: "not found" }, 404) : json(stored);
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

    // Optimistic concurrency: refuse the write if the pad moved on since the
    // client last read it, so one device cannot silently clobber another.
    const prev = url.searchParams.get("prev");
    const current = await env.PADS.get(key, "json");
    if (prev !== null && current !== null && String(current.updatedAt) !== prev) {
      return json({ error: "conflict", updatedAt: current.updatedAt }, 409);
    }

    const updatedAt = Date.now();
    await env.PADS.put(key, JSON.stringify({ payload, updatedAt }));
    return json({ updatedAt });
  },
};
