import { defineState } from "eve/context";

export const focus = defineState("crm.focus", () => ({
	organizationId: null as string | null,
	contactId: null as string | null,
	companyId: null as string | null,
	sessionId: null as string | null,
	spent: 0,
	budget: 4,
}));

export function currentFocus(): {
	organizationId: string | null;
	contactId: string | null;
	sessionId: string | null;
} {
	try {
		const state = focus.get();
		return {
			organizationId: state.organizationId,
			contactId: state.contactId,
			sessionId: state.sessionId,
		};
	} catch {
		return { organizationId: null, contactId: null, sessionId: null };
	}
}

export function focusedTenant(): string | null {
	return currentFocus().organizationId;
}

export function focusOn(input: {
	organizationId?: string | null;
	contactId?: string | null;
	companyId?: string | null;
	sessionId?: string | null;
}): void {
	focus.update((current) => ({
		...current,
		organizationId: input.organizationId ?? current.organizationId,
		contactId: input.contactId ?? current.contactId,
		companyId: input.companyId ?? current.companyId,
		sessionId: input.sessionId ?? current.sessionId,
	}));
}

export function spend(units = 1): { ok: true } | { ok: false; reason: string } {
	const { spent, budget } = focus.get();

	if (spent + units > budget) {
		return {
			ok: false,
			reason:
				`Research budget for this contact is spent (${spent}/${budget}). ` +
				"Write up what you already have, or schedule a recheck with a reason. Do not keep looking.",
		};
	}

	focus.update((current) => ({ ...current, spent: current.spent + units }));
	return { ok: true };
}

export function setBudget(budget: number): void {
	focus.update((current) => ({ ...current, budget }));
}
