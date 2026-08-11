import "@crm/env/load";

import { setSingleTenantProcess } from "@crm/db";
import { DEFAULT_AGENT_MODEL } from "@crm/db/settings";
import { soleTenantId } from "@crm/db/sole-tenant";
import { defineAgent, defineDynamic } from "eve";
import { logCapabilities } from "./lib/capabilities";
import { selectedModel } from "./lib/model";

void logCapabilities();

void adoptTheOnlyWorkspace();

async function adoptTheOnlyWorkspace(): Promise<void> {
	try {
		setSingleTenantProcess(await soleTenantId());
	} catch (error) {
		console.error(
			"[agent] could not decide which workspace this agent works for; every CRM read will refuse until it can",
			error,
		);
	}
}

export default defineAgent({
	model: defineDynamic({
		fallback: DEFAULT_AGENT_MODEL.id,
		events: { "session.started": () => selectedModel() },
	}),
});
