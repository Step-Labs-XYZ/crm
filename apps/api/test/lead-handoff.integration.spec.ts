import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { DealStage, db, HandoffState, withTenant } from "@crm/db";
import type {
	ExistingLead,
	InvestorLeadWrite,
} from "../src/fundreporting/investor-lead.mapper";
import {
	LeadHandoffService,
	NO_ASSET_MANAGER,
	NOT_A_UUID,
} from "../src/fundreporting/lead-handoff.service";
import type {
	PlatformApi,
	PlatformOutcome,
} from "../src/fundreporting/platform.client";

const suffix = (process.env.TEST_RUN_ID ?? "lead-handoff").replace(
	/[^a-z0-9]+/gi,
	"-",
);

const TENANT = `${suffix}-am`;
const ASSET_MANAGER = "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const REP = `${suffix}-rep`;

type Call = {
	kind: "list" | "create" | "update";
	body?: unknown;
	leadId?: string;
};

function fakePlatform(options: {
	configured?: boolean;
	existing?: ExistingLead[];
	createOutcome?: PlatformOutcome<ExistingLead>;
	listOutcome?: PlatformOutcome<ExistingLead[]>;
}) {
	const calls: Call[] = [];

	const api: PlatformApi = {
		configured: () => options.configured ?? true,
		listFunds: async () => ({ ok: true, data: [] }),
		listShareClasses: async () => ({ ok: true, data: [] }),
		listShareholders: async () => ({ ok: true as const, data: [] }),
		getAssetManager: async () => ({
			ok: true as const,
			data: { id: "am_42", name: "Fernhill Capital" },
		}),
		listLeads: async () => {
			calls.push({ kind: "list" });
			return options.listOutcome ?? { ok: true, data: options.existing ?? [] };
		},
		createLead: async (body: InvestorLeadWrite) => {
			calls.push({ kind: "create", body });
			return options.createOutcome ?? { ok: true, data: { id: "lead_new" } };
		},
		updateLead: async (leadId, body) => {
			calls.push({ kind: "update", leadId, body });
			return { ok: true, data: { id: leadId } };
		},
	};

	return { api, calls };
}

async function seedWonDeal(): Promise<string> {
	return withTenant(TENANT, async () => {
		const company = await db.company.create({
			data: {
				organizationId: TENANT,
				name: "Fernhill Holdings",
				domain: `fernhill-${suffix}.example.test`,
			},
			select: { id: true },
		});

		const contact = await db.contact.create({
			data: {
				organizationId: TENANT,
				firstName: "Paula",
				lastName: "Marchetti",
				email: `paula@fernhill-${suffix}.example.test`,
				companyId: company.id,
			},
			select: { id: true },
		});

		const deal = await db.deal.create({
			data: {
				organizationId: TENANT,
				name: "Fernhill — Fund III",
				companyId: company.id,
				ownerId: REP,
				stage: DealStage.CLOSED_WON,
				closedAt: new Date("2026-08-11T10:00:00Z"),
				amount: "4000000",
				currency: "USD",
				contacts: {
					create: [
						{
							organization: { connect: { id: TENANT } },
							contact: { connect: { id: contact.id } },
						},
					],
				},
			},
			select: { id: true },
		});

		return deal.id;
	});
}

const clear = async () => {
	await db.organization.deleteMany({ where: { id: TENANT } });
	await db.user.deleteMany({ where: { id: REP } });
};

beforeEach(async () => {
	await clear();

	await db.user.create({
		data: { id: REP, name: "Rep", email: `${REP}@example.test` },
	});

	await db.organization.create({
		data: {
			id: TENANT,
			name: TENANT,
			slug: TENANT,
			createdAt: new Date(),
			assetManagerId: ASSET_MANAGER,
		},
	});
});

afterAll(clear);

