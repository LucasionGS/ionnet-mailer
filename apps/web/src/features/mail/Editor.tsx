import { useEffect, useRef, useState } from "react";
import { EditorContent, Extension, Node, useEditor, useEditorState, type Editor as TiptapEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import Highlight from "@tiptap/extension-highlight";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import {
  Baseline,
  Bold,
  ChevronDown,
  Code,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, IconButton, Input, Menu, MenuItem, Popover } from "@/components/ui";
import { toast } from "@/lib/toast";
import { imageToDataUrl } from "./images";

/** Keeps the wrapper around quoted/forwarded originals, so the signature can be placed above it on send. */
const QuotedOriginal = Node.create({
  name: "quotedOriginal",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      kind: {
        default: "quote",
        parseHTML: (el) => (el.classList.contains("ionnet-forward") ? "forward" : "quote"),
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div.ionnet-quote" }, { tag: "div.ionnet-forward" }];
  },
  renderHTML({ node }) {
    return ["div", { class: `ionnet-${node.attrs.kind}` }, 0];
  },
});

const LINK_EVENT = "ionnet:edit-link";

const TEXT_COLORS = [
  { label: "Default", value: null },
  { label: "Gray", value: "#6b7280" },
  { label: "Red", value: "#c62828" },
  { label: "Orange", value: "#c25e00" },
  { label: "Green", value: "#1b7f3b" },
  { label: "Blue", value: "#1d5fd1" },
  { label: "Purple", value: "#7b3fc4" },
];
const HIGHLIGHTS = [
  { label: "None", value: null },
  { label: "Yellow", value: "#fff3a3" },
  { label: "Green", value: "#c9f2d0" },
  { label: "Blue", value: "#cfe4ff" },
  { label: "Pink", value: "#ffd6e7" },
];

function normalizeUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url)) return `mailto:${url}`;
  return `https://${url}`;
}

function LinkForm({ editor, onDone }: { editor: TiptapEditor; onDone: () => void }) {
  const current = (editor.getAttributes("link").href as string | undefined) ?? "";
  const [url, setUrl] = useState(current);
  const apply = () => {
    const href = normalizeUrl(url);
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!href) chain.unsetLink().run();
    else if (editor.state.selection.empty && !current) chain.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    else chain.setLink({ href }).run();
    onDone();
  };
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        apply();
      }}
    >
      <Input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste or type a link" className="h-8 w-60" aria-label="Link address" />
      <Button type="submit" size="sm" variant="primary" className="h-8">
        {current ? "Update" : "Add"}
      </Button>
      {current && (
        <Button
          size="sm"
          variant="ghost"
          className="h-8"
          onClick={() => {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            onDone();
          }}
        >
          Remove
        </Button>
      )}
    </form>
  );
}

function ToolbarButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <IconButton size="sm" label={label} active={active} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick} tooltipSide="top">
      {children}
    </IconButton>
  );
}

function Swatches({ options, current, onPick }: { options: Array<{ label: string; value: string | null }>; current: string | null; onPick: (v: string | null) => void }) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          aria-label={o.label}
          title={o.label}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(o.value)}
          className={cn(
            "focus-ring relative h-6 w-6 rounded-full border transition-transform hover:scale-110",
            (current ?? null) === o.value ? "border-fg" : "border-border-strong",
          )}
          style={{ background: o.value ?? "var(--surface)" }}
        >
          {!o.value && <span className="absolute top-1/2 left-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-fg-faint" />}
        </button>
      ))}
    </div>
  );
}

const Divider = () => <span className="mx-1 h-4 w-px shrink-0 bg-border" />;

