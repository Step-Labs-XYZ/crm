import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { acrossTenants, db, withTenant } from "@crm/db";
import { PRIORITY } from "@crm/db/agent-tasks";
import { claimDue, completeTask, DIRECT_KINDS } from "../agent/lib/tasks";

const suffix = (process.env.TEST_RUN_ID ?? "tenancy-queue").replace(
	/[^a-z0-9]+/gi,
	"-",
);

const A = `${suffix}-one`;
const B = `${suffix}-two`;
const REASON = `tenancy-queue-spec (${suffix})`;

const RESEARCH = { except: DIRECT_KINDS } as const;
const VISIBLE = { only: DIRECT_KINDS } as const;

const queue = async (
	organizationId: string,
	kind: string,
	count: number,
	priority: number,
) =>
	withTenant(organizationId, async () =>
		db.agentTask.createMany({
			data: Array.from({ length: count }, (_, index) => ({
				organizationId,
				kind,
				reason: REASON,
				priority,
				budget: 4,
				dueAt: new Date(Date.now() - (index + 1) * 1000),
			})),
		}),
	);

const clear = async () => {
	await acrossTenants("test cleanup across both fixtures", async () =>
		db.agentTask.deleteMany({ where: { reason: REASON } }),
	);

	await db.organization.deleteMany({ where: { id: { in: [A, B] } } });
};

beforeEach(async () => {
	await clear();

	for (const id of [A, B]) {
		await db.organization.create({
			data: { id, name: id, slug: id, createdAt: new Date() },
		});
	}
});

afterAll(clear);

describe("the queue is drained for every workspace at once", () => {
	it("hands each claimed row back with the workspace it belongs to", async () => {
		await queue(A, "identify", 3, PRIORITY.identify);
		await queue(B, "identify", 3, PRIORITY.identify);

		const claimed = await claimDue(6, RESEARCH);
		const ours = claimed.filter((task) => task.reason === REASON);

		expect(ours).toHaveLength(6);
		expect(
			ours.every(
				(task) => task.organizationId === A || task.organizationId === B,
			),
		).toBe(true);
	});

	it("does not let one workspace's backlog starve another's", async () => {
		await queue(A, "identify", 20, PRIORITY.requested);
		await queue(B, "identify", 20, PRIORITY.recheck);

		const claimed = (await claimDue(10, RESEARCH)).filter(
			(task) => task.reason === REASON,
		);

		const fromA = claimed.filter((task) => task.organizationId === A).length;
		const fromB = claimed.filter((task) => task.organizationId === B).length;

		expect(fromA).toBeGreaterThan(0);
		expect(fromB).toBeGreaterThan(0);
		expect(Math.abs(fromA - fromB)).toBeLessThanOrEqual(1);
	});

	it("still takes the urgent work first inside a workspace", async () => {
		await queue(A, "identify", 1, PRIORITY.recheck);
		await queue(A, "meeting-prep", 1, PRIORITY.meeting);

		const claimed = (await claimDue(1, RESEARCH)).filter(
			(task) => task.reason === REASON,
		);

		expect(claimed[0]?.kind).toBe("meeting-prep");
	});

	it("keeps the lane split, and keeps it per workspace", async () => {
		await queue(A, "brand", 2, PRIORITY.brand);
		await queue(B, "brand", 2, PRIORITY.brand);
		await queue(A, "identify", 2, PRIORITY.identify);

		const visible = (await claimDue(4, VISIBLE)).filter(
			(task) => task.reason === REASON,
		);

		expect(visible).toHaveLength(4);
		expect(visible.every((task) => task.kind === "brand")).toBe(true);
		expect(visible.filter((task) => task.organizationId === A)).toHaveLength(2);
		expect(visible.filter((task) => task.organizationId === B)).toHaveLength(2);
	});
});

describe("a workspace cannot settle another's work", () => {
	it("refuses to complete a task that belongs to someone else", async () => {
		await queue(B, "identify", 1, PRIORITY.identify);

		const mine = (await claimDue(1, RESEARCH)).filter(
			(task) => task.reason === REASON,
		);

		const target = mine[0];
		expect(target?.organizationId).toBe(B);

		if (!target) throw new Error("nothing was queued for the second workspace");

		expect(
			await withTenant(A, async () => completeTask(target.id, "taken")),
		).toBeNull();

		const still = await withTenant(B, async () =>
			db.agentTask.findUnique({
				where: { id: target.id },
				select: { finishedAt: true },
			}),
		);

		expect(still?.finishedAt).toBeNull();
	});

	it("counts only its own queue", async () => {
		await queue(A, "identify", 3, PRIORITY.identify);
		await queue(B, "identify", 5, PRIORITY.identify);

		const [inA, inB] = await Promise.all([
			withTenant(A, async () =>
				db.agentTask.count({ where: { reason: REASON } }),
			),
			withTenant(B, async () =>
				db.agentTask.count({ where: { reason: REASON } }),
			),
		]);

		expect(inA).toBe(3);
		expect(inB).toBe(5);
	});
});
