import { z } from "zod";

export const youtubeConnectionCreateSchema = z.object({
  clientId: z.string().min(1, "Client ID is required").max(256),
  clientSecret: z.string().min(1, "Client Secret is required").max(256),
});

export type YoutubeConnectionCreateInput = z.infer<typeof youtubeConnectionCreateSchema>;
