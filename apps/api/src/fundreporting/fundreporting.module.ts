import { Module } from "@nestjs/common";
import { FundreportingRouter } from "./fundreporting.router";
import { LeadHandoffService } from "./lead-handoff.service";
import { PLATFORM_API, PlatformClient } from "./platform.client";

@Module({
	providers: [
		PlatformClient,
		{ provide: PLATFORM_API, useExisting: PlatformClient },
		LeadHandoffService,
		FundreportingRouter,
	],
	exports: [LeadHandoffService],
})
export class FundreportingModule {}
