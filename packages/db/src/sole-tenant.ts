import { db } from "./client";
import { withTenant } from "./tenant-scope";

export async function soleTenantId(): Promise<string> {
	const rows = await db.organization.findMany({
		select: { id: true },
		orderBy: [{ createdAt: "asc" }, { id: "asc" }],
		take: 2,
	});

	const first = rows[0];

	if (!first) {
		throw new Error(
			"This install has no workspace yet, so there is nothing to work on. Sign in once to create it.",
		);
	}

	if (rows.length > 1) {
		throw new Error(
			"This install has more than one workspace, and this caller has not been told which one it is working for. It cannot be allowed to read them all.",
		);
	}

	return first.id;
}

export async function withSoleTenant<T>(run: () => Promise<T>): Promise<T> {
	return withTenant(await soleTenantId(), run);
}
