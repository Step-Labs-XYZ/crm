import { type Db, EnrichmentStatus, tenantId } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { InjectDatabase } from "../database/database.constants";
import { domainFromEmail } from "./domain";

@Injectable()
export class CompanyDirectoryService {
	private readonly logger = new Logger(CompanyDirectoryService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly agent: AgentTriggerService,
	) {}

	async companyForEmail(
		email: string,
		options: { ownerId?: string | null } = {},
	): Promise<string | null> {
		const domain = domainFromEmail(email);
		if (!domain) return null;

		const existing = await this.db.company.findUnique({
			where: {
				organizationId_domain: { organizationId: tenantId(), domain },
			},
			select: { id: true },
		});
		if (existing) return existing.id;

		const company = await this.db.company.upsert({
			where: {
				organizationId_domain: { organizationId: tenantId(), domain },
			},
			create: {
				organizationId: tenantId(),
				name: domain,
				domain,
				website: `https://${domain}`,
				enrichmentStatus: EnrichmentStatus.PENDING,
				ownerId: options.ownerId ?? null,
			},
			update: {},
			select: { id: true },
		});

		await this.agent.companyCreated(
			company.id,
			`Created from an email domain (${domain}) — it has no name but the domain`,
		);

		this.logger.log({
			message: "Company created from an email domain",
			companyId: company.id,
			domain,
		});

		return company.id;
	}
}
