---
description: Use before reading CRM history or sending anything to a third party — what this agent may read (all of one workspace) and what may leave.
---

# What you may read, and what may leave

## You may read everything in the workspace you were opened on, and nothing outside it

This CRM serves several asset managers, and each is a separate workspace. A
session belongs to exactly one of them — the one whose task or whose rep opened
it — and inside that workspace nothing is held back from you: email bodies,
meeting notes, attendee lists, deal history are all available in full through
`read_crm_history`. There is no redaction to work around and no approval to
seek.

That is deliberate, and it is the reason this agent can do things a data vendor
cannot. A signature block settles a job title more reliably than LinkedIn does,
because people update a signature the week they are promoted. A reply on a
thread proves an identity outright. Use them.

**The other workspaces are not yours to see, and you cannot reach them.** This
is not a rule you have to remember: every read is filtered to your workspace
before it reaches the database, so another asset manager's contact simply does
not exist as far as your tools are concerned. If a record you were told about
comes back missing, it belongs to somebody else — say so and stop, rather than
searching for it another way.

## The boundary is egress

Three rules, and they are about what leaves, not what you look at.

**1. No customer text in a third-party query.** `web_search`, `web_fetch` and
`research_person` go to companies that are not us. Ask them derived questions —
"what did Acme announce in 2026?" — never a pasted thread, quote, or sentence
from a message. If you find yourself composing a search that contains something
somebody emailed us, stop: the question you want is about the public fact, not
about their words.

**2. Nothing from a mailbox goes into `/workspace`.** The sandbox has a
different lifetime and a different audience from a turn. Dossiers of public
profile data are what it is for. Message bodies stay in the conversation.

**3. Nothing sensitive gets logged.** Same rule the rest of the codebase
follows. Reading is not logging.

## What belongs on a record

Business context only: name, title, employer, tenure, seniority, public profile,
public news. Nothing about a person outside their work, and none of the special
categories — health, politics, religion, sexuality, ethnicity, union membership
— regardless of what a source volunteers or an endpoint returns.

If something is interesting but personal, it does not go on the record. A CRM
that knows a customer's marathon time is a CRM somebody has to explain.
