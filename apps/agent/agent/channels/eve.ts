import { db } from "@crm/db";
import {
	type AuthFn,
	extractBearerToken,
	localDev,
	vercelOidc,
	verifyJwtHmac,
	withAuthChallenges,
} from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

export const BRIDGE_ISSUER = "crm-app";
export const BRIDGE_AUDIENCE = "crm-agent";

export function repFromCrm(secret: string): AuthFn<Request> {
	return withAuthChallenges(
		async (request: Request) => {
			const result = await verifyJwtHmac(
				extractBearerToken(request.headers.get("authorization")),
				{
					algorithm: "HS256",
					audiences: [BRIDGE_AUDIENCE],
					issuer: BRIDGE_ISSUER,
					secret,
				},
			);

			if (!result.ok) return null;

			const claims = result.sessionAuth;
			const userId = claims.subject;
			if (!userId) return null;

			const attributes = claims.attributes ?? {};
			const organizationId = attributes.organizationId;

			if (typeof organizationId !== "string" || !organizationId) return null;

			if (!(await belongsTo(userId, organizationId))) return null;

			return {
				attributes,
				authenticator: "crm-app",
				principalId: userId,
				principalType: "user" as const,
			};
		},
		[{ scheme: "Bearer" }],
	);
}

async function belongsTo(
	userId: string,
	organizationId: string,
): Promise<boolean> {
	try {
		const member = await db.member.findUnique({
			where: { organizationId_userId: { organizationId, userId } },
			select: { id: true },
		});

		return Boolean(member);
	} catch (error) {
		console.error(
			"[eve] could not check the workspace on a bridge token; refusing it",
			error,
		);
		return false;
	}
}

const secret = process.env.AGENT_BRIDGE_SECRET;

export default eveChannel({
	auth: [...(secret ? [repFromCrm(secret)] : []), vercelOidc(), localDev()],
});
