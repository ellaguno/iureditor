import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { listen } from '@tauri-apps/api/event';
import { readFile } from '@tauri-apps/plugin-fs';
import { Editor } from './components/Editor';
import type { EditorHandle } from './components/Editor';
import { TitleBar } from './components/TitleBar';
import { ResizeHandles } from './components/ResizeHandles';
import { StatusBar } from './components/StatusBar';
import { SourceView, type SourceViewHandle } from './components/SourceView';
import { languageForPath } from './lib/highlight';
import { Sidebar } from './components/Sidebar';
import type { HeadingInfo } from './lib/outline';
import { collectHeadings, buildTocHtml, lineAtPos } from './lib/outline';
import {
  initTheme,
  getTheme,
  setTheme,
  getZoom,
  setZoom,
  getSpellcheck,
  setSpellcheck,
  getLineNumbers,
  setLineNumbers,
  getSidebarPrefs,
  setSidebarPrefs,
  getPageWidth,
  setPageWidth,
  ZOOM_STEP,
} from './lib/prefs';
import type { Theme, SidebarView, SidebarPrefs, PageWidth } from './lib/prefs';
import { getMermaid } from './lib/mermaid';
import {
  readDocument,
  writeDocument,
  detectEol,
  normalizeEol,
  applyEol,
  type Eol,
  createFile,
  createFolder,
  dirname,
  pickOpenPath,
  pickSavePath,
  pickImagePath,
  confirmDiscard,
  confirmRecoverDrafts,
  saveImageToAssets,
  allowDocumentDir,
  allowImageDirs,
  relocateImages,
  getRecentFiles,
  addRecentFile,
  basename,
  isMarkdownPath,
  isTextPath,
  getMtime,
  confirmReloadExternal,
  confirmOverwriteExternal,
} from './lib/fileio';
import type { ImageRelocation } from './lib/fileio';
import { syncAfterSave } from './lib/iurefficient';
import { saveDrafts, loadDrafts, clearDrafts } from './lib/autosave';
import { saveSession, loadSession } from './lib/session';
import {
  ensureStarterTemplates,
  listTemplates,
  readTemplate,
  openTemplatesFolder,
} from './lib/templates';
import { checkForUpdates } from './lib/updater';
import { exportToPdf } from './lib/exportPdf';
import { HELP_TITLE, HELP_MARKDOWN } from './lib/help';
import { t } from './lib/i18n';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// Ventana desacoplada: se creó con `index.html?detach=<ruta>` desde el menú de
// una pestaña. Arranca con ese único documento y NO persiste sesión ni
// borradores (esos son responsabilidad de la ventana principal, y el store es
// compartido entre ventanas: escribirlo aquí pisaría el de la principal).
const detachPath =
  isTauri && typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('detach')
    : null;

// Un documento abierto = una pestaña. Cada pestaña monta su propio <Editor>
// (oculto si no está activa): así conserva su historial de undo, cursor y
// diagramas renderizados al cambiar de pestaña.
interface DocTab {
  id: number;
  path: string | null;
  dirty: boolean;
  /** Título fijo para pestañas sin archivo (p. ej. la ayuda integrada). Si
   *  está presente sustituye al «Sin título» por defecto. */
  title?: string;
  sourceMode: boolean;
  /** Texto plano (.txt, .env…): sólo vista fuente, sin pipeline markdown —
   *  convertirlo corrompería el archivo (p. ej. `# comentario` → <h1>). */
  plain: boolean;
}

/** Contenido pendiente de cargar en el editor de una pestaña recién creada
 *  (el handle no existe hasta que React monta el componente). */
interface PendingLoad {
  content: string;
  /** null = el contenido ES el estado guardado (abrir archivo limpio);
   *  string = markdown guardado en disco (recuperación de borrador sucio). */
  baseline: string | null;
  plain?: boolean;
  /** Posición del cursor a restaurar (sesión anterior). */
  cursor?: number;
}

