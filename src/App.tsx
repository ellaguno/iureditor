import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { readFile } from '@tauri-apps/plugin-fs';
import { Editor } from './components/Editor';
import type { EditorHandle } from './components/Editor';
import { buildAppMenu } from './lib/menu';
import {
  readDocument,
  writeDocument,
  pickOpenPath,
  pickSavePath,
  confirmDiscard,
  saveImageToAssets,
  allowDocumentDir,
  getRecentFiles,
  addRecentFile,
  basename,
} from './lib/fileio';
import { exportToPdf } from './lib/exportPdf';
import { t } from './lib/i18n';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export default function App() {
  const editorRef = useRef<EditorHandle>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);

  // Refs espejo para handlers estables (menú nativo, listeners de ventana).
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const savedMarkdownRef = useRef('');

  // ---------- título de ventana ----------
  useEffect(() => {
    if (!isTauri) return;
    const name = filePath ? basename(filePath) : t('app.untitled');
    void getCurrentWindow().setTitle(`${dirty ? '• ' : ''}${name} — iureditor`);
  }, [filePath, dirty]);

  // ---------- cambios del editor → dirty ----------
  const handleChange = useCallback((markdown: string) => {
    setDirty(markdown !== savedMarkdownRef.current);
  }, []);

  // ---------- abrir / nuevo ----------
  const loadDocument = useCallback(async (path: string) => {
    const raw = await readDocument(path);
    editorRef.current?.setMarkdown(raw);
    // Canónico: el markdown tal como lo re-emite el editor. Evita marcar
    // dirty por diferencias de normalización (espacios, separadores).
    savedMarkdownRef.current = editorRef.current?.getMarkdown() ?? raw;
    setFilePath(path);
    setDirty(false);
    setRecentFiles(await addRecentFile(path));
  }, []);

  const guardDirty = useCallback(async (): Promise<boolean> => {
    if (!dirtyRef.current) return true;
    return confirmDiscard();
  }, []);

  const handleNew = useCallback(async () => {
    if (!(await guardDirty())) return;
    editorRef.current?.setMarkdown('');
    savedMarkdownRef.current = editorRef.current?.getMarkdown() ?? '';
    setFilePath(null);
    setDirty(false);
  }, [guardDirty]);

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
    const md = editorRef.current?.getMarkdown() ?? '';
    let path = filePathRef.current;
    if (as || !path) {
      path = await pickSavePath(path ? basename(path) : 'documento.md');
      if (!path) return null;
      await allowDocumentDir(path);
    }
    await writeDocument(path, md);
    savedMarkdownRef.current = md;
    setFilePath(path);
    setDirty(false);
    setRecentFiles(await addRecentFile(path));
    return path;
  }, []);

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

  // ---------- exportar ----------
  const handleExportPdf = useCallback(() => {
    const editor = editorRef.current?.editor;
    if (editor) void exportToPdf(editor, filePathRef.current);
  }, []);

  const handleExportDocx = useCallback(() => {
    const editor = editorRef.current?.editor;
    if (!editor) return;
    // Import perezoso: turbodocx pesa ~1MB y sólo se usa al exportar.
    void import('./lib/exportDocx').then(({ exportToDocx }) =>
      exportToDocx(editor, filePathRef.current)
    );
  }, []);

  const handleQuit = useCallback(() => {
    // close() dispara onCloseRequested, donde vive el guard de dirty.
    void getCurrentWindow().close();
  }, []);

  // ---------- menú nativo ----------
  useEffect(() => {
    if (!isTauri) return;
    void buildAppMenu(
      {
        onNew: () => void handleNew(),
        onOpen: () => void handleOpen(),
        onOpenRecent: (path) => void handleOpenRecent(path),
        onSave: handleSave,
        onSaveAs: handleSaveAs,
        onExportPdf: handleExportPdf,
        onExportDocx: handleExportDocx,
        onQuit: handleQuit,
      },
      recentFiles
    );
  }, [
    recentFiles,
    handleNew,
    handleOpen,
    handleOpenRecent,
    handleSave,
    handleSaveAs,
    handleExportPdf,
    handleExportDocx,
    handleQuit,
  ]);

  // ---------- recientes iniciales ----------
  useEffect(() => {
    if (!isTauri) return;
    void getRecentFiles().then(setRecentFiles);
  }, []);

  // ---------- guard al cerrar ----------
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      if (dirtyRef.current && !(await confirmDiscard())) {
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
      <Editor ref={editorRef} onChange={handleChange} onInsertImageFile={handleInsertImageFile} />
    </div>
  );
}
