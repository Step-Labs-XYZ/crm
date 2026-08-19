"use client";

import { Button } from "@crm/ui/components/button";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { SimpleTable } from "@crm/ui/components/simple-table";
import { Skeleton } from "@crm/ui/components/skeleton";
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
			<tbody>
				{rows.map((investor) => (
					<tr key={investor.id}>
						<td className="font-medium">{investor.name}</td>
						<td>{investor.email ?? <EmptyCellValue />}</td>
						<td>
							{investor.role ? (
								(ROLES[investor.role] ?? investor.role)
							) : (
								<EmptyCellValue />
							)}
						</td>
						<td>
							{investor.kind ? (
								(KINDS[investor.kind] ?? investor.kind)
							) : (
								<EmptyCellValue />
							)}
						</td>
						<td>
							{investor.contactId ? (
								<Button
									variant="link"
									onClick={() =>
										open({ kind: "contact", id: investor.contactId as string })
									}
								>
									Open contact
								</Button>
							) : (
								<span className="text-muted-foreground">Not a contact yet</span>
							)}
						</td>
					</tr>
				))}
			</tbody>
		</SimpleTable>
	);
}
