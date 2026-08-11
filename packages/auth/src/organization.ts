import { db } from "@crm/db";
import { WORKSPACE_ID, workspaceSlug } from "@crm/db/workspace";
import { organizationForEmail, seedBootstrapTenant } from "./tenant";

export { WORKSPACE_ID };

export const DEFAULT_WORKSPACE_NAME = "CRM";

export const WORKSPACE_ROLES = ["owner", "admin", "member"] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export function isWorkspaceRole(value: string): value is WorkspaceRole {
	return (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function isWorkspaceAdmin(role: WorkspaceRole | null): boolean {
	return role === "owner" || role === "admin";
}

export function canRenameWorkspace(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export function canChangeRole(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export async function ensureWorkspaceMembership(
	userId: string,
): Promise<string | undefined> {
	try {
		return await db.$transaction(async (tx) => {
			const user = await tx.user.findUnique({
				where: { id: userId },
				select: { email: true },
			});

			await seedBootstrapTenant(
				tx,
				WORKSPACE_ID,
				DEFAULT_WORKSPACE_NAME,
				workspaceSlug(DEFAULT_WORKSPACE_NAME),
			);

			const organizationId = await organizationForEmail(user?.email, tx);

			if (!organizationId) {
				console.error(
					`[auth] ${userId} signed in with an address no tenant admits; they have no workspace`,
				);
				return undefined;
			}

			const workspace = await tx.organization.findUnique({
				where: { id: organizationId },
				select: { id: true, name: true, slug: true },
			});

			if (!workspace) return undefined;

			const slug = workspaceSlug(workspace.name);

			if (workspace.slug !== slug) {
				await tx.organization.update({
					where: { id: workspace.id },
					data: { slug },
				});
			}

			await tx.member.upsert({
				where: {
					organizationId_userId: { organizationId: workspace.id, userId },
				},
				create: {
					id: crypto.randomUUID(),
					organizationId: workspace.id,
					userId,
					role: "member",
					createdAt: new Date(),
				},
				update: {},
			});

			return workspace.id;
		});
	} catch (error) {
		console.error(
			`[auth] could not enrol user ${userId} in their workspace; the next sign-in will retry`,
			error,
		);
		return undefined;
	}
}