function useToolbarState(editor: TiptapEditor) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      blockquote: e.isActive("blockquote"),
      block: e.isActive("heading", { level: 2 }) ? "Heading" : e.isActive("heading", { level: 3 }) ? "Subheading" : "Normal",
      color: (e.getAttributes("textStyle").color as string | undefined) ?? null,
      highlight: e.isActive("highlight") ? ((e.getAttributes("highlight").color as string | undefined) ?? HIGHLIGHTS[1]!.value) : null,
      // useEditor tears the editor down itself; a late render must not run commands on it
      canUndo: !e.isDestroyed && e.can().undo(),
      canRedo: !e.isDestroyed && e.can().redo(),
    }),
  });
}

export function EditorToolbar({ editor, onInsertImage }: { editor: TiptapEditor | null; onInsertImage?: () => void }) {
  if (!editor) return null;
  return <ToolbarInner editor={editor} onInsertImage={onInsertImage} />;
}

function ToolbarInner({ editor, onInsertImage }: { editor: TiptapEditor; onInsertImage?: () => void }) {
  const s = useToolbarState(editor);
  const [linkOpen, setLinkOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);

  // Ctrl/Cmd+K with nothing selected has no bubble menu to land in, so it opens the toolbar's link box.
  useEffect(() => {
    const dom = editor.view.dom;
    const h = () => setLinkOpen(true);
    dom.addEventListener(LINK_EVENT, h);
    return () => dom.removeEventListener(LINK_EVENT, h);
  }, [editor]);

  const run = () => editor.chain().focus();

  return (
    <div className="flex flex-wrap items-center gap-0.5">
      <ToolbarButton label="Undo" disabled={!s.canUndo} onClick={() => run().undo().run()}>
        <Undo2 size={14} />
      </ToolbarButton>
      <ToolbarButton label="Redo" disabled={!s.canRedo} onClick={() => run().redo().run()}>
        <Redo2 size={14} />
      </ToolbarButton>
      <Divider />
      <Menu
        align="start"
        side="top"
        trigger={
          <button
            type="button"
            className="focus-ring flex h-7 w-[6.5rem] items-center justify-between gap-1 rounded-md px-2 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
            onMouseDown={(e) => e.preventDefault()}
          >
            {s.block}
            <ChevronDown size={12} />
          </button>
        }
      >
        <MenuItem checked={s.block === "Normal"} onSelect={() => run().setParagraph().run()}>
          Normal
        </MenuItem>
        <MenuItem checked={s.block === "Heading"} onSelect={() => run().setHeading({ level: 2 }).run()}>
          <span className="text-base font-semibold">Heading</span>
        </MenuItem>
        <MenuItem checked={s.block === "Subheading"} onSelect={() => run().setHeading({ level: 3 }).run()}>
          <span className="font-semibold">Subheading</span>
        </MenuItem>
      </Menu>
      <Divider />
      <ToolbarButton label="Bold" active={s.bold} onClick={() => run().toggleBold().run()}>
        <Bold size={14} />
      </ToolbarButton>
      <ToolbarButton label="Italic" active={s.italic} onClick={() => run().toggleItalic().run()}>
        <Italic size={14} />
      </ToolbarButton>
      <ToolbarButton label="Underline" active={s.underline} onClick={() => run().toggleUnderline().run()}>
        <UnderlineIcon size={14} />
      </ToolbarButton>
      <ToolbarButton label="Strikethrough" active={s.strike} onClick={() => run().toggleStrike().run()}>
        <Strikethrough size={14} />
      </ToolbarButton>
      <Popover
        open={colorOpen}
        onOpenChange={setColorOpen}
        trigger={
          <button
            type="button"
            aria-label="Text and highlight color"
            title="Text and highlight color"
            onMouseDown={(e) => e.preventDefault()}
            className={cn("focus-ring flex h-7 w-7 flex-col items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg", colorOpen && "bg-surface-2 text-fg")}
          >
            <Baseline size={14} />
            <span className="-mt-0.5 h-[3px] w-3.5 rounded-full" style={{ background: s.color ?? s.highlight ?? "var(--fg-faint)" }} />
          </button>
        }
      >
        <div className="flex flex-col gap-2 p-1">
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-fg-muted">
              <Baseline size={12} /> Text
            </div>
            <Swatches options={TEXT_COLORS} current={s.color} onPick={(v) => (v ? run().setColor(v).run() : run().unsetColor().run())} />
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-fg-muted">
              <Highlighter size={12} /> Highlight
            </div>
            <Swatches options={HIGHLIGHTS} current={s.highlight} onPick={(v) => (v ? run().setHighlight({ color: v }).run() : run().unsetHighlight().run())} />
          </div>
        </div>
      </Popover>
      <Divider />
      <ToolbarButton label="Bulleted list" active={s.bulletList} onClick={() => run().toggleBulletList().run()}>
        <List size={14} />
      </ToolbarButton>
      <ToolbarButton label="Numbered list" active={s.orderedList} onClick={() => run().toggleOrderedList().run()}>
        <ListOrdered size={14} />
      </ToolbarButton>
      <ToolbarButton label="Quote" active={s.blockquote} onClick={() => run().toggleBlockquote().run()}>
        <Quote size={14} />
      </ToolbarButton>
      <ToolbarButton label="Code" active={s.code} onClick={() => run().toggleCode().run()}>
        <Code size={14} />
      </ToolbarButton>
      <ToolbarButton label="Divider line" onClick={() => run().setHorizontalRule().run()}>
        <Minus size={14} />
      </ToolbarButton>
      <Divider />
      <Popover
        open={linkOpen}
        onOpenChange={setLinkOpen}
        trigger={
          <button
            type="button"
            aria-label="Link"
            title="Link (Ctrl+K)"
            onMouseDown={(e) => e.preventDefault()}
            className={cn(
              "focus-ring flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-2 hover:text-fg",
              s.link || linkOpen ? "bg-accent-soft text-accent" : "text-fg-muted",
            )}
          >
            <Link2 size={14} />
          </button>
        }
      >
        <LinkForm editor={editor} onDone={() => setLinkOpen(false)} />
      </Popover>
      {onInsertImage && (
        <ToolbarButton label="Insert image" onClick={onInsertImage}>
          <ImagePlus size={14} />
        </ToolbarButton>
      )}
      <Divider />
      <ToolbarButton label="Clear formatting" onClick={() => run().clearNodes().unsetAllMarks().run()}>
        <RemoveFormatting size={14} />
      </ToolbarButton>
    </div>
  );
}

