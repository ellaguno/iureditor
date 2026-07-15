import { useCallback, useEffect, useRef, useState } from 'react';
import { readDir } from '@tauri-apps/plugin-fs';
import { ChevronRight, ChevronDown, FileText, FolderOpen, FolderSearch } from 'lucide-react';
import { basename, isMarkdownPath, isTextPath } from '../lib/fileio';
import { t } from '../lib/i18n';

// Árbol de archivos de la carpeta de trabajo (estilo Obsidian/Zettlr).
// Carga perezosa por carpeta (readDir al expandir) y refresco de las
// carpetas expandidas al recuperar el foco de la ventana.

interface Entry {
  name: string;
  path: string;
  isDir: boolean;
}

const isEditableFile = (name: string): boolean =>
  isMarkdownPath(name) || (isTextPath(name) && name.includes('.'));

const listDir = async (dir: string): Promise<Entry[]> => {
  const entries = await readDir(dir);
  return entries
    .filter((e) => {
      if (e.isDirectory) return !e.name.startsWith('.'); // sin .git etc.
      return e.isFile && isEditableFile(e.name);
    })
    .map((e) => ({
      name: e.name,
      path: `${dir}/${e.name}`,
      isDir: !!e.isDirectory,
    }))
    .sort((a, b) =>
      a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name, 'es')
    );
};

export const FilesPanel = ({
  root,
  activePath,
  onOpenFile,
  onPickFolder,
}: {
  root: string | null;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onPickFolder: () => void;
}) => {
  const [dirs, setDirs] = useState<Map<string, Entry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const rootRef = useRef(root);
  rootRef.current = root;

  const loadDir = useCallback(async (dir: string) => {
    try {
      const entries = await listDir(dir);
      setDirs((prev) => new Map(prev).set(dir, entries));
    } catch (err) {
      console.error(`No se pudo leer la carpeta ${dir}:`, err);
      setDirs((prev) => new Map(prev).set(dir, []));
    }
  }, []);

  // Cambio de carpeta raíz: árbol desde cero.
  useEffect(() => {
    setDirs(new Map());
    setExpanded(new Set());
    if (root) void loadDir(root);
  }, [root, loadDir]);

  // Refresco al recuperar el foco (igual criterio que los cambios externos).
  useEffect(() => {
    const onFocus = () => {
      const r = rootRef.current;
      if (!r) return;
      void loadDir(r);
      for (const dir of expandedRef.current) void loadDir(dir);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadDir]);

  const toggleDir = useCallback(
    (dir: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(dir)) {
          next.delete(dir);
        } else {
          next.add(dir);
          if (!dirs.has(dir)) void loadDir(dir);
        }
        return next;
      });
    },
    [dirs, loadDir]
  );

  if (!root) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-full px-4 text-center">
        <p className="text-xs text-gray-400 dark:text-gray-500">{t('files.empty')}</p>
        <button
          type="button"
          onClick={onPickFolder}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-1.5"
        >
          <FolderOpen className="w-4 h-4" />
          {t('files.open')}
        </button>
      </div>
    );
  }

  const renderDir = (dir: string, depth: number) => {
    const entries = dirs.get(dir);
    if (!entries) {
      return (
        <div
          key={`${dir}-loading`}
          style={{ paddingLeft: `${12 + depth * 14}px` }}
          className="py-1 text-xs italic text-gray-400 dark:text-gray-500"
        >
          …
        </div>
      );
    }
    if (entries.length === 0) {
      return (
        <div
          key={`${dir}-empty`}
          style={{ paddingLeft: `${12 + depth * 14}px` }}
          className="py-1 text-xs italic text-gray-400 dark:text-gray-500"
        >
          {t('files.emptyDir')}
        </div>
      );
    }
    return entries.map((entry) =>
      entry.isDir ? (
        <div key={entry.path}>
          <button
            type="button"
            onClick={() => toggleDir(entry.path)}
            title={entry.name}
            style={{ paddingLeft: `${12 + depth * 14}px` }}
            className="w-full pr-2 py-1 text-left text-sm truncate text-gray-700 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-gray-700/70 flex items-center gap-1"
          >
            {expanded.has(entry.path) ? (
              <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-60" />
            )}
            <span className="truncate font-medium">{entry.name}</span>
          </button>
          {expanded.has(entry.path) && renderDir(entry.path, depth + 1)}
        </div>
      ) : (
        <button
          key={entry.path}
          type="button"
          onClick={() => onOpenFile(entry.path)}
          title={entry.name}
          style={{ paddingLeft: `${12 + depth * 14 + 18}px` }}
          className={`w-full pr-2 py-1 text-left text-sm truncate flex items-center gap-1.5 ${
            entry.path === activePath
              ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-800 dark:text-primary-200'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-gray-700/70'
          }`}
        >
          <FileText className="w-3.5 h-3.5 shrink-0 opacity-60" />
          <span className="truncate">{entry.name}</span>
        </button>
      )
    );
  };

  return (
    <div className="h-full overflow-y-auto py-2">
      <div className="px-3 pb-1 flex items-center justify-between gap-2">
        <span
          className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 truncate"
          title={root}
        >
          {basename(root)}
        </span>
        <button
          type="button"
          title={t('files.change')}
          onClick={onPickFolder}
          className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
        >
          <FolderSearch className="w-3.5 h-3.5" />
        </button>
      </div>
      {renderDir(root, 0)}
    </div>
  );
};
