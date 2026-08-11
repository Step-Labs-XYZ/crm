import "@crm/env/load";

import { setAmbientTenantResolver } from "@crm/db";
import { DEFAULT_AGENT_MODEL } from "@crm/db/settings";
import { defineAgent, defineDynamic } from "eve";
import { logCapabilities } from "./lib/capabilities";
import { focusedTenant } from "./lib/focus";
import { selectedModel } from "./lib/model";

void logCapabilities();

setAmbientTenantResolver(focusedTenant);

export default defineAgent({
	model: defineDynamic({
		fallback: DEFAULT_AGENT_MODEL.id,
		events: { "session.started": () => selectedModel() },
	}),
});
