import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor as TipTapEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Typography from '@tiptap/extension-typography';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Highlighter,
} from 'lucide-react';
import { MenuBar } from './MenuBar';
import { SearchBar } from './SearchBar';
import { ToolbarButton } from './ToolbarButton';
import { Mermaid } from '../extensions/mermaid';
import { LocalImage } from '../extensions/localImage';
import { SearchReplace } from '../extensions/searchReplace';
import { getSpellcheck } from '../lib/prefs';
import { prepareContent, buildTurndownService } from '../lib/markdown';
import { markdownToHtml } from '../lib/markdown';
import { collectHeadings } from '../lib/outline';
import type { HeadingInfo } from '../lib/outline';
import { t } from '../lib/i18n';

const lowlight = createLowlight(common);

// Heurística: ¿el texto plano pegado parece markdown? Si sí, lo convertimos
// para que tablas/código/listas pegados desde otra herramienta entren como
// nodos reales y no como párrafos sueltos (que romperían el round-trip).
const looksLikeMarkdown = (text: string): boolean => {
  if (!text.includes('\n')) return false;
  return /^#{1,6} |^```|^> |^\s*[-*+] |^\s*\d+[.)] |^\|.*\|/m.test(text);
};

export interface EditorHandle {
  /** Markdown actual del documento (conversión inmediata, sin debounce). */
  getMarkdown: () => string;
  /** Reemplaza el contenido (abrir archivo / nuevo). Resetea undo history. */
  setMarkdown: (markdown: string) => void;
  /** Inserta una imagen en el cursor. */
  insertImage: (src: string, alt?: string) => void;
  /** Abre la barra de búsqueda (Ctrl+F). */
  openSearch: () => void;
  /** Activa/desactiva el corrector ortográfico del contenteditable. */
  setSpellcheck: (enabled: boolean) => void;
  focus: () => void;
  editor: TipTapEditor | null;
}

interface EditorProps {
  /** Cambio de contenido, debounced 250ms, en markdown. Para dirty-tracking. */
  onChange?: (markdown: string) => void;
  /** Encabezados del documento (mismo debounce que onChange, y al cargar). */
  onHeadingsChange?: (headings: HeadingInfo[]) => void;
  /**
   * Imagen pegada/soltada: la app la persiste (assets/ junto al .md) y
   * devuelve el src a insertar (ruta relativa), o null para cancelar.
   */
  onInsertImageFile?: (file: File) => Promise<string | null>;
  /** Diálogo nativo de selección de imagen (botón Examinar del modal). */
  onBrowseImage?: () => Promise<string | null>;
}

