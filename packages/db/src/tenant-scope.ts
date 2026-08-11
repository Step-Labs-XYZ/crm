import { AsyncLocalStorage } from "node:async_hooks";

export const TENANT_MODELS = [
	"Company",
	"Contact",
	"Deal",
	"DealContact",
	"Activity",
] as const;

export type TenantModel = (typeof TENANT_MODELS)[number];

const SCOPED: ReadonlySet<string> = new Set(TENANT_MODELS);

export function isTenantModel(model: string | undefined): model is TenantModel {
	return model !== undefined && SCOPED.has(model);
}

export type TenantScope =
	| { kind: "tenant"; organizationId: string }
	| { kind: "across"; reason: string };

const storage = new AsyncLocalStorage<TenantScope>();

let processScope: TenantScope | null = null;

export function setSingleTenantProcess(organizationId: string): void {
	if (!organizationId) {
		throw new Error(
			"setSingleTenantProcess needs an organization id, and was given none.",
		);
	}

	processScope = { kind: "tenant", organizationId };
}

function scopeNow(): TenantScope | undefined {
	return storage.getStore() ?? processScope ?? undefined;
}

export function withTenant<T>(organizationId: string, run: () => T): T {
	if (!organizationId) {
		throw new Error("withTenant needs an organization id, and was given none.");
	}

	return storage.run({ kind: "tenant", organizationId }, run);
}

export function acrossTenants<T>(reason: string, run: () => T): T {
	return storage.run({ kind: "across", reason }, run);
}

export function currentScope(): TenantScope | undefined {
	return scopeNow();
}

export function currentTenant(): string | null {
	const scope = scopeNow();

	return scope?.kind === "tenant" ? scope.organizationId : null;
}

export function tenantId(): string {
	const scope = scopeNow();

	if (scope?.kind === "tenant") return scope.organizationId;

	throw new Error(
		scope
			? "A record cannot be written under acrossTenants — it has to belong to one workspace. Wrap the write in withTenant(organizationId, …)."
			: "A record cannot be written with no workspace in scope. Wrap the write in withTenant(organizationId, …).",
	);
}

export class MissingTenantScopeError extends Error {
	constructor(model: string, operation: string) {
		super(
			`${model}.${operation} ran with no workspace in scope. Wrap the call in withTenant(organizationId, …) — or, if it genuinely spans every workspace, in acrossTenants("why", …).`,
		);
		this.name = "MissingTenantScopeError";
	}
}

export function requireScope(model: string, operation: string): TenantScope {
	const scope = scopeNow();

	if (!scope) throw new MissingTenantScopeError(model, operation);

	return scope;
}
