"use client";

import { signIn } from "@crm/auth/client";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { Spinner } from "@crm/ui/components/spinner";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

export function DevSignIn() {
	const [email, setEmail] = useState("demo@steplabs.xyz");
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setPending(true);

		const { error } = await signIn.email({ email, password });

		if (error) {
			toast.error(error.message ?? "No se pudo iniciar sesión.");
			setPending(false);
			return;
		}

		window.location.href = "/";
	}

	return (
		<form className="flex flex-col gap-3" onSubmit={handleSubmit}>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="dev-email">Email</Label>
				<Input
					id="dev-email"
					type="email"
					autoComplete="username"
					value={email}
					onChange={(event) => setEmail(event.target.value)}
					required
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label htmlFor="dev-password">Password</Label>
				<Input
					id="dev-password"
					type="password"
					autoComplete="current-password"
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					required
				/>
			</div>

			<Button className="w-full" disabled={pending} type="submit">
				{pending ? <Spinner data-icon="inline-start" /> : null}
				Dev sign in
			</Button>

			<p className="text-center text-muted-foreground text-xs/5">
				Local dev login (DEV_LOCAL_LOGIN). Remove before merging.
			</p>
		</form>
	);
}
