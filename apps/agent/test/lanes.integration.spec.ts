import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { db, withTenant } from "@crm/db";
import { DIRECT_KINDS, isDirectKind, PRIORITY } from "@crm/db/agent-tasks";
import { WORKSPACE_ID } from "@crm/db/workspace";
import { claimDue } from "../agent/lib/tasks";

const TEST_TENANT = WORKSPACE_ID;

const scoped =
	<T>(run: () => Promise<T>) =>
	() =>
		withTenant(TEST_TENANT, run);

const REASON = "lane-test";

const VISIBLE = { only: DIRECT_KINDS } as const;
const RESEARCH = { except: DIRECT_KINDS } as const;

async function clear() {
	await db.agentTask.deleteMany({ where: { reason: REASON } });
}

beforeEach(scoped(clear));
afterEach(scoped(clear));

async function queue(kind: string, priority: number) {
	return await db.agentTask.create({
		data: {
			organizationId: TEST_TENANT,
			kind,
			reason: REASON,
			dueAt: new Date(Date.now() - 1000),
			priority,
			budget: 2,
		},
		select: { id: true },
	});
}

describe("dispatch lanes", () => {
	it(
		"keeps a logo out of the research lane and a brief out of the visible one",
		scoped(async () => {
			const brand = await queue("brand", PRIORITY.brand);
			const profile = await queue("company-profile", PRIORITY.companyProfile);

			const visible = await claimDue(10, VISIBLE);
			const research = await claimDue(10, RESEARCH);

			const visibleIds = visible.map((t) => t.id);
			const researchIds = research.map((t) => t.id);

			expect(visibleIds).toContain(brand.id);
			expect(visibleIds).not.toContain(profile.id);

			expect(researchIds).toContain(profile.id);
			expect(researchIds).not.toContain(brand.id);
		}),
	);

	it(
		"a logo is never starved by a queue full of research",
		scoped(async () => {
			for (let i = 0; i < 30; i += 1) {
				await queue("identify", PRIORITY.identify);
			}

			const brand = await queue("brand", PRIORITY.brand);

			const visible = await claimDue(5, VISIBLE);

			expect(visible.map((t) => t.id)).toContain(brand.id);
		}),
	);

	it(
		"takes the visible work in priority order",
		scoped(async () => {
			const portrait = await queue("portrait", PRIORITY.portrait);
			const brand = await queue("brand", PRIORITY.brand);

			const claimed = await claimDue(10, VISIBLE);
			const ordered = claimed
				.filter((t) => t.id === brand.id || t.id === portrait.id)
				.map((t) => t.id);

			expect(ordered).toEqual([brand.id, portrait.id]);
		}),
	);

	it(
		"sends the who-are-we pass to the research lane, ahead of the contacts",
		scoped(async () => {
			const identify = await queue("identify", PRIORITY.identify);
			const us = await queue("workspace-profile", PRIORITY.workspace);

			const visible = await claimDue(10, VISIBLE);
			const research = await claimDue(10, RESEARCH);

			expect(visible.map((t) => t.id)).not.toContain(us.id);

			const ordered = research
				.filter((t) => t.id === us.id || t.id === identify.id)
				.map((t) => t.id);

			expect(ordered).toEqual([us.id, identify.id]);
		}),
	);

	it(
		"leases the two lanes independently",
		scoped(async () => {
			const brand = await queue("brand", PRIORITY.brand);

			await claimDue(10, VISIBLE);
			const again = await claimDue(10, RESEARCH);

			expect(again.map((t) => t.id)).not.toContain(brand.id);
		}),
	);
});

describe("kind vocabulary", () => {
	it("agrees on which kinds skip the model", () => {
		expect(isDirectKind("brand")).toBe(true);
		expect(isDirectKind("portrait")).toBe(true);
		expect(isDirectKind("company-profile")).toBe(false);
		expect(isDirectKind("identify")).toBe(false);
		expect(isDirectKind("workspace-profile")).toBe(false);
	});

	it("puts what a rep sees first above what they have to click for", () => {
		expect(PRIORITY.brand).toBeGreaterThan(PRIORITY.requested);
		expect(PRIORITY.portrait).toBeGreaterThan(PRIORITY.requested);
		expect(PRIORITY.requested).toBeGreaterThan(PRIORITY.companyProfile);
		expect(PRIORITY.companyProfile).toBeGreaterThan(PRIORITY.recheck);
	});
});
