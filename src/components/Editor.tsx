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
import { NodeSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { ReplaceStep, ReplaceAroundStep } from '@tiptap/pm/transform';
import { MenuBar } from './MenuBar';
import { TableToolbar } from './TableToolbar';
import { SearchBar } from './SearchBar';
import { ToolbarButton } from './ToolbarButton';
import { Mermaid } from '../extensions/mermaid';
import { FootnoteRef, FootnoteDef } from '../extensions/footnote';
import { MathInline, MathBlock } from '../extensions/math';
import { LocalImage } from '../extensions/localImage';
import { SearchReplace } from '../extensions/searchReplace';
import { Callout } from '../extensions/callout';
import { SlashCommand } from '../extensions/slashCommand';
import { WikiLink } from '../extensions/wikiLink';
import { notifyLinks } from '../lib/linkContext';
import { getSpellcheck } from '../lib/prefs';
import {
  prepareContent,
  buildTurndownService,
  markdownToHtml,
  splitFrontMatter,
  joinFrontMatter,
} from '../lib/markdown';
import { LineNumbers } from '../extensions/lineNumbers';
import {
  normalizePastedText,
  asciiToMarkdown,
  plainTextToHtml,
  isTerminalHtml,
  dedentListBlocks,
} from '../lib/asciiPaste';
import {
  imagePathFromText,
  imagePathFromUriList,
  fileFromLocalPath,
  fileFromTransientSrc,
  isTransientImageSrc,
  readLocalBytes,
} from '../lib/pasteImages';
import { insertImageAndContinue } from '../lib/insertImage';
import { collectHeadings, lineAtPos } from '../lib/outline';
import type { HeadingInfo } from '../lib/outline';
import { t, useLang } from '../lib/i18n';

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
  /** Front matter YAML del documento actual ('' si no hay). */
  getFrontMatter: () => string;
  /** Abre la barra de búsqueda (Ctrl+F). */
  openSearch: (replace?: boolean) => void;
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
  /** Movimiento del cursor (debounced): línea visual y posición PM. Alimenta
   *  el nº de línea de la barra de estado y el resaltado del esquema. */
  onCursorChange?: (info: { line: number; pos: number }) => void;
  /** Al hacer scroll: posición PM del encabezado visible arriba del viewport
   *  (para resaltar la sección en el esquema sin mover el cursor). */
  onScrollHeading?: (pos: number) => void;
  /**
   * Imagen pegada/soltada: la app la persiste (assets/ junto al .md) y
   * devuelve el src a insertar (ruta relativa), o null para cancelar.
   */
  onInsertImageFile?: (file: File) => Promise<string | null>;
  /** Diálogo nativo de selección de imagen (botón Examinar del modal). */
  onBrowseImage?: () => Promise<string | null>;
  /**
   * Lee una imagen del portapapeles del sistema (respaldo para Linux, donde
   * el evento `paste` del DOM no entrega los bytes de una captura). Devuelve
   * un File o null si el portapapeles no contiene una imagen.
   */
  onReadClipboardImage?: () => Promise<File | null>;
  /**
   * Lee el texto del portapapeles del sistema (respaldo para Linux cuando el
   * evento `paste` anuncia `text/uri-list` pero no entrega su contenido).
   */
  onReadClipboardText?: () => Promise<string | null>;
  /** Números de línea en el margen (misma línea que la barra de estado). */
  lineNumbers?: boolean;
  /** Ruta del documento: base para resolver sus wikilinks. */
  docPath?: string | null;
}

