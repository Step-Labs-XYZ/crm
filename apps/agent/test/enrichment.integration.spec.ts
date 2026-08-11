import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { db, EnrichmentStatus, withTenant } from "@crm/db";
import { WORKSPACE_ID } from "@crm/db/workspace";
import { markRunning, settle } from "../agent/lib/enrichment";

const TEST_TENANT = WORKSPACE_ID;

const scoped =
	<T>(run: () => Promise<T>) =>
	() =>
		withTenant(TEST_TENANT, run);

const domain = "lifecycle.example.test";

async function clear() {
	await db.company.deleteMany({ where: { domain } });
	await db.contact.deleteMany({
		where: { email: { startsWith: "lifecycle-" } },
	});
}

beforeEach(scoped(clear));
afterEach(scoped(clear));

async function company() {
	return await db.company.create({
		data: { organizationId: TEST_TENANT, name: "Lifecycle", domain },
		select: { id: true },
	});
}

async function contact() {
	return await db.contact.create({
		data: {
			organizationId: TEST_TENANT,
			firstName: "Lifecycle",
			email: `lifecycle-${crypto.randomUUID()}@example.test`,
		},
		select: { id: true },
	});
}

function subjectOf(ids: { contactId?: string; companyId?: string }) {
	return {
		id: "task",
		kind: "test",
		contactId: ids.contactId ?? null,
		companyId: ids.companyId ?? null,
	};
}

async function statusOfContact(id: string) {
	const row = await db.contact.findUnique({
		where: { id },
		select: { enrichmentStatus: true, enrichedAt: true },
	});
	return row;
}

describe("the record follows the task", () => {
	it(
		"takes a contact off PENDING, which nothing used to do",
		scoped(async () => {
			const person = await contact();
			const subject = subjectOf({ contactId: person.id });

			expect((await statusOfContact(person.id))?.enrichmentStatus).toBe(
				"PENDING",
			);

			await markRunning(subject);
			expect((await statusOfContact(person.id))?.enrichmentStatus).toBe(
				"RUNNING",
			);

			await settle(subject, EnrichmentStatus.COMPLETE);
			const done = await statusOfContact(person.id);
			expect(done?.enrichmentStatus).toBe("COMPLETE");
			expect(done?.enrichedAt).not.toBeNull();
		}),
	);

	it(
		"does the same for a company",
		scoped(async () => {
			const org = await company();
			const subject = subjectOf({ companyId: org.id });

			await markRunning(subject);
			await settle(subject, EnrichmentStatus.COMPLETE);

			const row = await db.company.findUnique({
				where: { id: org.id },
				select: { enrichmentStatus: true },
			});
			expect(row?.enrichmentStatus).toBe("COMPLETE");
		}),
	);

	it(
		"lets a tool's more specific answer win over the queue's",
		scoped(async () => {
			const org = await company();
			const subject = subjectOf({ companyId: org.id });

			await markRunning(subject);

			await db.company.update({
				where: { id: org.id },
				data: {
					enrichmentStatus: EnrichmentStatus.SKIPPED,
					enrichmentError: "No domain to look up.",
				},
			});

			await settle(subject, EnrichmentStatus.COMPLETE);

			const row = await db.company.findUnique({
				where: { id: org.id },
				select: { enrichmentStatus: true, enrichmentError: true },
			});
			expect(row?.enrichmentStatus).toBe("SKIPPED");
			expect(row?.enrichmentError).toBe("No domain to look up.");
		}),
	);

	it(
		"puts a failed record back to work on a retry",
		scoped(async () => {
			const person = await contact();
			const subject = subjectOf({ contactId: person.id });

			await markRunning(subject);
			await settle(subject, EnrichmentStatus.FAILED, "the vendor refused");
			expect((await statusOfContact(person.id))?.enrichmentStatus).toBe(
				"FAILED",
			);

			await markRunning(subject);
			const retried = await statusOfContact(person.id);
			expect(retried?.enrichmentStatus).toBe("RUNNING");

			const row = await db.contact.findUnique({
				where: { id: person.id },
				select: { enrichmentError: true },
			});
			expect(row?.enrichmentError).toBeNull();
		}),
	);

	it(
		"survives a record deleted while the agent was still reading about it",
		scoped(async () => {
			const person = await contact();
			const subject = subjectOf({ contactId: person.id });

			await markRunning(subject);
			await db.contact.delete({ where: { id: person.id } });

			await settle(subject, EnrichmentStatus.COMPLETE);
		}),
	);
});
