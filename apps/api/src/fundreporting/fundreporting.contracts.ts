import { z } from "zod";

export const retryHandoffInput = z.object({
	dealId: z.string().min(1),
});

export type RetryHandoffInput = z.infer<typeof retryHandoffInput>;
