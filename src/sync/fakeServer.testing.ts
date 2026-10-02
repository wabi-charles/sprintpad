/**
 * Test doubles for the sync layer, shared between its suites.
 *
 * Named `.testing.ts` rather than `.test.ts` so vitest does not run it as a
 * suite, and nothing in the app imports it, so it never reaches a bundle.
 */
import { vi } from "vitest";
import type { StorageLike } from "../data/storage";

export function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    keys: () => [...data.keys()],
  };
}

/** A stand-in for the Worker: the same contract, in memory. */
export function fakeServer() {
  const pads = new Map<string, { payload: unknown; updatedAt: number; auth?: string }>();
  let clock = 1_000;

  const handler = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = url.pathname.replace("/pad/", "");
    const method = init?.method ?? "GET";
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    if (method === "GET") {
      const stored = pads.get(key);
      // The token never leaves the server.
      return stored
        ? json({ payload: stored.payload, updatedAt: stored.updatedAt })
        : json({ error: "not found" }, 404);
    }

    const auth = new Headers(init?.headers).get("x-pad-auth");
    if (!auth) return json({ error: "missing write token" }, 401);

    const current = pads.get(key);
    if (current?.auth && current.auth !== auth) return json({ error: "forbidden" }, 403);

    if (method === "DELETE") {
      pads.delete(key);
      return json({ ok: true });
    }

    const prev = url.searchParams.get("prev");
    if (prev !== null && current && String(current.updatedAt) !== prev) {
      return json({ error: "conflict" }, 409);
    }
    const updatedAt = (clock += 1000);
    pads.set(key, { payload: JSON.parse(String(init?.body)), updatedAt, auth });
    return json({ updatedAt });
  });

  return {
    pads,
    handler,
    /** Bumps the stamp as if another device had written, without new content. */
    editRemotely: (key: string) => {
      const stored = pads.get(key);
      if (stored) pads.set(key, { ...stored, updatedAt: (clock += 1000) });
    },
    /** As if another device had deleted the pad everywhere. */
    deleteRemotely: (key: string) => void pads.delete(key),
  };
}

export type FakeServer = ReturnType<typeof fakeServer>;
