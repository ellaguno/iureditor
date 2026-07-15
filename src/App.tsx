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
import { collectHeadings, buildTocHtml } from './lib/outline';
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
  confirmRecoverDrafts,
  saveImageToAssets,
  allowDocumentDir,
  getRecentFiles,
  addRecentFile,
  basename,
} from './lib/fileio';
import { saveDrafts, loadDrafts, clearDrafts } from './lib/autosave';
import { exportToPdf } from './lib/exportPdf';
import { t } from './lib/i18n';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// Un documento abierto = una pestaña. Cada pestaña monta su propio <Editor>
// (oculto si no está activa): así conserva su historial de undo, cursor y
// diagramas renderizados al cambiar de pestaña.
interface DocTab {
  id: number;
  path: string | null;
  dirty: boolean;
  sourceMode: boolean;
}

/** Contenido pendiente de cargar en el editor de una pestaña recién creada
 *  (el handle no existe hasta que React monta el componente). */
interface PendingLoad {
  content: string;
  /** null = el contenido ES el estado guardado (abrir archivo limpio);
   *  string = markdown guardado en disco (recuperación de borrador sucio). */
  baseline: string | null;
}

export default function App() {
  const [tabs, setTabs] = useState<DocTab[]>([
    { id: 0, path: null, dirty: false, sourceMode: false },
  ]);
  const [activeId, setActiveId] = useState(0);
  const nextTabId = useRef(1);

  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [counts, setCounts] = useState({ words: 0, chars: 0 });
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [spellcheck, setSpellcheckState] = useState<boolean>(getSpellcheck);
  const [zoom, setZoomState] = useState<number>(getZoom);
  const [showOutline, setShowOutline] = useState<boolean>(getOutlineVisible);
  const [headings, setHeadings] = useState<HeadingInfo[]>([]);
  const [sourceText, setSourceText] = useState('');

  // Estado por pestaña que vive fuera de React (mapas por id).
  const editorHandles = useRef(new Map<number, EditorHandle | null>());
  const savedMd = useRef(new Map<number, string>());
  const sourceTexts = useRef(new Map<number, string>());
  const pendingLoads = useRef(new Map<number, PendingLoad>());

  // Refs espejo para handlers estables (listeners de ventana, atajos).
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const sourceTextRef = useRef(sourceText);
  sourceTextRef.current = sourceText;

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const activeHandle = useCallback(
    () => editorHandles.current.get(activeIdRef.current) ?? null,
    []
  );

  const updateTab = useCallback((id: number, patch: Partial<DocTab>) => {
    setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  }, []);

  // ---------- título de ventana ----------
  useEffect(() => {
    if (!isTauri) return;
    const name = activeTab?.path ? basename(activeTab.path) : t('app.untitled');
    void getCurrentWindow().setTitle(`${activeTab?.dirty ? '• ' : ''}${name} — iureditor`);
  }, [activeTab?.path, activeTab?.dirty]);

  // ---------- contadores ----------
  const updateCounts = useCallback((markdown: string) => {
    const words = markdown.trim() ? markdown.trim().split(/\s+/).length : 0;
    setCounts({ words, chars: markdown.length });
  }, []);

  // ---------- borradores (autoguardado de todas las pestañas sucias) ----------
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleDraftSave = useCallback(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      const drafts = tabsRef.current
        .filter((tab) => tab.dirty)
        .map((tab) => ({
          path: tab.path,
          markdown: editorHandles.current.get(tab.id)?.getMarkdown() ?? '',
          savedAt: Date.now(),
        }))
        .filter((d) => d.markdown.trim());
      void saveDrafts(drafts);
    }, 2500);
  }, []);

  useEffect(
    () => () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    },
    []
  );

  // ---------- cambios del editor → dirty + borradores ----------
  const handleChangeFor = useCallback(
    (tabId: number, markdown: string) => {
      const isDirty = markdown !== (savedMd.current.get(tabId) ?? '');
      const tab = tabsRef.current.find((tb) => tb.id === tabId);
      if (tab && tab.dirty !== isDirty) updateTab(tabId, { dirty: isDirty });
      if (tabId === activeIdRef.current) updateCounts(markdown);
      scheduleDraftSave();
    },
    [updateCounts, updateTab, scheduleDraftSave]
  );

  // ---------- cargas pendientes (pestañas recién montadas) ----------
  useEffect(() => {
    for (const tab of tabs) {
      const pending = pendingLoads.current.get(tab.id);
      const handle = editorHandles.current.get(tab.id);
      if (!pending || !handle) continue;
      pendingLoads.current.delete(tab.id);
      if (pending.baseline !== null) {
        // Borrador recuperado: el baseline (disco) define el estado limpio.
        handle.setMarkdown(pending.baseline);
        savedMd.current.set(tab.id, handle.getMarkdown());
        handle.setMarkdown(pending.content);
        updateTab(tab.id, { dirty: true });
      } else {
        handle.setMarkdown(pending.content);
        savedMd.current.set(tab.id, handle.getMarkdown());
      }
      if (tab.id === activeIdRef.current) {
        const md = handle.getMarkdown();
        updateCounts(md);
        setSourceText(md);
        sourceTexts.current.set(tab.id, md);
        if (handle.editor) setHeadings(collectHeadings(handle.editor.state.doc));
      }
    }
  });

  // ---------- cambio de pestaña activa: refrescar vistas derivadas ----------
  useEffect(() => {
    const handle = editorHandles.current.get(activeId);
    if (!handle) return;
    const md = handle.getMarkdown();
    updateCounts(md);
    setSourceText(sourceTexts.current.get(activeId) ?? md);
    if (handle.editor) setHeadings(collectHeadings(handle.editor.state.doc));
    // Las imágenes relativas se resuelven contra el directorio del doc activo.
    const path = tabsRef.current.find((tab) => tab.id === activeId)?.path;
    if (path) void allowDocumentDir(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // ---------- vista de código fuente (por pestaña) ----------
  const syncSourceToEditor = useCallback(() => {
    const tab = tabsRef.current.find((tb) => tb.id === activeIdRef.current);
    if (!tab?.sourceMode) return;
    activeHandle()?.setMarkdown(sourceTextRef.current);
  }, [activeHandle]);

  const handleSourceChange = useCallback(
    (markdown: string) => {
      setSourceText(markdown);
      sourceTexts.current.set(activeIdRef.current, markdown);
      handleChangeFor(activeIdRef.current, markdown);
    },
    [handleChangeFor]
  );

  const handleToggleSource = useCallback(() => {
    const id = activeIdRef.current;
    const tab = tabsRef.current.find((tb) => tb.id === id);
    const handle = activeHandle();
    if (!tab || !handle) return;
    if (tab.sourceMode) {
      handle.setMarkdown(sourceTextRef.current);
      // Canónico: lo que el editor re-emite, para no dejar dirty espurio.
      handleChangeFor(id, handle.getMarkdown());
      updateTab(id, { sourceMode: false });
    } else {
      const md = handle.getMarkdown();
      setSourceText(md);
      sourceTexts.current.set(id, md);
      updateTab(id, { sourceMode: true });
    }
  }, [activeHandle, handleChangeFor, updateTab]);

  // ---------- esquema del documento ----------
  const handleToggleOutline = useCallback(() => {
    setShowOutline((prev) => {
      setOutlineVisible(!prev);
      return !prev;
    });
  }, []);

  const handleOutlineSelect = useCallback(
    (heading: HeadingInfo) => {
      const editor = activeHandle()?.editor;
      if (!editor) return;
      const pos = Math.min(heading.pos, editor.state.doc.content.size - 1);
      editor.chain().focus().setTextSelection(pos + 1).run();
      const dom = editor.view.nodeDOM(pos);
      if (dom instanceof HTMLElement) {
        dom.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } else {
        editor.commands.scrollIntoView();
      }
    },
    [activeHandle]
  );

  // ---------- pestañas ----------
  const createTab = useCallback((load?: PendingLoad, path: string | null = null): number => {
    const id = nextTabId.current++;
    if (load) pendingLoads.current.set(id, load);
    setTabs((prev) => [...prev, { id, path, dirty: false, sourceMode: false }]);
    setActiveId(id);
    return id;
  }, []);

  /** ¿La pestaña está "prístina"? (sin archivo, sin cambios, vacía) */
  const isPristine = useCallback((tab: DocTab): boolean => {
    if (tab.path || tab.dirty) return false;
    const handle = editorHandles.current.get(tab.id);
    return !handle || !handle.getMarkdown().trim();
  }, []);

  const removeTab = useCallback((id: number) => {
    editorHandles.current.delete(id);
    savedMd.current.delete(id);
    sourceTexts.current.delete(id);
    pendingLoads.current.delete(id);
    setTabs((prev) => {
      const idx = prev.findIndex((tab) => tab.id === id);
      const rest = prev.filter((tab) => tab.id !== id);
      if (rest.length === 0) {
        // Siempre queda al menos una pestaña.
        const freshId = nextTabId.current++;
        setActiveId(freshId);
        return [{ id: freshId, path: null, dirty: false, sourceMode: false }];
      }
      if (activeIdRef.current === id) {
        const neighbor = rest[Math.min(idx, rest.length - 1)];
        setActiveId(neighbor.id);
      }
      return rest;
    });
  }, []);

  const handleCloseTab = useCallback(
    async (id: number) => {
      const tab = tabsRef.current.find((tb) => tb.id === id);
      if (!tab) return;
      if (tab.dirty && !(await confirmDiscard())) return;
      removeTab(id);
      scheduleDraftSave();
    },
    [removeTab, scheduleDraftSave]
  );

  // ---------- abrir / nuevo ----------
  const loadDocument = useCallback(
    async (path: string) => {
      // Si ya está abierto, sólo activa su pestaña.
      const existing = tabsRef.current.find((tab) => tab.path === path);
      if (existing) {
        setActiveId(existing.id);
        return;
      }
      const raw = await readDocument(path);
      setRecentFiles(await addRecentFile(path));

      const active = tabsRef.current.find((tab) => tab.id === activeIdRef.current);
      if (active && isPristine(active)) {
        // Reutiliza la pestaña vacía actual (comportamiento clásico).
        const handle = editorHandles.current.get(active.id);
        if (handle) {
          handle.setMarkdown(raw);
          const canonical = handle.getMarkdown();
          savedMd.current.set(active.id, canonical);
          sourceTexts.current.set(active.id, canonical);
          setSourceText(canonical);
          updateCounts(canonical);
          if (handle.editor) setHeadings(collectHeadings(handle.editor.state.doc));
        } else {
          pendingLoads.current.set(active.id, { content: raw, baseline: null });
        }
        updateTab(active.id, { path, dirty: false });
        return;
      }
      createTab({ content: raw, baseline: null }, path);
    },
    [createTab, isPristine, updateCounts, updateTab]
  );

  const handleNew = useCallback(() => {
    createTab();
  }, [createTab]);

  const handleOpen = useCallback(async () => {
    const path = await pickOpenPath();
    if (path) await loadDocument(path);
  }, [loadDocument]);

  const handleOpenRecent = useCallback(
    async (path: string) => {
      try {
        await loadDocument(path);
      } catch (err) {
        console.error('No se pudo abrir el archivo reciente:', err);
      }
    },
    [loadDocument]
  );

  // ---------- guardar ----------
  const doSave = useCallback(
    async (as: boolean): Promise<string | null> => {
      syncSourceToEditor();
      const id = activeIdRef.current;
      const handle = editorHandles.current.get(id);
      if (!handle) return null;
      const md = handle.getMarkdown();
      const tab = tabsRef.current.find((tb) => tb.id === id);
      let path = tab?.path ?? null;
      if (as || !path) {
        path = await pickSavePath(path ? basename(path) : 'documento.md');
        if (!path) return null;
        await allowDocumentDir(path);
      }
      await writeDocument(path, md);
      savedMd.current.set(id, md);
      // En modo fuente, el textarea pasa a mostrar el markdown canónico guardado.
      if (tab?.sourceMode) {
        setSourceText(md);
        sourceTexts.current.set(id, md);
      }
      updateTab(id, { path, dirty: false });
      setRecentFiles(await addRecentFile(path));
      // Guardado exitoso: re-generar borradores (sólo pestañas aún sucias).
      scheduleDraftSave();
      return path;
    },
    [syncSourceToEditor, updateTab, scheduleDraftSave]
  );

  const handleSave = useCallback(() => void doSave(false), [doSave]);
  const handleSaveAs = useCallback(() => void doSave(true), [doSave]);

  // ---------- imágenes pegadas ----------
  const handleInsertImageFile = useCallback(
    async (file: File): Promise<string | null> => {
      let path = tabsRef.current.find((tab) => tab.id === activeIdRef.current)?.path ?? null;
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

  const activePath = useCallback(
    () => tabsRef.current.find((tab) => tab.id === activeIdRef.current)?.path ?? null,
    []
  );

  const handleExportPdf = useCallback(() => {
    syncSourceToEditor();
    const handle = activeHandle();
    const editor = handle?.editor;
    if (!editor) return;
    exportToPdf(editor, activePath(), handle?.getFrontMatter() ?? '').catch((err) =>
      reportExportError('PDF', err)
    );
  }, [reportExportError, syncSourceToEditor, activeHandle, activePath]);

  const handleExportDocx = useCallback(() => {
    syncSourceToEditor();
    const editor = activeHandle()?.editor;
    if (!editor) return;
    // Import perezoso: docx pesa ~370KB y sólo se usa al exportar.
    import('./lib/exportDocx')
      .then(({ exportToDocx }) => exportToDocx(editor, activePath()))
      .catch((err) => reportExportError('DOCX', err));
  }, [reportExportError, syncSourceToEditor, activeHandle, activePath]);

  const handleExportHtml = useCallback(() => {
    syncSourceToEditor();
    const editor = activeHandle()?.editor;
    if (!editor) return;
    import('./lib/exportHtmlFile')
      .then(({ exportToHtmlFile }) => exportToHtmlFile(editor, activePath()))
      .catch((err) => reportExportError('HTML', err));
  }, [reportExportError, syncSourceToEditor, activeHandle, activePath]);

  const handleQuit = useCallback(() => {
    // close() dispara onCloseRequested, donde vive el guard de dirty.
    void getCurrentWindow().close();
  }, []);

  // ---------- índice (TOC) ----------
  const handleInsertToc = useCallback(() => {
    const editor = activeHandle()?.editor;
    const tab = tabsRef.current.find((tb) => tb.id === activeIdRef.current);
    if (!editor || tab?.sourceMode) return;
    const toc = buildTocHtml(collectHeadings(editor.state.doc));
    if (toc) editor.chain().focus().insertContent(toc).run();
  }, [activeHandle]);

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
    for (const handle of editorHandles.current.values()) {
      handle?.setSpellcheck(enabled);
    }
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
    const tab = tabsRef.current.find((tb) => tb.id === activeIdRef.current);
    if (tab?.sourceMode) return;
    activeHandle()?.openSearch();
  }, [activeHandle]);

  const cycleTab = useCallback((delta: number) => {
    const list = tabsRef.current;
    if (list.length < 2) return;
    const idx = list.findIndex((tab) => tab.id === activeIdRef.current);
    const next = list[(idx + delta + list.length) % list.length];
    setActiveId(next.id);
  }, []);

  // ---------- atajos de teclado (los menús no son nativos) ----------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'tab') {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
        return;
      }
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
        handleNew();
      } else if (key === 'w' && !e.shiftKey) {
        e.preventDefault();
        void handleCloseTab(activeIdRef.current);
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
    handleCloseTab,
    handleExportPdf,
    handleQuit,
    handleFind,
    handleZoomIn,
    handleZoomOut,
    handleZoomReset,
    handleToggleOutline,
    handleToggleSource,
    cycleTab,
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

  // ---------- arranque: recientes, recuperación de borradores y CLI ----------
  useEffect(() => {
    if (!isTauri) return;
    void getRecentFiles().then(setRecentFiles);
    void (async () => {
      // 1) ¿Quedaron borradores de una sesión que terminó mal?
      const drafts = await loadDrafts();
      if (drafts.length) {
        const names = drafts.map((d) => (d.path ? basename(d.path) : t('app.untitled')));
        const newest = Math.max(...drafts.map((d) => d.savedAt || 0));
        if (await confirmRecoverDrafts(names, newest)) {
          let firstId: number | null = null;
          for (const draft of drafts) {
            let baseline = '';
            if (draft.path) {
              try {
                baseline = await readDocument(draft.path);
              } catch {
                baseline = '';
              }
            }
            const id = createTab({ content: draft.markdown, baseline }, draft.path);
            if (firstId === null) firstId = id;
          }
          if (firstId !== null) setActiveId(firstId);
          // Los borradores siguen en disco hasta que el usuario guarde o
          // descarte — si la app vuelve a morir, no se pierde nada.
          return;
        }
        await clearDrafts();
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
      const dirtyTabs = tabsRef.current.filter((tab) => tab.dirty);
      if (dirtyTabs.length === 0) return;
      if (await confirmDiscard()) {
        // Cierre con descarte explícito: sin borradores huérfanos.
        if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
        await clearDrafts();
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
          await loadDocument(p);
          return;
        }
        if (/\.(png|jpe?g|gif|webp|svg)$/i.test(p)) {
          const bytes = await readFile(p);
          const ext = p.split('.').pop()!.toLowerCase();
          const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
          const file = new File([new Uint8Array(bytes)], basename(p), { type: mime });
          const src = await handleInsertImageFile(file);
          if (src) activeHandle()?.insertImage(src, basename(p));
          return;
        }
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [loadDocument, handleInsertImageFile, activeHandle]);

  const sourceMode = activeTab?.sourceMode ?? false;

  return (
    <div className="h-full flex flex-col">
      {isTauri && <ResizeHandles />}
      {isTauri && (
        <TitleBar
          tabs={tabs}
          activeTabId={activeId}
          onSelectTab={setActiveId}
          onCloseTab={(id) => void handleCloseTab(id)}
          recentFiles={recentFiles}
          actions={{
            onNew: handleNew,
            onOpen: () => void handleOpen(),
            onOpenRecent: (path) => void handleOpenRecent(path),
            onSave: handleSave,
            onSaveAs: handleSaveAs,
            onExportPdf: handleExportPdf,
            onExportDocx: handleExportDocx,
            onExportHtml: handleExportHtml,
            onQuit: handleQuit,
            onUndo: () => activeHandle()?.editor?.chain().focus().undo().run(),
            onRedo: () => activeHandle()?.editor?.chain().focus().redo().run(),
            onSelectAll: () => activeHandle()?.editor?.chain().focus().selectAll().run(),
            onInsertToc: handleInsertToc,
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
          {/* Cada pestaña mantiene su editor montado (oculto si no está
              activa o en modo fuente): conserva undo, cursor y mermaid. */}
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`flex-1 min-h-0 flex-col ${
                tab.id === activeId && !tab.sourceMode ? 'flex' : 'hidden'
              }`}
            >
              <Editor
                ref={(handle) => {
                  editorHandles.current.set(tab.id, handle);
                }}
                onChange={(md) => handleChangeFor(tab.id, md)}
                onHeadingsChange={(hs) => {
                  if (tab.id === activeIdRef.current) setHeadings(hs);
                }}
                onInsertImageFile={handleInsertImageFile}
                onBrowseImage={handleBrowseImage}
              />
            </div>
          ))}
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
        dirty={activeTab?.dirty ?? false}
        hasFile={!!activeTab?.path}
        zoom={zoom}
      />
    </div>
  );
}
