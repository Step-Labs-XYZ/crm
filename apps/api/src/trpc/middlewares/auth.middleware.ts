import type { Db } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
	MiddlewareOptions,
	MiddlewareResponse,
	TRPCMiddleware,
} from "nestjs-trpc";
import { InjectDatabase } from "../../database/database.constants";
import { setRequestUserId } from "../../logging/request-context";
import type { AuthedTrpcContext, BaseTrpcContext } from "../context.types";

@Injectable()
export class AuthMiddleware implements TRPCMiddleware {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async use(opts: MiddlewareOptions): Promise<MiddlewareResponse> {
		const ctx = opts.ctx as BaseTrpcContext;
		const user = ctx.session?.user;

		if (!user) {
			throw new TRPCError({ code: "UNAUTHORIZED" });
		}

		setRequestUserId(user.id);

		const organizationId = await this.tenantOf(ctx, user.id);

		if (!organizationId) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "That account does not belong to a workspace on this install.",
			});
		}

		const nextCtx: AuthedTrpcContext = { ...ctx, user, organizationId };
		return opts.next({ ctx: nextCtx });
	}

	private async tenantOf(
		ctx: BaseTrpcContext,
		userId: string,
	): Promise<string | null> {
		const active = ctx.session?.session.activeOrganizationId;
		if (active) return active;

		const member = await this.db.member.findFirst({
			where: { userId },
			select: { organizationId: true },
			orderBy: { createdAt: "asc" },
		});

		return member?.organizationId ?? null;
	}
}
