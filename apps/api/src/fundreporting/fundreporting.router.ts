import { Inject } from "@nestjs/common";
import { Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { FundCatalogService } from "./fund-catalog.service";
import {
	retryHandoffInput,
	shareClassesInput,
} from "./fundreporting.contracts";
import { LeadHandoffService } from "./lead-handoff.service";

@Router({ alias: "fundreporting" })
@UseMiddlewares(AuthMiddleware)
export class FundreportingRouter {
	constructor(
		@Inject(LeadHandoffService) private readonly handoff: LeadHandoffService,
		@Inject(FundCatalogService) private readonly catalog: FundCatalogService,
	) {}

	@Query()
	async outstanding() {
		return this.handoff.outstanding();
	}

	@Query()
	async assetManager() {
		return this.catalog.assetManager();
	}

	@Query()
	async funds() {
		return this.catalog.funds();
	}

	@Query({ input: shareClassesInput })
	async shareClasses(@Input() input: z.infer<typeof shareClassesInput>) {
		return this.catalog.shareClasses(input.fundId);
	}

	@Mutation({ input: retryHandoffInput })
	async retry(@Input() input: z.infer<typeof retryHandoffInput>) {
		return this.handoff.retry(input.dealId);
	}
}
