import type { Metadata } from "next";
import { Suspense } from "react";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellLoading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { InvestorsTable } from "./investors-table";

export const metadata: Metadata = {
	title: "Investors",
};

export default function InvestorsPage() {
	return (
		<PageShell className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Investors</PageShellTitle>
					<PageShellDescription>
						Who already holds a position with this asset manager, read from
						FundReporting. Nothing here is stored in the CRM.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent className="min-h-0">
				<Suspense fallback={<PageShellLoading />}>
					<Investors />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function Investors() {
	await requireSession();

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await queryClient.prefetchQuery(trpc.fundreporting.investors.queryOptions());

	return (
		<HydrateClient>
			<InvestorsTable />
		</HydrateClient>
	);
}
