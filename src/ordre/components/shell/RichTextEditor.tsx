import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useImperativeHandle, forwardRef } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  Heading1, Heading2, List, ListOrdered, Quote, Link2, Link2Off,
  Undo2, Redo2, Pilcrow,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface RichTextEditorHandle {
  insertText: (text: string) => void;
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  onFocus?: () => void;
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(
  ({ value, onChange, placeholder, onFocus }, ref) => {
    const editor = useEditor({
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        Underline,
        Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { class: "text-primary underline" } }),
        Placeholder.configure({ placeholder: placeholder ?? "Skriv innholdet i e-posten her…" }),
      ],
      content: value || "<p></p>",
      editorProps: {
        attributes: {
          class:
            "prose prose-sm dark:prose-invert max-w-none min-h-[280px] px-4 py-3 focus:outline-none [&_p]:my-2 [&_h1]:mt-3 [&_h2]:mt-3",
        },
      },
      onUpdate: ({ editor }) => onChange(editor.getHTML()),
      onFocus: () => onFocus?.(),
    });

    // Sync external value changes (e.g., template switch / reset)
    useEffect(() => {
      if (!editor) return;
      const current = editor.getHTML();
      if (value && value !== current) {
        editor.commands.setContent(value, { emitUpdate: false });
      }
    }, [value, editor]);

    useImperativeHandle(ref, () => ({
      insertText: (text: string) => {
        editor?.chain().focus().insertContent(text).run();
      },
      focus: () => editor?.chain().focus().run(),
    }), [editor]);

    if (!editor) return null;

    return (
      <div className="overflow-hidden rounded-[10px] border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background transition-all">
        <Toolbar editor={editor} />
        <div className="bg-background">
          <EditorContent editor={editor} />
        </div>
      </div>
    );
  }
);
RichTextEditor.displayName = "RichTextEditor";

function Toolbar({ editor }: { editor: Editor }) {
  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Lenke (URL):", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 px-1.5 py-1">
      <ToolGroup>
        <ToolBtn label="Overskrift 1" active={editor.isActive("heading", { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
          <Heading1 className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn label="Overskrift 2" active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn label="Avsnitt" active={editor.isActive("paragraph")}
          onClick={() => editor.chain().focus().setParagraph().run()}>
          <Pilcrow className="h-3.5 w-3.5" />
        </ToolBtn>
      </ToolGroup>

      <Divider />

      <ToolGroup>
        <ToolBtn label="Fet" active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn label="Kursiv" active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn label="Understrek" active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn label="Gjennomstreket" active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolBtn>
      </ToolGroup>

      <Divider />

      <ToolGroup>
        <ToolBtn label="Punktliste" active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn label="Nummerert liste" active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn label="Sitat" active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote className="h-3.5 w-3.5" />
        </ToolBtn>
      </ToolGroup>

      <Divider />

      <ToolGroup>
        <ToolBtn label="Sett inn lenke" active={editor.isActive("link")} onClick={setLink}>
          <Link2 className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn label="Fjern lenke" disabled={!editor.isActive("link")}
          onClick={() => editor.chain().focus().unsetLink().run()}>
          <Link2Off className="h-3.5 w-3.5" />
        </ToolBtn>
      </ToolGroup>

      <Divider />

      <ToolGroup>
        <ToolBtn label="Angre" onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}>
          <Undo2 className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn label="Gjør om" onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}>
          <Redo2 className="h-3.5 w-3.5" />
        </ToolBtn>
      </ToolGroup>
    </div>
  );
}

function ToolGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function Divider() {
  return <Separator orientation="vertical" className="mx-1 h-5" />;
}

function ToolBtn({
  children, onClick, active, disabled, label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "h-7 w-7 p-0",
        active && "bg-accent text-accent-foreground",
      )}
    >
      {children}
    </Button>
  );
}
