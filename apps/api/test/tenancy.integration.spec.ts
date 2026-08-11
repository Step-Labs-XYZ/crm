import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, MissingTenantScopeError, withTenant } from "@crm/db";

const suffix = (process.env.TEST_RUN_ID ?? "tenancy-spec").replace(
	/[^a-z0-9]+/gi,
	"-",
);

const A = `${suffix}-alpha`;
const B = `${suffix}-beta`;
const SHARED_DOMAIN = `shared-${suffix}.example.test`;
const SHARED_EMAIL = `prospect@${SHARED_DOMAIN}`;
const userId = `${suffix}-rep`;

type Seeded = { companyId: string; contactId: string; dealId: string };

let alpha: Seeded;
let beta: Seeded;

async function seedTenant(organizationId: string) {
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
			data: { organizationId, name: organizationId, domain: SHARED_DOMAIN },
			select: { id: true },
		});

		const contact = await db.contact.create({
			data: {
				organizationId,
				firstName: "Shared",
				lastName: "Prospect",
				email: SHARED_EMAIL,
				companyId: company.id,
			},
			select: { id: true },
		});

		const deal = await db.deal.create({
			data: {
				organizationId,
				name: `${organizationId} deal`,
				companyId: company.id,
				ownerId: userId,
			},
			select: { id: true },
		});

		await db.activity.create({
			data: {
				organizationId,
				type: "NOTE",
				subject: `${organizationId} note`,
				companyId: company.id,
				dealId: deal.id,
				createdById: userId,
			},
		});

		return { companyId: company.id, contactId: contact.id, dealId: deal.id };
	});
}

async function clean() {
	for (const organizationId of [A, B]) {
		await db.organization.deleteMany({ where: { id: organizationId } });
	}
	await db.user.deleteMany({ where: { id: userId } });
}

beforeAll(async () => {
	await clean();

	await db.user.create({
		data: { id: userId, name: "Rep", email: `${userId}@example.test` },
	});

	alpha = await seedTenant(A);
	beta = await seedTenant(B);
});

afterAll(clean);

describe("a workspace reads its own records and no others", () => {
	it("lists only its own companies, contacts, deals and activities", async () => {
		await withTenant(A, async () => {
			const [companies, contacts, deals, activities] = await Promise.all([
				db.company.findMany({ select: { organizationId: true } }),
				db.contact.findMany({ select: { organizationId: true } }),
				db.deal.findMany({ select: { organizationId: true } }),
				db.activity.findMany({ select: { organizationId: true } }),
			]);

			for (const rows of [companies, contacts, deals, activities]) {
				expect(rows.length).toBeGreaterThan(0);
				expect(rows.every((row) => row.organizationId === A)).toBe(true);
			}
		});
	});

	it("cannot fetch another workspace's record by its id", async () => {
		await withTenant(A, async () => {
			expect(
				await db.company.findUnique({ where: { id: beta.companyId } }),
			).toBeNull();

			expect(
				await db.contact.findFirst({ where: { id: beta.contactId } }),
			).toBeNull();

			expect(
				await db.deal.findUnique({ where: { id: beta.dealId } }),
			).toBeNull();
		});
	});

	it("counts and groups only its own rows", async () => {
		const [inA, inB] = await Promise.all([
			withTenant(A, async () =>
				db.company.count({ where: { domain: SHARED_DOMAIN } }),
			),
			withTenant(B, async () =>
				db.company.count({ where: { domain: SHARED_DOMAIN } }),
			),
		]);

		expect(inA).toBe(1);
		expect(inB).toBe(1);
	});
});

describe("a workspace cannot write to another's records", () => {
	it("refuses to update a record it does not own", async () => {
		await withTenant(A, async () => {
			expect(
				(async () =>
					db.company.update({
						where: { id: beta.companyId },
						data: { name: "taken over" },
					}))(),
			).rejects.toThrow();
		});

		const untouched = await withTenant(B, async () =>
			db.company.findUnique({
				where: { id: beta.companyId },
				select: { name: true },
			}),
		);

		expect(untouched?.name).toBe(B);
	});

	it("deletes nothing when it deletes another workspace's rows", async () => {
		await withTenant(A, async () => {
			const removed = await db.activity.deleteMany({
				where: { subject: `${B} note` },
			});

			expect(removed.count).toBe(0);
		});

		const survived = await withTenant(B, async () =>
			db.activity.count({ where: { subject: `${B} note` } }),
		);

		expect(survived).toBe(1);
	});

	it("stamps a create with the workspace in scope", async () => {
		const created = await withTenant(A, async () =>
			db.company.create({
				data: { organizationId: A, name: `${A} extra` },
				select: { id: true, organizationId: true },
			}),
		);

		expect(created.organizationId).toBe(A);

		await withTenant(A, async () =>
			db.company.delete({ where: { id: created.id } }),
		);
	});
});

describe("the constraints are per workspace, not per install", () => {
	it("lets two workspaces hold the same domain and the same address", async () => {
		const [a, b] = await Promise.all([
			withTenant(A, async () =>
				db.company.findFirst({
					where: { domain: SHARED_DOMAIN },
					select: { organizationId: true },
				}),
			),
			withTenant(B, async () =>
				db.company.findFirst({
					where: { domain: SHARED_DOMAIN },
					select: { organizationId: true },
				}),
			),
		]);

		expect(a?.organizationId).toBe(A);
		expect(b?.organizationId).toBe(B);
	});
});

describe("a query with no workspace in scope is refused", () => {
	it("throws rather than reading every workspace", async () => {
		expect((async () => db.company.findMany())()).rejects.toBeInstanceOf(
			MissingTenantScopeError,
		);
	});

	it("names the model and the operation it refused", async () => {
		expect((async () => db.contact.findMany())()).rejects.toThrow(
			/Contact\.findMany/,
		);
	});
});
