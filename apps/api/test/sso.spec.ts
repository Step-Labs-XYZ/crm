import { describe, expect, it } from "bun:test";
import { isGoogleConfigured } from "@crm/auth";
import type { Db } from "@crm/db";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { SsoService } from "../src/sso/sso.service";

type Row = {
	providerId: string;
	issuer: string;
	domain: string;
	oidcConfig: string | null;
	samlConfig: string | null;
};

const LIST = {
	q: "",
	sort: "providerId",
	dir: "asc" as const,
	page: 1,
	pageSize: 25,
};

const TENANT = "acme";

function service(role: string | null, rows: Row[] = []) {
	const seen: { providerWhere?: unknown; ownedWhere?: unknown } = {};

	const db = {
		member: {
			findUnique: async () => (role === null ? null : { role }),
		},
		ssoProvider: {
			findMany: async ({ where }: { where: unknown }) => {
				seen.providerWhere = where;
				return rows;
			},
			findFirst: async ({ where }: { where: { organizationId: string } }) => {
				seen.ownedWhere = where;
				return where.organizationId === TENANT ? { id: "p1" } : null;
			},
			count: async () => rows.length,
		},
	} as unknown as Db;

	return { sso: new SsoService(db), seen };
}

const OKTA: Row = {
	providerId: "okta",
	issuer: "https://acme.okta.com",
	domain: "acme.com, subsidiary.com",
	oidcConfig: JSON.stringify({
		clientId: "0oa1b2c3d4WXYZ",
		clientSecret: "shhh",
	}),
	samlConfig: null,
};

describe("who may configure SSO", () => {
	it("lets an owner and an admin", async () => {
		for (const role of ["owner", "admin"]) {
			const { sso } = service(role);
			expect((await sso.settings(TENANT, "u1")).canConfigure).toBe(true);
		}
	});

	it("refuses a member, and refuses them the writes too", async () => {
		const { sso } = service("member");

		expect((await sso.settings(TENANT, "u1")).canConfigure).toBe(false);

		expect(
			sso.remove(TENANT, "u1", new Headers(), { providerId: "okta" }),
		).rejects.toBeInstanceOf(ForbiddenException);

		expect(
			sso.register(TENANT, "u1", new Headers(), {
				providerId: "okta",
				issuer: "https://acme.okta.com",
				domain: "acme.com",
				clientId: "id",
				clientSecret: "secret",
			}),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	it("refuses somebody who is not in the workspace at all", async () => {
		const { sso } = service(null);
		expect((await sso.settings(TENANT, "u1")).canConfigure).toBe(false);
	});
});

describe("what a provider looks like once it is saved", () => {
	it("never hands back the client secret", async () => {
		const { sso } = service("owner", [OKTA]);
		const [provider] = (await sso.list(TENANT, LIST)).rows;

		expect(JSON.stringify(provider)).not.toContain("shhh");
		expect(provider?.clientIdLastFour).toBe("WXYZ");
	});

	it("splits the domains and names the callback the IdP needs", async () => {
		const { sso } = service("owner", [OKTA]);
		const [provider] = (await sso.list(TENANT, LIST)).rows;

		expect(provider?.domains).toEqual(["acme.com", "subsidiary.com"]);
		expect(provider?.type).toBe("oidc");
		expect(provider?.name).toBe("Okta");
		expect(provider?.callbackURL).toEndWith("/api/auth/sso/callback/okta");
	});

	it("reads the organization it was passed, and never a second one", async () => {
		const { sso, seen } = service("owner", [OKTA]);
		await sso.list(TENANT, LIST);

		expect(seen.providerWhere).toEqual({ organizationId: TENANT });

		await sso.list("other-tenant", LIST);

		expect(seen.providerWhere).toEqual({ organizationId: "other-tenant" });
	});

	it("refuses to delete a provider that belongs to another tenant", async () => {
		const { sso } = service("owner", [OKTA]);

		expect(
			sso.remove("other-tenant", "u1", new Headers(), { providerId: "okta" }),
		).rejects.toBeInstanceOf(NotFoundException);
	});

	it("searches the name, the domain and the issuer", async () => {
		const { sso, seen } = service("owner", [OKTA]);
		await sso.list(TENANT, { ...LIST, q: " acme " });

		expect(seen.providerWhere).toEqual({
			organizationId: TENANT,
			OR: [
				{ providerId: { contains: "acme", mode: "insensitive" } },
				{ domain: { contains: "acme", mode: "insensitive" } },
				{ issuer: { contains: "acme", mode: "insensitive" } },
			],
		});
	});
});

describe("the sign-in page's read", () => {
	it("carries the name and nothing else", async () => {
		const { sso } = service(null, [OKTA]);

		expect((await sso.signInOptions()).providers).toEqual([
			{ providerId: "okta", name: "Okta" },
		]);
	});

	it("says whether Google is configured, so the page can offer nothing", async () => {
		const { sso } = service(null, [OKTA]);

		expect((await sso.signInOptions()).google).toBe(isGoogleConfigured());
	});
});
