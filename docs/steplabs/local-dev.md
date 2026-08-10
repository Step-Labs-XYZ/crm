# Step Labs — local dev notes

Everything in this file is specific to **our fork** (`Step-Labs-XYZ/crm`), not to
upstream. It lives under `docs/steplabs/` — a path upstream does not use — so
syncing with `trycompai/crm` never conflicts here.

Upstream's own instructions are in the root `AGENTS.md` and `docs/`. Read those
first; this file only records where our machines deviate.

## Remotes

```
origin    git@github-steplabs:Step-Labs-XYZ/crm.git   # our fork
upstream  https://github.com/trycompai/crm.git        # trycompai
```

Sync with `git fetch upstream && git rebase upstream/main`.

## Toolchain

The repo pins `bun@1.3.12` (`packageManager` in `package.json`). Installed via
mise, not the bun.sh installer:

```sh
mise use -g bun@1.3.12
```

Node ≥22 is also required. **Do not use pnpm or npm here** — the lockfile is
`bun.lock`, and the company "pnpm always" rule does not apply to this repo.

## Postgres is on 5436, not 5432

Port 5432 on this machine is taken by another project's `sred-db` container, so
`docker compose up -d` fails out of the box. `docker-compose.override.yml`
remaps it:

```yaml
services:
  postgres:
    ports: !override
      - "5436:5432"
```

The `!override` tag is required — Compose *merges* port lists rather than
replacing them, so without it Docker still tries to bind 5432 and fails.

`.env` has `DATABASE_URL` pointed at 5436 to match. The override file is
git-excluded (`.git/info/exclude`) because the port collision is local to this
machine, not a property of the fork.

## Getting in without a Google OAuth client

Sign-in is Google-only: `packages/auth/src/auth.ts` sets
`emailAndPassword.enabled = false`, and `socialProviders` stays empty when
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are unset. The sign-in page says so
outright — *"This CRM has no sign-in method configured, so nobody can get in —
including you."*

For evaluation before anyone sets up an OAuth client,
`packages/auth/scripts/local-preview-session.ts` (git-excluded) mints a Better
Auth session through the internal adapter and prints a signed cookie:

```sh
bun run packages/auth/scripts/local-preview-session.ts you@steplabs.xyz
# paste the printed document.cookie = "..." into the browser console on :3000
```

Two onboarding gates also sit in front of the app (`apps/app/lib/onboarding.ts`).
Both were settled directly in the local database:

```sql
UPDATE "organization"
SET website  = 'https://steplabs.xyz',
    metadata = jsonb_build_object('onboardedAt', to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text
WHERE id = 'workspace';

INSERT INTO "appSetting" (id, "updatedAt", "contextDevApiKey")
VALUES ('app', now(), 'local-preview-placeholder')
ON CONFLICT (id) DO UPDATE SET "contextDevApiKey" = EXCLUDED."contextDevApiKey";
```

The `contextDevApiKey` placeholder only satisfies the gate — it is not a real
context.dev key, so **the research agent cannot actually enrich anything**. Any
evaluation of the agent (the whole point of this CRM) needs a real key.

All three shims are for looking at the product. Delete them once a real Google
OAuth client and a real context.dev key exist.

## Ports

| Service | Port |
|---|---|
| `apps/app` (Next.js) | 3000 |
| `apps/api` (NestJS) | 3001 |
| `apps/agent` (eve) | 2000 (127.0.0.1 only) |
| Postgres (docker) | 5436 |

3000 collides with `fundreporting-v2`'s dev server — run one at a time, or start
fundreporting with `pnpm dev -p 3002`.

## Commands

```sh
bun install
docker compose up -d
bun run db:deploy      # migrations
bun run db:seed        # 15 companies, 45 contacts, 23 deals, 162 activities
bun run dev            # app + api + agent
bun run db:studio      # Prisma Studio
bun run check-types
bun run lint           # biome
bun run test
```
