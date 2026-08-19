import { Module } from "@nestjs/common";
import { FundCatalogService } from "./fund-catalog.service";
import { FundreportingRouter } from "./fundreporting.router";
import { LeadHandoffService } from "./lead-handoff.service";
import { PLATFORM_API, PlatformClient } from "./platform.client";

@Module({
	providers: [
		PlatformClient,
		{ provide: PLATFORM_API, useExisting: PlatformClient },
		LeadHandoffService,
		FundCatalogService,
		FundreportingRouter,
	],
	exports: [LeadHandoffService],
})
export class FundreportingModule {}
