# Step Labs — tenancy

Upstream is single tenant on purpose, and [`docs/api.md`](../api.md) opens by
saying so: no `organizationId` on any CRM record, one `organization` row whose id
is the literal string `workspace`, and a rule that the id is *a constant, never a
parameter*.

**Our fork does not get to keep that.** FundReporting sells CRM + Asset Manager
as one service, and each asset manager reuses its own client data on the
platform, so the CRM is one workspace per asset manager. That decision is
Andrea's, relayed 2026-08-10, and it is what every note below follows from.

This file is the fork's tenancy rules. It lives under `docs/steplabs/` — a path
upstream does not use — so rebasing on `trycompai/crm` does not conflict here.
Where an upstream file is now wrong about *this* fork it carries a short pointer
back to this one rather than a rewrite, to keep the conflict surface small.

## The tenant is the Better Auth organization

Nothing new was built to hold a tenant. The `organization` plugin was already
installed with its tables; what upstream did was pin it to one row and treat the
id as a constant. So this is **stopping the singleton**, not adding tenancy.

- **The tenant is resolved from the signed-in address, never passed in.**
  `databaseHooks.session.create.before` already wrote `activeOrganizationId` onto
  the session — it just always wrote the same value. It now writes whichever
  tenant claims the caller's address, and `AuthMiddleware` reads it back onto
  `AuthedTrpcContext.organizationId`. A procedure that needs the tenant takes it
  from the context; nothing derives it from an input, because an input is
  something a caller can choose.
- **A session minted before this change still resolves.** `AuthMiddleware` falls
  back to the caller's oldest `Member` row when `activeOrganizationId` is null,
  so the change does not sign everybody out.
- **No tenant is a refusal, not a default.** The middleware throws `FORBIDDEN`
  rather than picking one. Falling back to "the first organization" is how a rep
  at one asset manager reads another's pipeline.

## `AllowedSignIn` is the allow-list, and it is per tenant

`ALLOWED_SIGN_IN` was one global comma-separated list read by two things — the
sign-in guard and the sync's decision about which side of a conversation is
external. With N asset managers a single list stops being an authorisation model
entirely: it cannot say *which* workspace an address belongs to, and that is now
the question being asked.

So the list is rows: `AllowedSignIn { organizationId, entry }`, one entry per
domain or address, exactly the two shapes the environment variable accepted.

- **`entry` is globally unique**, and that constraint is the whole design. It is
  what makes "which tenant does this address belong to" have one answer. Without
  it two asset managers could both claim `acme.com` and the resolution would
  depend on row order.
- **The most specific claim wins.** `organizationForEmail` builds the candidates
  an address could match — the address itself, then the host, then each shorter
  suffix — and takes the earliest one any tenant has claimed. So a domain can
  belong to one tenant while a single named address inside it belongs to another,
  which is the contractor case the environment variable already supported.
- **Subdomains still match the domain that was listed**, as before:
  `paula@mail.acme.com` matches a tenant that claimed `acme.com`.
- **The sync's "us" set reads the same rows.** `GoogleMatchService.internalIdentity`
  takes an `organizationId` and builds its domains from that tenant's entries and
  its addresses from that tenant's `Member` rows — not from every `User` in the
  install, which is what it used to do. Two sources for one fact is how a
  colleague becomes a lead; two *tenants* in one source is how another asset
  manager's staff become your leads.

### `ALLOWED_SIGN_IN` is a seed now, not the model

The variable still works and a fresh clone still runs exactly as
[the README](../../README.md) describes — but it is read **once**, to create the
first tenant, and never consulted again.

- **The seed only fires while the whole table is empty.** `seedBootstrapTenant`
  checks that before doing anything, so the moment any tenant has an entry the
  environment stops having an opinion. That one rule covers both cases: a fresh
  clone with no organization at all, and an existing install whose `workspace`
  row predates this change and needs its entries backfilled.
- **An empty table and an empty variable still fails closed.** Nobody signs in.
  That is upstream's rule and there was no reason to soften it.
- **Adding the second tenant is not a variable.** It is rows, and there is no UI
  for it yet — see the gaps below.

### The Google `hd` hint is gone

`socialProviders.google` used to pin `hd` to the first domain in the
environment's list. That is a hint that *restricts which Google account can
complete the flow*, so with more than one asset manager it locks out every
tenant but whichever one happened to be first in a variable. It is removed;
`databaseHooks.user.create.before` was always the actual gate, and it now
refuses with a message the reader can act on instead of Google refusing with one
they cannot.

## What is scoped, and what is not yet

Scoped in this change:

| Surface | How |
| --- | --- |
| `WorkspaceService` | every read and write takes the caller's `organizationId` |
| `SsoService` | same, plus `remove` refuses a provider another tenant owns |
| `GoogleMatchService.internalIdentity` | that tenant's members and entries |
| Gmail and Calendar sync | the mailbox owner's tenant, or the mailbox is skipped |

**Not scoped yet, and each is its own feature:**

- **The agent** — `readWorkspaceProfile`, `readWorkspaceIdentity` and
  `writeWorkspaceProfile` still key on `WORKSPACE_ID`, because the agent's tasks,
  preambles and tools have no tenant to pass them yet. Its documented permission
  to read everything including email bodies is justified in
  [`docs/agent.md`](../agent.md) by being single tenant, and that justification
  no longer holds.
