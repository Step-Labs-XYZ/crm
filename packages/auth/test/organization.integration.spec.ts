import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { db } from "@crm/db";
import { ensureWorkspaceMembership, WORKSPACE_ID } from "../src/organization";
import { organizationForEmail } from "../src/tenant";

const suffix = (process.env.TEST_RUN_ID ?? "organization-spec").replace(
	/[^a-z0-9]+/gi,
	"-",
);

const ROOT = `${suffix}.example.test`;
const TENANT_A = `${suffix}-tenant-a`;
const TENANT_B = `${suffix}-tenant-b`;
const DOMAIN_A = `a.${ROOT}`;
const DOMAIN_B = `b.${ROOT}`;

const emailOf = (label: string, domain = ROOT) =>
	`${label}.${suffix}@${domain}`;

type Snapshot = {
	organization: {
		name: string;
		slug: string;
		website: string | null;
		metadata: string | null;
	} | null;
	members: { id: string; userId: string; role: string; createdAt: Date }[];
	allowed: { id: string; organizationId: string; entry: string }[];
};

let snapshot: Snapshot;
let allowedSignIn: string | undefined;
let firstId: string;
let secondId: string;

const seedUser = async (
	label: string,
	createdAt: Date,
	domain = ROOT,
): Promise<string> => {
	const user = await db.user.create({
		data: {
			id: `${suffix}-${label}-${domain}`,
			name: label,
			email: emailOf(label, domain),
			createdAt,
			updatedAt: createdAt,
		},
		select: { id: true },
	});

	return user.id;
};

const roleOf = async (
	userId: string,
	organizationId = WORKSPACE_ID,
): Promise<string | null> => {
	const member = await db.member.findUnique({
		where: { organizationId_userId: { organizationId, userId } },
		select: { role: true },
	});

	return member?.role ?? null;
};

const seedTenant = async (id: string, entry: string) => {
	await db.organization.create({
		data: { id, name: id, slug: id, createdAt: new Date() },
	});

	await db.allowedSignIn.create({ data: { organizationId: id, entry } });
};

const clear = async () => {
	await db.allowedSignIn.deleteMany({});
	await db.member.deleteMany({
		where: { organizationId: { in: [WORKSPACE_ID, TENANT_A, TENANT_B] } },
	});
	await db.organization.deleteMany({
		where: { id: { in: [WORKSPACE_ID, TENANT_A, TENANT_B] } },
	});
	await db.user.deleteMany({ where: { email: { endsWith: ROOT } } });
};

beforeAll(async () => {
	allowedSignIn = process.env.ALLOWED_SIGN_IN;

	const organization = await db.organization.findUnique({
		where: { id: WORKSPACE_ID },
		select: { name: true, slug: true, website: true, metadata: true },
	});

	snapshot = {
		organization,
		members: await db.member.findMany({
			where: { organizationId: WORKSPACE_ID },
			select: { id: true, userId: true, role: true, createdAt: true },
		}),
		allowed: await db.allowedSignIn.findMany({
			select: { id: true, organizationId: true, entry: true },
		}),
	};
});

beforeEach(async () => {
	await clear();

	process.env.ALLOWED_SIGN_IN = ROOT;

	firstId = await seedUser("first", new Date("2020-01-01T00:00:00Z"));
	secondId = await seedUser("second", new Date("2021-01-01T00:00:00Z"));
});

afterAll(async () => {
	await clear();

	if (allowedSignIn === undefined) delete process.env.ALLOWED_SIGN_IN;
	else process.env.ALLOWED_SIGN_IN = allowedSignIn;

	if (snapshot.organization) {
		await db.organization.create({
			data: {
				id: WORKSPACE_ID,
				createdAt: new Date(),
				...snapshot.organization,
			},
		});

		await db.member.createMany({
			data: snapshot.members.map((member) => ({
				...member,
				organizationId: WORKSPACE_ID,
			})),
		});
	}

	if (snapshot.allowed.length > 0) {
		await db.allowedSignIn.createMany({
			data: snapshot.allowed,
			skipDuplicates: true,
		});
	}
});

