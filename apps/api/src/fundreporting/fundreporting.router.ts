import { Inject } from "@nestjs/common";
import { Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { retryHandoffInput } from "./fundreporting.contracts";
import { LeadHandoffService } from "./lead-handoff.service";

@Router({ alias: "fundreporting" })
@UseMiddlewares(AuthMiddleware)
export class FundreportingRouter {
	constructor(
		@Inject(LeadHandoffService) private readonly handoff: LeadHandoffService,
	) {}

	@Query()
	async outstanding() {
		return this.handoff.outstanding();
	}

	@Mutation({ input: retryHandoffInput })
	async retry(@Input() input: z.infer<typeof retryHandoffInput>) {
		return this.handoff.retry(input.dealId);
	}
}
