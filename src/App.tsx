import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { readFile } from '@tauri-apps/plugin-fs';
import { Editor } from './components/Editor';
import type { EditorHandle } from './components/Editor';
import { TitleBar } from './components/TitleBar';
import { ResizeHandles } from './components/ResizeHandles';
import { StatusBar } from './components/StatusBar';
import { SourceView } from './components/SourceView';
import { OutlinePanel } from './components/OutlinePanel';
import type { HeadingInfo } from './lib/outline';
import {
  initTheme,
  getTheme,
  setTheme,
  getZoom,
  setZoom,
  getSpellcheck,
  setSpellcheck,
  getOutlineVisible,
  setOutlineVisible,
  ZOOM_STEP,
} from './lib/prefs';
import type { Theme } from './lib/prefs';
import { getMermaid } from './lib/mermaid';
import {
  readDocument,
  writeDocument,
  pickOpenPath,
  pickSavePath,
  pickImagePath,
  confirmDiscard,
  confirmRecoverDraft,
  saveImageToAssets,
  allowDocumentDir,
  getRecentFiles,
  addRecentFile,
  basename,
} from './lib/fileio';
import { saveDraft, loadDraft, clearDraft } from './lib/autosave';
import { exportToPdf } from './lib/exportPdf';
import { t } from './lib/i18n';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export default function App() {
  const editorRef = useRef<EditorHandle>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [counts, setCounts] = useState({ words: 0, chars: 0 });
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [spellcheck, setSpellcheckState] = useState<boolean>(getSpellcheck);
  const [zoom, setZoomState] = useState<number>(getZoom);
  const [showOutline, setShowOutline] = useState<boolean>(getOutlineVisible);
  const [headings, setHeadings] = useState<HeadingInfo[]>([]);
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceText, setSourceText] = useState('');

  // Refs espejo para handlers estables (menú nativo, listeners de ventana).
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const sourceModeRef = useRef(sourceMode);
  sourceModeRef.current = sourceMode;
  const sourceTextRef = useRef(sourceText);
  sourceTextRef.current = sourceText;
  const savedMarkdownRef = useRef('');

  // ---------- título de ventana ----------
  useEffect(() => {
    if (!isTauri) return;
    const name = filePath ? basename(filePath) : t('app.untitled');
    void getCurrentWindow().setTitle(`${dirty ? '• ' : ''}${name} — iureditor`);
  }, [filePath, dirty]);

  // ---------- contadores ----------
  const updateCounts = useCallback((markdown: string) => {
    const words = markdown.trim() ? markdown.trim().split(/\s+/).length : 0;
    setCounts({ words, chars: markdown.length });
  }, []);

  // ---------- cambios del editor → dirty + borrador de autoguardado ----------
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (markdown: string) => {
      const isDirty = markdown !== savedMarkdownRef.current;
      setDirty(isDirty);
      updateCounts(markdown);
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      if (isDirty) {
        draftTimerRef.current = setTimeout(() => {
          void saveDraft(filePathRef.current, markdown);
        }, 2500);
      }
    },
    [updateCounts]
  );

  useEffect(
    () => () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    },
    []
  );

  // ---------- vista de código fuente ----------
  // En modo fuente el editor WYSIWYG sigue montado (oculto); el texto crudo
  // se le aplica al volver, al guardar o antes de exportar.
  const syncSourceToEditor = useCallback(() => {
    if (!sourceModeRef.current || !editorRef.current) return;
    editorRef.current.setMarkdown(sourceTextRef.current);
  }, []);

  const handleSourceChange = useCallback(
    (markdown: string) => {
      setSourceText(markdown);
      handleChange(markdown);
    },
    [handleChange]
  );

  const handleToggleSource = useCallback(() => {
    if (sourceModeRef.current) {
      if (editorRef.current) {
        editorRef.current.setMarkdown(sourceTextRef.current);
        // Canónico: lo que el editor re-emite, para no dejar dirty espurio.
        handleChange(editorRef.current.getMarkdown());
      }
      setSourceMode(false);
    } else {
      setSourceText(editorRef.current?.getMarkdown() ?? '');
      setSourceMode(true);
    }
  }, [handleChange]);

  // ---------- esquema del documento ----------
  const handleToggleOutline = useCallback(() => {
    setShowOutline((prev) => {
      setOutlineVisible(!prev);
      return !prev;
    });
  }, []);

  const handleOutlineSelect = useCallback((heading: HeadingInfo) => {
    const editor = editorRef.current?.editor;
    if (!editor) return;
    const pos = Math.min(heading.pos, editor.state.doc.content.size - 1);
    editor.chain().focus().setTextSelection(pos + 1).run();
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof HTMLElement) {
      dom.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else {
      editor.commands.scrollIntoView();
    }
  }, []);

  // ---------- abrir / nuevo ----------
  const loadDocument = useCallback(async (path: string) => {
    const raw = await readDocument(path);
    editorRef.current?.setMarkdown(raw);
    // Canónico: el markdown tal como lo re-emite el editor. Evita marcar
    // dirty por diferencias de normalización (espacios, separadores).
    savedMarkdownRef.current = editorRef.current?.getMarkdown() ?? raw;
    updateCounts(savedMarkdownRef.current);
    setSourceText(savedMarkdownRef.current);
    setFilePath(path);
    setDirty(false);
    setRecentFiles(await addRecentFile(path));
  }, [updateCounts]);

  const guardDirty = useCallback(async (): Promise<boolean> => {
    if (!dirtyRef.current) return true;
    const discard = await confirmDiscard();
    if (discard) {
      // Descarte explícito: el borrador de autoguardado también se va.
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      void clearDraft();
    }
    return discard;
  }, []);

  const handleNew = useCallback(async () => {
    if (!(await guardDirty())) return;
    editorRef.current?.setMarkdown('');
    savedMarkdownRef.current = editorRef.current?.getMarkdown() ?? '';
    updateCounts(savedMarkdownRef.current);
    setSourceText(savedMarkdownRef.current);
    setFilePath(null);
    setDirty(false);
  }, [guardDirty, updateCounts]);

  const handleOpen = useCallback(async () => {
    if (!(await guardDirty())) return;
    const path = await pickOpenPath();
    if (path) await loadDocument(path);
  }, [guardDirty, loadDocument]);

  const handleOpenRecent = useCallback(
    async (path: string) => {
      if (!(await guardDirty())) return;
      try {
        await loadDocument(path);
      } catch (err) {
        console.error('No se pudo abrir el archivo reciente:', err);
      }
    },
    [guardDirty, loadDocument]
  );

  // ---------- guardar ----------
  const doSave = useCallback(async (as: boolean): Promise<string | null> => {
    syncSourceToEditor();
    const md = editorRef.current?.getMarkdown() ?? '';
    let path = filePathRef.current;
    if (as || !path) {
      path = await pickSavePath(path ? basename(path) : 'documento.md');
      if (!path) return null;
      await allowDocumentDir(path);
    }
    await writeDocument(path, md);
    savedMarkdownRef.current = md;
    // En modo fuente, el textarea pasa a mostrar el markdown canónico guardado.
    if (sourceModeRef.current) setSourceText(md);
    setFilePath(path);
    setDirty(false);
    setRecentFiles(await addRecentFile(path));
    // Guardado exitoso: el borrador de recuperación ya no aplica.
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    void clearDraft();
    return path;
  }, [syncSourceToEditor]);

  const handleSave = useCallback(() => void doSave(false), [doSave]);
  const handleSaveAs = useCallback(() => void doSave(true), [doSave]);

  // ---------- imágenes pegadas ----------
  const handleInsertImageFile = useCallback(
    async (file: File): Promise<string | null> => {
      let path = filePathRef.current;
      if (!path) {
        // Regla v1: para guardar imágenes junto al doc, primero hay que
        // guardar el documento.
        path = await doSave(true);
        if (!path) return null;
      }
      return saveImageToAssets(path, file);
    },
    [doSave]
  );

  // ---------- imagen vía diálogo nativo (botón Examinar del modal) ----------
  const handleBrowseImage = useCallback(async (): Promise<string | null> => {
    const imgPath = await pickImagePath();
    if (!imgPath) return null;
    const bytes = await readFile(imgPath);
    const ext = imgPath.split('.').pop()!.toLowerCase();
    const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    const file = new File([new Uint8Array(bytes)], basename(imgPath), { type: mime });
    // Copia a assets/ junto al documento (pide guardar primero si es nuevo)
    return handleInsertImageFile(file);
  }, [handleInsertImageFile]);

  // ---------- exportar ----------
  const reportExportError = useCallback(async (format: string, err: unknown) => {
    console.error(`Export ${format} falló:`, err);
    const { message } = await import('@tauri-apps/plugin-dialog');
    const detail = err instanceof Error ? err.message : String(err);
    await message(`No se pudo exportar a ${format}:\n${detail}`, {
      title: 'iureditor',
      kind: 'error',
    });
  }, []);

  const handleExportPdf = useCallback(() => {
    syncSourceToEditor();
    const editor = editorRef.current?.editor;
    if (!editor) return;
    exportToPdf(editor, filePathRef.current).catch((err) =>
      reportExportError('PDF', err)
    );
  }, [reportExportError, syncSourceToEditor]);

  const handleExportDocx = useCallback(() => {
    syncSourceToEditor();
    const editor = editorRef.current?.editor;
    if (!editor) return;
    // Import perezoso: turbodocx pesa ~1MB y sólo se usa al exportar.
    import('./lib/exportDocx')
      .then(({ exportToDocx }) => exportToDocx(editor, filePathRef.current))
      .catch((err) => reportExportError('DOCX', err));
  }, [reportExportError, syncSourceToEditor]);

  const handleExportHtml = useCallback(() => {
    syncSourceToEditor();
    const editor = editorRef.current?.editor;
    if (!editor) return;
    import('./lib/exportHtmlFile')
      .then(({ exportToHtmlFile }) => exportToHtmlFile(editor, filePathRef.current))
      .catch((err) => reportExportError('HTML', err));
  }, [reportExportError, syncSourceToEditor]);

  const handleQuit = useCallback(() => {
    // close() dispara onCloseRequested, donde vive el guard de dirty.
    void getCurrentWindow().close();
  }, []);

  // ---------- preferencias de vista ----------
  useEffect(() => {
    initTheme();
  }, []);

  const handleThemeChange = useCallback((next: Theme) => {
    setTheme(next);
    setThemeState(next);
  }, []);

  const handleSpellcheckChange = useCallback((enabled: boolean) => {
    setSpellcheck(enabled);
    setSpellcheckState(enabled);
    editorRef.current?.setSpellcheck(enabled);
  }, []);

  const applyZoom = useCallback((next: number) => {
    const clamped = setZoom(next);
    setZoomState(clamped);
  }, []);

  const handleZoomIn = useCallback(() => applyZoom(getZoom() + ZOOM_STEP), [applyZoom]);
  const handleZoomOut = useCallback(() => applyZoom(getZoom() - ZOOM_STEP), [applyZoom]);
  const handleZoomReset = useCallback(() => applyZoom(1), [applyZoom]);

  const handleFind = useCallback(() => {
    // La búsqueda opera sobre el editor WYSIWYG; en modo fuente no aplica.
    if (sourceModeRef.current) return;
    editorRef.current?.openSearch();
  }, []);

  // ---------- atajos de teclado (los menús ya no son nativos) ----------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        if (e.shiftKey) handleSaveAs();
        else handleSave();
      } else if (key === 'o' && e.shiftKey) {
        e.preventDefault();
        handleToggleOutline();
      } else if (key === 'm' && e.shiftKey) {
        e.preventDefault();
        handleToggleSource();
      } else if (key === 'o' && !e.shiftKey) {
        e.preventDefault();
        void handleOpen();
      } else if (key === 'n' && !e.shiftKey) {
        e.preventDefault();
        void handleNew();
      } else if (key === 'p' && !e.shiftKey) {
        e.preventDefault();
        handleExportPdf();
      } else if (key === 'q' && !e.shiftKey) {
        e.preventDefault();
        handleQuit();
      } else if (key === 'f' && !e.shiftKey) {
        e.preventDefault();
        handleFind();
      } else if (key === '+' || key === '=') {
        e.preventDefault();
        handleZoomIn();
      } else if (key === '-') {
        e.preventDefault();
        handleZoomOut();
      } else if (key === '0') {
        e.preventDefault();
        handleZoomReset();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [
    handleSave,
    handleSaveAs,
    handleOpen,
    handleNew,
    handleExportPdf,
    handleQuit,
    handleFind,
    handleZoomIn,
    handleZoomOut,
    handleZoomReset,
    handleToggleOutline,
    handleToggleSource,
  ]);

  // ---------- precarga de mermaid en idle ----------
  // El primer diagrama tardaba: mermaid son ~2MB que se cargan bajo demanda.
  // Precargarlo tras el arranque oculta esa latencia sin frenar el inicio.
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const id = w.requestIdleCallback
      ? w.requestIdleCallback(() => void getMermaid())
      : window.setTimeout(() => void getMermaid(), 1500);
    return () => {
      if (w.cancelIdleCallback) w.cancelIdleCallback(id);
      else window.clearTimeout(id);
    };
  }, []);

  // ---------- arranque: recientes, recuperación de borrador y CLI ----------
  useEffect(() => {
    if (!isTauri) return;
    void getRecentFiles().then(setRecentFiles);
    void (async () => {
      // 1) ¿Quedó un borrador de una sesión que terminó mal?
      const draft = await loadDraft();
      if (draft) {
        const docName = draft.path ? basename(draft.path) : t('app.untitled');
        if (await confirmRecoverDraft(docName, draft.savedAt)) {
          if (draft.path) {
            try {
              // Contenido guardado en disco = referencia para dirty.
              const raw = await readDocument(draft.path);
              editorRef.current?.setMarkdown(raw);
              savedMarkdownRef.current = editorRef.current?.getMarkdown() ?? raw;
              setFilePath(draft.path);
              setRecentFiles(await addRecentFile(draft.path));
            } catch {
              savedMarkdownRef.current = '';
              setFilePath(null);
            }
          } else {
            savedMarkdownRef.current = '';
            setFilePath(null);
          }
          editorRef.current?.setMarkdown(draft.markdown);
          updateCounts(draft.markdown);
          setDirty(true);
          // El borrador sigue en disco hasta que el usuario guarde o
          // descarte — si la app vuelve a morir, no se pierde nada.
          return;
        }
        await clearDraft();
      }

      // 2) Archivo pasado por línea de comandos
      const { invoke } = await import('@tauri-apps/api/core');
      const cliFile = await invoke<string | null>('get_cli_file');
      if (cliFile) await loadDocument(cliFile);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- guard al cerrar ----------
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      if (!dirtyRef.current) return;
      if (await confirmDiscard()) {
        // Cierre con descarte explícito: sin borrador huérfano.
        if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
        await clearDraft();
      } else {
        event.preventDefault();
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // ---------- drag & drop (Tauri intercepta los drops HTML5) ----------
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type !== 'drop') return;
      const paths = event.payload.paths || [];
      for (const p of paths) {
        if (/\.(md|markdown)$/i.test(p)) {
          if (await guardDirty()) await loadDocument(p);
          return;
        }
        if (/\.(png|jpe?g|gif|webp|svg)$/i.test(p)) {
          const bytes = await readFile(p);
          const ext = p.split('.').pop()!.toLowerCase();
          const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
          const file = new File([new Uint8Array(bytes)], basename(p), { type: mime });
          const src = await handleInsertImageFile(file);
          if (src) editorRef.current?.insertImage(src, basename(p));
          return;
        }
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [guardDirty, loadDocument, handleInsertImageFile]);

  return (
    <div className="h-full flex flex-col">
      {isTauri && <ResizeHandles />}
      {isTauri && (
        <TitleBar
          filePath={filePath}
          dirty={dirty}
          recentFiles={recentFiles}
          actions={{
            onNew: () => void handleNew(),
            onOpen: () => void handleOpen(),
            onOpenRecent: (path) => void handleOpenRecent(path),
            onSave: handleSave,
            onSaveAs: handleSaveAs,
            onExportPdf: handleExportPdf,
            onExportDocx: handleExportDocx,
            onExportHtml: handleExportHtml,
            onQuit: handleQuit,
            onUndo: () => editorRef.current?.editor?.chain().focus().undo().run(),
            onRedo: () => editorRef.current?.editor?.chain().focus().redo().run(),
            onSelectAll: () => editorRef.current?.editor?.chain().focus().selectAll().run(),
            onFind: handleFind,
            onZoomIn: handleZoomIn,
            onZoomOut: handleZoomOut,
            onZoomReset: handleZoomReset,
          }}
          viewPrefs={{
            theme,
            onThemeChange: handleThemeChange,
            spellcheck,
            onSpellcheckChange: handleSpellcheckChange,
            outline: showOutline,
            onOutlineToggle: handleToggleOutline,
            sourceMode,
            onSourceModeToggle: handleToggleSource,
          }}
        />
      )}
      <div className="flex-1 min-h-0 flex">
        {showOutline && !sourceMode && (
          <OutlinePanel headings={headings} onSelect={handleOutlineSelect} />
        )}
        <div className="flex-1 min-w-0 flex flex-col" style={{ zoom }}>
          {/* El editor queda montado (oculto) en modo fuente: conserva
              historial de undo y evita re-renderizar mermaid al volver. */}
          <div className={`flex-1 min-h-0 flex flex-col ${sourceMode ? 'hidden' : ''}`}>
            <Editor
              ref={editorRef}
              onChange={handleChange}
              onHeadingsChange={setHeadings}
              onInsertImageFile={handleInsertImageFile}
              onBrowseImage={handleBrowseImage}
            />
          </div>
          {sourceMode && (
            <SourceView
              value={sourceText}
              onChange={handleSourceChange}
              spellcheck={spellcheck}
            />
          )}
        </div>
      </div>
      <StatusBar
        words={counts.words}
        chars={counts.chars}
        dirty={dirty}
        hasFile={!!filePath}
        zoom={zoom}
      />
    </div>
  );
}
