# The Xano dev environment, and how to connect from any machine

FundReporting runs on **Xano**, and until 2026-08-18 there was exactly one database:
production. This is the record of the `dev` environment built beside it so we can develop
without touching real data, and of everything a second machine needs to reach the same
state.

> It covers both projects: this CRM (the handoff in `apps/api/src/fundreporting/`) and
> `fundreporting-v2`, the Next.js app that consumes Xano.

---

## 1. What exists in Xano today

Instance (the **client's** account): `xjcl-a4qe-ykfx.f2.xano.io`
Workspace: **`fundreporting-nextjs`** (id `4`) — 44 tables.

| Data source | Purpose | State |
| --- | --- | --- |
| `live` | **production** — the real book, cap tables, KYC | untouchable |
| `dev` | development | created 2026-08-18 |

Logic branches: only **`v1`** (live). **No dev branch yet** — see §6.

**What a data source is.** In Xano the *schema* (the 44 tables) and the *logic* (endpoints,
functions) live at workspace/branch level and are **shared**; a data source separates only
**the rows**. Verified on creation:

```
              live    dev
tables          44     44     <- same schema
asset_manager   10      0
currency        47      0
fund            36      0     <- separate data
```

### The consequence to read before touching anything

Because the logic and the external API keys are shared with `live`, the `dev` data source
isolates data but does **not** isolate:

- **Resend** (email). A bulk send in dev would mail **real** investors. An OTP to your own
  inbox is harmless; a bulk send is not.
- **EODHD**, Google Maps, Anthropic, and any configured webhook.
- Editing an endpoint on branch `v1` **changes production**.

**Ground rules:** always point at `dev`; never trigger bulk email flows; never edit the
endpoints or functions on branch `v1` without a dev branch (§6).

---

## 2. Credentials, and where they live

None of this is committed. On each machine it goes in the harness secret store,
`~/.config/step-labs-harness/secrets.env` (mode `600`):

| Key | What it is for |
| --- | --- |
| `SL_SECRET_STEP_LABS_XANO_FUNDREPORTING_META` | **Metadata API token** — inspecting and administering Xano (schema, data sources, seeding). The apps never use it. |

To install the token on another machine without it reaching the shell history:

```bash
read -rs XANO && \
  echo "SL_SECRET_STEP_LABS_XANO_FUNDREPORTING_META=$XANO" >> ~/.config/step-labs-harness/secrets.env && \
  unset XANO && echo ok
```

Check that it works (read-only):

```bash
TOKEN=$(grep -E '^SL_SECRET_STEP_LABS_XANO_FUNDREPORTING_META=' \
  ~/.config/step-labs-harness/secrets.env | cut -d= -f2-)
curl -sS -H "Authorization: Bearer $TOKEN" \
  https://xjcl-a4qe-ykfx.f2.xano.io/api:meta/workspace/4/datasource
# expected: [{"label":"live",...},{"label":"dev",...}]
```

**The metadata token does not authenticate the application API.** Proven: a `GET` against
`api:GOD16uGH/currency` answers `401` with it and without it alike. They are two separate
auth systems, and a token for one says nothing about the other.

**Still missing for production** (the client has to issue it — see
`fundreporting-handoff.md`):

- A `PLATFORM_SERVICE_TOKEN` that may **write** `investor_lead`. `XANO_PROXY_SECRET` is not
  a substitute: it is the shared secret of their login proxy, and what it mints is one
  *person's* session.
- The **asset-manager UUID** per workspace (`organization.assetManagerId`).

---

## 3. How an app is pointed at `dev`

Xano selects the database per request from this header:

```
X-Data-Source: dev
```

With no header Xano uses `live`. **Omitting it is writing to production.**

- **CRM** — one client (`apps/api/src/fundreporting/platform.client.ts`), so this was a
  one-line change: it sends the header when `PLATFORM_DATA_SOURCE` is set. Without the
  variable the behaviour is identical to before. ✔ done.
- **fundreporting-v2** — builds its Xano calls in **253 places across 149 files**, each
  assembling headers inline. It goes through a **local proxy**
  (`scripts/xano-dev-proxy.mjs`): in a dev checkout, `PLATFORM_API_URL` and `XANO_API_URL`
  point at the proxy, which adds the header and forwards. ✔ done.

### Why a proxy and not a `fetch` patch (this one cost us)

The first attempt wrapped `globalThis.fetch` from `instrumentation.ts`. It passed an
isolated test covering all four cases — GET, POST with a body, a `Request` object, a
different host — and **still failed inside Next**: Next wraps `fetch` itself and the app's
calls went around the patch. A signup meant for `dev` **created a user in production**
(`user` 249 → 250; removed afterwards).

The lessons, in order of value:

1. **The reliable seam is the URL, not the call site.** With a proxy no call can escape,
   because the proxy *is* the destination. A patch depends on nothing else touching the
   same global.
2. **Verify with a READ that discriminates, never with a write.** The good test is to log
   in as a user that exists only in `live`: if it fails, you are on `dev`. A verification
   that can dirty production is not a verification.
3. **An isolated test does not test the system.** The wrapper worked perfectly outside
   Next; inside it never ran at all.
4. The proxy **logs every call** with the data source it used, so where a request went is
   visible rather than assumed.

---

## 4. Seeding `dev`

`dev` starts empty, so the app has nothing to even log in with. The agreed policy:

- ✅ **Copy the catalogue tables** from `live` (`currency`, `country`, `asset_class`,
  `transaction_type`): reference data, no PII, and almost nothing works without them. The
  `id`s are preserved so foreign keys still resolve.
- ✅ **Create by hand** one `asset_manager`, one `fund` and one test `user`, all fictitious.
- ❌ **Never** copy the real book: investors, `cap_table_*`, `compliance_*`, documents.

State (2026-08-18): catalogues ✔ seeded (currency 47, country 249, asset_class 22,
transaction_type 14) and a test user `demo@steplabs.xyz` created through the app's signup
pointed at the proxy. The book tables are still at 0.

`xano-seed-dev.mjs` (in `steplabs/preview-demo/`, beside the local runbook) does the
catalogue half. It always writes with `X-Data-Source: dev` — the constant is fixed in the
code — and it is idempotent: a table that already has rows in dev is skipped.

```bash
node xano-seed-dev.mjs --dry-run   # show what it would do
node xano-seed-dev.mjs             # seed
```

> Note: Claude Code's auto mode blocks POSTs to external APIs, so a person runs this script
> (or a permission rule is added to `settings.json`).

---

## 5. Running both projects on another machine

Full recipes in `steplabs/preview-demo/README.md`. In short:

| Project | Local URL | Data |
| --- | --- | --- |
| **CRM** (this repo) | `:3200` app · `:3001` API · `:2000` agent | **local** Postgres (`crm`) |
| **fundreporting-v2** | `:3000` prod view · `:3300` dev | Xano (remote) |

What bites on a fresh machine (all verified on WSL):

- **Bun** is the CRM's package manager (`packageManager: bun@1.3.12`). If the official
  installer fails for want of `unzip`: `npm i -g bun@1.3.12`.
- **`turbo run dev` requires a TTY** ("Cannot run interactive task without Terminal UI"),
  so the scripts start each app separately instead of using `turbo run dev`.
- **The CRM database** needs no Docker. A local Postgres does: create the `crm` database,
  then `bunx prisma db push` and `bunx prisma db seed` inside `packages/db`.
- The CRM app runs on **`:3200`** so it does not collide with fundreporting-v2 on `:3000`.
  The browser only ever talks to the app, which proxies `/api/*` to the API
  server-to-server, so there is no CORS problem — only `APP_URL` has to be declared for
  better-auth's `trustedOrigins`.
- `fundreporting-v2` needs its `.env.local`, which is not in git: get it from a teammate or
  rebuild it from the secret store.
- Running the prod view and the dev view **at the same time** needs two working copies —
  Next allows one dev server per directory. `git worktree` is what that is for.

---

## 6. Open decisions

1. **A `dev` logic branch.** Only `v1` exists, so any change to a Xano endpoint or function
   still edits production. Needed as soon as we want to modify the backend, not for
   developing the apps against it.
2. **`PLATFORM_SERVICE_TOKEN` for production, plus the asset-manager UUIDs** (§2).
3. **Isolating the external keys.** If dev must not be able to reach the real Resend or
   EODHD, the answer is a separate dev *workspace* (same instance), not just a data source.
4. **Deployment.** Proposed: Vercel Preview (PRs) → Xano `dev`; Production → Xano `live`.
   In Xano, promote by merging/publishing a branch.

---

## References

- `data-model.md` — the CRM's model against FundReporting's, and why the seam is shape C.
- `fundreporting-handoff.md` — the handoff field by field; what is confirmed against the
  real Xano and what is missing.
- `tenancy.md` — the fork's multi-tenancy (`organization.assetManagerId`).
- `steplabs/preview-demo/ANALYSIS-XANO-CRM-FUNDREPORTING.md` (outside git) — the long
  analysis: fundreporting-v2's write surface, the architecture options and the deployment
  plan.