export const Editor = forwardRef<EditorHandle, EditorProps>(
  ({ onChange, onHeadingsChange, onInsertImageFile, onBrowseImage }, ref) => {
    const turndown = useMemo(() => buildTurndownService(), []);
    const [showSearch, setShowSearch] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onHeadingsRef = useRef(onHeadingsChange);
    onHeadingsRef.current = onHeadingsChange;
    const insertFileRef = useRef(onInsertImageFile);
    insertFileRef.current = onInsertImageFile;
    const editorRef = useRef<TipTapEditor | null>(null);

    const emit = useCallback(
      (instance: TipTapEditor) => {
        onChangeRef.current?.(turndown.turndown(instance.getHTML()));
        onHeadingsRef.current?.(collectHeadings(instance.state.doc));
      },
      [turndown]
    );

    const insertImageFile = useCallback(async (file: File, instance: TipTapEditor) => {
      if (!insertFileRef.current) return;
      try {
        const src = await insertFileRef.current(file);
        if (src) {
          instance.chain().focus().setImage({ src, alt: file.name }).run();
        }
      } catch (err) {
        console.error('No se pudo insertar la imagen:', err);
      }
    }, []);

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          codeBlock: false, // usamos CodeBlockLowlight
          link: false, // configurado aparte
          underline: false, // configurado aparte
        }),
        Placeholder.configure({
          placeholder: t('editor.placeholder'),
        }),
        Underline,
        Link.configure({
          openOnClick: false,
          HTMLAttributes: {
            class: 'text-primary-600 dark:text-primary-400 underline cursor-pointer',
          },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Highlight.configure({ multicolor: true }),
        TextStyle,
        Color,
        Subscript,
        Superscript,
        LocalImage.configure({
          HTMLAttributes: { class: 'max-w-full h-auto rounded-lg' },
        }),
        Typography,
        CodeBlockLowlight.configure({ lowlight }),
        Mermaid,
        SearchReplace,
      ],
      content: '',
      editorProps: {
        attributes: {
          class:
            'tiptap-editor prose dark:prose-invert prose-sm sm:prose-base max-w-none focus:outline-none min-h-[300px] px-4 py-3',
          spellcheck: String(getSpellcheck()),
        },
        handlePaste: (_view, event) => {
          // 1) Screenshot / archivo de imagen en el portapapeles
          const items = event.clipboardData?.items;
          if (items && insertFileRef.current) {
            for (const item of Array.from(items)) {
              if (item.kind === 'file' && item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file && editorRef.current) {
                  event.preventDefault();
                  void insertImageFile(file, editorRef.current);
                  return true;
                }
              }
            }
          }
          // 2) Texto plano con pinta de markdown → convertir a nodos reales
          const html = event.clipboardData?.getData('text/html');
          const text = event.clipboardData?.getData('text/plain');
          if (!html && text && looksLikeMarkdown(text)) {
            event.preventDefault();
            const inst = editorRef.current;
            if (inst) inst.chain().focus().insertContent(markdownToHtml(text)).run();
            return true;
          }
          return false;
        },
        // NOTA: drag-and-drop de archivos NO pasa por ProseMirror en Tauri —
        // la webview lo intercepta (dragDropEnabled). Se maneja en App.tsx
        // vía getCurrentWebview().onDragDropEvent().
      },
      onUpdate: ({ editor: e }) => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => emit(e), 250);
      },
    });

    editorRef.current = editor;

    useImperativeHandle(
      ref,
      () => ({
        getMarkdown: () => {
          if (!editor) return '';
          if (debounceRef.current) clearTimeout(debounceRef.current);
          return turndown.turndown(editor.getHTML());
        },
        setMarkdown: (markdown: string) => {
          if (!editor) return;
          editor.commands.setContent(prepareContent(markdown));
          // Nuevo documento: el historial de undo no debe cruzar archivos
          // (setContent con emitUpdate false no dispara onUpdate), pero el
          // esquema sí debe reflejar el contenido recién cargado.
          onHeadingsRef.current?.(collectHeadings(editor.state.doc));
        },
        insertImage: (src: string, alt = '') => {
          editor?.chain().focus().setImage({ src, alt }).run();
        },
        openSearch: () => setShowSearch(true),
        setSpellcheck: (enabled: boolean) => {
          editor?.view.dom.setAttribute('spellcheck', String(enabled));
        },
        focus: () => editor?.commands.focus(),
        editor,
      }),
      [editor, turndown]
    );

    useEffect(
      () => () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      },
      []
    );

    if (!editor) {
      return (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full bg-white dark:bg-gray-900 overflow-hidden">
        <MenuBar editor={editor} onBrowseImage={onBrowseImage} />
        {showSearch && <SearchBar editor={editor} onClose={() => setShowSearch(false)} />}

        <BubbleMenu
          editor={editor}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg flex items-center gap-0.5 p-1"
        >
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive('bold')}
            title={t('editor.bold')}
          >
            <Bold className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive('italic')}
            title={t('editor.italic')}
          >
            <Italic className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            isActive={editor.isActive('underline')}
            title={t('editor.underline')}
          >
            <UnderlineIcon className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            isActive={editor.isActive('strike')}
            title={t('editor.strikethrough')}
          >
            <Strikethrough className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCode().run()}
            isActive={editor.isActive('code')}
            title={t('editor.code')}
          >
            <Code className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHighlight().run()}
            isActive={editor.isActive('highlight')}
            title={t('editor.highlightText')}
          >
            <Highlighter className="w-3.5 h-3.5" />
          </ToolbarButton>
        </BubbleMenu>

        <div className="flex-1 overflow-auto">
          <EditorContent editor={editor} />
        </div>
      </div>
    );
  }
);

Editor.displayName = 'Editor';
