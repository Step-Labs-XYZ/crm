import { describe, expect, it } from "bun:test";
import {
	LANDING_STATUS,
	type LeadSource,
	matchExisting,
	toCreate,
	toUpdate,
} from "../src/fundreporting/investor-lead.mapper";

const source: LeadSource = {
	assetManagerId: "am_42",
	dealName: "Fernhill — Fund III",
	amount: "4000000",
	currency: "USD",
	closedAt: new Date("2026-08-11T10:00:00Z"),
	companyName: "Fernhill Holdings",
	person: {
		firstName: "Paula",
		lastName: "Marchetti",
		email: "paula@fernhill.com",
		phone: "+1 415 555 0142",
	},
};

describe("what the CRM writes onto an investor lead", () => {
	it("carries the person, the company and the asset manager", () => {
		const write = toCreate(source);

		expect(write.asset_manager).toBe("am_42");
		expect(write.name).toBe("Paula Marchetti");
		expect(write.email).toBe("paula@fernhill.com");
		expect(write.phone).toBe("+1 415 555 0142");
		expect(write.company).toBe("Fernhill Holdings");
	});

	it("lands the lead short of the qualification gate, never at investor", () => {
		expect(toCreate(source).status).toBe(LANDING_STATUS);
		expect(LANDING_STATUS).not.toBe("investor");
		expect(LANDING_STATUS).not.toBe("qualified");
	});

	it("never writes a fund interest, a committed amount or a classification", () => {
		const write = toCreate(source) as Record<string, unknown>;

		for (const forbidden of [
			"interests",
			"committed_amount",
			"investor_classification",
			"converted_to_shareholder",
			"converted_at",
		]) {
			expect(write[forbidden]).toBeUndefined();
		}
	});

	it("puts the deal value in the note rather than in a money field", () => {
		const write = toCreate(source);

		expect(write.notes).toContain("4000000 USD");
		expect(write.notes).toContain("Fernhill — Fund III");
		expect(write.notes).toContain(
			"Fund interests, committed amounts and classification are not set by the CRM",
		);
	});

	it("does not move a lead's status once their team has it", () => {
		expect(toUpdate(source)).not.toHaveProperty("status");
	});

	it("falls back to the company, then the deal, when nobody is on the deal", () => {
		expect(toCreate({ ...source, person: null }).name).toBe(
			"Fernhill Holdings",
		);

		expect(toCreate({ ...source, person: null, companyName: null }).name).toBe(
			"Fernhill — Fund III",
		);
	});

	it("omits what it does not know rather than sending empty strings", () => {
		const write = toCreate({
			...source,
			companyName: null,
			person: {
				firstName: "Paula",
				lastName: null,
				email: null,
				phone: null,
			},
		});

		expect(write.name).toBe("Paula");
		expect(write).not.toHaveProperty("email");
		expect(write).not.toHaveProperty("phone");
		expect(write).not.toHaveProperty("company");
	});
});

describe("finding a lead that is already there", () => {
	const leads = [
		{ id: 1, email: "someone@else.com" },
		{ id: 2, email: "Paula@Fernhill.com" },
	];

	it("matches on the address whatever case it was stored in", () => {
		expect(matchExisting(leads, "paula@fernhill.com")?.id).toBe(2);
	});

	it("matches nobody when the deal has no address to match on", () => {
		expect(matchExisting(leads, null)).toBeNull();
		expect(matchExisting(leads, "   ")).toBeNull();
	});

	it("does not guess when the address is not there", () => {
		expect(matchExisting(leads, "stranger@fernhill.com")).toBeNull();
	});
});
