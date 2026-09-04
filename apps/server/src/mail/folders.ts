import type { ImapFlow } from "imapflow";
import { specialUseFromFlag, type Folder, type SpecialUse } from "@ionnet/shared";

export async function listFolders(client: ImapFlow): Promise<Folder[]> {
  const rows = await client.list({ statusQuery: { messages: true, unseen: true } });
  const folders: Folder[] = rows
    .filter((r) => !r.flags.has("\\Noselect") && !r.flags.has("\\NonExistent"))
    .map((r) => ({
      path: r.path,
      name: r.path === "INBOX" ? "Inbox" : r.name,
      delimiter: r.delimiter,
      specialUse: r.path === "INBOX" ? "inbox" : specialUseFromFlag(r.specialUse),
      unread: r.status?.unseen ?? 0,
      total: r.status?.messages ?? 0,
      subscribed: r.subscribed,
    }));
  const order: Record<string, number> = { inbox: 0, drafts: 1, sent: 2, archive: 3, junk: 4, trash: 5 };
  folders.sort((a, b) => {
    const oa = a.specialUse ? order[a.specialUse]! : 10;
    const ob = b.specialUse ? order[b.specialUse]! : 10;
    return oa - ob || a.path.localeCompare(b.path);
  });
  return folders;
}

export async function findSpecialFolder(client: ImapFlow, use: SpecialUse): Promise<string> {
  const rows = await client.list();
  const hit = rows.find((r) => (r.path === "INBOX" ? "inbox" : specialUseFromFlag(r.specialUse)) === use);
  if (hit) return hit.path;
  const fallback: Record<SpecialUse, string> = { inbox: "INBOX", drafts: "Drafts", sent: "Sent", junk: "Junk", trash: "Trash", archive: "Archive" };
  const name = fallback[use];
  if (!rows.some((r) => r.path === name)) await client.mailboxCreate(name);
  return name;
}
