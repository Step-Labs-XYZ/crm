import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, withTenant } from "@crm/db";

const suffix = (process.env.TEST_RUN_ID ?? "suppression-tenancy").replace(
	/[^a-z0-9]+/gi,
	"-",
);

const A = `${suffix}-ours`;
const B = `${suffix}-theirs`;

const DOMAIN = `shared-${suffix}.example.test`;
const ADDRESS = `paula@${DOMAIN}`;

const clear = async () => {
	await db.organization.deleteMany({ where: { id: { in: [A, B] } } });
};

beforeAll(async () => {
	await clear();

	for (const id of [A, B]) {
		await db.organization.create({
			data: { id, name: id, slug: id, createdAt: new Date() },
		});
	}
});

afterAll(clear);

describe("a suppression is one workspace's decision", () => {
	it("does not hide the address from another workspace's sync", async () => {
		await withTenant(A, async () =>
			db.suppressedContact.create({
				data: { organizationId: A, email: ADDRESS, reason: "deleted by us" },
			}),
		);

		const [seenByA, seenByB] = await Promise.all([
			withTenant(A, async () =>
				db.suppressedContact.findMany({ select: { email: true } }),
			),
			withTenant(B, async () =>
				db.suppressedContact.findMany({ select: { email: true } }),
			),
		]);

		expect(seenByA.map((row) => row.email)).toContain(ADDRESS);
		expect(seenByB.map((row) => row.email)).not.toContain(ADDRESS);
	});

	it("lets the other workspace suppress the same address for itself", async () => {
		await withTenant(B, async () =>
			db.suppressedContact.create({
				data: { organizationId: B, email: ADDRESS, reason: "deleted by them" },
			}),
		);

		const [ours, theirs] = await Promise.all([
			withTenant(A, async () =>
				db.suppressedContact.findUnique({
					where: {
						organizationId_email: { organizationId: A, email: ADDRESS },
					},
					select: { reason: true },
				}),
			),
			withTenant(B, async () =>
				db.suppressedContact.findUnique({
					where: {
						organizationId_email: { organizationId: B, email: ADDRESS },
					},
					select: { reason: true },
				}),
			),
		]);

		expect(ours?.reason).toBe("deleted by us");
		expect(theirs?.reason).toBe("deleted by them");
	});

	it("does the same for a suppressed domain", async () => {
		await withTenant(A, async () =>
			db.suppressedDomain.create({
				data: { organizationId: A, domain: DOMAIN, reason: "not a prospect" },
			}),
		);

		const [inA, inB] = await Promise.all([
			withTenant(A, async () =>
				db.suppressedDomain.count({ where: { domain: DOMAIN } }),
			),
			withTenant(B, async () =>
				db.suppressedDomain.count({ where: { domain: DOMAIN } }),
			),
		]);

		expect(inA).toBe(1);
		expect(inB).toBe(0);
	});

	it("cannot lift another workspace's suppression", async () => {
		const removed = await withTenant(A, async () =>
			db.suppressedContact.deleteMany({
				where: { email: { equals: ADDRESS, mode: "insensitive" } },
			}),
		);

		expect(removed.count).toBe(1);

		const stillTheirs = await withTenant(B, async () =>
			db.suppressedContact.count({ where: { email: ADDRESS } }),
		);

		expect(stillTheirs).toBe(1);
	});
});