/** Small formatting bar that follows the text selection. */
function SelectionMenu({ editor }: { editor: TiptapEditor }) {
  const s = useToolbarState(editor);
  const [linking, setLinking] = useState(false);
  const run = () => editor.chain().focus();

  useEffect(() => {
    const dom = editor.view.dom;
    const h = (e: Event) => {
      if (editor.state.selection.empty) return;
      e.stopImmediatePropagation(); // handled here rather than by the toolbar
      setLinking(true);
    };
    dom.addEventListener(LINK_EVENT, h, true);
    return () => dom.removeEventListener(LINK_EVENT, h, true);
  }, [editor]);

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 8, onHide: () => setLinking(false) }}
      shouldShow={({ editor: e, state }) => e.isEditable && !state.selection.empty && !e.isActive("image") && e.view.hasFocus() || linking}
      className="z-[70] flex items-center gap-0.5 rounded-lg border bg-surface p-1 shadow-pop"
    >
      {linking ? (
        <LinkForm editor={editor} onDone={() => setLinking(false)} />
      ) : (
        <>
          <ToolbarButton label="Bold" active={s.bold} onClick={() => run().toggleBold().run()}>
            <Bold size={14} />
          </ToolbarButton>
          <ToolbarButton label="Italic" active={s.italic} onClick={() => run().toggleItalic().run()}>
            <Italic size={14} />
          </ToolbarButton>
          <ToolbarButton label="Underline" active={s.underline} onClick={() => run().toggleUnderline().run()}>
            <UnderlineIcon size={14} />
          </ToolbarButton>
          <ToolbarButton label="Strikethrough" active={s.strike} onClick={() => run().toggleStrike().run()}>
            <Strikethrough size={14} />
          </ToolbarButton>
          <ToolbarButton
            label="Highlight"
            active={!!s.highlight}
            onClick={() => (s.highlight ? run().unsetHighlight().run() : run().setHighlight({ color: HIGHLIGHTS[1]!.value! }).run())}
          >
            <Highlighter size={14} />
          </ToolbarButton>
          <Divider />
          <ToolbarButton label="Link" active={s.link} onClick={() => setLinking(true)}>
            <Link2 size={14} />
          </ToolbarButton>
        </>
      )}
    </BubbleMenu>
  );
}

