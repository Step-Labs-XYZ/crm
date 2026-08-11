import { db, Prisma, tenantId } from "@crm/db";

export type LeasedTask = {
	id: string;
	organizationId: string;
	contactId: string | null;
	companyId: string | null;
	kind: string;
	reason: string;
	budget: number;
	attempts: number;
	priority: number;
	dueAt: Date;
};

export type TaskSubject = {
	id: string;
	organizationId: string;
	contactId: string | null;
	companyId: string | null;
	kind: string;
};

const LEASE_MS = 10 * 60_000;

export const MAX_ATTEMPTS = 3;

export { DIRECT_KINDS } from "@crm/db/agent-tasks";

export async function claimDue(
	limit: number,
	kinds: { only: readonly string[] } | { except: readonly string[] },
	leaseMs = LEASE_MS,
): Promise<LeasedTask[]> {
	const now = new Date();
	const until = new Date(now.getTime() + leaseMs);

	const list = "only" in kinds ? kinds.only : kinds.except;
	if ("only" in kinds && list.length === 0) return [];

	const match = Prisma.sql`t2.kind ${"only" in kinds ? Prisma.sql`IN` : Prisma.sql`NOT IN`} (${Prisma.join(list)})`;

	const eligible = Prisma.sql`
		"finishedAt" IS NULL
		AND "dueAt" <= ${now}
		AND ("leasedUntil" IS NULL OR "leasedUntil" < ${now})
		AND "attempts" < ${MAX_ATTEMPTS}`;

	const claimed = await db.$queryRaw<LeasedTask[]>`
		UPDATE "agentTask" AS t
		SET "leasedUntil" = ${until},
			"startedAt" = COALESCE(t."startedAt", ${now}),
			"attempts" = t."attempts" + 1
		FROM (
			SELECT t2.id FROM "agentTask" AS t2
			JOIN (
				SELECT id, ROW_NUMBER() OVER (
					PARTITION BY "organizationId"
					ORDER BY "priority" DESC, "dueAt" ASC
				) AS seat
				FROM "agentTask"
				WHERE ${eligible} AND kind ${"only" in kinds ? Prisma.sql`IN` : Prisma.sql`NOT IN`} (${Prisma.join(list)})
			) AS turn ON turn.id = t2.id
			WHERE t2."finishedAt" IS NULL
				AND t2."dueAt" <= ${now}
				AND (t2."leasedUntil" IS NULL OR t2."leasedUntil" < ${now})
				AND t2."attempts" < ${MAX_ATTEMPTS}
				AND ${match}
			ORDER BY turn.seat ASC, t2."priority" DESC, t2."dueAt" ASC
			LIMIT ${limit}
			FOR UPDATE OF t2 SKIP LOCKED
		) AS due
		WHERE t.id = due.id
		RETURNING t.id, t."organizationId", t."contactId", t."companyId", t.kind,
			t.reason, t.budget, t.attempts, t.priority, t."dueAt";
	`;

	return claimed.sort(
		(a, b) =>
			seatOf(a, claimed) - seatOf(b, claimed) ||
			b.priority - a.priority ||
			a.dueAt.getTime() - b.dueAt.getTime(),
	);
}

function seatOf(task: LeasedTask, claimed: readonly LeasedTask[]): number {
	return claimed
		.filter((other) => other.organizationId === task.organizationId)
		.sort(
			(a, b) =>
				b.priority - a.priority || a.dueAt.getTime() - b.dueAt.getTime(),
		)
		.indexOf(task);
}

export async function retireExhausted(): Promise<TaskSubject[]> {
	const now = new Date();

	return db.$queryRaw<TaskSubject[]>`
		UPDATE "agentTask" AS t
		SET "finishedAt" = ${now},
			"outcome" = ${`Gave up after ${MAX_ATTEMPTS} attempts: the session never reported back.`}
		WHERE t."finishedAt" IS NULL
			AND t."attempts" >= ${MAX_ATTEMPTS}
			AND (t."leasedUntil" IS NULL OR t."leasedUntil" < ${now})
		RETURNING t.id, t."organizationId", t."contactId", t."companyId", t.kind;
	`;
}

export async function completeTask(
	taskId: string,
	outcome: string,
	sessionId?: string,
): Promise<TaskSubject | null> {
	const { count } = await db.agentTask.updateMany({
		where: { id: taskId, finishedAt: null },
		data: {
			finishedAt: new Date(),
			outcome: outcome.slice(0, 500),
			...(sessionId ? { sessionId } : {}),
		},
	});

	if (count === 0) return null;

	return await db.agentTask.findUnique({
		where: { id: taskId },
		select: {
			id: true,
			organizationId: true,
			contactId: true,
			companyId: true,
			kind: true,
		},
	});
}

export async function taskSubject(taskId: string): Promise<TaskSubject | null> {
	return await db.agentTask.findUnique({
		where: { id: taskId },
		select: {
			id: true,
			organizationId: true,
			contactId: true,
			companyId: true,
			kind: true,
		},
	});
}

export async function noteSession(
	taskId: string,
	sessionId: string,
): Promise<void> {
	await db.agentTask.updateMany({
		where: { id: taskId, finishedAt: null },
		data: { sessionId },
	});
}

export async function scheduleTask(input: {
	contactId?: string | null;
	companyId?: string | null;
	kind: string;
	reason: string;
	dueAt: Date;
	priority?: number;
	budget?: number;
}): Promise<{ id: string }> {
	const existing = await db.agentTask.findFirst({
		where: {
			kind: input.kind,
			finishedAt: null,
			contactId: input.contactId ?? undefined,
			companyId: input.companyId ?? undefined,
		},
		select: { id: true },
	});

	if (existing) {
		await db.agentTask.update({
			where: { id: existing.id },
			data: { dueAt: input.dueAt, reason: input.reason },
		});
		return existing;
	}

	return await db.agentTask.create({
		data: {
			organizationId: tenantId(),
			contactId: input.contactId ?? null,
			companyId: input.companyId ?? null,
			kind: input.kind,
			reason: input.reason,
			dueAt: input.dueAt,
			priority: input.priority ?? 0,
			budget: input.budget ?? 4,
		},
		select: { id: true },
	});
}

export async function lastDecision(contactId: string) {
	return await db.agentTask.findFirst({
		where: { contactId },
		orderBy: { createdAt: "desc" },
		select: {
			kind: true,
			reason: true,
			dueAt: true,
			finishedAt: true,
			outcome: true,
		},
	});
}

export type { Prisma };
