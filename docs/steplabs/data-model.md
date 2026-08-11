# The CRM data model, and how it lines up with FundReporting

Deliverable for ClickUp [86cb2yvy3](https://app.clickup.com/t/86cb2yvy3) —
*CRO: set up the foundation*. Step 1 asks what this fork already models; step 2
asks how it reaches FundReporting. This file answers the first and states the
decision the second one depends on.

Two things the task's wording gets wrong, and both change the plan:

- **"Try Compile"** is `trycompai/crm` — Comp AI's agentic CRM, MIT licensed. Our
  fork is `Step-Labs-XYZ/crm`, cloned at `~/workspaces/step-labs/crm`.
- **FundReporting has no database we can connect to.** All of its data is in
  **Xano**, reached over HTTP with the caller's bearer token; the Next.js app is
  a proxy in front of it. So "connect it to the FundReporting database" is not
  an option that exists — the choice is only *which* API shape we build.

---

## 1. What the CRM models

Postgres via Prisma (`packages/db/prisma/schema.prisma`, 703 lines). Three
records carry the CRM, and everything else hangs off them.

### Company

`company` — the account. Keyed on a unique `domain`, which is also the join the
Gmail/Calendar sync uses to file a stranger's address against an account.

| Group | Fields |
|---|---|
| Identity | `name`, `domain` (unique), `website`, `description` |
| Artwork | `logoUrl`, `logoDarkUrl`, `iconUrl`, `iconDarkUrl`, `iconTone`, `brandColor` |
| Firmographics | `industry`, `subIndustry`, `city`, `stateCode`, `country`, `countryCode` |
| Channels | `phone`, `email`, `linkedinUrl`, `twitterUrl`, `githubUrl`, `pricingUrl`, `careersUrl` |
| Ownership | `ownerId` → `User`, `primaryContactId` → `Contact` |
| Enrichment | `enrichmentStatus` (PENDING/RUNNING/COMPLETE/FAILED/SKIPPED), `enrichedAt`, `enrichmentError`, `companyEnrichment.raw` (vendor payload, kept) |
| Provenance | `source` (MANUAL/IMPORT/EMAIL/CALENDAR), `lastActivityAt` |

### Contact

`contact` — the person. `email` is unique and is the identity key everywhere:
the sync knows people only by address, and deleting a contact writes a
`SuppressedContact` row on that address so the next inbound thread does not
recreate them.

`firstName`, `lastName`, `email`, `phone`, `title`, `linkedinUrl`, `twitterUrl`,
`githubUrl`, `imageUrl`, plus `companyId`, `ownerId`, `source`,
`lastActivityAt`, and the same enrichment triple as Company.

### Deal

`deal` — the opportunity. **`companyId` is required**; a deal cannot exist
without an account. People attach through `dealContact` (composite PK
`dealId + contactId`, optional `role`), so a deal has many contacts.

`name`, `companyId`, `ownerId`, `stage`, `stageChangedAt`, `amount`
(`Decimal(14,2)`), `currency` (default `USD`), `expectedCloseDate`, `closedAt`,
`closedReason`, `lastActivityAt`.

### Pipeline stages

A **fixed Prisma enum**, `DealStage` — not a table, so stages are a migration
and a regenerated client, not configuration:

```
DEMO_BOOKED → QUALIFIED_TO_BUY → DECISION_MAKER_BOUGHT_IN → CONTRACT_SENT → CLOSED_WON
                     ↘ UNQUALIFIED_TO_BUY                              ↘ CLOSED_LOST
```

`stageChangedAt` is what the board's stage clock reads. A stage change also
writes an `Activity` of type `STAGE_CHANGE`, so the history is in the timeline
rather than only in the current value.

### Activity

`activity` — one timeline for all three records. `type` is
NOTE/CALL/EMAIL/MEETING/TASK/STAGE_CHANGE/ENRICHMENT; `companyId`, `contactId`
and `dealId` are all nullable and independent, so one row can be filed against
any combination. `dueAt`/`completedAt` make it double as the task list.
`emailThreadId` and `calendarEventId` are unique FKs — that is how a synced
thread becomes exactly one timeline entry.

### What sits on top

- **Intelligence** (`apps/agent`, an eve app on :2000): `ContactFact` is the
  evidence ledger — `field`, `value`, `score`, `band` (VERIFIED/PROBABLE/
  POSSIBLE), `evidence` JSON, `status` (APPLIED/PROPOSED/DISMISSED/SUPERSEDED).
  A fact writes through to the contact only at VERIFIED, never over a human
  edit. `ContactBrief` is the written narrative; `AgentTask`/`AgentEvent` are
  the work queue and the audit trail.
- **Google sync**: `MailboxSync`, `EmailThread`, `EmailMessage`,
  `CalendarEvent`, `CalendarAttendee`, plus `SuppressedDomain`/
  `SuppressedContact`. Forward-only — nothing before the first sync is imported.
- **Auth/workspace**: Better Auth (`User`, `Session`, `Account`, `Member`,
  `Organization`, `SsoProvider`). The organization is a **singleton** whose id
  is the literal string `workspace`.

### The two structural facts that constrain integration

1. **Single tenant, deliberately.** Upstream removed `organizationId` from every
   CRM record and documents the removal as a rule (`docs/api.md`). A company, a
   contact, a deal and an activity are scoped by nothing. FundReporting is
   multi-tenant by asset manager, with ~250 live investor customers.
2. **No integration surface.** The data surface is tRPC, for its own front end
   only. The only REST controllers are `/api/auth/*`, `/health`, and two
   internal agent routes guarded by a shared secret. No public REST, no
   webhooks, no API keys.

---

## 2. What FundReporting already has

The equivalent pipeline exists and is called `investor_lead` (Xano table,
proxied by `app/api/investor-leads/*`).

```
lead → prospect → qualified → onboarding → investor
```

`id`, `name`, `email`, `phone`, `company` *(a string, not a record)*, `status`,
`notes`, `address` (object), `interests[]` (`{fund, share_class,
committed_amount}`), `investor_classification` (retail/professional/
institutional), `referrer_email`, `created_at`, and on conversion
`converted_at` + `converted_to_shareholder`.

Two behaviours matter more than the fields:

- **A qualification gate.** Moving *to* `qualified` requires at least one fund
  interest, at least one committed amount > 0, and an investor classification
  (`qualificationGateItems` in `components/lead-sheet.tsx`).
- **Conversion is a four-step write, not a status change**
  (`app/api/investor-leads/[id]/convert/route.ts`): create an AM-level
  `cap_table_shareholder` → create its `cap_table_entry` with the total
  commitment → create a shareholder + entry **per fund interest**, parented to
  the AM shareholder → PATCH the lead to `investor`. It is not atomic; partial
  failures come back as `207` with a `partial` payload. Leads also carry
  compliance records (KYC/AML) and documents.

---

## 3. How the two line up

| CRM | FundReporting | Fit |
|---|---|---|
| `Contact` | `investor_lead` (person fields) | Good. Both keyed on email. |
| `Company` | `investor_lead.company` | **Poor.** A free-text string on their side vs. a first-class record with a unique domain on ours. |
| `Deal` | `investor_lead.interests[]` | **Poor.** One deal = one company; one lead = N fund interests, each with its own share class and amount. Their unit is the *interest*, ours is the *deal*. |
| `DealStage` (7, enum) | `status` (5, string) | Different vocabularies, both closed. `CLOSED_WON` ≈ `investor`, and that is the only defensible mapping. |
| `Activity` | notes + `tasks` | Ours is richer, theirs is split. |
| `ContactFact` / `ContactBrief` / the agent | — | **No equivalent.** This is the whole reason we forked. |
| Gmail/Calendar sync | — | No equivalent. |
| (none) | compliance records, documents, cap table | No equivalent on our side, and none should be built. |

**The value flows one way.** Everything the CRM has that FundReporting lacks is
top-of-funnel: research, evidence, inbox and calendar capture. Everything
FundReporting has that the CRM lacks — commitments, compliance, cap tables,
money — is post-conversion and regulated. That asymmetry is the argument for
where the seam goes.

---

## 4. The decision, and what it costs

**Decided 2026-08-10.** Andrea confirmed the audience: *"debería ser para todos.
El servicio de ellos incluye CRM + Asset Manager, por lo que reusa la data de
los clientes en la plataforma."* So the CRM is **multi-tenant, one per asset
manager**, and it is expected to **reuse each AM's existing platform data**.
Daniel chose **shape C** for the integration seam.

Those two answers are compatible, but they are not the same size of work, and
the second one is not free. Read the rest of this section as: C is the seam,
tenancy is the prerequisite, and "reuse the platform data" is a third thing
neither of them covers.

### The three shapes considered

**A — Xano as the source of truth.** Replace Prisma with calls to the Xano API.
Every tRPC service is Prisma-native (`findMany` with facet counts, `resolveOrderBy`,
`FOR UPDATE` transactions), and the agent writes facts transactionally. This is
not an integration, it is rewriting the product. **Not recommended.**

**B — Two databases, continuous sync.** The CRM keeps Postgres; a new Nest
module reconciles `Contact`/`Deal` against `investor_lead` in both directions.
Requires deciding who owns a record mid-pipeline, and every field where the
models disagree (one company string vs. one company record, N interests vs. one
deal) becomes a conflict rule someone has to maintain. Real, and expensive.

**C — One-way handoff at conversion.** The CRM owns prospecting; FundReporting
owns everything from the commitment onward. A deal reaching `CLOSED_WON` creates
or updates the `investor_lead` in Xano — one integration point, one direction,
mapping only the fields both sides agree on. Compliance, cap tables and money
never leave Xano. **Recommended** as the first step; it does not preclude B.

Under C the CRM needs an outbound client (`PLATFORM_API_URL` + a service token,
which FundReporting already issues as `PLATFORM_SERVICE_TOKEN`), which lands in
the API rather than the agent — it files, it does not decide, so it stays on the
right side of `docs/api.md`'s first rule.

### Tenancy is now a prerequisite, and here is its measured size

> **Started.** The auth and workspace half has landed — the tenant is resolved
> from the signed-in address and the allow-list is per workspace. The 212 CRM
> query sites below are still unscoped. [`tenancy.md`](./tenancy.md) is the
> living record; the measurement here is what it was sized against.

Upstream did not merely leave tenancy out — it removed it and wrote the removal
down as a rule. Reintroducing it is the larger half of this project. Measured
against the tree on 2026-08-10:

| Surface | Count |
|---|---|
| Query sites on CRM models in `apps/api/src` | **153**, across 21 files |
| Query sites on CRM models in `apps/agent` + `packages/db` | **59**, across 12 files |
| Uses of the `WORKSPACE_ID` constant | **39** |
| Files with raw SQL that would need scoping | 4 — notably `crm/activity-stamp.service.ts` (per-table `UPDATE … SET lastActivityAt = (SELECT MAX(…))`) and `agent/lib/tasks.ts` (`FOR UPDATE SKIP LOCKED`) |

Every one of those 212 sites currently queries with no tenant predicate, because
there is nothing to predicate on.

**One piece of good news.** Better Auth's `organization` plugin is already
installed and its tables already exist — `Organization`, `Member`, `Invitation`,
`SsoProvider`. The singleton is a *convention* (`WORKSPACE_ID` is the literal
string `workspace`), not a missing capability, and the `invitation` table is
created and deliberately unused. So the auth half is closer to *stop treating
the plugin as a singleton* than to *build tenancy*. That does not shrink the 212
query sites, but it removes the schema and invite-flow work.

**Three things tenancy breaks that are not query predicates**, and they are the
ones worth flagging early because each is a decision rather than a refactor:

1. **The agent's read rule.** `docs/agent.md` grants it *everything, including
   full email bodies*, justified explicitly by "single-tenant internal tool". In
   a multi-tenant install that premise is gone: one AM's agent session must not
   be able to reach another's mail. The egress rules and the session preamble
   both assume one workspace.
2. **`ALLOWED_SIGN_IN` stops being an authorisation model.** It is one global
   comma-separated list, read by both the sign-in guard and the sync's
   internal-vs-external decision. With N asset managers it has to become
   per-tenant, and the sync's "us" set has to follow it.
3. **Gmail/Calendar sync becomes per-tenant.** Each AM connects its own
   mailboxes, so `MailboxSync`, the suppression lists and the participant
   filter all need scoping too.

**Recommendation on the tenant key: mirror the platform, do not invent one.**
The CRM's tenant should *be* FundReporting's asset-manager entity id, not a
parallel id the two systems then have to keep in step. That also makes "reuse
the client data in the platform" expressible — the tenant is already the join.

### "Reuse the platform data" is a fourth requirement, not part of C

Shape C is write-only and fires once, at conversion. Andrea's sentence asks for
something else as well: that an AM's CRM shows the investors and entities it
already has in the platform. That is a **read** path from Xano, and it is not
covered by the handoff.

It does not change the choice of C — the seam is still the right one — but it
needs its own decision, and the same three shapes apply to it in miniature:
read-through on demand, cached mirror, or full sync. Recommend read-through
first (an AM's existing investors shown as read-only records sourced from Xano),
because a cached mirror of regulated data is a second copy of the cap table and
should not be built until somebody asks for it in writing.

---

## 5. What step 2 turns into

Given the above, the honest sequencing is:

1. **Confirm the tenant key with the client** — that the CRM's tenant is the
   asset-manager entity id in Xano, and that a rep belongs to exactly one.
2. **Reintroduce tenancy** across the 212 query sites, the 39 `WORKSPACE_ID`
   uses and the raw SQL, plus the three non-refactor decisions above. This is
   the bulk of the work and it is not a two-day task.
3. **Build the C handoff**: an outbound Xano client in `apps/api` (using
   `PLATFORM_API_URL` + `PLATFORM_SERVICE_TOKEN`, which FundReporting already
   issues), firing when a deal reaches `CLOSED_WON`, mapping only the fields
   both models agree on. It files and decides nothing, so it belongs in the API
   rather than the agent — `docs/api.md`'s first rule.
4. **Read-through of existing platform investors**, once its shape is decided.

Step 3 is small and well understood; step 2 is what the estimate hangs on.
Sequencing 3 before 2 is possible — a single-tenant handoff proves the mapping
end to end and is not wasted work — but it must not be mistaken for the
integration being done.

---

## 6. Status of step 1

Running locally as of 2026-08-10, verified: `app` :3000 (`/sign-in` 200), `api`
:3001 (`/health` 200), `agent` :2000 (401 without the bridge secret, which is
the documented refuse-when-unset behaviour), Postgres :5436. Seeded with 15
companies, 45 contacts, 23 deals, 164 activities.

Two caveats carried over from `local-dev.md`: sign-in still runs on the minted
preview session because there is no Google OAuth client, and `contactFact` and
`agentTask` are both empty — the agent has no real context.dev key, so nothing
it does can be evaluated yet.

One new observation: under `bun run dev` the tRPC generator re-emits
`AppRouter` every ~200ms in a watch loop. Harmless, but it makes the dev log
unreadable — filter it out when reading errors.