export interface MailEditorOptions {
  placeholder?: string;
  /** Ctrl/Cmd+Enter inside the editor */
  onSubmit?: () => void;
  /** pasted/dropped files that are not embeddable images */
  onFiles?: (files: File[]) => void;
}

/** Insert images at the cursor; anything that can't be embedded is handed to `onFiles` as a regular attachment. */
export async function insertImages(editor: TiptapEditor, files: File[], onFiles?: (files: File[]) => void, pos?: number) {
  const rest: File[] = [];
  for (const f of files) {
    const src = f.type.startsWith("image/") ? await imageToDataUrl(f).catch(() => null) : null;
    if (!src) {
      rest.push(f);
      continue;
    }
    const node = { type: "image", attrs: { src, alt: f.name } };
    if (pos !== undefined) editor.chain().focus().insertContentAt(pos, node).run();
    else editor.chain().focus().insertContent(node).run();
  }
  if (rest.length) {
    if (onFiles) onFiles(rest);
    else toast.error("Could not insert image");
  }
}

export function useMailEditor(initialHtml: string, onUpdate: (html: string) => void, options: MailEditorOptions = {}) {
  // The editor is created once; keep the callbacks current without recreating it.
  const opts = useRef(options);
  opts.current = options;
  const editorRef = useRef<TiptapEditor | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: false }),
      Link.configure({ openOnClick: false, autolink: true, defaultProtocol: "https" }),
      Placeholder.configure({ placeholder: options.placeholder ?? "Write your message…" }),
      Image.configure({ inline: true, allowBase64: true }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      QuotedOriginal,
      Extension.create({
        name: "mailShortcuts",
        priority: 1000,
        addKeyboardShortcuts() {
          return {
            "Mod-Enter": () => {
              opts.current.onSubmit?.();
              return true;
            },
            "Mod-k": () => {
              this.editor.view.dom.dispatchEvent(new CustomEvent(LINK_EVENT));
              return true;
            },
          };
        },
      }),
    ],
    content: initialHtml,
    autofocus: false,
    onUpdate: ({ editor: e }) => onUpdate(e.getHTML()),
    editorProps: {
      attributes: { class: "tiptap text-sm" },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length || !editorRef.current) return false;
        event.preventDefault();
        void insertImages(editorRef.current, files, opts.current.onFiles);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (moved || !files.some((f) => f.type.startsWith("image/")) || !editorRef.current) return false;
        event.preventDefault();
        event.stopPropagation(); // the composer around us would attach them as files
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void insertImages(editorRef.current, files, opts.current.onFiles, pos);
        return true;
      },
    },
  });
  editorRef.current = editor;
  return editor;
}

export function EditorArea({ editor, className }: { editor: TiptapEditor | null; className?: string }) {
  return (
    <div
      className={cn("scroll-thin min-h-0 flex-1 cursor-text overflow-y-auto px-4 py-3", className)}
      onClick={(e) => {
        if (e.target === e.currentTarget) editor?.commands.focus("end");
      }}
    >
      {editor && <SelectionMenu editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
