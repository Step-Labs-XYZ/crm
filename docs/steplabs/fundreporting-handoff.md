# Step Labs — the FundReporting handoff

This is step 2 of ClickUp 86cb2yvy3. The ticket offers "connect it to the
FundReporting database, or design the API layer" — and there is no database, so
it was only ever the second. All of FundReporting's data is in **Xano**, reached
over HTTP; the Next.js app in `fundreporting-v2` is a proxy in front of it.

The seam is deliberately small: **one write, in one direction, at one moment.**

## What crosses, and what never does

A deal reaching `CLOSED_WON` creates or updates that person's `investor_lead` on
FundReporting's side. That is the whole of it.

**Nothing else leaves the CRM, and nothing comes back.** Compliance records,
cap tables, capital calls, share classes and money stay in Xano, where they are
already regulated and audited. The CRM is where a rep works a prospect; the
platform is where an investor exists. Those are different jobs and the handoff
is the one place they touch.

Three shapes were considered. A shared database is impossible — there is no
database. Two-way sync would put a second copy of cap-table data in a system
that has no business holding it. So: a one-way handoff at conversion.

## The mapping, field by field

`apps/api/src/fundreporting/investor-lead.mapper.ts` is pure and has no I/O, so
every decision below is a unit test rather than a comment.

| Their field | What we send | Why |
| --- | --- | --- |
| `asset_manager` | the workspace's `assetManagerId` | Their leads are filtered by it. Without it we cannot file at all — see below. |
| `name` | the deal contact's name | Falls back to the company, then the deal name. A lead with no name is not useful to anybody. |
| `email`, `phone` | the deal contact's | Omitted entirely when unknown, rather than sent empty. |
| `company` | the company's name | Free text on their side, a first-class record with a unique domain on ours. This is the lossy one. |
| `status` | `prospect`, **on create only** | See below. |
| `notes` | deal name, value, close date | Where the deal context goes, because it has nowhere structured to live. |

**Never sent, and this is the load-bearing part:** `interests`,
`committed_amount`, `investor_classification`, `converted_at`,
`converted_to_shareholder`, or anything else touching money, compliance or the
cap table. A test asserts their absence by name, so adding one is a deliberate
act rather than an accident.

### Why the lead lands at `prospect`

`CLOSED_WON` in the CRM means a rep won the deal. It does **not** mean the person
is an investor — on FundReporting's side that requires their qualification gate
(at least one fund interest, a committed amount above zero, and a classification)
and then a four-step conversion that writes shareholders and cap-table entries.

The CRM can supply none of those and must never perform that conversion. So the
lead lands short of the gate, at `prospect`, and their team takes it from there.

**An update never carries `status` at all.** Once their team has the lead, moving
it is their call: a re-fired stage change would otherwise drag a qualified lead
back to `prospect`, which is worse than not writing at all.

### Their unit is the interest; ours is the deal

One lead carries N fund interests, each with its own share class and committed
amount. One deal belongs to one company. There is no honest automatic mapping
between those, and inventing one would mean the CRM writing money. The deal's
value goes in the note, as prose, for a human to act on.

## Filing exactly once

`InvestorLeadHandoff` holds one row per deal — `dealId` is unique, and that
constraint *is* the idempotency rather than a check that could race.

- **Already filed** → the stored `leadId` is updated. A stage change fired twice
  does not create a second lead.
- **Not filed, but they already know the person** → the lead list for that asset
  manager is fetched and matched on email, so a prospect who already exists is
  updated rather than duplicated. Their API has no email filter, so this reads
  the asset manager's leads and matches in memory — fine at the current scale
  (~250 investors), and the first thing to revisit if that changes.
- **Neither** → a lead is created.

## Refusing beats guessing

A workspace that has not been told which asset manager it is **refuses to file**
and says so. It does not fall back to the first asset manager, and it does not
file without one.

That is the same rule as everywhere else in this fork's tenancy work, and here
it is the difference between a rep's won deal landing in their own book or in
somebody else's. `organization.assetManagerId` is nullable with no default for
exactly this reason.

The same applies to configuration: no `PLATFORM_API_URL` or
`PLATFORM_SERVICE_TOKEN` and the handoff is a capability the install does not
have. The deal still closes, the row records `REFUSED` with the reason, and
nothing throws — the rule from `docs/environment.md` that a missing key removes
a capability and never breaks the product.

## A failure is visible and retryable

The handoff is fired **after** the stage change commits and is never awaited by
it. Failing a rep's stage change because somebody else's API is down would be
the wrong trade.

So the outcome is a row, not an exception:

| State | Means |
| --- | --- |
| `SENT` | filed, `leadId` recorded |
| `FAILED` | the platform was reachable and unhappy (5xx, 429, timeout) — worth retrying |
| `REFUSED` | we will not file: no asset manager, or not configured. Retrying changes nothing until a human does |
| `PENDING` | written, not yet settled |

`fundreporting.outstanding` lists everything in `FAILED` or `REFUSED` with its
reason, and `fundreporting.retry` re-runs one. The distinction between the two
failure states matters: one is a wait, the other is a person's decision.

## What has been checked against the real API, and what has not

`fundreporting-v2/.env.local` holds **half** of what this needs, so part of the
contract is now confirmed rather than inferred.

**Confirmed, by unauthenticated read-only calls against their Xano host:**

| Call | Answer | What it settles |
| --- | --- | --- |
| `GET /investor_lead` | `401 ERROR_CODE_UNAUTHORIZED` | The path is right and it requires auth |
| `GET /nonsense_endpoint` | `404` | So the 401 above is the endpoint, not a blanket refusal |
| `GET /investor_lead?asset_manager=1` | `400 "Not a valid UUID."` | The parameter is real, it is validated, and **it is a UUID** |

That last one is the useful one, and it changed the code: a workspace whose
`assetManagerId` is not a UUID is refused **before** any call goes out, with a
sentence somebody can act on, rather than being sent and coming back as an
opaque 400.

**Still missing: `PLATFORM_SERVICE_TOKEN`.** It is not in `.env.local` — the file
has `PLATFORM_API_URL`, `XANO_API_URL` and `XANO_PROXY_SECRET`, and that third
one is not a substitute: it is the shared secret for their *login* proxy
(`request-code`, `verify-code`), and what it mints is a **user's** session token
after an emailed code. A background handoff cannot log in as a person.

So two things are still needed before this can run for real, and only one of them
is a credential:

1. **A `PLATFORM_SERVICE_TOKEN` that may write `investor_lead`**, or a decision
   that the handoff should authenticate some other way. Their own codebase uses
   that variable in exactly one route, for a cron, so the pattern exists but is
   barely exercised.
2. **The asset-manager UUID for each workspace.** We now know the shape; what we
   do not have is which UUID belongs to which asset manager. That is the
   tenant-key conversation, and it is the one thing that decides where a won deal
   lands.

The field names on `investor_lead` are still read from their UI and proxy routes
rather than from a schema. The first authenticated call will confirm or correct
them, and the mapper is one pure file with no I/O precisely so that correcting it
is cheap.