export const Editor = forwardRef<EditorHandle, EditorProps>(
  (
    {
      onChange,
      onHeadingsChange,
      onCursorChange,
      onScrollHeading,
      onInsertImageFile,
      onBrowseImage,
      onReadClipboardImage,
      onReadClipboardText,
      lineNumbers = false,
      docPath = null,
    },
    ref
  ) => {
    const lang = useLang();
    const turndown = useMemo(() => buildTurndownService(), []);
    const [showSearch, setShowSearch] = useState(false);
    const [replaceSignal, setReplaceSignal] = useState(0);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cursorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scrollRafRef = useRef<number | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onHeadingsRef = useRef(onHeadingsChange);
    onHeadingsRef.current = onHeadingsChange;
    const onCursorRef = useRef(onCursorChange);
    onCursorRef.current = onCursorChange;
    const onScrollHeadingRef = useRef(onScrollHeading);
    onScrollHeadingRef.current = onScrollHeading;
    const insertFileRef = useRef(onInsertImageFile);
    insertFileRef.current = onInsertImageFile;
    const readClipboardImageRef = useRef(onReadClipboardImage);
    readClipboardImageRef.current = onReadClipboardImage;
    const readClipboardTextRef = useRef(onReadClipboardText);
    readClipboardTextRef.current = onReadClipboardText;
    const editorRef = useRef<TipTapEditor | null>(null);
    // Front matter YAML del documento actual: no se renderiza en el editor,
    // pero debe sobrevivir el round-trip (se antepone al markdown emitido).
    const frontMatterRef = useRef('');

    const emit = useCallback(
      (instance: TipTapEditor) => {
        onChangeRef.current?.(
          joinFrontMatter(frontMatterRef.current, turndown.turndown(instance.getHTML()))
        );
        onHeadingsRef.current?.(collectHeadings(instance.state.doc));
      },
      [turndown]
    );

    const insertImageFile = useCallback(async (file: File, instance: TipTapEditor) => {
      if (!insertFileRef.current) return;
      try {
        const src = await insertFileRef.current(file);
        if (src) {
          insertImageAndContinue(instance, { src, alt: file.name });
        }
      } catch (err) {
        console.error('No se pudo insertar la imagen:', err);
      }
    }, []);

    // Lectura del portapapeles del sistema en curso (respaldo de Linux): el
    // evento `paste` llega duplicado en WebKitGTK y sin esto se insertaba la
    // imagen dos veces.
    const clipboardReadRef = useRef<Promise<void> | null>(null);

    // Imágenes con src transitorio (data:/blob:/file:) que entraron en una
    // transacción — pegado nativo, HTML con imágenes incrustadas, HTML de
    // LibreOffice… — se guardan en assets/ y el nodo pasa a la ruta relativa.
    // Las peticiones se encadenan: fijar una imagen puede pedir guardar el
    // documento primero, y no queremos tres diálogos a la vez.
    const localizingRef = useRef<Set<string>>(new Set());
    const localizeQueueRef = useRef<Promise<void>>(Promise.resolve());
    const localizeTransientImages = useCallback((inst: TipTapEditor, transaction: Transaction) => {
      if (!insertFileRef.current || !transaction.docChanged) return;
      const found = new Set<string>();
      for (const step of transaction.steps) {
        if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) continue;
        step.slice.content.descendants((node) => {
          if (node.type.name === 'image' && isTransientImageSrc(node.attrs.src)) {
            found.add(node.attrs.src as string);
          }
          return true;
        });
      }
      for (const src of found) {
        if (localizingRef.current.has(src)) continue;
        localizingRef.current.add(src);
        localizeQueueRef.current = localizeQueueRef.current.then(async () => {
          try {
            const file = await fileFromTransientSrc(src, readLocalBytes);
            const rel = file ? await insertFileRef.current?.(file) : null;
            if (inst.isDestroyed) return;
            const hits: { pos: number; size: number; attrs: Record<string, unknown> }[] = [];
            inst.state.doc.descendants((node, pos) => {
              if (node.type.name === 'image' && node.attrs.src === src) {
                hits.push({ pos, size: node.nodeSize, attrs: node.attrs });
              }
              return true;
            });
            if (!hits.length) return;
            const tr = inst.state.tr;
            // De atrás hacia delante: borrar no desplaza las posiciones previas.
            for (const hit of hits.reverse()) {
              if (rel) tr.setNodeMarkup(hit.pos, undefined, { ...hit.attrs, src: rel });
              else if (/^blob:/i.test(src)) tr.delete(hit.pos, hit.pos + hit.size); // inservible al reabrir
            }
            if (tr.docChanged) inst.view.dispatch(tr);
          } catch (err) {
            console.error('No se pudo fijar la imagen pegada en assets/:', err);
          } finally {
            localizingRef.current.delete(src);
          }
        });
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
          // Función: se evalúa en cada render de decoraciones (sigue el idioma).
          placeholder: () => t('editor.placeholder'),
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
          // Las imágenes `data:` de un HTML pegado se aceptan (antes se
          // descartaban en silencio) y se fijan en assets/ al momento.
          allowBase64: true,
        }),
        Typography,
        CodeBlockLowlight.configure({ lowlight }),
        Mermaid,
        FootnoteRef,
        FootnoteDef,
        MathInline,
        MathBlock,
        SearchReplace,
        LineNumbers.configure({ enabled: lineNumbers }),
        Callout,
        SlashCommand,
        WikiLink,
      ],
      content: '',
      editorProps: {
        attributes: {
          class:
            'tiptap-editor prose dark:prose-invert prose-sm sm:prose-base max-w-none focus:outline-none min-h-[300px] px-4 py-3',
          spellcheck: String(getSpellcheck()),
        },
        handlePaste: (view, event) => {
          // Vista huérfana (React StrictMode monta el editor dos veces en
          // desarrollo): sólo atiende la vista conectada al DOM.
          if (!view.dom.isConnected) return false;
          const inst = editorRef.current;
          if (!inst) return false;
          const data = event.clipboardData;
          // 1) Screenshot / archivo de imagen en el portapapeles
          const items = data?.items;
          if (items && insertFileRef.current) {
            for (const item of Array.from(items)) {
              if (item.kind === 'file' && item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) {
                  event.preventDefault();
                  void insertImageFile(file, inst);
                  return true;
                }
              }
            }
          }
          const rawHtml = data?.getData('text/html') ?? '';
          const rawText = data?.getData('text/plain') ?? '';
          const uriList = data?.getData('text/uri-list') ?? '';
          // 1b) Archivo de imagen copiado en el gestor de archivos: llega como
          //     URI `file:` (o ruta) en texto. Antes se pegaba la ruta como
          //     texto (o nada); ahora se copia a assets/ y se inserta la imagen.
          const pasteLocalImage = (path: string) =>
            void (async () => {
              const file = await fileFromLocalPath(path, readLocalBytes);
              if (file) await insertImageFile(file, inst);
            })();
          const localImage = imagePathFromUriList(uriList) ?? imagePathFromText(rawText);
          if (localImage && insertFileRef.current && !rawHtml.includes('data-pm-slice')) {
            event.preventDefault();
            pasteLocalImage(localImage);
            return true;
          }
          // WebKitGTK anuncia `text/uri-list` (archivo copiado en el gestor
          // de archivos) pero no entrega su contenido —ni por getData ni por
          // getAsString— y oculta el text/plain. El pegado nativo tampoco
          // inserta nada, así que se cancela y se lee el texto del
          // portapapeles del sistema vía Rust.
          const hasUriItem =
            !!items && Array.from(items).some((i) => i.kind === 'string' && i.type === 'text/uri-list');
          if (hasUriItem && !uriList && !rawText && !rawHtml && readClipboardTextRef.current) {
            event.preventDefault();
            void (async () => {
              const value = (await readClipboardTextRef.current?.()) ?? '';
              const path = imagePathFromUriList(value) ?? imagePathFromText(value);
              if (path && insertFileRef.current) pasteLocalImage(path);
              else if (value.trim()) {
                // Otro tipo de archivo: al menos su ruta como texto.
                const first = value.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) ?? '';
                inst.chain().focus().insertContent({ type: 'text', text: first.trim() }).run();
              }
            })();
            return true;
          }
          // 2) Texto plano. Primero se normalizan los fines de línea (las
          //    terminales entregan CRLF/CR que rompen los regex multilinea
          //    del pipeline) y se convierten tablas/diagramas ASCII. Si tras
          //    eso el texto parece markdown —o hubo conversión—, entra por
          //    markdownToHtml como nodos reales.
          //    El HTML de una terminal (un <div> por línea) se ignora y se
          //    pega su texto plano.
          const text = rawText ? dedentListBlocks(normalizePastedText(rawText)) : rawText;
          const html = rawHtml && !(rawText && isTerminalHtml(rawHtml)) ? rawHtml : '';
          if (!html && text) {
            const { text: md, changed } = asciiToMarkdown(text);
            if (changed || looksLikeMarkdown(md)) {
              event.preventDefault();
              // insertContent conserva por defecto el espacio en blanco, y los
              // `\n` entre bloques del HTML generado se volvían párrafos
              // vacíos (texto de terminal muy separado). Igual que al abrir un
              // archivo, se descartan; los <pre> conservan el suyo.
              inst
                .chain()
                .focus()
                .insertContent(markdownToHtml(md), { parseOptions: { preserveWhitespace: false } })
                .run();
              return true;
            }
            // Prosa plana multilínea: siempre por plainTextToHtml, que
            // respeta los saltos simples como saltos duros (el paste por
            // defecto de ProseMirror haría un párrafo por línea, añadiendo
            // retornos al serializar). Con una sola línea y sin CRs que
            // limpiar, el paste por defecto ya hace lo correcto.
            if (rawText !== text || text.includes('\n')) {
              event.preventDefault();
              inst.chain().focus().insertContent(plainTextToHtml(text)).run();
              return true;
            }
          }
          // 3) Respaldo: en Linux/WebKitGTK las capturas del portapapeles no
          //    llegan por clipboardData (el evento viene VACÍO). Se consulta el
          //    portapapeles del sistema vía Rust y se inserta la imagen cuando
          //    llega. El pegado nativo se cancela: sin esto WebKitGTK insertaba
          //    por su cuenta un <img> con URL `blob:` (que se guardaba tal cual
          //    en el markdown y al reabrir no se veía) y movía la selección,
          //    con lo que la copia buena acababa en otro sitio del documento.
          //    Además el evento llega duplicado: mientras hay una lectura en
          //    curso, el segundo se ignora.
          if (!html && !text && !uriList && readClipboardImageRef.current) {
            event.preventDefault();
            if (!clipboardReadRef.current) {
              clipboardReadRef.current = (async () => {
                try {
                  const file = await readClipboardImageRef.current?.();
                  if (file && editorRef.current) await insertImageFile(file, editorRef.current);
                } finally {
                  clipboardReadRef.current = null;
                }
              })();
            }
            return true;
          }
          return false;
        },
        // NOTA: drag-and-drop de archivos NO pasa por ProseMirror en Tauri —
        // la webview lo intercepta (dragDropEnabled). Se maneja en App.tsx
        // vía getCurrentWebview().onDragDropEvent().
      },
      onUpdate: ({ editor: e, transaction }) => {
        localizeTransientImages(e, transaction);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        // emit() serializa el documento COMPLETO (getHTML + turndown): en
        // documentos grandes cuesta cientos de ms, así que el debounce crece
        // con el tamaño. Nada de lo que alimenta es urgente (dirty-tracking,
        // contadores, borradores); getMarkdown() sigue siendo inmediato.
        const delay = e.state.doc.content.size > 100_000 ? 1200 : 250;
        debounceRef.current = setTimeout(() => emit(e), delay);
      },
      onSelectionUpdate: ({ editor: e }) => {
        if (!onCursorRef.current) return;
        if (cursorDebounceRef.current) clearTimeout(cursorDebounceRef.current);
        cursorDebounceRef.current = setTimeout(() => {
          const pos = e.state.selection.from;
          onCursorRef.current?.({ line: lineAtPos(e.state.doc, pos), pos });
        }, 120);
      },
    });

    // Scroll del editor → encabezado visible (resaltado del esquema). Se
    // busca el último h1–h6 cuyo tope quedó en o por encima del viewport.
    const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
      if (!onScrollHeadingRef.current || scrollRafRef.current !== null) return;
      const container = event.currentTarget;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        const view = editorRef.current?.view;
        if (!view || !container.isConnected) return;
        const top = container.getBoundingClientRect().top;
        let current: HTMLElement | null = null;
        for (const el of view.dom.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')) {
          if (el.getBoundingClientRect().top <= top + 16) current = el;
          else break;
        }
        if (!current) return; // antes del primer encabezado: sin sección
        try {
          // posAtDOM devuelve el inicio del contenido (nodePos + 1); el
          // esquema guarda nodePos, de ahí el -1.
          onScrollHeadingRef.current?.(view.posAtDOM(current, 0) - 1);
        } catch {
          // nodo desmontado a mitad de scroll: se ignora este tick
        }
      });
    }, []);

    editorRef.current = editor;

    useImperativeHandle(
      ref,
      () => ({
        getMarkdown: () => {
          if (!editor) return '';
          if (debounceRef.current) clearTimeout(debounceRef.current);
          return joinFrontMatter(frontMatterRef.current, turndown.turndown(editor.getHTML()));
        },
        setMarkdown: (markdown: string) => {
          if (!editor) return;
          const { frontMatter, body } = splitFrontMatter(markdown);
          frontMatterRef.current = frontMatter;
          editor.commands.setContent(prepareContent(body));
          // Nuevo documento: el historial de undo no debe cruzar archivos
          // (setContent con emitUpdate false no dispara onUpdate), pero el
          // esquema sí debe reflejar el contenido recién cargado.
          onHeadingsRef.current?.(collectHeadings(editor.state.doc));
        },
        insertImage: (src: string, alt = '') => {
          if (editor) insertImageAndContinue(editor, { src, alt });
        },
        getFrontMatter: () => frontMatterRef.current,
        openSearch: (replace = false) => {
          setShowSearch(true);
          if (replace) setReplaceSignal((n) => n + 1);
        },
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
        if (cursorDebounceRef.current) clearTimeout(cursorDebounceRef.current);
        if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
      },
      []
    );

    useEffect(() => {
      if (!editor || editor.isDestroyed) return;
      editor.commands.setLineNumbers(lineNumbers);
    }, [editor, lineNumbers]);

    // Los wikilinks se resuelven desde la carpeta del documento: al cambiar
    // de ruta (guardar como) se re-pintan.
    useEffect(() => {
      if (!editor || editor.isDestroyed) return;
      editor.storage.wikiLink.sourcePath = docPath;
      notifyLinks();
    }, [editor, docPath]);

    // Cambio de idioma: una transacción vacía recalcula las decoraciones
    // (el placeholder) sin tocar el documento ni el historial.
    useEffect(() => {
      if (!editor || editor.isDestroyed) return;
      editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
    }, [editor, lang]);

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
        <TableToolbar editor={editor} />
        {showSearch && (
          <SearchBar
            editor={editor}
            replaceSignal={replaceSignal}
            onClose={() => {
              setShowSearch(false);
              setReplaceSignal(0);
            }}
          />
        )}

        <BubbleMenu
          editor={editor}
          // Sólo con texto seleccionado: sobre una imagen o un diagrama
          // seleccionados (NodeSelection) los botones de formato no aplican.
          shouldShow={({ editor: e, state, from, to }) =>
            e.isEditable &&
            from !== to &&
            !(state.selection instanceof NodeSelection) &&
            !e.isActive('codeBlock')
          }
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

        <div className="flex-1 overflow-auto" onScroll={handleScroll}>
          <EditorContent editor={editor} />
        </div>
      </div>
    );
  }
);

Editor.displayName = 'Editor';
