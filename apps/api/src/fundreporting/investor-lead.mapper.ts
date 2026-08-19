export const LANDING_STATUS = "prospect";

export type LeadPerson = {
	firstName: string;
	lastName: string | null;
	email: string | null;
	phone: string | null;
};

export type LeadSource = {
	assetManagerId: string;
	dealName: string;
	amount: string | null;
	currency: string;
	closedAt: Date | null;
	companyName: string | null;
	person: LeadPerson | null;
	classification: string | null;
	interest: FundInterest | null;
};

export type FundInterest = {
	fund: string;
	share_class: string | null;
	committed_amount: number;
};

export type InvestorLeadWrite = {
	asset_manager: string;
	name: string;
	email?: string;
	phone?: string;
	company?: string;
	status?: string;
	notes?: string;
	investor_classification?: string;
	interests?: FundInterest[];
};

export type ExistingLead = {
	id: string | number;
	email?: string | null;
	interests?: FundInterest[] | null;
};

export function mergeInterests(
	existing: readonly FundInterest[] | null | undefined,
	incoming: FundInterest | null,
): FundInterest[] | null {
	if (!incoming) return null;

	const kept = (existing ?? []).filter(
		(held) =>
			held.fund !== incoming.fund ||
			(held.share_class ?? null) !== (incoming.share_class ?? null),
	);

	return [...kept, incoming];
}

export function leadName(person: LeadPerson | null, fallback: string): string {
	if (!person) return fallback;

	const full = [person.firstName, person.lastName]
		.map((part) => part?.trim())
		.filter(Boolean)
		.join(" ");

	return full || fallback;
}

export function handoffNote(source: LeadSource): string {
	const parts = [`Won in the CRM as "${source.dealName}".`];

	if (source.amount) {
		parts.push(
			`Deal value recorded there: ${source.amount} ${source.currency}.`,
		);
	}

	if (source.closedAt) {
		parts.push(`Closed ${source.closedAt.toISOString().slice(0, 10)}.`);
	}

	if (!source.interest) {
		parts.push("No fund interest was recorded on the deal.");
	}

	return parts.join(" ");
}

export function toCreate(source: LeadSource): InvestorLeadWrite {
	const write: InvestorLeadWrite = {
		asset_manager: source.assetManagerId,
		name: leadName(source.person, source.companyName ?? source.dealName),
		status: LANDING_STATUS,
		notes: handoffNote(source),
	};

	if (source.person?.email) write.email = source.person.email;
	if (source.person?.phone) write.phone = source.person.phone;
	if (source.companyName) write.company = source.companyName;
	if (source.classification) {
		write.investor_classification = source.classification;
	}
	if (source.interest) write.interests = [source.interest];

	return write;
}

export function toUpdate(
	source: LeadSource,
	existing?: ExistingLead | null,
): Omit<InvestorLeadWrite, "status"> {
	const { status, ...rest } = toCreate(source);
	void status;

	const merged = mergeInterests(existing?.interests, source.interest);
	if (merged) rest.interests = merged;

	return rest;
}

export function matchExisting(
	leads: readonly ExistingLead[],
	email: string | null,
): ExistingLead | null {
	if (!email) return null;

	const wanted = email.trim().toLowerCase();
	if (!wanted) return null;

	return (
		leads.find((lead) => lead.email?.trim().toLowerCase() === wanted) ?? null
	);
}
