# Sprintpad sync

The whole backend: an opaque blob under a key, with a stamp. It holds pads that
were encrypted in the browser, so there is no password here to check or store,
no accounts, and nothing worth reading if this store were ever exposed.

## Deploy

```bash
cd worker
npx wrangler kv namespace create PADS   # prints an id
# paste that id into wrangler.toml
npx wrangler deploy                     # prints your workers.dev URL
```

Then in Sprintpad: `⌘K → Sync across devices`, paste the URL as **Server**,
leave **Pad name** blank to create a pad, and choose a password. On your other
devices, enter the same server, the pad name shown, and the same password.

## Or from the dashboard

1. **Storage & Databases → KV → Create** a namespace.
2. **Compute (Workers) → Create → Worker**, paste `index.js`, deploy.
3. On the Worker: **Settings → Bindings → Add → KV namespace**, variable name
   `PADS`, pointed at the namespace from step 1.

## Free tier

A pad is a few kilobytes and one person generates a handful of writes a minute
at most. Cloudflare's free KV allowance (100k reads and 1k writes a day) is
orders of magnitude more than this needs.

## What it stores

`{ payload: { v, salt, iv, ct }, updatedAt }` — `ct` is AES-GCM ciphertext.
Writes take an optimistic `?prev=<updatedAt>`; a mismatch returns 409 so one
device cannot silently clobber another.