export default function App() {
  const [tabs, setTabs] = useState<DocTab[]>([
    { id: 0, path: null, dirty: false, sourceMode: false, plain: false },
  ]);
  const [activeId, setActiveId] = useState(0);
  const nextTabId = useRef(1);

  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [templates, setTemplates] = useState<string[]>([]);
  const [counts, setCounts] = useState({ words: 0, chars: 0 });
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [spellcheck, setSpellcheckState] = useState<boolean>(getSpellcheck);
  const [lineNumbers, setLineNumbersState] = useState<boolean>(getLineNumbers);
  const [zoom, setZoomState] = useState<number>(getZoom);
  const [pageWidth, setPageWidthState] = useState<PageWidth>(getPageWidth);
  const [sidebar, setSidebar] = useState<SidebarPrefs>(getSidebarPrefs);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const workspaceRef = useRef<string | null>(null);
  workspaceRef.current = workspace;
  // Directorio por defecto para archivos nuevos: último abierto/guardado, o el
  // seleccionado en el panel de archivos. Se mantiene también en un ref para
  // usarlo dentro de callbacks (guardado) sin re-crearlos.
  const [lastDir, setLastDir] = useState<string | null>(null);
  const lastDirRef = useRef<string | null>(null);
  lastDirRef.current = lastDir;
  const [headings, setHeadings] = useState<HeadingInfo[]>([]);
  // Línea del cursor (barra de estado) y posición que marca la sección activa
  // en el esquema (la del cursor, o la del encabezado visible al hacer scroll).
  const [cursorLine, setCursorLine] = useState(1);
  const [outlinePos, setOutlinePos] = useState(0);
  const [sourceText, setSourceText] = useState('');

  // Estado por pestaña que vive fuera de React (mapas por id).
  const editorHandles = useRef(new Map<number, EditorHandle | null>());
  const sourceViewRef = useRef<SourceViewHandle>(null);
  const savedMd = useRef(new Map<number, string>());
  // Último markdown emitido por cada editor: los borradores lo reutilizan
  // para no re-serializar documentos grandes (getMarkdown recorre todo el
  // documento y en 300KB cuesta cientos de ms).
  const emittedMd = useRef(new Map<number, string>());
  const sourceTexts = useRef(new Map<number, string>());
  const pendingLoads = useRef(new Map<number, PendingLoad>());
  // mtime del archivo en disco cuando lo cargamos/guardamos: si el disco
  // tiene uno más nuevo, alguien lo modificó por fuera.
  const diskMtime = useRef(new Map<number, number>());
  // Estilo de fin de línea del archivo en disco, por pestaña. El contenido en
  // memoria siempre es LF; al guardar se repone (applyEol) el estilo original
  // para no reescribir en silencio un archivo CRLF de Windows.
  const tabEol = useRef(new Map<number, Eol>());
  const eolFor = (id: number): Eol => tabEol.current.get(id) ?? 'lf';
  // Última posición del cursor por pestaña (PM pos en markdown, offset de
  // texto en pestañas plain). Viaja a session.json para reabrir donde estaba.
  const cursorPos = useRef(new Map<number, number>());
  // Caret pendiente de aplicar a una pestaña plain restaurada (la vista
  // fuente sólo existe para la pestaña activa).
  const pendingCaret = useRef(new Map<number, number>());
  // Pestañas markdown restauradas cuyo scroll al cursor está pendiente (el
  // editor oculto no puede hacer scrollIntoView).
  const pendingScrollMd = useRef(new Set<number>());

  // Refs espejo para handlers estables (listeners de ventana, atajos).
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const sourceTextRef = useRef(sourceText);
  sourceTextRef.current = sourceText;

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  // El panel de archivos sigue al documento activo: abrir, «guardar como» o
  // cambiar de pestaña apuntan la carpeta de trabajo a la del archivo. La
  // navegación manual del panel (subir, doble clic, elegir carpeta) manda
  // hasta que el documento activo vuelva a cambiar de ruta.
  const activeTabPath = activeTab?.path ?? null;
  useEffect(() => {
    if (activeTabPath) setWorkspace(dirname(activeTabPath));
  }, [activeTabPath]);

  const activeHandle = useCallback(
    () => editorHandles.current.get(activeIdRef.current) ?? null,
    []
  );

  /** Directorio con el que arranca CUALQUIER diálogo de archivo (abrir,
   *  guardar como, imágenes, exportar): el del documento activo si ya tiene
   *  ruta —guardar-como lo muda de carpeta y desde entonces manda la nueva— y
   *  si no, `lastDir`: lo último que el usuario tocó (abrir, guardar o la
   *  carpeta seleccionada en el panel de archivos). */
  const defaultDir = useCallback((): string | null => {
    const path = tabsRef.current.find((tb) => tb.id === activeIdRef.current)?.path;
    return path ? dirname(path) : lastDirRef.current;
  }, []);

  const updateTab = useCallback((id: number, patch: Partial<DocTab>) => {
    setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  }, []);

  // ---------- título de ventana ----------
  useEffect(() => {
    if (!isTauri) return;
    const name = activeTab?.path
      ? basename(activeTab.path)
      : activeTab?.title ?? t('app.untitled');
    void getCurrentWindow().setTitle(`${activeTab?.dirty ? '• ' : ''}${name} — iureditor`);
  }, [activeTab?.path, activeTab?.dirty, activeTab?.title]);

  // ---------- contadores ----------
  const updateCounts = useCallback((markdown: string) => {
    const words = markdown.trim() ? markdown.trim().split(/\s+/).length : 0;
    setCounts({ words, chars: markdown.length });
  }, []);

  // ---------- borradores (autoguardado de todas las pestañas sucias) ----------
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleDraftSave = useCallback(() => {
    if (detachPath) return; // las ventanas desacopladas no tocan los borradores
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      const drafts = tabsRef.current
        .filter((tab) => tab.dirty)
        .map((tab) => ({
          path: tab.path,
          // El emitido más reciente basta: este timer siempre corre después
          // del emit que marcó la pestaña como sucia.
          markdown: tab.plain
            ? sourceTexts.current.get(tab.id) ?? ''
            : emittedMd.current.get(tab.id) ??
              editorHandles.current.get(tab.id)?.getMarkdown() ??
              '',
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
      emittedMd.current.set(tabId, markdown);
      const isDirty = markdown !== (savedMd.current.get(tabId) ?? '');
      const tab = tabsRef.current.find((tb) => tb.id === tabId);
      if (tab && tab.dirty !== isDirty) updateTab(tabId, { dirty: isDirty });
      if (tabId === activeIdRef.current) updateCounts(markdown);
      scheduleDraftSave();
    },
    [updateCounts, updateTab, scheduleDraftSave]
  );

  // Aplica el caret restaurado a la vista fuente de una pestaña plain (la
  // vista se monta/actualiza en el siguiente render, de ahí el doble rAF).
  const applyPendingCaret = useCallback((id: number) => {
    const caret = pendingCaret.current.get(id);
    if (caret === undefined) return;
    pendingCaret.current.delete(id);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => sourceViewRef.current?.setCaret(caret))
    );
  }, []);

  // ---------- cargas pendientes (pestañas recién montadas) ----------
  useEffect(() => {
    for (const tab of tabs) {
      const pending = pendingLoads.current.get(tab.id);
      if (!pending) continue;
      if (pending.plain) {
        // Texto plano: sin editor de por medio, directo a la vista fuente.
        pendingLoads.current.delete(tab.id);
        savedMd.current.set(tab.id, pending.baseline ?? pending.content);
        sourceTexts.current.set(tab.id, pending.content);
        if (pending.cursor !== undefined) {
          const caret = Math.min(pending.cursor, pending.content.length);
          cursorPos.current.set(tab.id, caret);
          pendingCaret.current.set(tab.id, caret);
        }
        if (pending.baseline !== null) updateTab(tab.id, { dirty: true });
        if (tab.id === activeIdRef.current) {
          setSourceText(pending.content);
          updateCounts(pending.content);
          setHeadings([]);
          applyPendingCaret(tab.id);
        }
        continue;
      }
      const handle = editorHandles.current.get(tab.id);
      if (!handle) continue;
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
      if (pending.cursor !== undefined && handle.editor) {
        // Reabrir donde estaba el cursor. El editor puede estar oculto
        // (pestaña inactiva): el scroll queda pendiente para su activación.
        const size = handle.editor.state.doc.content.size;
        const pos = Math.max(0, Math.min(pending.cursor, size));
        handle.editor.commands.setTextSelection(pos);
        cursorPos.current.set(tab.id, pos);
        pendingScrollMd.current.add(tab.id);
        if (tab.id === activeIdRef.current) {
          handle.editor.commands.scrollIntoView();
          pendingScrollMd.current.delete(tab.id);
        }
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
    const tab = tabsRef.current.find((tb) => tb.id === activeId);
    if (tab?.plain) {
      const text = sourceTexts.current.get(activeId) ?? '';
      setSourceText(text);
      updateCounts(text);
      setHeadings([]);
      setCursorLine(1);
      setOutlinePos(0);
      applyPendingCaret(activeId);
      return;
    }
    const handle = editorHandles.current.get(activeId);
    if (!handle) return;
    if (pendingScrollMd.current.delete(activeId)) {
      // Primera activación tras restaurar sesión: centrar el cursor.
      requestAnimationFrame(() => handle.editor?.commands.scrollIntoView());
    }
    const md = handle.getMarkdown();
    updateCounts(md);
    setSourceText(sourceTexts.current.get(activeId) ?? md);
    if (handle.editor) {
      setHeadings(collectHeadings(handle.editor.state.doc));
      // La barra de estado y el esquema retoman el cursor de esta pestaña.
      const pos = handle.editor.state.selection.from;
      setCursorLine(lineAtPos(handle.editor.state.doc, pos));
      setOutlinePos(pos);
    }
    // Las imágenes relativas se resuelven contra el directorio del doc activo.
    if (tab?.path) void allowDocumentDir(tab.path);
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
    // Un archivo de texto plano vive siempre en la vista fuente.
    if (tab.plain) return;
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

  // ---------- panel lateral (archivos / esquema) ----------
  const applySidebar = useCallback((updater: (prev: SidebarPrefs) => SidebarPrefs) => {
    setSidebar((prev) => {
      const next = updater(prev);
      setSidebarPrefs(next);
      return next;
    });
  }, []);

  const handleToggleSidebar = useCallback(() => {
    applySidebar((prev) => ({ ...prev, visible: !prev.visible }));
  }, [applySidebar]);

  /** Muestra el panel en una vista; si ya está visible en esa vista, lo oculta. */
  const handleSidebarView = useCallback(
    (view: SidebarView) => {
      applySidebar((prev) =>
        prev.visible && prev.view === view
          ? { ...prev, visible: false }
          : { visible: true, view }
      );
    },
    [applySidebar]
  );

  // ---------- carpeta de trabajo ----------
  const handlePickWorkspace = useCallback(async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      defaultPath: workspaceRef.current ?? lastDirRef.current ?? undefined,
    });
    if (typeof selected !== 'string') return;
    setWorkspace(selected);
    setLastDir(selected);
    applySidebar(() => ({ visible: true, view: 'files' }));
  }, [applySidebar]);

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
  const createTab = useCallback(
    (load?: PendingLoad, path: string | null = null, title?: string): number => {
      const id = nextTabId.current++;
      const plain = !!load?.plain;
      if (load) pendingLoads.current.set(id, load);
      setTabs((prev) => [...prev, { id, path, dirty: false, title, sourceMode: plain, plain }]);
      setActiveId(id);
      return id;
    },
    []
  );

  /** ¿La pestaña está "prístina"? (sin archivo, sin cambios, vacía) */
  const isPristine = useCallback((tab: DocTab): boolean => {
    if (tab.path || tab.dirty || tab.plain) return false;
    const handle = editorHandles.current.get(tab.id);
    return !handle || !handle.getMarkdown().trim();
  }, []);

  const removeTab = useCallback((id: number) => {
    editorHandles.current.delete(id);
    savedMd.current.delete(id);
    emittedMd.current.delete(id);
    sourceTexts.current.delete(id);
    pendingLoads.current.delete(id);
    diskMtime.current.delete(id);
    tabEol.current.delete(id);
    cursorPos.current.delete(id);
    pendingCaret.current.delete(id);
    pendingScrollMd.current.delete(id);
    setTabs((prev) => {
      const idx = prev.findIndex((tab) => tab.id === id);
      const rest = prev.filter((tab) => tab.id !== id);
      if (rest.length === 0) {
        // Siempre queda al menos una pestaña.
        const freshId = nextTabId.current++;
        setActiveId(freshId);
        return [{ id: freshId, path: null, dirty: false, sourceMode: false, plain: false }];
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
      const rawDisk = await readDocument(path);
      const eol = detectEol(rawDisk);
      const raw = normalizeEol(rawDisk);
      setRecentFiles(await addRecentFile(path));
      setLastDir(dirname(path));
      const plain = !isMarkdownPath(path);
      const mtime = await getMtime(path);
      const rememberMtime = (id: number) => {
        if (mtime !== null) diskMtime.current.set(id, mtime);
        tabEol.current.set(id, eol);
      };

      const active = tabsRef.current.find((tab) => tab.id === activeIdRef.current);
      if (active && isPristine(active)) {
        rememberMtime(active.id);
        if (plain) {
          // La pestaña vacía se convierte en pestaña de texto plano.
          savedMd.current.set(active.id, raw);
          sourceTexts.current.set(active.id, raw);
          setSourceText(raw);
          updateCounts(raw);
          setHeadings([]);
          updateTab(active.id, { path, dirty: false, plain: true, sourceMode: true });
          return;
        }
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
      rememberMtime(createTab({ content: raw, baseline: null, plain }, path));
    },
    [createTab, isPristine, updateCounts, updateTab]
  );

  // ---------- cambios externos al archivo abierto ----------
  const reloadTabFromDisk = useCallback(
    async (id: number) => {
      const tab = tabsRef.current.find((tb) => tb.id === id);
      if (!tab?.path) return;
      const rawDisk = await readDocument(tab.path);
      tabEol.current.set(id, detectEol(rawDisk));
      const raw = normalizeEol(rawDisk);
      const m = await getMtime(tab.path);
      if (m !== null) diskMtime.current.set(id, m);
      if (tab.plain) {
        savedMd.current.set(id, raw);
        sourceTexts.current.set(id, raw);
        if (id === activeIdRef.current) {
          setSourceText(raw);
          updateCounts(raw);
        }
      } else {
        const handle = editorHandles.current.get(id);
        if (!handle) return;
        handle.setMarkdown(raw);
        const canonical = handle.getMarkdown();
        savedMd.current.set(id, canonical);
        sourceTexts.current.set(id, canonical);
        if (id === activeIdRef.current) {
          setSourceText(canonical);
          updateCounts(canonical);
          if (handle.editor) setHeadings(collectHeadings(handle.editor.state.doc));
        }
      }
      updateTab(id, { dirty: false });
    },
    [updateCounts, updateTab]
  );

  // ---------- menú contextual de pestañas ----------
  /** Recargar desde disco (menú contextual). Si hay cambios locales, confirma
   *  antes de descartarlos. */
  const handleReloadTab = useCallback(
    async (id: number) => {
      const tab = tabsRef.current.find((tb) => tb.id === id);
      if (!tab?.path) return;
      if (tab.dirty && !(await confirmDiscard())) return;
      await reloadTabFromDisk(id);
    },
    [reloadTabFromDisk]
  );

  const handleCloseOthers = useCallback(
    async (id: number) => {
      const others = tabsRef.current.filter((tb) => tb.id !== id).map((tb) => tb.id);
      for (const oid of others) await handleCloseTab(oid);
    },
    [handleCloseTab]
  );

  const handleCloseRight = useCallback(
    async (id: number) => {
      const list = tabsRef.current;
      const idx = list.findIndex((tb) => tb.id === id);
      if (idx < 0) return;
      const right = list.slice(idx + 1).map((tb) => tb.id);
      for (const rid of right) await handleCloseTab(rid);
    },
    [handleCloseTab]
  );

  /** Guarda una pestaña concreta en su ruta (sin diálogo: ya tiene archivo).
   *  Usado al desacoplar una pestaña sucia, para que la ventana nueva no lea
   *  del disco una versión vieja. Devuelve false si el usuario cancela ante un
   *  cambio externo. */
  const saveTabInPlace = useCallback(
    async (id: number): Promise<boolean> => {
      const tab = tabsRef.current.find((tb) => tb.id === id);
      if (!tab?.path) return false;
      // Si es la pestaña activa en modo fuente, vuelca el textarea al editor.
      if (id === activeIdRef.current) syncSourceToEditor();
      const md = tab.plain
        ? sourceTexts.current.get(id) ?? ''
        : editorHandles.current.get(id)?.getMarkdown() ?? '';
      const known = diskMtime.current.get(id);
      const current = await getMtime(tab.path);
      if (known !== undefined && current !== null && current > known) {
        if (!(await confirmOverwriteExternal(basename(tab.path)))) return false;
      }
      await writeDocument(tab.path, applyEol(md, eolFor(id)));
      const savedMtime = await getMtime(tab.path);
      if (savedMtime !== null) diskMtime.current.set(id, savedMtime);
      savedMd.current.set(id, md);
      updateTab(id, { dirty: false });
      return true;
    },
    [syncSourceToEditor, updateTab]
  );

  /** Desacoplar la pestaña a una ventana propia (mismo proceso). La ventana
   *  nueva lee el archivo del disco, así que primero se guarda si está sucia. */
  const handleDetachTab = useCallback(
    async (id: number) => {
      const tab = tabsRef.current.find((tb) => tb.id === id);
      if (!tab?.path) return; // sin archivo no hay nada que leer en la ventana nueva
      if (tab.dirty && !(await saveTabInPlace(id))) return;
      const path = tab.path;
      try {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const label = `doc-${Date.now()}`;
        const win = new WebviewWindow(label, {
          url: `index.html?detach=${encodeURIComponent(path)}`,
          title: basename(path),
          width: 1000,
          height: 760,
          minWidth: 640,
          minHeight: 480,
          decorations: false,
        });
        win.once('tauri://error', (e) =>
          console.error('No se pudo desacoplar la pestaña:', e)
        );
      } catch (err) {
        console.error('No se pudo desacoplar la pestaña:', err);
        return;
      }
      removeTab(id); // ya guardada/limpia: sin diálogo de descarte
    },
    [saveTabInPlace, removeTab]
  );

  const externalCheckBusy = useRef(false);

  /** ¿La pestaña tiene cambios sin guardar? No basta el flag `dirty`: viaja
   *  por el estado de React y puede ir un tick por detrás de las últimas
   *  pulsaciones, y una recarga silenciosa se las llevaría por delante. Se
   *  compara el contenido real contra el último guardado. */
  const hasUnsavedChanges = useCallback((tab: DocTab): boolean => {
    if (tab.dirty) return true;
    // En vista fuente lo que manda es el textarea: el editor todavía no ha
    // recibido lo tecleado (sólo se vuelca al guardar o al salir del modo).
    const current =
      tab.plain || tab.sourceMode
        ? sourceTexts.current.get(tab.id)
        : editorHandles.current.get(tab.id)?.getMarkdown();
    if (current === undefined) return false;
    return current !== (savedMd.current.get(tab.id) ?? '');
  }, []);

  /** Al recuperar el foco: ¿algún archivo abierto cambió en disco?
   *  Limpio → recarga silenciosa; con cambios locales → el usuario decide. */
  const checkExternalChanges = useCallback(async () => {
    if (externalCheckBusy.current) return;
    externalCheckBusy.current = true;
    try {
      for (const tab of tabsRef.current) {
        if (!tab.path) continue;
        const known = diskMtime.current.get(tab.id);
        if (known === undefined) continue;
        const m = await getMtime(tab.path);
        if (m === null || m <= known) continue;
        // Relee el estado: el await de arriba da tiempo a que la pestaña se
        // ensucie (o a que un guardado en curso le cambie la ruta).
        const fresh = tabsRef.current.find((tb) => tb.id === tab.id);
        if (!fresh?.path || fresh.path !== tab.path) continue;
        if (!hasUnsavedChanges(fresh)) {
          await reloadTabFromDisk(tab.id);
        } else if (await confirmReloadExternal(basename(tab.path))) {
          await reloadTabFromDisk(tab.id);
        } else {
          // Conservar la versión local: conflicto resuelto a favor del
          // usuario; el próximo guardado sobrescribe sin volver a preguntar.
          diskMtime.current.set(tab.id, m);
        }
      }
    } catch (err) {
      console.error('Chequeo de cambios externos falló:', err);
    } finally {
      externalCheckBusy.current = false;
    }
  }, [reloadTabFromDisk, hasUnsavedChanges]);

  useEffect(() => {
    if (!isTauri) return;
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) void checkExternalChanges();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [checkExternalChanges]);

  // ---------- instancia única: abrir archivo de un 2º lanzamiento ----------
  // El plugin single-instance (Rust) emite "open-file" a la ventana principal
  // cuando se abre un .md con la app ya corriendo, en vez de lanzar otra
  // instancia. loadDocument deduplica por ruta.
  useEffect(() => {
    if (!isTauri || detachPath) return;
    const unlisten = listen<string>('open-file', (event) => {
      const path = event.payload;
      if (path) void loadDocument(path);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [loadDocument]);

  const handleNew = useCallback(() => {
    createTab();
  }, [createTab]);

  /** Nuevo archivo desde el panel: se crea vacío en `dir` y se abre. Devuelve
   *  true si se creó (el panel cierra su input). */
  const handleCreateFile = useCallback(
    async (dir: string, name: string): Promise<boolean> => {
      try {
        const path = await createFile(dir, name);
        await loadDocument(path);
        setLastDir(dir);
        return true;
      } catch (err) {
        const { message } = await import('@tauri-apps/plugin-dialog');
        const reason =
          err instanceof Error && err.message === 'ya-existe'
            ? 'Ya existe un archivo con ese nombre.'
            : 'No se pudo crear el archivo (nombre inválido o sin permisos).';
        await message(reason, { title: 'iureditor', kind: 'warning' });
        return false;
      }
    },
    [loadDocument]
  );

  /** Nueva carpeta desde el menú contextual del panel. Devuelve true si se
   *  creó (el panel cierra su input y recarga). */
  const handleCreateFolder = useCallback(
    async (dir: string, name: string): Promise<boolean> => {
      try {
        await createFolder(dir, name);
        setLastDir(dir);
        return true;
      } catch (err) {
        const { message } = await import('@tauri-apps/plugin-dialog');
        const reason =
          err instanceof Error && err.message === 'ya-existe'
            ? 'Ya existe una carpeta con ese nombre.'
            : 'No se pudo crear la carpeta (nombre inválido o sin permisos).';
        await message(reason, { title: 'iureditor', kind: 'warning' });
        return false;
      }
    },
    []
  );

  /** "Subir un directorio" del panel: la carpeta de trabajo pasa a ser su
   *  carpeta padre (dentro de $HOME; readDir arriba de ahí falla por scope). */
  const handleGoUp = useCallback(() => {
    setWorkspace((current) => {
      if (!current) return current;
      const parent = dirname(current);
      if (!parent || parent === current) return current;
      setLastDir(parent);
      return parent;
    });
  }, []);

  /** Doble clic en una carpeta del panel: pasa a ser la carpeta de trabajo. */
  const handleEnterDir = useCallback((dir: string) => {
    setWorkspace(dir);
    setLastDir(dir);
  }, []);

  /** El panel informa qué carpeta está activa: pasa a ser el destino por
   *  defecto de los archivos nuevos. */
  const handleSelectDir = useCallback((dir: string) => setLastDir(dir), []);

  // ---------- plantillas ----------
  const refreshTemplates = useCallback(() => {
    void listTemplates().then(setTemplates);
  }, []);

  const handleNewFromTemplate = useCallback(
    async (name: string) => {
      try {
        const content = await readTemplate(name);
        // Pestaña sin título con la plantilla aplicada: baseline '' → nace
        // sucia, obligando a "Guardar como" (la plantilla no se toca).
        createTab({ content, baseline: '' });
      } catch (err) {
        console.error(`No se pudo cargar la plantilla «${name}»:`, err);
      }
    },
    [createTab]
  );

  const handleOpenTemplatesFolder = useCallback(() => {
    void openTemplatesFolder().catch((err) =>
      console.error('No se pudo abrir la carpeta de plantillas:', err)
    );
  }, []);

  const handleOpen = useCallback(async () => {
    const path = await pickOpenPath(defaultDir());
    if (path) await loadDocument(path);
  }, [loadDocument, defaultDir]);

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
  /** Sólo se avisa cuando el documento se reescribió por dentro: el usuario
   *  merece saber por qué su historial de deshacer empieza de cero. Si todo se
   *  resolvió copiando (el caso normal), no hay nada que contar. */
  const reportRelocation = useCallback(async (moved: ImageRelocation) => {
    const lineas = [
      moved.copied && `• ${moved.copied} copiada(s) a la carpeta nueva`,
      moved.renamed &&
        `• ${moved.renamed} guardada(s) con otro nombre (ya había un archivo distinto con el suyo)`,
      moved.relinked &&
        `• ${moved.relinked} reapuntada(s) a su ubicación original, por vivir fuera de la carpeta del documento`,
    ].filter(Boolean);
    const { message } = await import('@tauri-apps/plugin-dialog');
    await message(
      `El documento cambió de carpeta y se ajustaron sus imágenes:\n\n${lineas.join('\n')}\n\n` +
        'Como se reescribieron rutas dentro del documento, el historial de deshacer empieza de cero.',
      { title: 'iureditor — Imágenes del documento', kind: 'info' }
    );
  }, []);

  const doSave = useCallback(
    async (as: boolean): Promise<string | null> => {
      const id = activeIdRef.current;
      const tab = tabsRef.current.find((tb) => tb.id === id);
      let md: string;
      if (tab?.plain) {
        // Texto plano: lo que está en la vista fuente, byte a byte.
        md = sourceTextRef.current;
      } else {
        syncSourceToEditor();
        const handle = editorHandles.current.get(id);
        if (!handle) return null;
        md = handle.getMarkdown();
      }
      let path = tab?.path ?? null;
      const savingInPlace = !as && !!path;
      if (as || !path) {
        // El diálogo arranca en la carpeta del documento (o, si es nuevo, en
        // la última usada) y conserva su nombre.
        const previousDir = path ? dirname(path) : null;
        path = await pickSavePath(
          path ? basename(path) : 'documento.md',
          !tab?.plain,
          defaultDir()
        );
        if (!path) return null;
        if (!tab?.plain && !isMarkdownPath(path)) {
          // El usuario eligió una extensión de texto (p. ej. `.txt`): el
          // archivo deja de ser markdown. Se guarda el fuente tal cual y la
          // pestaña pasa a modo texto plano (sin pipeline markdown).
          await writeDocument(path, applyEol(md, eolFor(id)));
          const savedMtime = await getMtime(path);
          if (savedMtime !== null) diskMtime.current.set(id, savedMtime);
          savedMd.current.set(id, md);
          sourceTexts.current.set(id, md);
          setSourceText(md);
          setHeadings([]);
          updateTab(id, { path, dirty: false, plain: true, sourceMode: true });
          setLastDir(dirname(path));
          setRecentFiles(await addRecentFile(path));
          scheduleDraftSave();
          return path;
        }
        if (!tab?.plain) {
          const newDir = dirname(path);
          // El orden importa: primero el documento pasa a vivir en la carpeta
          // nueva (allowDocumentDir fija el directorio base de las imágenes),
          // y sólo entonces se reubican y se re-renderizan; al revés, las
          // rutas reapuntadas se resolverían contra la carpeta vieja.
          await allowDocumentDir(path);
          // Mudar el documento de carpeta dejaría sus imágenes relativas
          // apuntando al vacío: se copian (o se reapuntan) antes de guardar.
          let moved: ImageRelocation | null = null;
          let rewritten = false;
          if (previousDir && previousDir !== newDir) {
            try {
              moved = await relocateImages(md, previousDir, newDir);
              rewritten = moved.markdown !== md;
              md = moved.markdown;
            } catch (err) {
              console.error('No se pudieron reubicar las imágenes:', err);
            }
          }
          // Las reapuntadas viven fuera de la carpeta nueva: sin permitir su
          // directorio, la webview las bloquea al dibujarlas.
          await allowImageDirs(md, newDir);
          if (moved && rewritten) {
            // Alguna referencia cambió: el editor todavía tiene la ruta vieja,
            // así que se le devuelve el markdown reescrito para que lo que se
            // ve y lo que va al disco sean lo mismo. Cuesta el historial de
            // deshacer, pero sólo en este caso.
            const handle = editorHandles.current.get(id);
            if (handle) {
              handle.setMarkdown(md);
              md = handle.getMarkdown(); // canónico: evita un «sucio» espurio
            }
            void reportRelocation(moved);
          }
        }
      }
      // Cinturón: si el archivo cambió en disco desde que se cargó, avisar
      // antes de sobrescribir los cambios externos.
      if (savingInPlace) {
        const known = diskMtime.current.get(id);
        const current = await getMtime(path);
        if (known !== undefined && current !== null && current > known) {
          if (!(await confirmOverwriteExternal(basename(path)))) return null;
        }
      }
      await writeDocument(path, applyEol(md, eolFor(id)));
      const savedMtime = await getMtime(path);
      if (savedMtime !== null) diskMtime.current.set(id, savedMtime);
      savedMd.current.set(id, md);
      // En modo fuente, el textarea pasa a mostrar el markdown canónico guardado.
      if (tab?.sourceMode) {
        setSourceText(md);
        sourceTexts.current.set(id, md);
      }
      updateTab(id, { path, dirty: false });
      setLastDir(dirname(path));
      setRecentFiles(await addRecentFile(path));
      // Guardado exitoso: re-generar borradores (sólo pestañas aún sucias).
      scheduleDraftSave();
      // Si el archivo está vinculado a un documento de Iurefficient, sube la versión.
      void syncAfterSave(path);
      return path;
    },
    [syncSourceToEditor, updateTab, scheduleDraftSave, defaultDir, reportRelocation]
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

  // ---------- imagen pegada desde el portapapeles del sistema ----------
  // Respaldo para Linux/WebKitGTK, donde el evento `paste` del DOM no entrega
  // los bytes de una captura. Devuelve un File PNG o null si no hay imagen.
  const readClipboardImageFile = useCallback(async (): Promise<File | null> => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const b64 = await invoke<string | null>('read_clipboard_image');
      if (!b64) return null;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      // Nombre `image.png` → saveImageToAssets genera `img-<timestamp>.png`.
      return new File([bytes], 'image.png', { type: 'image/png' });
    } catch (err) {
      console.error('No se pudo leer la imagen del portapapeles:', err);
      return null;
    }
  }, []);

  // ---------- imagen vía diálogo nativo (botón Examinar del modal) ----------
  const handleBrowseImage = useCallback(async (): Promise<string | null> => {
    const imgPath = await pickImagePath(defaultDir());
    if (!imgPath) return null;
    const bytes = await readFile(imgPath);
    const ext = imgPath.split('.').pop()!.toLowerCase();
    const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    const file = new File([new Uint8Array(bytes)], basename(imgPath), { type: mime });
    // Copia a assets/ junto al documento (pide guardar primero si es nuevo)
    return handleInsertImageFile(file);
  }, [handleInsertImageFile, defaultDir]);

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

  /** Los exports operan sobre el documento markdown; en texto plano avisa. */
  const guardPlainExport = useCallback((): boolean => {
    const tab = tabsRef.current.find((tb) => tb.id === activeIdRef.current);
    if (!tab?.plain) return true;
    void import('@tauri-apps/plugin-dialog').then(({ message }) =>
      message('La exportación está disponible para documentos Markdown.', {
        title: 'iureditor',
        kind: 'info',
      })
    );
    return false;
  }, []);

  const handleExportPdf = useCallback(() => {
    if (!guardPlainExport()) return;
    syncSourceToEditor();
    const handle = activeHandle();
    const editor = handle?.editor;
    if (!editor) return;
    exportToPdf(editor, activePath(), handle?.getFrontMatter() ?? '').catch((err) =>
      reportExportError('PDF', err)
    );
  }, [reportExportError, syncSourceToEditor, activeHandle, activePath, guardPlainExport]);

  const handleExportDocx = useCallback(() => {
    if (!guardPlainExport()) return;
    syncSourceToEditor();
    const editor = activeHandle()?.editor;
    if (!editor) return;
    // Import perezoso: docx pesa ~370KB y sólo se usa al exportar.
    import('./lib/exportDocx')
      .then(({ exportToDocx }) => exportToDocx(editor, activePath(), defaultDir()))
      .catch((err) => reportExportError('DOCX', err));
  }, [reportExportError, syncSourceToEditor, activeHandle, activePath, guardPlainExport, defaultDir]);

  const handleExportHtml = useCallback(() => {
    if (!guardPlainExport()) return;
    syncSourceToEditor();
    const editor = activeHandle()?.editor;
    if (!editor) return;
    import('./lib/exportHtmlFile')
      .then(({ exportToHtmlFile }) => exportToHtmlFile(editor, activePath(), defaultDir()))
      .catch((err) => reportExportError('HTML', err));
  }, [reportExportError, syncSourceToEditor, activeHandle, activePath, guardPlainExport, defaultDir]);

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

  // ---------- ayuda integrada ----------
  const handleOpenHelp = useCallback(() => {
    // Si la ayuda ya está abierta, sólo activa su pestaña.
    const existing = tabsRef.current.find((tb) => tb.title === HELP_TITLE);
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    // Pestaña en memoria (sin ruta): baseline null → nace limpia. Al guardar
    // pedirá ubicación, así no se sobrescribe nada.
    createTab({ content: HELP_MARKDOWN, baseline: null }, null, HELP_TITLE);
  }, [createTab]);

  // ---------- preferencias de vista ----------
  useEffect(() => {
    initTheme();
  }, []);

  const handleThemeChange = useCallback((next: Theme) => {
    setTheme(next);
    setThemeState(next);
  }, []);

  const handleLineNumbersChange = useCallback((enabled: boolean) => {
    setLineNumbers(enabled);
    setLineNumbersState(enabled);
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

  const handlePageWidthChange = useCallback((next: PageWidth) => {
    setPageWidth(next);
    setPageWidthState(next);
  }, []);

  const handleCyclePageWidth = useCallback(() => {
    const order: PageWidth[] = ['medium', 'wide', 'full'];
    const next = order[(order.indexOf(getPageWidth()) + 1) % order.length];
    handlePageWidthChange(next);
  }, [handlePageWidthChange]);

  const handleFind = useCallback(() => {
    // Cada vista busca a su manera: el editor WYSIWYG con decoraciones de
    // ProseMirror, la vista fuente sobre el texto del textarea.
    const tab = tabsRef.current.find((tb) => tb.id === activeIdRef.current);
    if (tab?.sourceMode) sourceViewRef.current?.openSearch();
    else activeHandle()?.openSearch();
  }, [activeHandle]);

  /** Abre un resultado de la búsqueda en archivos: carga el documento, lo
   *  pasa a vista fuente (la línea es un concepto del texto) y salta a ella. */
  const handleOpenSearchResult = useCallback(
    async (path: string, line: number) => {
      try {
        await loadDocument(path);
      } catch (err) {
        console.error('No se pudo abrir el resultado:', err);
        return;
      }
      const tab = tabsRef.current.find((tb) => tb.path === path);
      if (!tab) return;
      if (!tab.plain && !tab.sourceMode) {
        const handle = editorHandles.current.get(tab.id);
        // Pestaña recién creada: el contenido lo pone la carga pendiente.
        if (handle && !pendingLoads.current.has(tab.id)) {
          const md = handle.getMarkdown();
          setSourceText(md);
          sourceTexts.current.set(tab.id, md);
        }
        updateTab(tab.id, { sourceMode: true });
      }
      // La vista fuente (y su contenido, si la pestaña es nueva) se montan en
      // los renders siguientes.
      setTimeout(() => sourceViewRef.current?.goToLine(line), 150);
    },
    [loadDocument, updateTab]
  );

  const handleGoToLine = useCallback(() => {
    // "Ir a línea" es un concepto de la vista fuente: si la pestaña está en
    // modo visual, primero se cambia a fuente y luego se abre la barrita.
    const tab = tabsRef.current.find((tb) => tb.id === activeIdRef.current);
    if (!tab) return;
    if (tab.sourceMode || tab.plain) {
      sourceViewRef.current?.openGoToLine();
    } else {
      handleToggleSource();
      // La vista fuente se monta en el siguiente render.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => sourceViewRef.current?.openGoToLine())
      );
    }
  }, [handleToggleSource]);

  const cycleTab = useCallback((delta: number) => {
    const list = tabsRef.current;
    if (list.length < 2) return;
    const idx = list.findIndex((tab) => tab.id === activeIdRef.current);
    const next = list[(idx + delta + list.length) % list.length];
    setActiveId(next.id);
  }, []);

  const reorderTabs = useCallback((from: number, to: number) => {
    setTabs((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const moveActiveTab = useCallback(
    (delta: number) => {
      const list = tabsRef.current;
      const idx = list.findIndex((tab) => tab.id === activeIdRef.current);
      const to = idx + delta;
      if (idx < 0 || to < 0 || to >= list.length) return;
      reorderTabs(idx, to);
    },
    [reorderTabs]
  );

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
      if (e.shiftKey && (key === 'pageup' || key === 'pagedown')) {
        e.preventDefault();
        moveActiveTab(key === 'pageup' ? -1 : 1);
        return;
      }
      // Guardar: Ctrl+S (Save) y su equivalente en español Ctrl+G (Guardar).
      if (key === 's' || key === 'g') {
        e.preventDefault();
        if (e.shiftKey) handleSaveAs();
        else handleSave();
      } else if (key === 'a' && e.shiftKey) {
        // Ctrl+Shift+A: ciclar el ancho de página (Ancho). Ctrl+A sin Shift
        // queda para "seleccionar todo".
        e.preventDefault();
        handleCyclePageWidth();
      } else if (key === 'o' && e.shiftKey) {
        e.preventDefault();
        handleSidebarView('outline');
      } else if (key === 'e' && e.shiftKey) {
        e.preventDefault();
        handleSidebarView('files');
      } else if (key === 'f' && e.shiftKey) {
        e.preventDefault();
        handleSidebarView('search');
      } else if (key === 'i' && e.shiftKey) {
        e.preventDefault();
        handleSidebarView('iurefficient');
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
      } else if (key === 'l' && !e.shiftKey) {
        e.preventDefault();
        handleGoToLine();
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
    handleGoToLine,
    handleZoomIn,
    handleZoomOut,
    handleZoomReset,
    handleSidebarView,
    handleToggleSource,
    handleCyclePageWidth,
    cycleTab,
    moveActiveTab,
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

  // ---------- arranque: sesión, borradores, recientes y CLI ----------
  const sessionReady = useRef(false);
  // Guarda síncrona: en dev, React.StrictMode monta el componente dos veces
  // (setup → cleanup → setup) y este efecto de restauración no es idempotente
  // (crea pestañas). Sin la guarda, cada archivo de la sesión se abría por
  // duplicado. También protege ante cualquier remontaje (HMR).
  const initStarted = useRef(false);

  useEffect(() => {
    if (!isTauri) return;
    if (initStarted.current) return;
    initStarted.current = true;
    void getRecentFiles().then(setRecentFiles);
    void ensureStarterTemplates().then(() => listTemplates().then(setTemplates));
    void (async () => {
      try {
        // 0) Ventana desacoplada: sólo su documento, sin sesión ni borradores.
        if (detachPath) {
          try {
            await loadDocument(detachPath);
          } catch (err) {
            console.error('No se pudo abrir el documento desacoplado:', err);
          }
          return;
        }
        // 1) ¿Quedaron borradores de una sesión que terminó mal?
        const drafts = await loadDrafts();
        let recovered = false;
        if (drafts.length) {
          const names = drafts.map((d) => (d.path ? basename(d.path) : t('app.untitled')));
          const newest = Math.max(...drafts.map((d) => d.savedAt || 0));
          recovered = await confirmRecoverDrafts(names, newest);
          if (!recovered) await clearDrafts();
        }
        const draftByPath = new Map(
          recovered ? drafts.filter((d) => d.path).map((d) => [d.path!, d] as const) : []
        );

        // 2) Pestañas de la sesión anterior (en su orden), aplicando encima
        //    el borrador si lo hay para esa ruta.
        const session = await loadSession();
        if (session?.workspace) setWorkspace(session.workspace);
        // El directorio por defecto sobrevive al reinicio: sin esto, la app
        // arrancaba apuntando al home hasta abrir o guardar algo.
        const restoredDir = session?.lastDir ?? session?.workspace ?? null;
        if (restoredDir) setLastDir(restoredDir);
        const openedByPath = new Map<string, number>();
        for (const path of session?.paths ?? []) {
          if (openedByPath.has(path)) continue;
          try {
            const rawDisk = await readDocument(path);
            const raw = normalizeEol(rawDisk);
            const plain = !isMarkdownPath(path);
            const draft = draftByPath.get(path);
            const cursor = session?.cursors?.[path];
            const id = createTab(
              draft
                ? { content: draft.markdown, baseline: raw, plain, cursor }
                : { content: raw, baseline: null, plain, cursor },
              path
            );
            tabEol.current.set(id, detectEol(rawDisk));
            const m = await getMtime(path);
            if (m !== null) diskMtime.current.set(id, m);
            openedByPath.set(path, id);
          } catch {
            // El archivo ya no existe: la pestaña no se restaura.
          }
        }

        // 3) Borradores fuera de la sesión (sin título, o ruta desaparecida).
        if (recovered) {
          for (const draft of drafts) {
            if (draft.path && openedByPath.has(draft.path)) continue;
            let baseline = '';
            let baselineEol: Eol = 'lf';
            if (draft.path) {
              try {
                const rawDisk = await readDocument(draft.path);
                baselineEol = detectEol(rawDisk);
                baseline = normalizeEol(rawDisk);
              } catch {
                baseline = '';
              }
            }
            const plain = draft.path ? !isMarkdownPath(draft.path) : false;
            const id = createTab({ content: draft.markdown, baseline, plain }, draft.path);
            tabEol.current.set(id, baselineEol);
            if (draft.path) {
              const m = await getMtime(draft.path);
              if (m !== null) diskMtime.current.set(id, m);
              openedByPath.set(draft.path, id);
            }
          }
        }

        // 4) La pestaña vacía inicial sobra si se restauró algo.
        if (openedByPath.size > 0 || (recovered && drafts.length)) {
          setTabs((prev) => (prev.length > 1 ? prev.filter((tb) => tb.id !== 0) : prev));
          const activeRestored = session?.activePath
            ? openedByPath.get(session.activePath)
            : undefined;
          if (activeRestored !== undefined) setActiveId(activeRestored);
        }

        // 5) Archivo pasado por línea de comandos (dedupe vía loadDocument).
        const { invoke } = await import('@tauri-apps/api/core');
        const cliFile = await invoke<string | null>('get_cli_file');
        if (cliFile) await loadDocument(cliFile);
      } finally {
        sessionReady.current = true;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- chequeo de actualizaciones (silencioso, tras el arranque) ----------
  useEffect(() => {
    if (!isTauri) return;
    const timer = setTimeout(() => void checkForUpdates(true), 6000);
    return () => clearTimeout(timer);
  }, []);

  // ---------- persistencia de la sesión de pestañas ----------
  useEffect(() => {
    // La ventana desacoplada no persiste sesión (store compartido: pisaría la
    // de la ventana principal).
    if (!isTauri || detachPath || !sessionReady.current) return;
    const timer = setTimeout(() => {
      // Dedup por si el árbol de pestañas llegara a tener la misma ruta abierta
      // más de una vez: la sesión guardada nunca debe multiplicar archivos.
      const paths = [...new Set(tabs.filter((tb) => tb.path).map((tb) => tb.path!))];
      const activePath = tabs.find((tb) => tb.id === activeId)?.path ?? null;
      void saveSession({ paths, activePath, workspace, lastDir, cursors: collectCursors() });
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, activeId, workspace, lastDir]);

  /** Cursor por ruta de las pestañas abiertas (para session.json). */
  const collectCursors = (): Record<string, number> => {
    const cursors: Record<string, number> = {};
    for (const tb of tabsRef.current) {
      if (!tb.path) continue;
      const pos = cursorPos.current.get(tb.id);
      if (pos !== undefined) cursors[tb.path] = pos;
    }
    return cursors;
  };

  // ---------- guard al cerrar ----------
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      // Sesión final con la posición del cursor al día (el guardado por
      // efecto sólo corre cuando cambian pestañas, no al mover el cursor).
      if (!detachPath && sessionReady.current) {
        const list = tabsRef.current;
        await saveSession({
          paths: [...new Set(list.filter((tb) => tb.path).map((tb) => tb.path!))],
          activePath: list.find((tb) => tb.id === activeIdRef.current)?.path ?? null,
          workspace: workspaceRef.current,
          lastDir: lastDirRef.current,
          cursors: collectCursors(),
        });
      }
      const dirtyTabs = tabsRef.current.filter((tab) => tab.dirty);
      if (dirtyTabs.length === 0) return;
      if (await confirmDiscard()) {
        // Cierre con descarte explícito: sin borradores huérfanos. La ventana
        // desacoplada no gestiona borradores (son de la principal).
        if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
        if (!detachPath) await clearDrafts();
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
        if (isTextPath(p)) {
          try {
            await loadDocument(p);
          } catch (err) {
            console.error('No se pudo abrir como texto:', err);
          }
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
          sidebarVisible={sidebar.visible}
          onToggleSidebar={handleToggleSidebar}
          tabs={tabs}
          activeTabId={activeId}
          onSelectTab={setActiveId}
          onCloseTab={(id) => void handleCloseTab(id)}
          onReloadTab={(id) => void handleReloadTab(id)}
          onCloseOthers={(id) => void handleCloseOthers(id)}
          onCloseRight={(id) => void handleCloseRight(id)}
          onDetachTab={(id) => void handleDetachTab(id)}
          onReorderTab={reorderTabs}
          recentFiles={recentFiles}
          templates={templates}
          actions={{
            onNew: handleNew,
            onNewFromTemplate: (name) => void handleNewFromTemplate(name),
            onOpenTemplatesFolder: handleOpenTemplatesFolder,
            onTemplatesRefresh: refreshTemplates,
            onOpen: () => void handleOpen(),
            onOpenFolder: () => void handlePickWorkspace(),
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
            onGoToLine: handleGoToLine,
            onZoomIn: handleZoomIn,
            onZoomOut: handleZoomOut,
            onZoomReset: handleZoomReset,
            onCheckUpdates: () => void checkForUpdates(false),
            onOpenHelp: handleOpenHelp,
          }}
          viewPrefs={{
            theme,
            onThemeChange: handleThemeChange,
            spellcheck,
            onSpellcheckChange: handleSpellcheckChange,
            lineNumbers,
            onLineNumbersChange: handleLineNumbersChange,
            outline: sidebar.visible && sidebar.view === 'outline',
            onOutlineToggle: () => handleSidebarView('outline'),
            files: sidebar.visible && sidebar.view === 'files',
            onFilesToggle: () => handleSidebarView('files'),
            search: sidebar.visible && sidebar.view === 'search',
            onSearchToggle: () => handleSidebarView('search'),
            iurefficient: sidebar.visible && sidebar.view === 'iurefficient',
            onIurefficientToggle: () => handleSidebarView('iurefficient'),
            sourceMode,
            onSourceModeToggle: handleToggleSource,
            pageWidth,
            onPageWidthChange: handlePageWidthChange,
          }}
        />
      )}
      <div className="flex-1 min-h-0 flex">
        {sidebar.visible && (
          <Sidebar
            view={sidebar.view}
            onViewChange={(view) => applySidebar((prev) => ({ ...prev, view }))}
            sourceMode={sourceMode}
            headings={headings}
            outlinePos={outlinePos}
            onSelectHeading={handleOutlineSelect}
            workspace={workspace}
            activePath={activeTab?.path ?? null}
            onOpenFile={(path) =>
              void loadDocument(path).catch((err) =>
                console.error('No se pudo abrir desde el panel:', err)
              )
            }
            onPickFolder={() => void handlePickWorkspace()}
            onOpenSearchResult={(path, line) => void handleOpenSearchResult(path, line)}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onSelectDir={handleSelectDir}
            onGoUp={handleGoUp}
            onEnterDir={handleEnterDir}
            activeDirty={!!activeTab?.dirty}
            onSaveActive={() => doSave(false)}
          />
        )}
        <div className="flex-1 min-w-0 flex flex-col" style={{ zoom }} data-page-width={pageWidth}>
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
                onCursorChange={({ line, pos }) => {
                  cursorPos.current.set(tab.id, pos);
                  if (tab.id !== activeIdRef.current) return;
                  setCursorLine(line);
                  setOutlinePos(pos);
                }}
                onScrollHeading={(pos) => {
                  if (tab.id === activeIdRef.current) setOutlinePos(pos);
                }}
                onInsertImageFile={handleInsertImageFile}
                onBrowseImage={handleBrowseImage}
                onReadClipboardImage={readClipboardImageFile}
              />
            </div>
          ))}
          {sourceMode && (
            <SourceView
              ref={sourceViewRef}
              value={sourceText}
              onChange={handleSourceChange}
              onCursorLine={(line, offset) => {
                setCursorLine(line);
                // Sólo pestañas plain: en modo fuente de un markdown el
                // offset del textarea no es una posición de ProseMirror.
                const tab = tabsRef.current.find((tb) => tb.id === activeIdRef.current);
                if (tab?.plain && offset !== undefined) {
                  cursorPos.current.set(tab.id, offset);
                }
              }}
              spellcheck={spellcheck}
              language={languageForPath(activeTab?.path ?? null)}
              lineNumbers={lineNumbers}
            />
          )}
        </div>
      </div>
      <StatusBar
        line={cursorLine}
        words={counts.words}
        chars={counts.chars}
        dirty={activeTab?.dirty ?? false}
        hasFile={!!activeTab?.path}
        zoom={zoom}
      />
    </div>
  );
}
