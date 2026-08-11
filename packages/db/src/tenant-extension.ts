import { Prisma } from "./generated/prisma/client";
import { isTenantModel, requireScope } from "./tenant-scope";

const CREATE_OPERATIONS: ReadonlySet<string> = new Set([
	"create",
	"createMany",
	"createManyAndReturn",
]);

type Args = Record<string, unknown>;

function stamp(data: unknown, organizationId: string): unknown {
	if (Array.isArray(data)) {
		return data.map((row) => ({
			...(row as Args),
			organizationId,
		}));
	}

	return { ...((data as Args) ?? {}), organizationId };
}

export const tenantScopeExtension = Prisma.defineExtension({
	name: "tenantScope",

	query: {
		$allModels: {
			$allOperations({ model, operation, args, query }) {
				if (!isTenantModel(model)) return query(args);

				const scope = requireScope(model, operation);

				if (scope.kind === "across") return query(args);

				const { organizationId } = scope;
				const next: Args = { ...(args as Args) };

				if (CREATE_OPERATIONS.has(operation)) {
					next.data = stamp(next.data, organizationId);
					return query(next);
				}

				if (operation === "upsert") {
					next.create = stamp(next.create, organizationId);
					next.where = { ...((next.where as Args) ?? {}), organizationId };
					return query(next);
				}

				next.where = { ...((next.where as Args) ?? {}), organizationId };
				return query(next);
			},
		},
	},
});
