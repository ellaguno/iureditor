import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  Minus,
  Square,
  X,
  Check,
  Menu as MenuIcon,
  ChevronRight,
  ChevronDown,
  Plus,
} from 'lucide-react';
import { basename } from '../lib/fileio';
import type { Theme } from '../lib/prefs';

const HELP_LINKS: { label: string; url: string }[] = [
  { label: 'Apps', url: 'https://iurefficient.com' },
  { label: 'Blog', url: 'https://blog.iurefficient.com' },
  { label: 'Videos Iurefficient', url: 'https://youtube.com/@iurefficient' },
  { label: 'Demo', url: 'https://demo.iurefficient.com' },
];

// Barra de título propia estilo GNOME (headerbar): botón hamburguesa con los
// menús (acordeón), pestañas de documentos abiertos y botones de ventana en
// una sola barra. La ventana corre con decorations: false.

export interface TitleBarActions {
  onNew: () => void;
  onOpen: () => void;
  onOpenRecent: (path: string) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportPdf: () => void;
  onExportDocx: () => void;
  onExportHtml: () => void;
  onQuit: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSelectAll: () => void;
  onInsertToc: () => void;
  onFind: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

export interface ViewPrefs {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  spellcheck: boolean;
  onSpellcheckChange: (enabled: boolean) => void;
  outline: boolean;
  onOutlineToggle: () => void;
  sourceMode: boolean;
  onSourceModeToggle: () => void;
}

export interface TabInfo {
  id: number;
  path: string | null;
  dirty: boolean;
}

const MenuItem = ({
  label,
  shortcut,
  onClick,
  disabled = false,
  checked,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  /** undefined = sin indicador; true/false = item tipo radio/checkbox */
  checked?: boolean;
}) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className="w-full px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-default flex items-center justify-between gap-6"
  >
    <span className="truncate flex items-center gap-2">
      {checked !== undefined && (
        <Check className={`w-3.5 h-3.5 shrink-0 ${checked ? '' : 'invisible'}`} />
      )}
      {label}
    </span>
    {shortcut && (
      <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">{shortcut}</span>
    )}
  </button>
);

const MenuSeparator = () => <div className="h-px bg-gray-200 dark:bg-gray-700 my-1" />;

type SectionId = 'file' | 'edit' | 'view' | 'help';

