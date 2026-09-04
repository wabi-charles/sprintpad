import { isEncryptedPad, type EncryptedPad } from "./crypto";

/**
 * The client for the pad store. The server is deliberately dumb: it holds an
 * opaque blob under a key and stamps it. It cannot read a pad, and there is
 * nothing to log in to.
 */

export interface RemotePad {
  payload: EncryptedPad;
  updatedAt: number;
}

export class SyncUnavailable extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "SyncUnavailable";
  }
}

/** Someone else wrote to the pad between our read and our write. */
export class RemoteMovedOn extends Error {
  constructor() {
    super("The pad changed on another device while this one was saving.");
    this.name = "RemoteMovedOn";
  }
}

export function createRemote(endpoint: string) {
  const base = endpoint.replace(/\/+$/, "");

  return {
    async get(padKey: string): Promise<RemotePad | null> {
      let response: Response;
      try {
        response = await fetch(`${base}/pad/${encodeURIComponent(padKey)}`);
      } catch (error) {
        throw new SyncUnavailable(error instanceof Error ? error.message : "network error");
      }

      if (response.status === 404) return null;
      if (!response.ok) throw new SyncUnavailable(`server returned ${response.status}`);

      const body: unknown = await response.json();
      const pad = body as Partial<RemotePad>;
      if (!isEncryptedPad(pad.payload) || typeof pad.updatedAt !== "number") {
        throw new SyncUnavailable("the server returned something unreadable");
      }
      return { payload: pad.payload, updatedAt: pad.updatedAt };
    },

    /**
     * `prev` is the stamp we believe is current. The server refuses the write
     * if it has moved on, so a save cannot silently clobber another device.
     */
    async put(padKey: string, payload: EncryptedPad, prev: number | null): Promise<number> {
      const query = prev === null ? "" : `?prev=${prev}`;
      let response: Response;
      try {
        response = await fetch(`${base}/pad/${encodeURIComponent(padKey)}${query}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        throw new SyncUnavailable(error instanceof Error ? error.message : "network error");
      }

      if (response.status === 409) throw new RemoteMovedOn();
      if (!response.ok) throw new SyncUnavailable(`server returned ${response.status}`);

      const body = (await response.json()) as { updatedAt?: unknown };
      if (typeof body.updatedAt !== "number") {
        throw new SyncUnavailable("the server returned something unreadable");
      }
      return body.updatedAt;
    },
  };
}

export type Remote = ReturnType<typeof createRemote>;