describe("bootstrapping the first tenant from ALLOWED_SIGN_IN", () => {
	it("creates it and enrols everyone who already had an account", async () => {
		const workspaceId = await ensureWorkspaceMembership(secondId);

		expect(workspaceId).toBe(WORKSPACE_ID);
		expect(await roleOf(firstId)).toBe("owner");
		expect(await roleOf(secondId)).toBe("member");
	});

	it("writes the environment's entries down, and then stops reading it", async () => {
		await ensureWorkspaceMembership(secondId);

		const rows = await db.allowedSignIn.findMany({
			select: { entry: true, organizationId: true },
		});

		expect(rows).toEqual([{ entry: ROOT, organizationId: WORKSPACE_ID }]);

		process.env.ALLOWED_SIGN_IN = "somewhere.else.test";

		const laterId = await seedUser("later", new Date("2026-01-01T00:00:00Z"));

		expect(await ensureWorkspaceMembership(laterId)).toBe(WORKSPACE_ID);
	});

	it("is idempotent, so signing in again neither duplicates nor re-roles", async () => {
		await ensureWorkspaceMembership(secondId);

		await db.member.update({
			where: {
				organizationId_userId: {
					organizationId: WORKSPACE_ID,
					userId: secondId,
				},
			},
			data: { role: "admin" },
		});

		await ensureWorkspaceMembership(secondId);
		await ensureWorkspaceMembership(secondId);

		const rows = await db.member.findMany({
			where: { organizationId: WORKSPACE_ID, userId: secondId },
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]?.role).toBe("admin");
	});

	it("joins someone who signs up later as a member", async () => {
		await ensureWorkspaceMembership(secondId);

		const laterId = await seedUser("later", new Date("2026-01-01T00:00:00Z"));

		await ensureWorkspaceMembership(laterId);

		expect(await roleOf(laterId)).toBe("member");
	});

	it("leaves the owner alone when a later arrival signs in", async () => {
		await ensureWorkspaceMembership(secondId);

		const laterId = await seedUser("later", new Date("2026-01-01T00:00:00Z"));

		await ensureWorkspaceMembership(laterId);

		expect(await roleOf(firstId)).toBe("owner");

		const owners = await db.member.count({
			where: { organizationId: WORKSPACE_ID, role: "owner" },
		});

		expect(owners).toBe(1);
	});
});

describe("more than one tenant", () => {
	beforeEach(async () => {
		await seedTenant(TENANT_A, DOMAIN_A);
		await seedTenant(TENANT_B, DOMAIN_B);
	});

	it("puts a person in the tenant their address belongs to, and in no other", async () => {
		const aliceId = await seedUser("alice", new Date(), DOMAIN_A);
		const bobId = await seedUser("bob", new Date(), DOMAIN_B);

		expect(await ensureWorkspaceMembership(aliceId)).toBe(TENANT_A);
		expect(await ensureWorkspaceMembership(bobId)).toBe(TENANT_B);

		expect(await roleOf(aliceId, TENANT_A)).toBe("member");
		expect(await roleOf(aliceId, TENANT_B)).toBeNull();
		expect(await roleOf(bobId, TENANT_B)).toBe("member");
		expect(await roleOf(bobId, TENANT_A)).toBeNull();
	});

	it("reads a tenant's members without ever returning another tenant's", async () => {
		const aliceId = await seedUser("alice", new Date(), DOMAIN_A);
		const bobId = await seedUser("bob", new Date(), DOMAIN_B);

		await ensureWorkspaceMembership(aliceId);
		await ensureWorkspaceMembership(bobId);

		const inA = await db.member.findMany({
			where: { organizationId: TENANT_A },
			select: { userId: true },
		});

		expect(inA.map((row) => row.userId)).toEqual([aliceId]);
	});

	it("does not bootstrap over tenants that already exist", async () => {
		const strangerId = await seedUser("stranger", new Date());

		expect(await ensureWorkspaceMembership(strangerId)).toBeUndefined();

		expect(
			await db.organization.findUnique({ where: { id: WORKSPACE_ID } }),
		).toBeNull();
	});

	it("prefers the address over the domain when both are listed", async () => {
		const carolEmail = emailOf("carol", DOMAIN_A);

		await db.allowedSignIn.create({
			data: { organizationId: TENANT_B, entry: carolEmail },
		});

		expect(await organizationForEmail(carolEmail)).toBe(TENANT_B);
		expect(await organizationForEmail(emailOf("dave", DOMAIN_A))).toBe(
			TENANT_A,
		);
	});

	it("matches a subdomain against the domain that was listed", async () => {
		expect(await organizationForEmail(emailOf("eve", `mail.${DOMAIN_A}`))).toBe(
			TENANT_A,
		);
	});

	it("admits nobody whose address no tenant claims", async () => {
		expect(
			await organizationForEmail(emailOf("nobody", "elsewhere.test")),
		).toBeNull();
	});
});
