import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, withTenant } from "@crm/db";
import { readCompanyHistory } from "../agent/lib/accounts";
import { readCrmHistory } from "../agent/lib/crm";
import { searchCrm } from "../agent/lib/lookup";

const suffix = (process.env.TEST_RUN_ID ?? "read-boundary").replace(
	/[^a-z0-9]+/gi,
	"-",
);

const A = `${suffix}-ours`;
const B = `${suffix}-theirs`;
const REP = `${suffix}-rep`;

type Fixture = {
	companyId: string;
	contactId: string;
	threadId: string;
	factId: string;
};

let ours: Fixture;
let theirs: Fixture;

async function seed(organizationId: string, label: string): Promise<Fixture> {
	await db.organization.create({
		data: {
			id: organizationId,
			name: organizationId,
			slug: organizationId,
			createdAt: new Date(),
		},
	});

	return withTenant(organizationId, async () => {
		const company = await db.company.create({
			data: {
				organizationId,
				name: `${label} Holdings`,
				domain: `${label}.${suffix}.example.test`,
			},
			select: { id: true },
		});

		const contact = await db.contact.create({
			data: {
				organizationId,
				firstName: label,
				lastName: "Marchetti",
				email: `${label}@${label}.${suffix}.example.test`,
				companyId: company.id,
			},
			select: { id: true },
		});

		const thread = await db.emailThread.create({
			data: {
				organizationId,
				rootMessageId: `<root-${label}-${suffix}@example.test>`,
				subject: `${label} — commitment terms`,
				companyId: company.id,
				contactId: contact.id,
				firstMessageAt: new Date(),
				lastMessageAt: new Date(),
				messageCount: 1,
			},
			select: { id: true },
		});

		await db.emailMessage.create({
			data: {
				organizationId,
				threadId: thread.id,
				rfcMessageId: `<msg-${label}-${suffix}@example.test>`,
				direction: "INBOUND",
				fromEmail: `${label}@${label}.${suffix}.example.test`,
				recipients: [],
				subject: `${label} — commitment terms`,
				body: `${label} is committing four million.`,
				sentAt: new Date(),
			},
		});

		const fact = await db.contactFact.create({
			data: {
				organizationId,
				contactId: contact.id,
				field: "title",
				value: `${label} Chief Investment Officer`,
				score: 1,
				band: "VERIFIED",
				evidence: {},
				method: "crm.signature-block",
			},
			select: { id: true },
		});

		return {
			companyId: company.id,
			contactId: contact.id,
			threadId: thread.id,
			factId: fact.id,
		};
	});
}

const clear = async () => {
	await db.organization.deleteMany({ where: { id: { in: [A, B] } } });
	await db.user.deleteMany({ where: { id: REP } });
};

beforeAll(async () => {
	await clear();

	await db.user.create({
		data: { id: REP, name: "Rep", email: `${REP}@example.test` },
	});

	ours = await seed(A, "ours");
	theirs = await seed(B, "theirs");
});

afterAll(clear);

describe("a session opened on one workspace cannot read another's", () => {
	it("cannot read the other workspace's mail", async () => {
		await withTenant(A, async () => {
			expect(
				await db.emailMessage.findMany({ select: { body: true } }),
			).toHaveLength(1);

			expect(
				await db.emailThread.findUnique({ where: { id: theirs.threadId } }),
			).toBeNull();

			const bodies = await db.emailMessage.findMany({ select: { body: true } });
			expect(bodies.some((row) => row.body?.includes("theirs"))).toBe(false);
		});
	});

	it("cannot read the other workspace's facts or brief", async () => {
		await withTenant(A, async () => {
			expect(
				await db.contactFact.findUnique({ where: { id: theirs.factId } }),
			).toBeNull();

			const facts = await db.contactFact.findMany({ select: { value: true } });
			expect(facts.every((row) => row.value.startsWith("ours"))).toBe(true);
		});
	});

	it("finds nothing when it searches for the other workspace's people", async () => {
		const found = await withTenant(A, async () => searchCrm("Marchetti"));
		const serialised = JSON.stringify(found);

		expect(serialised).toContain("ours");
		expect(serialised).not.toContain("theirs");
	});

	it("refuses to open the other workspace's contact history", async () => {
		const history = await withTenant(A, async () =>
			readCrmHistory(theirs.contactId),
		);

		expect(history).toBeNull();
	});

	it("refuses to open the other workspace's account history", async () => {
		const history = await withTenant(A, async () =>
			readCompanyHistory(theirs.companyId),
		);

		expect(history).toBeNull();
	});

	it("still reads its own records perfectly well", async () => {
		const [history, account] = await Promise.all([
			withTenant(A, async () => readCrmHistory(ours.contactId)),
			withTenant(A, async () => readCompanyHistory(ours.companyId)),
		]);

		expect(history).not.toBeNull();
		expect(account).not.toBeNull();
	});
});
