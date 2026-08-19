"use client";

import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { SimpleTable, SimpleTableRow } from "@crm/ui/components/simple-table";
import { Skeleton } from "@crm/ui/components/skeleton";
import { TableCell } from "@crm/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { useTRPC } from "@/lib/trpc/client";

const ROLES: Record<string, string> = {
	investor: "Investor",
	ubo: "Beneficial owner",
	stakeholder: "Stakeholder",
};

const KINDS: Record<string, string> = {
	individual: "Person",
	company: "Company",
	fund: "Fund",
	asset_manager: "Asset manager",
};

export function InvestorsTable() {
	const trpc = useTRPC();
	const open = useOpenRecord();
	const investors = useQuery(trpc.fundreporting.investors.queryOptions());

	if (investors.isPending) {
		return (
			<div className="flex flex-col gap-2">
				<Skeleton className="h-9 w-full" />
				<Skeleton className="h-9 w-full" />
				<Skeleton className="h-9 w-full" />
			</div>
		);
	}

	const rows = investors.data ?? [];

	if (rows.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				Nobody holds a position with this asset manager yet, or FundReporting
				could not be reached. Nothing is stored here either way — this list is
				read from the platform every time it is opened.
			</p>
		);
	}

	return (
		<SimpleTable
			columns={[
				{ header: "Investor" },
				{ header: "Email" },
				{ header: "Holds as" },
				{ header: "Kind" },
				{ header: "In this CRM" },
			]}
		>
			{rows.map((investor) => {
				const contactId = investor.contactId;

				return (
					<SimpleTableRow
						key={investor.id}
						clickable={Boolean(contactId)}
						onClick={
							contactId
								? () => open({ kind: "contact", id: contactId })
								: undefined
						}
					>
						<TableCell className="font-medium">{investor.name}</TableCell>
						<TableCell>{investor.email ?? <EmptyCellValue />}</TableCell>
						<TableCell>
							{investor.role ? (
								(ROLES[investor.role] ?? investor.role)
							) : (
								<EmptyCellValue />
							)}
						</TableCell>
						<TableCell>
							{investor.kind ? (
								(KINDS[investor.kind] ?? investor.kind)
							) : (
								<EmptyCellValue />
							)}
						</TableCell>
						<TableCell className="text-muted-foreground">
							{contactId ? "Already a contact" : "Not a contact yet"}
						</TableCell>
					</SimpleTableRow>
				);
			})}
		</SimpleTable>
	);
}
