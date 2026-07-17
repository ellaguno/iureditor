import { useCallback, useEffect, useRef, useState } from 'react';
import { readDir } from '@tauri-apps/plugin-fs';
import {
  ChevronRight,
  ChevronDown,
  FileText,
  FolderOpen,
  FolderSearch,
  FilePlus,
  FolderPlus,
  ArrowUp,
  RefreshCw,
} from 'lucide-react';
import { basename, dirname, isMarkdownPath, isTextPath } from '../lib/fileio';
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

// Modo del input inline de creación: archivo o carpeta.
type CreateKind = 'file' | 'folder';

// Menú contextual (botón derecho): posición y carpeta destino.
interface ContextMenu {
  x: number;
  y: number;
  dir: string;
}

export const FilesPanel = ({
  root,
  activePath,
  onOpenFile,
  onPickFolder,
  onCreateFile,
  onCreateFolder,
  onSelectDir,
  onGoUp,
  onEnterDir,
}: {
  root: string | null;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onPickFolder: () => void;
  onCreateFile: (dir: string, name: string) => Promise<boolean>;
  onCreateFolder: (dir: string, name: string) => Promise<boolean>;
  onSelectDir: (dir: string) => void;
  onGoUp: () => void;
  /** Doble clic en una carpeta: pasa a ser la carpeta de trabajo (raíz). */
  onEnterDir: (dir: string) => void;
}) => {
  const [dirs, setDirs] = useState<Map<string, Entry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Carpeta destino de un archivo nuevo (resaltada); null = raíz.
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  // Input de creación abierto: carpeta destino y tipo (null = ninguno).
  const [creating, setCreating] = useState<{ dir: string; kind: CreateKind } | null>(null);
  const [newName, setNewName] = useState('');
  // Menú contextual del botón derecho (null = cerrado).
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  // Evita que el onBlur del input cancele mientras se está creando (el diálogo
  // nativo de error roba el foco).
  const submittingRef = useRef(false);
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
    setSelectedDir(null);
    setCreating(null);
    setMenu(null);
    if (root) void loadDir(root);
  }, [root, loadDir]);

  // Recarga la raíz y todas las carpetas expandidas (opción "Recargar" del
  // menú contextual, mismo criterio que el refresco al recuperar el foco).
  const reloadAll = useCallback(() => {
    const r = rootRef.current;
    if (!r) return;
    void loadDir(r);
    for (const dir of expandedRef.current) void loadDir(dir);
  }, [loadDir]);

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

  // Marca la carpeta como destino de archivos nuevos (y lo informa a la app).
  const selectDir = useCallback(
    (dir: string) => {
      setSelectedDir(dir);
      onSelectDir(dir);
    },
    [onSelectDir]
  );

  // Abre el input de creación (archivo o carpeta) en `dir`, expandiéndola.
  const startCreate = useCallback(
    (dir: string, kind: CreateKind = 'file') => {
      selectDir(dir);
      setNewName('');
      setCreating({ dir, kind });
      if (dir !== root && !expandedRef.current.has(dir)) {
        setExpanded((prev) => new Set(prev).add(dir));
        if (!dirs.has(dir)) void loadDir(dir);
      }
    },
    [selectDir, root, dirs, loadDir]
  );

  const cancelCreate = useCallback(() => {
    setCreating(null);
    setNewName('');
  }, []);

  const submitCreate = useCallback(async () => {
    const target = creating;
    const name = newName;
    if (!target || !name.trim()) {
      cancelCreate();
      return;
    }
    const ok =
      target.kind === 'folder'
        ? await onCreateFolder(target.dir, name)
        : await onCreateFile(target.dir, name);
    if (ok) {
      cancelCreate();
      void loadDir(target.dir);
    }
    // Si falla (nombre repetido), se deja el input abierto para corregir.
  }, [creating, newName, onCreateFile, onCreateFolder, cancelCreate, loadDir]);

  // Abre el menú contextual en (x,y) para la carpeta destino `dir`.
  const openMenu = useCallback((e: React.MouseEvent, dir: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, dir });
  }, []);

  // Cierra el menú al hacer clic fuera, con scroll, Escape o pérdida de foco.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

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

  // Input inline para nombrar el archivo/carpeta nuevo dentro de `dir`.
  const renderCreateInput = (dir: string, depth: number, kind: CreateKind) => (
    <div
      key={`${dir}-new`}
      style={{ paddingLeft: `${12 + depth * 14 + 18}px` }}
      className="pr-2 py-0.5 flex items-center gap-1.5"
    >
      {kind === 'folder' ? (
        <FolderPlus className="w-3.5 h-3.5 shrink-0 opacity-60" />
      ) : (
        <FilePlus className="w-3.5 h-3.5 shrink-0 opacity-60" />
      )}
      <input
        autoFocus
        value={newName}
        spellCheck={false}
        placeholder={t(kind === 'folder' ? 'files.newFolderPlaceholder' : 'files.newFilePlaceholder')}
        onChange={(e) => setNewName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submittingRef.current = true;
            void submitCreate().finally(() => {
              submittingRef.current = false;
            });
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelCreate();
          }
        }}
        onBlur={() => {
          if (!submittingRef.current) cancelCreate();
        }}
        className="flex-1 min-w-0 bg-white dark:bg-gray-900 border border-primary-400 dark:border-primary-500 rounded px-1 py-0.5 text-sm text-gray-800 dark:text-gray-100 focus:outline-none"
      />
    </div>
  );

  const renderDir = (dir: string, depth: number) => {
    const entries = dirs.get(dir);
    const input =
      creating?.dir === dir ? renderCreateInput(dir, depth, creating.kind) : null;
    if (!entries) {
      return (
        <>
          {input}
          <div
            key={`${dir}-loading`}
            style={{ paddingLeft: `${12 + depth * 14}px` }}
            className="py-1 text-xs italic text-gray-400 dark:text-gray-500"
          >
            …
          </div>
        </>
      );
    }
    if (entries.length === 0) {
      return (
        <>
          {input}
          {!input && (
            <div
              key={`${dir}-empty`}
              style={{ paddingLeft: `${12 + depth * 14}px` }}
              className="py-1 text-xs italic text-gray-400 dark:text-gray-500"
            >
              {t('files.emptyDir')}
            </div>
          )}
        </>
      );
    }
    return (
      <>
        {input}
        {entries.map((entry) =>
          entry.isDir ? (
            <div key={entry.path}>
              <div
                onContextMenu={(e) => openMenu(e, entry.path)}
                className={`group flex items-center ${
                  entry.path === selectedDir
                    ? 'bg-primary-50 dark:bg-primary-900/20'
                    : 'hover:bg-gray-200/70 dark:hover:bg-gray-700/70'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    toggleDir(entry.path);
                    selectDir(entry.path);
                  }}
                  onDoubleClick={() => onEnterDir(entry.path)}
                  title={entry.name}
                  style={{ paddingLeft: `${12 + depth * 14}px` }}
                  className="flex-1 min-w-0 pr-1 py-1 text-left text-sm truncate text-gray-700 dark:text-gray-300 flex items-center gap-1"
                >
                  {expanded.has(entry.path) ? (
                    <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-60" />
                  )}
                  <span className="truncate font-medium">{entry.name}</span>
                </button>
                <button
                  type="button"
                  title={t('files.newFile')}
                  onClick={() => startCreate(entry.path)}
                  className="shrink-0 w-6 h-6 mr-1 rounded flex items-center justify-center text-gray-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 hover:bg-gray-300/70 dark:hover:bg-gray-600/70"
                >
                  <FilePlus className="w-3.5 h-3.5" />
                </button>
              </div>
              {expanded.has(entry.path) && renderDir(entry.path, depth + 1)}
            </div>
          ) : (
            <button
              key={entry.path}
              type="button"
              onClick={() => onOpenFile(entry.path)}
              onContextMenu={(e) => openMenu(e, dirname(entry.path))}
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
        )}
      </>
    );
  };

  // Ítem del menú contextual.
  const menuItem = (
    icon: React.ReactNode,
    label: string,
    onClick: () => void
  ) => (
    <button
      type="button"
      onClick={() => {
        setMenu(null);
        onClick();
      }}
      className="w-full px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
    >
      <span className="opacity-70">{icon}</span>
      {label}
    </button>
  );

  return (
    <div
      className="h-full overflow-y-auto py-2"
      onContextMenu={(e) => openMenu(e, selectedDir ?? root)}
    >
      <div className="px-3 pb-1 flex items-center justify-between gap-2">
        <span
          className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 truncate"
          title={root}
        >
          {basename(root)}
        </span>
        <div className="shrink-0 flex items-center gap-0.5">
          <button
            type="button"
            title={t('files.newFile')}
            onClick={() => startCreate(selectedDir ?? root, 'file')}
            className="w-5 h-5 rounded flex items-center justify-center text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            <FilePlus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t('files.newFolder')}
            onClick={() => startCreate(selectedDir ?? root, 'folder')}
            className="w-5 h-5 rounded flex items-center justify-center text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t('files.goUp')}
            onClick={onGoUp}
            className="w-5 h-5 rounded flex items-center justify-center text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t('files.reload')}
            onClick={reloadAll}
            className="w-5 h-5 rounded flex items-center justify-center text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t('files.change')}
            onClick={onPickFolder}
            className="w-5 h-5 rounded flex items-center justify-center text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            <FolderSearch className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {renderDir(root, 0)}

      {menu && (
        <div
          role="menu"
          onContextMenu={(e) => e.preventDefault()}
          style={{
            left: Math.min(menu.x, window.innerWidth - 210),
            top: Math.min(menu.y, window.innerHeight - 160),
          }}
          className="fixed z-50 min-w-[190px] py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl"
        >
          {menuItem(<FilePlus className="w-4 h-4" />, t('files.newFile'), () =>
            startCreate(menu.dir, 'file')
          )}
          {menuItem(<FolderPlus className="w-4 h-4" />, t('files.newFolder'), () =>
            startCreate(menu.dir, 'folder')
          )}
          <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
          {menuItem(<ArrowUp className="w-4 h-4" />, t('files.goUp'), onGoUp)}
          {menuItem(<RefreshCw className="w-4 h-4" />, t('files.reload'), reloadAll)}
        </div>
      )}
    </div>
  );
};