- **`sso.signInOptions`** is the one public procedure, and it has no session to
  take a tenant from — so it lists every provider on the install. It returns only
  a provider id and a display name, never a secret, but it does let a stranger
  enumerate which asset managers are on this deployment. Scoping it needs a
  tenant hint in the sign-in URL, which the slug in `proxy.ts` could carry.
- **`ssoProvider.providerId` is globally unique**, which is the plugin's schema,
  so two tenants cannot both register a provider called `okta`. The cross-tenant
  *delete* is closed; the naming collision is not.
## The CRM records: one rule, not 212 edits

`Company`, `Contact`, `Deal`, `DealContact` and `Activity` carry an
`organizationId`, and **no service reads or writes it in a `where` clause.** A
Prisma client extension (`packages/db/src/tenant-extension.ts`) injects the
predicate into every operation on those five models, so the 153 query sites in
`apps/api/src` are untouched and still match upstream line for line. That is the
whole point: hand-editing them is how a fork stops being rebaseable.

- **The scope is ambient, and it is `AsyncLocalStorage`.**
  `withTenant(organizationId, run)` in
  [`@crm/db/tenant-scope`](../../packages/db/src/tenant-scope.ts) is the only way
  in. `AuthMiddleware` wraps every tRPC call in it, so a procedure is inside its
  caller's workspace before a service is reached.
- **No scope is a refusal, not a default.** A query on one of the five models
  with nothing in scope throws `MissingTenantScopeError` naming the model and the
  operation. The alternative — falling through unscoped — is a silent
  cross-tenant read, which is the one failure this whole change exists to
  prevent. `acrossTenants("why", …)` is the explicit escape, and it is greppable.
- **Reads are automatic; writes are compiler-enforced.** The extension stamps
  `organizationId` onto a create, but Prisma's own types still require the field,
  so every create site names its workspace — `organizationId: tenantId()`. That
  is the better half of the deal: a record written without saying whose it is
  should not compile.
- **`findUnique`, `update` and `delete` take the predicate too.** Prisma's
  extended where-unique accepts a non-unique filter beside the unique one, so
  fetching another workspace's row by id returns `null` and updating it raises
  `P2025`. Both are pinned in `apps/api/test/tenancy.integration.spec.ts`.
- **`domain` and `email` are unique per workspace**, not per install:
  `@@unique([organizationId, domain])` and `@@unique([organizationId, email])`.
  Two asset managers can hold the same prospect. It also means a lookup by
  domain or address is now a compound key, which is the one call-site shape the
  extension cannot fix for you.
- **The raw SQL carries the predicate by hand.** `$executeRaw` bypasses
  extensions entirely, so `ActivityStampService` adds `"organizationId" = …` to
  every statement, including the sub-selects over `activity`. A raw statement
  added later and left unscoped is invisible to every guard in this file.

### The one trap: a `PrismaPromise` is lazy

`withTenant(id, () => db.company.findMany())` **does not work.** Prisma's promise
does not execute until it is awaited, and the `await` happens after `withTenant`
has returned — so the query runs with the scope already gone and throws. Write
`withTenant(id, async () => db.company.findMany())`, or await inside the
callback. Everything in a request is fine, because the whole request runs inside
the scope; this only bites when a query is handed *out* of one.

### What the agent does in the meantime

The agent has no tenant plumbing, and its sessions run in async contexts the
dispatcher's scope does not reach. So `agent.ts` resolves the install's **only**
workspace at boot and sets it for the process (`setSingleTenantProcess`).

That is a stopgap and it is written to fail loudly rather than quietly: with more
than one workspace, `soleTenantId()` refuses, the agent logs that it cannot
decide who it works for, and every CRM read refuses. The day a second asset
manager is added, the agent stops — which is the correct behaviour for a process
whose documented permission is to read everything including email bodies.

`setSingleTenantProcess` has exactly one caller and must keep it. Called anywhere
in the API it would give every request a fallback workspace, which is precisely
the silent cross-tenant read the extension refuses.

## The invitation flow stays off, deliberately

Better Auth's `invitation` table is created because the plugin owns its schema,
and nothing writes to it. Upstream's reasoning was that `ALLOWED_SIGN_IN` already
decides who may sign in, so an invitation would be a second, quieter answer to
the same question. That reasoning survives the move to rows unchanged: a tenant's
`AllowedSignIn` entries are the answer, and signing in is still the join.

It is worth revisiting only if an asset manager needs to admit one person without
admitting their whole domain — which the rows already express as a single
address entry, so the case is thinner than it looks.

## The rebase cost, stated plainly

Every file this touched outside `docs/steplabs/` is a file upstream also changes,
and `docs/api.md`'s first rule is the one being broken. Scoping the CRM records
will be worse: it edits the services upstream develops most.

Two things keep it manageable and both are worth defending in review:

- **Prefer a change upstream would recognise.** Resolving the tenant from the
  session rather than threading an `organizationId` argument through every
  signature is not only better, it is a smaller diff against whatever upstream
  writes next.
- **The records were scoped with a Prisma client extension**, not by hand. The
  153 `where` clauses in `apps/api/src` are unchanged, so upstream's edits to
  those services still apply cleanly. What did change is the create sites — one
  line each, which the compiler demanded — and the handful of lookups by domain
  or address that became compound keys.
