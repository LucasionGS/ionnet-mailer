import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Archive, ChevronDown, ChevronRight, File, FolderIcon, Inbox, Plus, Send, ShieldAlert, Trash2 } from "lucide-react";
import type { Folder, SpecialUse } from "@ionnet/shared";
import { useCreateFolder } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/api";
import { cn, encodeFolder } from "@/lib/utils";
import { Button, Dialog, Field, IconButton, Input } from "@/components/ui";

const ICONS: Record<SpecialUse, React.ReactNode> = {
  inbox: <Inbox size={16} />,
  drafts: <File size={16} />,
  sent: <Send size={16} />,
  junk: <ShieldAlert size={16} />,
  trash: <Trash2 size={16} />,
  archive: <Archive size={16} />,
};
const ORDER: SpecialUse[] = ["inbox", "drafts", "sent", "archive", "junk", "trash"];

interface Node {
  folder: Folder;
  children: Node[];
}

function buildTree(folders: Folder[]): { special: Folder[]; tree: Node[] } {
  const special = ORDER.map((u) => folders.find((f) => f.specialUse === u)).filter((f): f is Folder => !!f);
  const rest = folders.filter((f) => !f.specialUse).sort((a, b) => a.path.localeCompare(b.path));
  const byPath = new Map<string, Node>();
  const roots: Node[] = [];
  for (const f of rest) {
    const node: Node = { folder: f, children: [] };
    byPath.set(f.path, node);
    const idx = f.path.lastIndexOf(f.delimiter || "/");
    const parent = idx > 0 ? byPath.get(f.path.slice(0, idx)) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return { special, tree: roots };
}

function FolderItem({ folder, active, depth, icon, onDrop }: { folder: Folder; active: boolean; depth: number; icon: React.ReactNode; onDrop?: (path: string) => void }) {
  const [over, setOver] = useState(false);
  return (
    <Link
      to="/mail/$folder"
      params={{ folder: encodeFolder(folder.path) }}
      className={cn(
        "focus-ring group flex h-9 items-center gap-3 rounded-lg pr-3 text-sm transition-colors",
        active ? "bg-selected font-semibold text-fg" : folder.unread > 0 ? "font-medium text-fg hover:bg-surface-3/70" : "text-fg-muted hover:bg-surface-3/70 hover:text-fg",
        over && "bg-accent-soft ring-2 ring-accent ring-inset",
      )}
      style={{ paddingLeft: 12 + depth * 14 }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-ionnet-messages")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop?.(folder.path);
      }}
    >
      <span className={cn("shrink-0", active ? "text-accent" : "text-fg-faint group-hover:text-fg-muted")}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
      {folder.unread > 0 && (
        <span className={cn("text-xs font-semibold tabular-nums", active ? "text-accent" : "text-fg-muted")}>{folder.unread > 999 ? "999+" : folder.unread}</span>
      )}
    </Link>
  );
}

function TreeNode({ node, activePath, depth, onDrop }: { node: Node; activePath: string; depth: number; onDrop?: (path: string) => void }) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  return (
    <div>
      <div className="flex items-center">
        {hasChildren ? (
          <button type="button" onClick={() => setOpen((o) => !o)} className="ml-1 flex h-5 w-4 items-center justify-center text-fg-faint" aria-label={open ? "Collapse" : "Expand"}>
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="ml-1 w-4" />
        )}
        <div className="min-w-0 flex-1">
          <FolderItem folder={node.folder} active={node.folder.path === activePath} depth={depth} icon={<FolderIcon size={16} />} onDrop={onDrop} />
        </div>
      </div>
      {open && node.children.map((c) => <TreeNode key={c.folder.path} node={c} activePath={activePath} depth={depth + 1} onDrop={onDrop} />)}
    </div>
  );
}

export function FolderList({ folders, activePath, onDrop }: { folders: Folder[]; activePath: string; onDrop?: (path: string) => void }) {
  const { special, tree } = buildTree(folders);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const create = useCreateFolder();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await create.mutateAsync({ path: name.trim() });
      toast.success("Folder created");
      setCreating(false);
      setName("");
    } catch (err) {
      toast.error("Could not create folder", errorMessage(err));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="scroll-thin flex-1 overflow-y-auto px-2 pb-2">
        <div className="flex flex-col gap-0.5">
          {special.map((f) => (
            <FolderItem key={f.path} folder={f} active={f.path === activePath} depth={0} icon={ICONS[f.specialUse!]} onDrop={onDrop} />
          ))}
        </div>
        <div className="mt-5 mb-1 flex items-center justify-between pr-1 pl-3">
          <span className="text-xs font-semibold text-fg-muted">Folders</span>
          <IconButton size="sm" label="New folder" onClick={() => setCreating(true)}>
            <Plus size={14} />
          </IconButton>
        </div>
        <div className="flex flex-col gap-0.5">
          {tree.length === 0 && <div className="px-3 py-1 text-xs text-fg-faint">Create folders to organise your mail.</div>}
          {tree.map((n) => (
            <TreeNode key={n.folder.path} node={n} activePath={activePath} depth={0} onDrop={onDrop} />
          ))}
        </div>
      </div>
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="New folder"
        description='Use "/" to nest, e.g. Projects/2026.'
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={create.isPending} onClick={(e) => submit(e as unknown as FormEvent)}>
              Create
            </Button>
          </>
        }
      >
        <form onSubmit={submit}>
          <Field label="Folder name">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <button type="submit" className="hidden" />
        </form>
      </Dialog>
    </div>
  );
}
