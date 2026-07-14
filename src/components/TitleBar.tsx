import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X, ChevronDown } from 'lucide-react';
import { basename } from '../lib/fileio';

// Barra de título propia estilo GNOME (headerbar): menús, título y botones
// de ventana en una sola barra. La ventana corre con decorations: false.

export interface TitleBarActions {
  onNew: () => void;
  onOpen: () => void;
  onOpenRecent: (path: string) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportPdf: () => void;
  onExportDocx: () => void;
  onQuit: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSelectAll: () => void;
}

const MenuItem = ({
  label,
  shortcut,
  onClick,
  disabled = false,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
}) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className="w-full px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-default flex items-center justify-between gap-6"
  >
    <span className="truncate">{label}</span>
    {shortcut && (
      <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">{shortcut}</span>
    )}
  </button>
);

const MenuSeparator = () => <div className="h-px bg-gray-200 dark:bg-gray-700 my-1" />;

const DropdownMenu = ({
  label,
  isOpen,
  onToggle,
  onClose,
  children,
}: {
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [isOpen, onClose]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={onToggle}
        className={`px-2.5 py-1 rounded text-sm flex items-center gap-0.5 ${
          isOpen
            ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-gray-700/70'
        }`}
      >
        {label}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 py-1 min-w-[230px]">
          {children}
        </div>
      )}
    </div>
  );
};

const WindowButton = ({
  onClick,
  title,
  danger = false,
  children,
}: {
  onClick: () => void;
  title: string;
  danger?: boolean;
  children: ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={`w-7 h-7 rounded-full flex items-center justify-center text-gray-600 dark:text-gray-300 ${
      danger
        ? 'hover:bg-red-500 hover:text-white'
        : 'hover:bg-gray-200 dark:hover:bg-gray-600'
    }`}
  >
    {children}
  </button>
);

export const TitleBar = ({
  actions,
  filePath,
  dirty,
  recentFiles,
}: {
  actions: TitleBarActions;
  filePath: string | null;
  dirty: boolean;
  recentFiles: string[];
}) => {
  const [openMenu, setOpenMenu] = useState<'file' | 'edit' | null>(null);

  const closeAnd = (fn: () => void) => () => {
    setOpenMenu(null);
    fn();
  };

  const appWindow = getCurrentWindow();
  const title = filePath ? basename(filePath) : 'Sin título';

  return (
    <div
      className="h-10 flex items-center bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700 select-none no-select shrink-0"
      data-tauri-drag-region
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) void appWindow.toggleMaximize();
      }}
    >
      {/* Menús */}
      <div className="flex items-center gap-0.5 px-2">
        <DropdownMenu
          label="Archivo"
          isOpen={openMenu === 'file'}
          onToggle={() => setOpenMenu(openMenu === 'file' ? null : 'file')}
          onClose={() => setOpenMenu(null)}
        >
          <MenuItem label="Nuevo" shortcut="Ctrl+N" onClick={closeAnd(actions.onNew)} />
          <MenuItem label="Abrir…" shortcut="Ctrl+O" onClick={closeAnd(actions.onOpen)} />
          {recentFiles.length > 0 && (
            <>
              <MenuSeparator />
              <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                Recientes
              </div>
              {recentFiles.slice(0, 5).map((path) => (
                <MenuItem
                  key={path}
                  label={basename(path)}
                  onClick={closeAnd(() => actions.onOpenRecent(path))}
                />
              ))}
            </>
          )}
          <MenuSeparator />
          <MenuItem label="Guardar" shortcut="Ctrl+S" onClick={closeAnd(actions.onSave)} />
          <MenuItem
            label="Guardar como…"
            shortcut="Ctrl+Shift+S"
            onClick={closeAnd(actions.onSaveAs)}
          />
          <MenuSeparator />
          <MenuItem
            label="Exportar a PDF…"
            shortcut="Ctrl+P"
            onClick={closeAnd(actions.onExportPdf)}
          />
          <MenuItem label="Exportar a DOCX…" onClick={closeAnd(actions.onExportDocx)} />
          <MenuSeparator />
          <MenuItem label="Salir" shortcut="Ctrl+Q" onClick={closeAnd(actions.onQuit)} />
        </DropdownMenu>

        <DropdownMenu
          label="Edición"
          isOpen={openMenu === 'edit'}
          onToggle={() => setOpenMenu(openMenu === 'edit' ? null : 'edit')}
          onClose={() => setOpenMenu(null)}
        >
          <MenuItem label="Deshacer" shortcut="Ctrl+Z" onClick={closeAnd(actions.onUndo)} />
          <MenuItem label="Rehacer" shortcut="Ctrl+Shift+Z" onClick={closeAnd(actions.onRedo)} />
          <MenuSeparator />
          <MenuItem
            label="Seleccionar todo"
            shortcut="Ctrl+A"
            onClick={closeAnd(actions.onSelectAll)}
          />
        </DropdownMenu>
      </div>

      {/* Título centrado (zona de arrastre) */}
      <div
        className="flex-1 h-full flex items-center justify-center text-sm font-medium text-gray-700 dark:text-gray-200 truncate px-2"
        data-tauri-drag-region
        onDoubleClick={() => void appWindow.toggleMaximize()}
      >
        <span className="truncate pointer-events-none">
          {dirty ? '• ' : ''}
          {title}
        </span>
      </div>

      {/* Botones de ventana */}
      <div className="flex items-center gap-1.5 px-2">
        <WindowButton title="Minimizar" onClick={() => void appWindow.minimize()}>
          <Minus className="w-3.5 h-3.5" />
        </WindowButton>
        <WindowButton title="Maximizar" onClick={() => void appWindow.toggleMaximize()}>
          <Square className="w-3 h-3" />
        </WindowButton>
        <WindowButton title="Cerrar" danger onClick={() => void appWindow.close()}>
          <X className="w-4 h-4" />
        </WindowButton>
      </div>
    </div>
  );
};
