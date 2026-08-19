import { z } from "zod";

export const retryHandoffInput = z.object({
	dealId: z.string().min(1),
});

export type RetryHandoffInput = z.infer<typeof retryHandoffInput>;

export const shareClassesInput = z.object({
	fundId: z.string().min(1),
});

export type ShareClassesInput = z.infer<typeof shareClassesInput>;
