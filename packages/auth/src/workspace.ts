import "@crm/env/load";

type AllowList = {
	domains: readonly string[];
	addresses: readonly string[];
};

const EMPTY: AllowList = { domains: [], addresses: [] };

let cachedSource: string | undefined;
let cached: AllowList = EMPTY;

export function normalizeSignInEntry(raw: string): string {
	return raw.trim().toLowerCase().replace(/^@/, "");
}

export function parseSignInEntries(source: string): readonly string[] {
	const entries: string[] = [];

	for (const raw of source.split(",")) {
		const entry = normalizeSignInEntry(raw);
		if (entry && !entries.includes(entry)) entries.push(entry);
	}

	return entries;
}

function allowList(): AllowList {
	const source = process.env.ALLOWED_SIGN_IN ?? "";
	if (source === cachedSource) return cached;

	const domains: string[] = [];
	const addresses: string[] = [];

	for (const entry of parseSignInEntries(source)) {
		(entry.includes("@") ? addresses : domains).push(entry);
	}

	cachedSource = source;
	cached = { domains, addresses };
	return cached;
}

export function bootstrapSignInEntries(): readonly string[] {
	return parseSignInEntries(process.env.ALLOWED_SIGN_IN ?? "");
}

export function workspaceDomains(): readonly string[] {
	return allowList().domains;
}

export function primaryWorkspaceDomain(): string | undefined {
	return allowList().domains[0];
}

export function hasSignInAllowList(): boolean {
	const { domains, addresses } = allowList();
	return domains.length > 0 || addresses.length > 0;
}

export function signInCandidates(
	email: string | null | undefined,
): readonly string[] {
	const value = email?.trim().toLowerCase();
	if (!value) return [];

	const parts = value.split("@");
	if (parts.length !== 2) return [];

	const [local, host] = parts;
	if (!local || !host) return [];

	const labels = host.split(".");
	const suffixes = labels.map((_, index) => labels.slice(index).join("."));

	return [value, ...suffixes];
}

export function isWorkspaceEmail(email: string | null | undefined): boolean {
	const [address, ...domains] = signInCandidates(email);
	if (!address) return false;

	const list = allowList();

	return (
		list.addresses.includes(address) ||
		domains.some((domain) => list.domains.includes(domain))
	);
}
