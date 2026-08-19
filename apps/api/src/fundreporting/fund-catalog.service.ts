import { type Db, tenantId } from "@crm/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { PLATFORM_API, type PlatformApi } from "./platform.client";

export type FundOption = {
	id: string;
	name: string;
	entityId: string | null;
};

export type ShareClassOption = {
	id: string;
	name: string;
};

@Injectable()
export class FundCatalogService {
	private readonly logger = new Logger(FundCatalogService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		@Inject(PLATFORM_API) private readonly platform: PlatformApi,
	) {}

	async funds(): Promise<FundOption[]> {
		const assetManagerId = await this.assetManagerId();
		if (!assetManagerId || !this.platform.configured()) return [];

		const result = await this.platform.listFunds(assetManagerId);

		if (!result.ok) {
			this.logger.warn({
				message: "FundReporting funds could not be read",
				reason: result.reason,
			});
			return [];
		}

		return result.data
			.filter((fund) => Boolean(fund.id))
			.map((fund) => ({
				id: fund.id,
				name: fund.name ?? fund.id,
				entityId: fund.entity ?? null,
			}));
	}

	async shareClasses(fundId: string): Promise<ShareClassOption[]> {
		const fund = (await this.funds()).find((option) => option.id === fundId);
		if (!fund?.entityId) return [];

		const result = await this.platform.listShareClasses(fund.entityId);

		if (!result.ok) {
			this.logger.warn({
				message: "FundReporting share classes could not be read",
				reason: result.reason,
			});
			return [];
		}

		return result.data
			.filter((cls) => Boolean(cls.id))
			.map((cls) => ({ id: cls.id, name: cls.name ?? cls.id }));
	}

	private async assetManagerId(): Promise<string | null> {
		const workspace = await this.db.organization.findUnique({
			where: { id: tenantId() },
			select: { assetManagerId: true },
		});

		return workspace?.assetManagerId ?? null;
	}
}
