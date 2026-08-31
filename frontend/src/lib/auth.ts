import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [adminClient()],
});

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  banned: boolean;
  maxStorageBytes: number | null;
  maxStreams: number | null;
};
