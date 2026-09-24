import { useState } from "react";
import { ChevronDown, Download, FileText, Forward, Image as ImageIcon, MoreHorizontal, Paperclip, Reply, ReplyAll, ShieldCheck, ShieldX, Star, Trash2 } from "lucide-react";
import type { Message } from "@ionnet/shared";
import { formatBytes } from "@ionnet/shared";
import { attachmentUrl, rawMessageUrl } from "@/lib/api";
import { avatarColor, cn, displayAddress, formatDateLong, formatDateShort, initials } from "@/lib/utils";
import { Badge, IconButton, Menu, MenuItem, MenuSeparator, Tooltip } from "@/components/ui";
import { HtmlFrame } from "./HtmlFrame";

export interface MessageCardProps {
  message: Message;
  expanded: boolean;
  onToggle: () => void;
  onReply: (m: Message) => void;
  onReplyAll: (m: Message) => void;
  onForward: (m: Message) => void;
  onDelete: (m: Message) => void;
  onToggleFlag: (m: Message) => void;
  onMarkUnread: (m: Message) => void;
  onEditDraft?: (m: Message) => void;
}

function AddressList({ label, list }: { label: string; list: Array<{ name: string; address: string }> }) {
  if (!list.length) return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-10 shrink-0 text-fg-faint">{label}</span>
      <span className="min-w-0 break-words text-fg-muted">
        {list.map((a, i) => (
          <span key={i}>
            {a.name ? (
              <>
                <span className="text-fg">{a.name}</span> <span>&lt;{a.address}&gt;</span>
              </>
            ) : (
              <span className="text-fg">{a.address}</span>
            )}
            {i < list.length - 1 ? ", " : ""}
          </span>
        ))}
      </span>
    </div>
  );
}

function AuthBadge({ label, value }: { label: string; value: string | null }) {
  if (!value) return <Badge tone="neutral">{label}: n/a</Badge>;
  const v = value.toLowerCase();
  const ok = v.startsWith("pass");
  const bad = v.startsWith("fail") || v.startsWith("softfail") || v.startsWith("permerror");
  return (
    <Badge tone={ok ? "success" : bad ? "danger" : "warning"}>
      {label}: {value}
    </Badge>
  );
}

