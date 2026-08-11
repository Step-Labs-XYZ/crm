import { type Db, db } from "@crm/db";
import {
	bootstrapSignInEntries,
	hasSignInAllowList,
	isWorkspaceEmail,
	signInCandidates,
} from "./workspace";

export type TenantClient = Pick<
	Db,
	"allowedSignIn" | "organization" | "member" | "user"
>;

export type SignUpAdmission = "admitted" | "refused" | "unconfigured";

export async function signInIsClaimed(
	client: TenantClient = db,
): Promise<boolean> {
	return (await client.allowedSignIn.count()) > 0;
}

export async function organizationForEmail(
	email: string | null | undefined,
	client: TenantClient = db,
): Promise<string | null> {
	const candidates = signInCandidates(email);
	if (candidates.length === 0) return null;

	const rows = await client.allowedSignIn.findMany({
		where: { entry: { in: [...candidates] } },
		select: { entry: true, organizationId: true },
	});

	if (rows.length === 0) return null;

	const rank = new Map(candidates.map((entry, index) => [entry, index]));
	const specificity = (entry: string) =>
		rank.get(entry) ?? Number.MAX_SAFE_INTEGER;

	return rows.reduce((best, row) =>
		specificity(row.entry) < specificity(best.entry) ? row : best,
	).organizationId;
}

export async function tenantSignInDomains(
	organizationId: string,
	client: TenantClient = db,
): Promise<readonly string[]> {
	const rows = await client.allowedSignIn.findMany({
		where: { organizationId },
		select: { entry: true },
	});

	return rows.map((row) => row.entry).filter((entry) => !entry.includes("@"));
}

export async function admitSignUp(
	email: string | null | undefined,
	client: TenantClient = db,
): Promise<SignUpAdmission> {
	if (await signInIsClaimed(client)) {
		return (await organizationForEmail(email, client)) ? "admitted" : "refused";
	}

	if (!hasSignInAllowList()) return "unconfigured";

	return isWorkspaceEmail(email) ? "admitted" : "refused";
}

export async function seedBootstrapTenant(
	client: TenantClient,
	organizationId: string,
	name: string,
	slug: string,
): Promise<void> {
	if (await signInIsClaimed(client)) return;

	const entries = bootstrapSignInEntries();
	if (entries.length === 0) return;

	const existing = await client.organization.findFirst({
		select: { id: true },
		orderBy: { createdAt: "asc" },
	});

	const tenantId = existing?.id ?? organizationId;

	if (!existing) {
		await client.organization.create({
			data: { id: tenantId, name, slug, createdAt: new Date() },
		});
	}

	await client.allowedSignIn.createMany({
		data: entries.map((entry) => ({ organizationId: tenantId, entry })),
		skipDuplicates: true,
	});

	if (
		(await client.member.count({ where: { organizationId: tenantId } })) > 0
	) {
		return;
	}

	const users = await client.user.findMany({
		select: { id: true },
		orderBy: [{ createdAt: "asc" }, { id: "asc" }],
	});

	await client.member.createMany({
		data: users.map((user, index) => ({
			id: crypto.randomUUID(),
			organizationId: tenantId,
			userId: user.id,
			role: index === 0 ? "owner" : "member",
			createdAt: new Date(),
		})),
		skipDuplicates: true,
	});
}
