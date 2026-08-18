import { InvestorClassification } from "@crm/db/enums";

export const INVESTOR_CLASSIFICATIONS = [
	InvestorClassification.RETAIL,
	InvestorClassification.PROFESSIONAL,
	InvestorClassification.INSTITUTIONAL,
] as const;

const LABELS: Record<InvestorClassification, string> = {
	RETAIL: "Retail",
	PROFESSIONAL: "Professional",
	INSTITUTIONAL: "Institutional",
};

export function classificationLabel(
	value: InvestorClassification | null | undefined,
): string | null {
	return value ? LABELS[value] : null;
}