export function MessageCard(p: MessageCardProps) {
  const m = p.message;
  const [showRemote, setShowRemote] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const from = m.from;
  const fromLabel = displayAddress(from) || "(unknown sender)";
  const attachments = m.attachments.filter((a) => !a.inline || !m.html);
  const auth = m.authentication;
  const authOk = [auth.spf, auth.dkim, auth.dmarc].some((v) => v?.toLowerCase().startsWith("pass"));
  const authBad = [auth.spf, auth.dkim, auth.dmarc].some((v) => v && /^(fail|softfail|permerror)/i.test(v));

  return (
    <article>
      <header
        className={cn("-mx-2 flex cursor-pointer items-start gap-3 rounded-lg px-2 py-3.5 transition-colors", !p.expanded && "hover:bg-surface-2")}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button,a")) return;
          p.onToggle();
        }}
      >
        <span
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
          style={{ background: avatarColor(from?.address ?? "?") }}
        >
          {initials(fromLabel)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={cn("truncate text-sm", m.unread ? "font-semibold" : "font-medium")}>{fromLabel}</span>
            {from?.name && <span className="hidden truncate text-xs text-fg-faint sm:inline">&lt;{from.address}&gt;</span>}
            {m.draft && <Badge tone="warning">Draft</Badge>}
            <span className="ml-auto shrink-0 text-xs text-fg-faint">
              <Tooltip content={formatDateLong(m.date)}>
                <span>{p.expanded ? formatDateLong(m.date) : formatDateShort(m.date)}</span>
              </Tooltip>
            </span>
          </div>
          {p.expanded ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowDetails((s) => !s);
              }}
              className="mt-0.5 inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
            >
              to {m.to.map(displayAddress).slice(0, 3).join(", ") || "(none)"}
              {m.cc.length > 0 && `, cc ${m.cc.length}`}
              <ChevronDown size={12} className={cn("transition-transform", showDetails && "rotate-180")} />
            </button>
          ) : (
            <div className="truncate text-xs text-fg-muted">{m.snippet}</div>
          )}
          {p.expanded && showDetails && (
            <div className="mt-2 flex flex-col gap-1 rounded-md border bg-surface-2 p-2 animate-fade-in">
              <AddressList label="From" list={from ? [from] : []} />
              <AddressList label="To" list={m.to} />
              <AddressList label="Cc" list={m.cc} />
              <AddressList label="Bcc" list={m.bcc} />
              {m.replyTo.length > 0 && <AddressList label="Reply" list={m.replyTo} />}
              <div className="flex gap-2 text-xs">
                <span className="w-10 shrink-0 text-fg-faint">Date</span>
                <span className="text-fg-muted">{formatDateLong(m.date)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <AuthBadge label="SPF" value={auth.spf} />
                <AuthBadge label="DKIM" value={auth.dkim} />
                <AuthBadge label="DMARC" value={auth.dmarc} />
                {auth.spamScore != null && <Badge tone={auth.spamScore >= 6 ? "danger" : auth.spamScore >= 3 ? "warning" : "neutral"}>spam score {auth.spamScore}</Badge>}
              </div>
            </div>
          )}
        </div>
        {p.expanded && (
          <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            {(authOk || authBad) && (
              <Tooltip content={authBad ? "Authentication failed for at least one check" : "Sender authenticated"}>
                <span className={cn("mr-1 hidden sm:inline-flex", authBad ? "text-danger" : "text-success")}>
                  {authBad ? <ShieldX size={15} /> : <ShieldCheck size={15} />}
                </span>
              </Tooltip>
            )}
            <IconButton label="Star" size="sm" active={m.flagged} onClick={() => p.onToggleFlag(m)}>
              <Star size={15} fill={m.flagged ? "currentColor" : "none"} className={m.flagged ? "text-warning" : ""} />
            </IconButton>
            <IconButton label="Reply (r)" size="sm" onClick={() => p.onReply(m)}>
              <Reply size={15} />
            </IconButton>
            <IconButton label="Reply all (a)" size="sm" onClick={() => p.onReplyAll(m)}>
              <ReplyAll size={15} />
            </IconButton>
            <IconButton label="Forward (f)" size="sm" onClick={() => p.onForward(m)}>
              <Forward size={15} />
            </IconButton>
            <Menu
              trigger={
                <button type="button" aria-label="More" className="focus-ring flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg">
                  <MoreHorizontal size={15} />
                </button>
              }
            >
              {m.draft && p.onEditDraft && <MenuItem onSelect={() => p.onEditDraft?.(m)}>Edit draft</MenuItem>}
              <MenuItem onSelect={() => p.onMarkUnread(m)}>Mark as unread</MenuItem>
              <MenuItem onSelect={() => window.open(rawMessageUrl(m.folder, m.uid), "_blank")} icon={<FileText size={14} />}>
                View raw source
              </MenuItem>
              <MenuSeparator />
              <MenuItem danger icon={<Trash2 size={14} />} onSelect={() => p.onDelete(m)}>
                Delete
              </MenuItem>
            </Menu>
          </div>
        )}
      </header>

      {p.expanded && (
        <div className="animate-fade-in">
          {m.hasRemoteContent && !showRemote && (
            <div className="mb-3 ml-12 flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-xs text-fg-muted max-md:ml-0">
              <ImageIcon size={13} />
              Remote images are hidden to protect your privacy.
              <button type="button" className="font-medium text-accent hover:underline" onClick={() => setShowRemote(true)}>
                Show images
              </button>
            </div>
          )}
          <div className="pb-5 md:pl-12">
            {m.html || m.text ? (
              // A white page in every theme: senders design their mail for one, and dark text on it stays readable.
              <div className="rounded-lg bg-white text-[#16181d] dark:px-5 dark:py-4">
                {m.html ? <HtmlFrame html={m.html} allowRemote={showRemote} /> : <div className="plain-body text-sm leading-relaxed">{m.text}</div>}
              </div>
            ) : (
              <div className="text-sm text-fg-faint italic">This message has no content.</div>
            )}
          </div>
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-5 md:pl-12">
              <div className="flex w-full items-center gap-1 text-xs text-fg-muted">
                <Paperclip size={12} />
                {attachments.length} {attachments.length === 1 ? "attachment" : "attachments"}
              </div>
              {attachments.map((a) => (
                <a
                  key={a.partId}
                  href={attachmentUrl(m.folder, m.uid, a.partId)}
                  download={a.filename}
                  className="focus-ring group flex max-w-full items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-xs transition-colors hover:border-border-strong hover:bg-surface-2"
                  title={`${a.filename} (${a.contentType})`}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-accent-soft text-accent">
                    {a.contentType.startsWith("image/") ? <ImageIcon size={13} /> : <FileText size={13} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.filename}</span>
                    <span className="block text-fg-faint">{formatBytes(a.size)}</span>
                  </span>
                  <Download size={13} className="ml-1 shrink-0 text-fg-faint opacity-0 transition-opacity group-hover:opacity-100" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
