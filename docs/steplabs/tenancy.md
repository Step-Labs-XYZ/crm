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

- **The CRM records themselves** — `Company`, `Contact`, `Deal`, `Activity` carry
  no `organizationId`, so every rep still reads every record. This is the large
  one: 153 query sites in `apps/api/src` and 59 in the agent and `packages/db`.
  Until it lands, **this install is not safe to point at two real asset
  managers.**
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
- **`Contact.email` and `Company.domain` are globally unique.** Two asset
  managers cannot both have a contact at the same address, and the second one to
  try gets a conflict about a record they cannot see. These constraints have to
  become composite with the tenant when the records are scoped.

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
- **When the records are scoped, do it with a Prisma client extension** that
  injects the tenant filter, rather than hand-editing 212 `where` clauses. The
  services then stay byte-identical to upstream and the rule lives in one file
  that upstream has no opinion about. Hand-editing the call sites is how this
  fork becomes unrebaseable.