describe("handing a won deal to FundReporting", () => {
	it("files it under the workspace's asset manager", async () => {
		const dealId = await seedWonDeal();
		const { api, calls } = fakePlatform({});
		const service = new LeadHandoffService(db, api);

		const result = await withTenant(TENANT, async () =>
			service.onDealWon(dealId),
		);

		expect(result.state).toBe(HandoffState.SENT);
		expect(result.leadId).toBe("lead_new");

		const created = calls.find((call) => call.kind === "create");
		expect(created).toBeDefined();
		expect(
			(created?.body as InvestorLeadWrite | undefined)?.asset_manager,
		).toBe(ASSET_MANAGER);
	});

	it("does not create a second lead when the stage change fires again", async () => {
		const dealId = await seedWonDeal();
		const { api, calls } = fakePlatform({});
		const service = new LeadHandoffService(db, api);

		await withTenant(TENANT, async () => service.onDealWon(dealId));
		const again = await withTenant(TENANT, async () =>
			service.onDealWon(dealId),
		);

		expect(again.state).toBe(HandoffState.SENT);
		expect(again.leadId).toBe("lead_new");
		expect(calls.filter((call) => call.kind === "create")).toHaveLength(1);
		expect(calls.filter((call) => call.kind === "update")).toHaveLength(1);

		const rows = await withTenant(TENANT, async () =>
			db.investorLeadHandoff.findMany({ where: { dealId } }),
		);

		expect(rows).toHaveLength(1);
	});

	it("updates the lead that is already there rather than duplicating a person", async () => {
		const dealId = await seedWonDeal();
		const { api, calls } = fakePlatform({
			existing: [{ id: 77, email: `paula@fernhill-${suffix}.example.test` }],
		});
		const service = new LeadHandoffService(db, api);

		const result = await withTenant(TENANT, async () =>
			service.onDealWon(dealId),
		);

		expect(result.leadId).toBe("77");
		expect(calls.some((call) => call.kind === "create")).toBe(false);
		expect(calls.find((call) => call.kind === "update")?.leadId).toBe("77");
	});
});

describe("when it cannot file", () => {
	it("refuses when the workspace has no asset manager, and says so", async () => {
		const dealId = await seedWonDeal();

		await db.organization.update({
			where: { id: TENANT },
			data: { assetManagerId: null },
		});

		const { api, calls } = fakePlatform({});
		const service = new LeadHandoffService(db, api);

		const result = await withTenant(TENANT, async () =>
			service.onDealWon(dealId),
		);

		expect(result.state).toBe(HandoffState.REFUSED);
		expect(result.reason).toBe(NO_ASSET_MANAGER);
		expect(calls).toHaveLength(0);
	});

	it("refuses an asset manager id that is not a UUID, before calling out", async () => {
		const dealId = await seedWonDeal();

		await db.organization.update({
			where: { id: TENANT },
			data: { assetManagerId: "am_test_42" },
		});

		const { api, calls } = fakePlatform({});
		const service = new LeadHandoffService(db, api);

		const result = await withTenant(TENANT, async () =>
			service.onDealWon(dealId),
		);

		expect(result.state).toBe(HandoffState.REFUSED);
		expect(result.reason).toBe(NOT_A_UUID);
		expect(calls).toHaveLength(0);
	});

	it("refuses when FundReporting is not connected on this install", async () => {
		const dealId = await seedWonDeal();
		const { api, calls } = fakePlatform({ configured: false });
		const service = new LeadHandoffService(db, api);

		const result = await withTenant(TENANT, async () =>
			service.onDealWon(dealId),
		);

		expect(result.state).toBe(HandoffState.REFUSED);
		expect(result.reason).toContain("PLATFORM_API_URL");
		expect(calls).toHaveLength(0);
	});

	it("records a reachable-but-broken platform as retryable, and shows it", async () => {
		const dealId = await seedWonDeal();
		const { api } = fakePlatform({
			listOutcome: {
				ok: false,
				retryable: true,
				reason: "FundReporting answered 503",
			},
		});
		const service = new LeadHandoffService(db, api);

		const result = await withTenant(TENANT, async () =>
			service.onDealWon(dealId),
		);

		expect(result.state).toBe(HandoffState.FAILED);

		const outstanding = await withTenant(TENANT, async () =>
			service.outstanding(),
		);

		expect(outstanding.map((row) => row.dealId)).toContain(dealId);
		expect(outstanding[0]?.reason).toContain("503");
	});

	it("lands on its feet when the platform recovers and it is retried", async () => {
		const dealId = await seedWonDeal();
		const broken = fakePlatform({
			listOutcome: { ok: false, retryable: true, reason: "503" },
		});

		await withTenant(TENANT, async () =>
			new LeadHandoffService(db, broken.api).onDealWon(dealId),
		);

		const healthy = fakePlatform({});
		const result = await withTenant(TENANT, async () =>
			new LeadHandoffService(db, healthy.api).retry(dealId),
		);

		expect(result.state).toBe(HandoffState.SENT);

		const outstanding = await withTenant(TENANT, async () =>
			new LeadHandoffService(db, healthy.api).outstanding(),
		);

		expect(outstanding.map((row) => row.dealId)).not.toContain(dealId);
	});
});
