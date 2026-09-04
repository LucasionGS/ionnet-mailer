import type { MailboxRow } from "../db/models.ts";

export type Variables = {
  user: MailboxRow;
  sessionId: string;
  clientIp: string;
};
export type AppEnv = { Variables: Variables };