const MenuSection = ({
  label,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) => (
  <div>
    <button
      type="button"
      onClick={onToggle}
      className={`w-full px-3 py-1.5 text-left text-sm font-medium flex items-center justify-between ${
        expanded
          ? 'text-gray-900 dark:text-gray-100'
          : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`}
    >
      {label}
      {expanded ? (
        <ChevronDown className="w-3.5 h-3.5 opacity-60" />
      ) : (
        <ChevronRight className="w-3.5 h-3.5 opacity-60" />
      )}
    </button>
    {expanded && <div className="pb-1">{children}</div>}
  </div>
);

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

const Tab = ({
  title,
  dirty,
  active,
  onSelect,
  onClose,
}: {
  title: string;
  dirty: boolean;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) => (
  <div
    role="tab"
    aria-selected={active}
    onClick={onSelect}
    onAuxClick={(e) => {
      if (e.button === 1) onClose(); // clic central cierra, como en navegadores
    }}
    title={title}
    className={`group/tab h-7 max-w-[180px] min-w-0 shrink-0 px-2.5 rounded-md flex items-center gap-1.5 text-sm cursor-default select-none ${
      active
        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200/70 dark:hover:bg-gray-700/60'
    }`}
  >
    {dirty && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-primary-500" />}
    <span className="truncate">{title}</span>
    <button
      type="button"
      title="Cerrar pestaña"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      className={`shrink-0 w-4 h-4 rounded flex items-center justify-center hover:bg-gray-300 dark:hover:bg-gray-600 ${
        active ? '' : 'opacity-0 group-hover/tab:opacity-100'
      }`}
    >
      <X className="w-3 h-3" />
    </button>
  </div>
);

export const TitleBar = ({
  actions,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  recentFiles,
  viewPrefs,
}: {
  actions: TitleBarActions;
  tabs: TabInfo[];
  activeTabId: number;
  onSelectTab: (id: number) => void;
  onCloseTab: (id: number) => void;
  recentFiles: string[];
  viewPrefs: ViewPrefs;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [section, setSection] = useState<SectionId>('file');
  const [version, setVersion] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(''));
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [menuOpen]);

  const closeAnd = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

  const toggleSection = (id: SectionId) => () => setSection(id);

  const appWindow = getCurrentWindow();

  return (
    <div
      // data-tauri-drag-region ya incluye doble-clic → maximizar/restaurar;
      // no añadir onDoubleClick propio o el toggle se ejecuta dos veces.
      className="h-10 flex items-center bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700 select-none no-select shrink-0"
      data-tauri-drag-region
    >
      {/* Menú hamburguesa */}
      <div className="relative px-2 shrink-0" ref={menuRef}>
        <button
          type="button"
          title="Menú"
          onClick={() => setMenuOpen(!menuOpen)}
          className={`w-8 h-8 rounded-md flex items-center justify-center ${
            menuOpen
              ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-gray-700/70'
          }`}
        >
          <MenuIcon className="w-5 h-5" />
        </button>
        {menuOpen && (
          <div className="absolute top-full left-2 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 py-1 w-[270px] max-h-[80vh] overflow-y-auto">
            <MenuSection label="Archivo" expanded={section === 'file'} onToggle={toggleSection('file')}>
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
              <MenuItem label="Exportar a HTML…" onClick={closeAnd(actions.onExportHtml)} />
              <MenuSeparator />
              <MenuItem label="Salir" shortcut="Ctrl+Q" onClick={closeAnd(actions.onQuit)} />
            </MenuSection>

            <MenuSeparator />

            <MenuSection label="Edición" expanded={section === 'edit'} onToggle={toggleSection('edit')}>
              <MenuItem label="Deshacer" shortcut="Ctrl+Z" onClick={closeAnd(actions.onUndo)} />
              <MenuItem label="Rehacer" shortcut="Ctrl+Shift+Z" onClick={closeAnd(actions.onRedo)} />
              <MenuSeparator />
              <MenuItem
                label="Buscar y reemplazar…"
                shortcut="Ctrl+F"
                onClick={closeAnd(actions.onFind)}
              />
              <MenuSeparator />
              <MenuItem label="Insertar índice" onClick={closeAnd(actions.onInsertToc)} />
              <MenuSeparator />
              <MenuItem
                label="Seleccionar todo"
                shortcut="Ctrl+A"
                onClick={closeAnd(actions.onSelectAll)}
              />
            </MenuSection>

            <MenuSeparator />

            <MenuSection label="Ver" expanded={section === 'view'} onToggle={toggleSection('view')}>
              <MenuItem
                label="Esquema del documento"
                shortcut="Ctrl+Shift+O"
                checked={viewPrefs.outline}
                onClick={viewPrefs.onOutlineToggle}
              />
              <MenuItem
                label="Código fuente"
                shortcut="Ctrl+Shift+M"
                checked={viewPrefs.sourceMode}
                onClick={viewPrefs.onSourceModeToggle}
              />
              <MenuSeparator />
              <MenuItem label="Aumentar zoom" shortcut="Ctrl++" onClick={actions.onZoomIn} />
              <MenuItem label="Reducir zoom" shortcut="Ctrl+-" onClick={actions.onZoomOut} />
              <MenuItem label="Zoom normal" shortcut="Ctrl+0" onClick={actions.onZoomReset} />
              <MenuSeparator />
              <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                Tema
              </div>
              <MenuItem
                label="Claro"
                checked={viewPrefs.theme === 'light'}
                onClick={() => viewPrefs.onThemeChange('light')}
              />
              <MenuItem
                label="Oscuro"
                checked={viewPrefs.theme === 'dark'}
                onClick={() => viewPrefs.onThemeChange('dark')}
              />
              <MenuItem
                label="Sistema"
                checked={viewPrefs.theme === 'system'}
                onClick={() => viewPrefs.onThemeChange('system')}
              />
              <MenuSeparator />
              <MenuItem
                label="Corrector ortográfico"
                checked={viewPrefs.spellcheck}
                onClick={() => viewPrefs.onSpellcheckChange(!viewPrefs.spellcheck)}
              />
            </MenuSection>

            <MenuSeparator />

            <MenuSection label="Ayuda" expanded={section === 'help'} onToggle={toggleSection('help')}>
              {HELP_LINKS.map(({ label, url }) => (
                <MenuItem key={url} label={label} onClick={closeAnd(() => void openUrl(url))} />
              ))}
              {version && (
                <>
                  <MenuSeparator />
                  <div className="px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500 select-none">
                    Versión {version}
                  </div>
                </>
              )}
            </MenuSection>
          </div>
        )}
      </div>

      {/* Pestañas de documentos */}
      <div className="flex-1 min-w-0 h-full flex items-center">
        <div className="flex items-center gap-1 overflow-x-auto max-w-full py-1 scrollbar-thin">
          {tabs.map((tab) => (
            <Tab
              key={tab.id}
              title={tab.path ? basename(tab.path) : 'Sin título'}
              dirty={tab.dirty}
              active={tab.id === activeTabId}
              onSelect={() => onSelectTab(tab.id)}
              onClose={() => onCloseTab(tab.id)}
            />
          ))}
          <button
            type="button"
            title="Nueva pestaña (Ctrl+N)"
            onClick={actions.onNew}
            className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        {/* Zona libre = arrastre de ventana */}
        <div className="flex-1 h-full min-w-[24px]" data-tauri-drag-region />
      </div>

      {/* Botones de ventana */}
      <div className="flex items-center gap-1.5 px-2 shrink-0">
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
