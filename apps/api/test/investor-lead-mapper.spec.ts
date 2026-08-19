import { describe, expect, it } from "bun:test";
import {
	LANDING_STATUS,
	type LeadSource,
	matchExisting,
	mergeInterests,
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
	classification: "professional",
	interest: {
		fund: "fund_iii",
		share_class: "class_a",
		committed_amount: 4000000,
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

	it("never writes conversion state or a loose committed amount", () => {
		const write = toCreate(source) as Record<string, unknown>;

		for (const forbidden of [
			"committed_amount",
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
		expect(write.notes).not.toContain("No fund interest");
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

describe("fund interests", () => {
	it("sends the deal's interest and the contact's classification", () => {
		const write = toCreate(source);

		expect(write.investor_classification).toBe("professional");
		expect(write.interests).toEqual([
			{ fund: "fund_iii", share_class: "class_a", committed_amount: 4000000 },
		]);
	});

	it("says so in the note when the deal names no fund", () => {
		const write = toCreate({ ...source, interest: null });

		expect(write.interests).toBeUndefined();
		expect(write.notes).toContain("No fund interest");
	});

	it("adds a second fund rather than replacing the first", () => {
		const held = {
			fund: "fund_ii",
			share_class: null,
			committed_amount: 1000000,
		};

		const merged = mergeInterests([held], source.interest);

		expect(merged).toEqual([held, source.interest!]);
	});

	it("replaces the amount when the same fund and class come back", () => {
		const stale = { ...source.interest!, committed_amount: 1 };

		const merged = mergeInterests([stale], source.interest);

		expect(merged).toEqual([source.interest!]);
	});

	it("leaves what the platform holds alone when the deal names no fund", () => {
		const held = { fund: "fund_ii", share_class: null, committed_amount: 5 };

		expect(mergeInterests([held], null)).toBeNull();
	});

	it("carries the merged list through an update", () => {
		const held = { fund: "fund_ii", share_class: null, committed_amount: 5 };

		const write = toUpdate(source, { id: "lead_1", interests: [held] });

		expect(write.interests).toEqual([held, source.interest!]);
	});
});
