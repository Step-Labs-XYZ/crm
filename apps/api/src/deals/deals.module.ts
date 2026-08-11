import { Module } from "@nestjs/common";
import { FundreportingModule } from "../fundreporting/fundreporting.module";
import { TrpcModule } from "../trpc/trpc.module";
import { DealsRouter } from "./deals.router";
import { DealsService } from "./deals.service";

@Module({
	imports: [TrpcModule, FundreportingModule],
	providers: [DealsService, DealsRouter],
	exports: [DealsService],
})
export class DealsModule {}
