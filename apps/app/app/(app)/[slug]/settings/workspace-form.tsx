"use client";

import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@crm/ui/components/input-group";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import { useWorkspaceSlug } from "@/lib/use-workspace-url";
import { workspaceUrl } from "@/lib/workspace-url";

export function WorkspaceForm() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const router = useRouter();
	const slug = useWorkspaceSlug();

	const nameId = useId();
	const websiteId = useId();
	const assetManagerId = useId();

	const workspace = useQuery(trpc.workspace.get.queryOptions());

	const [draft, setDraft] = useState<{
		name: string;
		website: string;
		assetManagerId: string;
	} | null>(null);

	const save = useMutation(
		trpc.workspace.update.mutationOptions({
			onSuccess: async (saved) => {
				await cache.workspace();
				setDraft(null);
				toast.success("Workspace saved.");

				if (saved.slug !== slug) {
					router.replace(workspaceUrl(saved.slug, "/settings"));
				}
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!workspace.data) return null;

	const { name, website, canRename } = workspace.data;
	const assetManager = workspace.data.assetManagerId ?? "";

	const values = draft ?? {
		name,
		website: website ?? "",
		assetManagerId: assetManager,
	};
	const dirty =
		values.name !== name ||
		values.website !== (website ?? "") ||
		values.assetManagerId !== assetManager;

	const edit = (patch: Partial<typeof values>) =>
		setDraft({ ...values, ...patch });

	return (
		<Card>
			<CardHeader>
				<CardTitle>Workspace</CardTitle>
				<CardDescription>
					The name and website of the company using this CRM.
				</CardDescription>

				<CardAction>
					<Button
						type="submit"
						form="workspace"
						disabled={
							!canRename ||
							save.isPending ||
							!dirty ||
							values.name.trim() === "" ||
							values.website.trim() === ""
						}
					>
						{save.isPending ? <Spinner data-icon="inline-start" /> : null}
						Save
					</Button>
				</CardAction>
			</CardHeader>

			<CardContent>
				<form
					id="workspace"
					onSubmit={(event) => {
						event.preventDefault();
						save.mutate({
							name: values.name,
							website: values.website.trim(),
							assetManagerId: values.assetManagerId.trim(),
						});
					}}
				>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor={nameId}>Name</FieldLabel>
							<Input
								id={nameId}
								value={values.name}
								onChange={(event) => edit({ name: event.target.value })}
								placeholder="Acme Inc."
								autoComplete="organization"
								disabled={!canRename || save.isPending}
								required
							/>
							<FieldDescription>
								Shown wherever the CRM refers to your own company.
							</FieldDescription>
						</Field>

						<Field>
							<FieldLabel htmlFor={websiteId}>Website</FieldLabel>
							<InputGroup>
								<InputGroupAddon>
									<InputGroupText>https://</InputGroupText>
								</InputGroupAddon>
								<InputGroupInput
									id={websiteId}
									value={values.website}
									onChange={(event) => edit({ website: event.target.value })}
									placeholder="acme.com"
									autoComplete="off"
									autoCapitalize="off"
									autoCorrect="off"
									spellCheck={false}
									inputMode="url"
									disabled={!canRename || save.isPending}
								/>
							</InputGroup>
							<FieldDescription>Your own company's website.</FieldDescription>
						</Field>

						<Field>
							<FieldLabel htmlFor={assetManagerId}>
								FundReporting asset manager
							</FieldLabel>
							<Input
								id={assetManagerId}
								value={values.assetManagerId}
								onChange={(event) =>
									edit({ assetManagerId: event.target.value })
								}
								placeholder="00000000-0000-0000-0000-000000000000"
								autoComplete="off"
								autoCapitalize="off"
								autoCorrect="off"
								spellCheck={false}
								disabled={!canRename || save.isPending}
							/>
							<FieldDescription>
								<AssetManagerCheck saved={assetManager !== ""} />
							</FieldDescription>
						</Field>
					</FieldGroup>
				</form>

				{canRename ? null : (
					<p className="text-muted-foreground text-xs">
						Only an owner or an admin can change this.
					</p>
				)}
			</CardContent>
		</Card>
	);
}

function AssetManagerCheck({ saved }: { saved: boolean }) {
	const trpc = useTRPC();
	const check = useQuery({
		...trpc.fundreporting.assetManager.queryOptions(),
		enabled: saved,
	});

	if (!saved) {
		return (
			<>
				Which asset manager this workspace is, on FundReporting's side. A won
				deal is filed against it; without one, nothing is filed.
			</>
		);
	}

	if (check.isPending) return <>Checking with FundReporting…</>;

	switch (check.data?.state) {
		case "found":
			return <>FundReporting knows this one as {check.data.name}.</>;
		case "unknown":
			return <>FundReporting does not recognise that id.</>;
		default:
			return <>Saved. FundReporting could not be reached to confirm it.</>;
	}
}
