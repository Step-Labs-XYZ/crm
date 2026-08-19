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

export type PlatformInvestor = {
	id: string;
	name: string;
	email: string | null;
	role: string | null;
	kind: string | null;
	contactId: string | null;
};

export type AssetManagerCheck =
	| { state: "unset" }
	| { state: "unreachable" }
	| { state: "unknown" }
	| { state: "found"; name: string };

@Injectable()
export class FundCatalogService {
	private readonly logger = new Logger(FundCatalogService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		@Inject(PLATFORM_API) private readonly platform: PlatformApi,
	) {}

	async assetManager(): Promise<AssetManagerCheck> {
		const assetManagerId = await this.assetManagerId();
		if (!assetManagerId) return { state: "unset" };
		if (!this.platform.configured()) return { state: "unreachable" };

		const result = await this.platform.getAssetManager(assetManagerId);

		if (!result.ok) {
			return { state: result.retryable ? "unreachable" : "unknown" };
		}

		return { state: "found", name: result.data.name ?? assetManagerId };
	}

	async investors(): Promise<PlatformInvestor[]> {
		const assetManagerId = await this.assetManagerId();
		if (!assetManagerId || !this.platform.configured()) return [];

		const manager = await this.platform.getAssetManager(assetManagerId);
		const entityId = manager.ok ? (manager.data.entity ?? null) : null;
		if (!entityId) return [];

		const result = await this.platform.listShareholders(entityId);

		if (!result.ok) {
			this.logger.warn({
				message: "FundReporting investors could not be read",
				reason: result.reason,
			});
			return [];
		}

		const held = result.data.filter((row) => Boolean(row.id));
		const emails = held
			.map((row) => row.email?.trim().toLowerCase())
			.filter((email): email is string => Boolean(email));

		const known =
			emails.length === 0
				? []
				: await this.db.contact.findMany({
						where: { email: { in: emails, mode: "insensitive" } },
						select: { id: true, email: true },
					});

		const byEmail = new Map(
			known
				.filter((contact) => contact.email)
				.map((contact) => [contact.email?.toLowerCase(), contact.id]),
		);

		return held.map((row) => ({
			id: row.id,
			name: row.name ?? row.email ?? row.id,
			email: row.email ?? null,
			role: row.role ?? null,
			kind: row.type ?? null,
			contactId: byEmail.get(row.email?.trim().toLowerCase() ?? "") ?? null,
		}));
	}

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
