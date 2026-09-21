import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useSuggest } from "@/lib/queries";
import { avatarColor, cn, initials } from "@/lib/utils";
import type { Recipient } from "./composerStore";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEntry(raw: string): Recipient | null {
  const s = raw.trim().replace(/[,;]+$/, "");
  if (!s) return null;
  const m = /^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/.exec(s);
  if (m) {
    const address = m[2]!.trim().toLowerCase();
    return EMAIL_RE.test(address) ? { name: (m[1] ?? "").trim(), address } : null;
  }
  return EMAIL_RE.test(s) ? { name: "", address: s.toLowerCase() } : null;
}

export function RecipientInput({
  label,
  value,
  onChange,
  autoFocus,
  placeholder,
  extra,
}: {
  label: string;
  value: Recipient[];
  onChange: (v: Recipient[]) => void;
  autoFocus?: boolean;
  placeholder?: string;
  extra?: React.ReactNode;
}) {
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: suggestions } = useSuggest(debounced);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 180);
    return () => clearTimeout(t);
  }, [text]);

  const list = (suggestions ?? []).filter((s) => !value.some((v) => v.address === s.address)).slice(0, 8);
  useEffect(() => setHi(0), [list.length, debounced]);

  const add = (r: Recipient | null) => {
    if (!r) return false;
    if (value.some((v) => v.address === r.address)) {
      setText("");
      return true;
    }
    onChange([...value, r]);
    setText("");
    return true;
  };

  const commitText = (): boolean => {
    const parts = text.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return true;
    const parsed = parts.map(parseEntry);
    if (parsed.some((p) => !p)) return false;
    const next = [...value];
    for (const p of parsed) if (p && !next.some((v) => v.address === p.address)) next.push(p);
    onChange(next);
    setText("");
    return true;
  };

  const invalid = text.trim().length > 0 && !parseEntry(text) && !open;

  return (
    <div className="flex items-start gap-2 border-b px-4 py-1 transition-colors focus-within:bg-surface-2/40">
      <span className="w-10 shrink-0 pt-1.5 text-xs text-fg-muted">{label}</span>
      <div className="relative min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1" onClick={() => inputRef.current?.focus()}>
          {value.map((r) => (
            <span
              key={r.address}
              className="flex max-w-full items-center gap-1 rounded-full border bg-surface py-0.5 pr-1 pl-0.5 text-xs transition-colors hover:border-border-strong"
              title={r.address}
            >
              <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full text-[9px] font-semibold text-white" style={{ background: avatarColor(r.address) }}>
                {initials(r.name || r.address)}
              </span>
              <span className="truncate">{r.name || r.address}</span>
              <button
                type="button"
                aria-label={`Remove ${r.address}`}
                className="rounded-full p-0.5 text-fg-faint hover:bg-surface-3 hover:text-fg"
                onClick={() => onChange(value.filter((v) => v.address !== r.address))}
              >
                <X size={11} />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            autoFocus={autoFocus}
            value={text}
            placeholder={value.length ? "" : placeholder}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              setTimeout(() => setOpen(false), 120);
              if (text.trim()) commitText();
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && list.length) {
                e.preventDefault();
                setHi((h) => (h + 1) % list.length);
              } else if (e.key === "ArrowUp" && list.length) {
                e.preventDefault();
                setHi((h) => (h - 1 + list.length) % list.length);
              } else if (e.key === "Enter" || e.key === "Tab" || e.key === "," || e.key === ";") {
                if (open && list[hi] && text.trim()) {
                  e.preventDefault();
                  add({ name: list[hi]!.name, address: list[hi]!.address });
                } else if (text.trim()) {
                  if (e.key !== "Tab") e.preventDefault();
                  if (!commitText() && e.key !== "Tab") e.preventDefault();
                }
              } else if (e.key === "Backspace" && !text && value.length) {
                onChange(value.slice(0, -1));
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            className={cn("min-w-[140px] flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-fg-faint", invalid && "text-danger")}
          />
        </div>
        {open && list.length > 0 && text.trim() && (
          <ul className="absolute top-full left-0 z-30 mt-1 w-full max-w-md overflow-hidden rounded-lg border bg-surface py-1 shadow-pop animate-pop-in">
            {list.map((s, i) => (
              <li key={s.address}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add({ name: s.name, address: s.address })}
                  className={cn("flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm", i === hi ? "bg-selected" : "hover:bg-surface-2")}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: avatarColor(s.address) }}>
                    {initials(s.name || s.address)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{s.name || s.address}</span>
                    {s.name && <span className="block truncate text-xs text-fg-muted">{s.address}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {extra}
    </div>
  );
}
