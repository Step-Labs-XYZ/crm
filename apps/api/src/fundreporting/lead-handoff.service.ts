import { type Db, DealStage, HandoffState, tenantId } from "@crm/db";
import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import {
	type ExistingLead,
	type LeadSource,
	matchExisting,
	toCreate,
	toUpdate,
} from "./investor-lead.mapper";
import {
	NOT_CONFIGURED,
	PLATFORM_API,
	type PlatformApi,
} from "./platform.client";

export const NO_ASSET_MANAGER =
	"This workspace has not been told which asset manager it is on FundReporting, so a won deal cannot be filed there.";

export const NOT_A_UUID =
	"This workspace's asset manager id is not a UUID, and FundReporting only accepts one. Correct it before a won deal can be filed there.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAssetManagerId(value: string | null): boolean {
	return Boolean(value && UUID.test(value.trim()));
}

export type HandoffResult = {
	dealId: string;
	state: HandoffState;
	leadId: string | null;
	reason: string | null;
};

@Injectable()
export class LeadHandoffService {
	private readonly logger = new Logger(LeadHandoffService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		@Inject(PLATFORM_API) private readonly platform: PlatformApi,
	) {}

	async onDealWon(dealId: string): Promise<HandoffResult> {
		const source = await this.sourceFor(dealId);

		if (!source) {
			return this.settle(dealId, HandoffState.REFUSED, NO_ASSET_MANAGER, null);
		}

		if (!isAssetManagerId(source.assetManagerId)) {
			return this.settle(dealId, HandoffState.REFUSED, NOT_A_UUID, null);
		}

		if (!this.platform.configured()) {
			return this.settle(dealId, HandoffState.REFUSED, NOT_CONFIGURED, null);
		}

		return this.deliver(dealId, source);
	}

	async retry(dealId: string): Promise<HandoffResult> {
		const existing = await this.db.investorLeadHandoff.findUnique({
			where: { dealId },
			select: { id: true },
		});

		if (!existing) {
			throw new NotFoundException("That deal has never been handed off.");
		}

		return this.onDealWon(dealId);
	}

	async outstanding(): Promise<HandoffResult[]> {
		const rows = await this.db.investorLeadHandoff.findMany({
			where: { state: { in: [HandoffState.FAILED, HandoffState.REFUSED] } },
			select: { dealId: true, state: true, leadId: true, lastError: true },
			orderBy: { updatedAt: "desc" },
		});

		return rows.map((row) => ({
			dealId: row.dealId,
			state: row.state,
			leadId: row.leadId,
			reason: row.lastError,
		}));
	}

	private async deliver(
		dealId: string,
		source: LeadSource,
	): Promise<HandoffResult> {
		const filed = await this.db.investorLeadHandoff.findUnique({
			where: { dealId },
			select: { leadId: true },
		});

		let leadId = filed?.leadId ?? null;

		if (!leadId) {
			const listed = await this.platform.listLeads(source.assetManagerId);

			if (!listed.ok) {
				return this.settle(
					dealId,
					listed.retryable ? HandoffState.FAILED : HandoffState.REFUSED,
					listed.reason,
					null,
				);
			}

			leadId = idOf(matchExisting(listed.data, source.person?.email ?? null));
		}

		const written = leadId
			? await this.platform.updateLead(leadId, toUpdate(source))
			: await this.platform.createLead(toCreate(source));

		if (!written.ok) {
			return this.settle(
				dealId,
				written.retryable ? HandoffState.FAILED : HandoffState.REFUSED,
				written.reason,
				leadId,
			);
		}

		const settledId = leadId ?? idOf(written.data);

		this.logger.log({
			message: "Won deal handed off to FundReporting",
			dealId,
			leadId: settledId,
			created: !leadId,
		});

		return this.settle(dealId, HandoffState.SENT, null, settledId);
	}

	private async settle(
		dealId: string,
		state: HandoffState,
		reason: string | null,
		leadId: string | null,
	): Promise<HandoffResult> {
		const sent = state === HandoffState.SENT;

		const row = await this.db.investorLeadHandoff.upsert({
			where: { dealId },
			create: {
				organizationId: tenantId(),
				dealId,
				state,
				leadId,
				attempts: 1,
				lastError: reason,
				sentAt: sent ? new Date() : null,
			},
			update: {
				state,
				attempts: { increment: 1 },
				lastError: reason,
				...(leadId ? { leadId } : {}),
				...(sent ? { sentAt: new Date() } : {}),
			},
			select: { state: true, leadId: true, lastError: true },
		});

		if (!sent) {
			this.logger.warn({
				message: "Handoff did not land",
				dealId,
				state,
				reason,
			});
		}

		return {
			dealId,
			state: row.state,
			leadId: row.leadId,
			reason: row.lastError,
		};
	}

	private async sourceFor(dealId: string): Promise<LeadSource | null> {
		const deal = await this.db.deal.findUnique({
			where: { id: dealId },
			select: {
				name: true,
				amount: true,
				currency: true,
				closedAt: true,
				stage: true,
				organizationId: true,
				company: {
					select: {
						name: true,
						primaryContact: {
							select: {
								firstName: true,
								lastName: true,
								email: true,
								phone: true,
							},
						},
					},
				},
				contacts: {
					orderBy: { contactId: "asc" },
					take: 1,
					select: {
						contact: {
							select: {
								firstName: true,
								lastName: true,
								email: true,
								phone: true,
							},
						},
					},
				},
			},
		});

		if (!deal || deal.stage !== DealStage.CLOSED_WON) return null;

		const workspace = await this.db.organization.findUnique({
			where: { id: deal.organizationId },
			select: { assetManagerId: true },
		});

		if (!workspace?.assetManagerId) return null;

		return {
			assetManagerId: workspace.assetManagerId,
			dealName: deal.name,
			amount: deal.amount ? deal.amount.toString() : null,
			currency: deal.currency,
			closedAt: deal.closedAt,
			companyName: deal.company?.name ?? null,
			person: deal.contacts[0]?.contact ?? deal.company?.primaryContact ?? null,
		};
	}
}

function idOf(lead: ExistingLead | null): string | null {
	if (!lead || lead.id === null || lead.id === undefined) return null;

	return String(lead.id);
}
