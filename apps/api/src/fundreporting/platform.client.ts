import { Injectable, Logger } from "@nestjs/common";
import type { ExistingLead, InvestorLeadWrite } from "./investor-lead.mapper";

export const PLATFORM_API = Symbol("PLATFORM_API");

export type PlatformOutcome<T> =
	| { ok: true; data: T }
	| { ok: false; retryable: boolean; reason: string };

export const NOT_CONFIGURED =
	"FundReporting is not connected on this install: set PLATFORM_API_URL and PLATFORM_SERVICE_TOKEN.";

export interface PlatformApi {
	configured(): boolean;
	listLeads(assetManagerId: string): Promise<PlatformOutcome<ExistingLead[]>>;
	createLead(body: InvestorLeadWrite): Promise<PlatformOutcome<ExistingLead>>;
	updateLead(
		leadId: string,
		body: Omit<InvestorLeadWrite, "status">,
	): Promise<PlatformOutcome<ExistingLead>>;
}

const TIMEOUT_MS = 15_000;

@Injectable()
export class PlatformClient implements PlatformApi {
	private readonly logger = new Logger(PlatformClient.name);

	configured(): boolean {
		return Boolean(
			process.env.PLATFORM_API_URL && process.env.PLATFORM_SERVICE_TOKEN,
		);
	}

	async listLeads(
		assetManagerId: string,
	): Promise<PlatformOutcome<ExistingLead[]>> {
		const query = `investor_lead?asset_manager=${encodeURIComponent(assetManagerId)}`;
		const result = await this.call<ExistingLead[] | null>("GET", query);

		if (!result.ok) return result;

		return { ok: true, data: Array.isArray(result.data) ? result.data : [] };
	}

	async createLead(
		body: InvestorLeadWrite,
	): Promise<PlatformOutcome<ExistingLead>> {
		return this.call<ExistingLead>("POST", "investor_lead", body);
	}

	async updateLead(
		leadId: string,
		body: Omit<InvestorLeadWrite, "status">,
	): Promise<PlatformOutcome<ExistingLead>> {
		return this.call<ExistingLead>(
			"PATCH",
			`investor_lead/${encodeURIComponent(leadId)}`,
			body,
		);
	}

	private async call<T>(
		method: "GET" | "POST" | "PATCH",
		path: string,
		body?: unknown,
	): Promise<PlatformOutcome<T>> {
		const base = process.env.PLATFORM_API_URL;
		const token = process.env.PLATFORM_SERVICE_TOKEN;
		const dataSource = process.env.PLATFORM_DATA_SOURCE;

		if (!base || !token) {
			return { ok: false, retryable: false, reason: NOT_CONFIGURED };
		}

		let response: Response;

		try {
			response = await fetch(`${base.replace(/\/+$/, "")}/${path}`, {
				method,
				headers: {
					authorization: `Bearer ${token}`,
					...(dataSource ? { "x-data-source": dataSource } : {}),
					...(body ? { "content-type": "application/json" } : {}),
				},
				...(body ? { body: JSON.stringify(body) } : {}),
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
		} catch (error) {
			return {
				ok: false,
				retryable: true,
				reason: `FundReporting could not be reached: ${error instanceof Error ? error.message : String(error)}`,
			};
		}

		if (!response.ok) {
			const detail = await response.text().catch(() => "");

			this.logger.warn({
				message: "FundReporting refused a call",
				method,
				status: response.status,
			});

			return {
				ok: false,
				retryable: response.status >= 500 || response.status === 429,
				reason: `FundReporting answered ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
			};
		}

		const data = (await response.json().catch(() => null)) as T;

		return { ok: true, data };
	}
}
