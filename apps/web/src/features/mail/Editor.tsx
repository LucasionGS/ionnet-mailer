import { useEffect } from "react";
import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { Bold, Code, Italic, Link2, List, ListOrdered, Quote, RemoveFormatting, Underline as UnderlineIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui";

function ToolbarButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <IconButton size="sm" label={label} active={active} onMouseDown={(e) => e.preventDefault()} onClick={onClick} tooltipSide="top">
      {children}
    </IconButton>
  );
}

export function EditorToolbar({ editor }: { editor: TiptapEditor | null }) {
  if (!editor) return null;
  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      <ToolbarButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold size={14} />
      </ToolbarButton>
      <ToolbarButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic size={14} />
      </ToolbarButton>
      <ToolbarButton label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon size={14} />
      </ToolbarButton>
      <span className="mx-1 h-4 w-px bg-border" />
      <ToolbarButton label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List size={14} />
      </ToolbarButton>
      <ToolbarButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered size={14} />
      </ToolbarButton>
      <ToolbarButton label="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote size={14} />
      </ToolbarButton>
      <ToolbarButton label="Code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code size={14} />
      </ToolbarButton>
      <ToolbarButton label="Link" active={editor.isActive("link")} onClick={setLink}>
        <Link2 size={14} />
      </ToolbarButton>
      <span className="mx-1 h-4 w-px bg-border" />
      <ToolbarButton label="Clear formatting" onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}>
        <RemoveFormatting size={14} />
      </ToolbarButton>
    </div>
  );
}

export function useMailEditor(initialHtml: string, onUpdate: (html: string) => void, placeholder = "Write your message…") {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, link: false }),
      Link.configure({ openOnClick: false, autolink: true, defaultProtocol: "https" }),
      Placeholder.configure({ placeholder }),
      Image.configure({ inline: true, allowBase64: true }),
    ],
    content: initialHtml,
    autofocus: false,
    onUpdate: ({ editor: e }) => onUpdate(e.getHTML()),
    editorProps: {
      attributes: { class: "tiptap text-sm" },
    },
  });
  useEffect(() => () => editor?.destroy(), [editor]);
  return editor;
}

export function EditorArea({ editor, className }: { editor: TiptapEditor | null; className?: string }) {
  return (
    <div
      className={cn("scroll-thin min-h-0 flex-1 cursor-text overflow-y-auto px-3 py-2", className)}
      onClick={() => editor?.commands.focus()}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
