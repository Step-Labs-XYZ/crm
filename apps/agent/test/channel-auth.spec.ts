import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import {
	BRIDGE_AUDIENCE,
	BRIDGE_ISSUER,
	repFromCrm,
} from "../agent/channels/eve";
import { isAutomated } from "../agent/lib/approval";

const SECRET = "test-secret-at-least-long-enough-to-be-a-secret";
const auth = repFromCrm(SECRET);

const suffix = (process.env.TEST_RUN_ID ?? "channel-auth").replace(
	/[^a-z0-9]+/gi,
	"-",
);

const TENANT = `${suffix}-workspace`;
const OTHER = `${suffix}-somebody-else`;
const REP = `${suffix}-rep`;

const clear = async () => {
	await db.organization.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
	await db.user.deleteMany({ where: { id: REP } });
};

beforeAll(async () => {
	await clear();

	await db.user.create({
		data: { id: REP, name: "Lewis Carhart", email: `${REP}@example.test` },
	});

	for (const id of [TENANT, OTHER]) {
		await db.organization.create({
			data: { id, name: id, slug: id, createdAt: new Date() },
		});
	}

	await db.member.create({
		data: {
			id: `${suffix}-member`,
			organizationId: TENANT,
			userId: REP,
			role: "member",
			createdAt: new Date(),
		},
	});
});

afterAll(clear);

async function mint(
	claims: Record<string, unknown>,
	secret = SECRET,
): Promise<string> {
	const encode = (value: object) =>
		Buffer.from(JSON.stringify(value)).toString("base64url");

	const signingInput = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}`;
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(signingInput),
	);

	return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
}

function request(token: string | null): Request {
	return new Request("https://agent.example.com/eve/v1/session", {
		method: "POST",
		headers: token ? { authorization: `Bearer ${token}` } : {},
	});
}

function claims(overrides: Record<string, unknown> = {}) {
	const now = Math.floor(Date.now() / 1000);
	return {
		iss: BRIDGE_ISSUER,
		aud: BRIDGE_AUDIENCE,
		sub: REP,
		organizationId: TENANT,
		email: "lewis@trycomp.ai",
		name: "Lewis Carhart",
		iat: now,
		nbf: now - 5,
		exp: now + 120,
		...overrides,
	};
}

describe("repFromCrm", () => {
	it("resolves a valid token to the rep, as a person", async () => {
		const result = await auth(request(await mint(claims())));

		expect(result).toMatchObject({
			authenticator: "crm-app",
			principalId: REP,
			principalType: "user",
		});
	});

	it("produces a principal the approval policy reads as human", async () => {
		const session = await auth(request(await mint(claims())));

		expect(isAutomated({ auth: { current: session } })).toBe(false);
	});

	it("carries the rep's identity for the agent to attribute work to", async () => {
		const session = await auth(request(await mint(claims())));

		expect(session).toMatchObject({
			attributes: { email: "lewis@trycomp.ai", name: "Lewis Carhart" },
		});
	});

	it("refuses a token claiming a workspace the rep does not belong to", async () => {
		const token = await mint(claims({ organizationId: OTHER }));

		expect(await auth(request(token))).toBeNull();
	});

	it("refuses a token that names no workspace at all", async () => {
		const bare = claims();
		delete (bare as Record<string, unknown>).organizationId;

		expect(await auth(request(await mint(bare)))).toBeNull();
	});

	it("skips a request with no token, rather than accepting it", async () => {
		expect(await auth(request(null))).toBeNull();
	});

	it("skips a token signed with the wrong secret", async () => {
		const forged = await mint(claims(), "not-the-shared-secret");
		expect(await auth(request(forged))).toBeNull();
	});

	it("skips a token whose payload was swapped for another user", async () => {
		const token = await mint(claims());
		const [header, , signature] = token.split(".");
		const impersonated = Buffer.from(
			JSON.stringify(claims({ sub: "somebody_else" })),
		).toString("base64url");

		expect(
			await auth(request(`${header}.${impersonated}.${signature}`)),
		).toBeNull();
	});

	it("skips a token whose signature was altered", async () => {
		const token = await mint(claims());
		const [header, payload, signature] = token.split(".");

		const middle = Math.floor((signature as string).length / 2);
		const swapped = (signature as string)[middle] === "A" ? "B" : "A";
		const altered = `${(signature as string).slice(0, middle)}${swapped}${(
			signature as string
		).slice(middle + 1)}`;

		expect(await auth(request(`${header}.${payload}.${altered}`))).toBeNull();
	});

	it("skips an expired token", async () => {
		const now = Math.floor(Date.now() / 1000);
		const stale = await mint(claims({ iat: now - 600, exp: now - 300 }));
		expect(await auth(request(stale))).toBeNull();
	});

	it("skips a token minted for a different agent", async () => {
		expect(
			await auth(request(await mint(claims({ aud: "someone-else" })))),
		).toBeNull();
	});

	it("skips a token from a different issuer", async () => {
		expect(
			await auth(request(await mint(claims({ iss: "not-our-app" })))),
		).toBeNull();
	});

	it("skips a token that names nobody", async () => {
		expect(
			await auth(request(await mint(claims({ sub: undefined })))),
		).toBeNull();
	});
});
