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
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { basename } from '../lib/fileio';
import type { Theme, PageWidth } from '../lib/prefs';

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
  onNewFromTemplate: (name: string) => void;
  onOpenTemplatesFolder: () => void;
  onTemplatesRefresh: () => void;
  onOpen: () => void;
  onOpenFolder: () => void;
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
  onCheckUpdates: () => void;
}

export interface ViewPrefs {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  spellcheck: boolean;
  onSpellcheckChange: (enabled: boolean) => void;
  outline: boolean;
  onOutlineToggle: () => void;
  files: boolean;
  onFilesToggle: () => void;
  sourceMode: boolean;
  onSourceModeToggle: () => void;
  pageWidth: PageWidth;
  onPageWidthChange: (width: PageWidth) => void;
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
  id,
  title,
  dirty,
  active,
  dragging,
  onSelect,
  onClose,
  onDragStart,
  onContextMenu,
}: {
  id: number;
  title: string;
  dirty: boolean;
  active: boolean;
  dragging: boolean;
  onSelect: () => void;
  onClose: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) => (
  <div
    role="tab"
    aria-selected={active}
    data-tab-id={id}
    onMouseDown={(e) => {
      if (e.button !== 0) return;
      onSelect();
      onDragStart(e);
    }}
    onAuxClick={(e) => {
      if (e.button === 1) onClose(); // clic central cierra, como en navegadores
    }}
    onContextMenu={(e) => {
      // Sustituye el menú del navegador (WebKitGTK) por el propio.
      e.preventDefault();
      onSelect();
      onContextMenu(e);
    }}
    title={title}
    className={`group/tab h-7 max-w-[180px] min-w-0 shrink-0 px-2.5 rounded-md flex items-center gap-1.5 text-sm cursor-default select-none ${
      active
        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200/70 dark:hover:bg-gray-700/60'
    } ${dragging ? 'opacity-70 ring-2 ring-primary-400' : ''}`}
  >
    {dirty && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-primary-500" />}
    <span className="truncate">{title}</span>
    <button
      type="button"
      title="Cerrar pestaña"
      onMouseDown={(e) => e.stopPropagation()}
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
  sidebarVisible,
  onToggleSidebar,
  actions,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onReloadTab,
  onCloseOthers,
  onCloseRight,
  onDetachTab,
  onReorderTab,
  recentFiles,
  templates,
  viewPrefs,
}: {
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  actions: TitleBarActions;
  tabs: TabInfo[];
  activeTabId: number;
  onSelectTab: (id: number) => void;
  onCloseTab: (id: number) => void;
  onReloadTab: (id: number) => void;
  onCloseOthers: (id: number) => void;
  onCloseRight: (id: number) => void;
  onDetachTab: (id: number) => void;
  onReorderTab: (from: number, to: number) => void;
  recentFiles: string[];
  templates: string[];
  viewPrefs: ViewPrefs;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [section, setSection] = useState<SectionId>('file');
  const [version, setVersion] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  // Menú contextual de una pestaña (clic derecho): guarda id y posición.
  const [tabMenu, setTabMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);

  // Reorden de pestañas arrastrando. HTML5 drag&drop no funciona dentro de
  // la webview de Tauri (el runtime intercepta los drops), así que se hace
  // a mano con eventos de puntero sobre la tira de pestañas.
  const stripRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const dragRef = useRef<{ id: number; startX: number; started: boolean } | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const reorderRef = useRef(onReorderTab);
  reorderRef.current = onReorderTab;

  const handleTabDragStart = (id: number) => (e: React.MouseEvent) => {
    dragRef.current = { id, startX: e.clientX, started: false };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.started) {
        if (Math.abs(e.clientX - drag.startX) < 5) return; // umbral anti-clic
        drag.started = true;
        setDraggingId(drag.id);
      }
      const strip = stripRef.current;
      if (!strip) return;
      const els = Array.from(strip.querySelectorAll<HTMLElement>('[data-tab-id]'));
      const from = tabsRef.current.findIndex((tb) => tb.id === drag.id);
      if (from < 0) return;
      // Índice destino: cuántos centros de pestaña quedan a la izquierda
      // del puntero.
      let to = 0;
      for (const el of els) {
        if (Number(el.dataset.tabId) === drag.id) continue;
        const rect = el.getBoundingClientRect();
        if (e.clientX > rect.left + rect.width / 2) to++;
      }
      if (to !== from) reorderRef.current(from, to);
    };
    const onUp = () => {
      dragRef.current = null;
      setDraggingId(null);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(''));
  }, []);

  // Al abrir el menú, refresca la lista de plantillas (el usuario puede
  // haber añadido archivos a la carpeta mientras la app corre).
  const refreshRef = useRef(actions.onTemplatesRefresh);
  refreshRef.current = actions.onTemplatesRefresh;
  useEffect(() => {
    if (menuOpen) refreshRef.current();
  }, [menuOpen]);

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

  // Cerrar el menú contextual de pestaña ante clic fuera, Escape o resize.
  useEffect(() => {
    if (!tabMenu) return;
    const onDown = (e: MouseEvent) => {
      if (tabMenuRef.current && !tabMenuRef.current.contains(e.target as Node)) setTabMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTabMenu(null);
    };
    const close = () => setTabMenu(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [tabMenu]);

  const closeAnd = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

  const runTabAction = (fn: () => void) => () => {
    setTabMenu(null);
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
      {/* Colapsar/abrir el panel lateral */}
      <div className="pl-2 shrink-0">
        <button
          type="button"
          title={sidebarVisible ? 'Ocultar panel lateral' : 'Mostrar panel lateral'}
          onClick={onToggleSidebar}
          className={`w-8 h-8 rounded-md flex items-center justify-center ${
            sidebarVisible
              ? 'text-gray-700 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-gray-700/70'
              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200/70 dark:hover:bg-gray-700/70'
          }`}
        >
          {sidebarVisible ? (
            <PanelLeftClose className="w-5 h-5" />
          ) : (
            <PanelLeftOpen className="w-5 h-5" />
          )}
        </button>
      </div>

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
              <MenuItem label="Abrir carpeta…" onClick={closeAnd(actions.onOpenFolder)} />
              {templates.length > 0 && (
                <>
                  <MenuSeparator />
                  <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    Nueva desde plantilla
                  </div>
                  {templates.map((name) => (
                    <MenuItem
                      key={name}
                      label={name}
                      onClick={closeAnd(() => actions.onNewFromTemplate(name))}
                    />
                  ))}
                  <MenuItem
                    label="Abrir carpeta de plantillas…"
                    onClick={closeAnd(actions.onOpenTemplatesFolder)}
                  />
                </>
              )}
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
              <MenuItem label="Guardar" shortcut="Ctrl+G" onClick={closeAnd(actions.onSave)} />
              <MenuItem
                label="Guardar como…"
                shortcut="Ctrl+Shift+G"
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
                label="Archivos de la carpeta"
                shortcut="Ctrl+Shift+E"
                checked={viewPrefs.files}
                onClick={viewPrefs.onFilesToggle}
              />
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
              <div className="px-3 py-1 flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                <span>Ancho de página</span>
                <span className="normal-case tracking-normal">Ctrl+Shift+A</span>
              </div>
              <MenuItem
                label="Medio"
                checked={viewPrefs.pageWidth === 'medium'}
                onClick={() => viewPrefs.onPageWidthChange('medium')}
              />
              <MenuItem
                label="Ancho"
                checked={viewPrefs.pageWidth === 'wide'}
                onClick={() => viewPrefs.onPageWidthChange('wide')}
              />
              <MenuItem
                label="Completo"
                checked={viewPrefs.pageWidth === 'full'}
                onClick={() => viewPrefs.onPageWidthChange('full')}
              />
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
              <MenuSeparator />
              <MenuItem
                label="Buscar actualizaciones…"
                onClick={closeAnd(actions.onCheckUpdates)}
              />
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
        <div
          ref={stripRef}
          className="flex items-center gap-1 overflow-x-auto max-w-full py-1 scrollbar-thin"
        >
          {tabs.map((tab) => (
            <Tab
              key={tab.id}
              id={tab.id}
              title={tab.path ? basename(tab.path) : 'Sin título'}
              dirty={tab.dirty}
              active={tab.id === activeTabId}
              dragging={tab.id === draggingId}
              onSelect={() => onSelectTab(tab.id)}
              onClose={() => onCloseTab(tab.id)}
              onDragStart={handleTabDragStart(tab.id)}
              onContextMenu={(e) => setTabMenu({ id: tab.id, x: e.clientX, y: e.clientY })}
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

      {/* Menú contextual de una pestaña */}
      {tabMenu &&
        (() => {
          const menuTab = tabs.find((tb) => tb.id === tabMenu.id);
          const idx = tabs.findIndex((tb) => tb.id === tabMenu.id);
          const hasPath = !!menuTab?.path;
          const hasRight = idx >= 0 && idx < tabs.length - 1;
          const hasOthers = tabs.length > 1;
          return (
            <div
              ref={tabMenuRef}
              // Ancla en el cursor; se sube 4px para no quedar bajo el puntero.
              style={{ top: tabMenu.y + 4, left: tabMenu.x }}
              className="fixed z-[60] min-w-[210px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1"
            >
              <MenuItem
                label="Recargar"
                disabled={!hasPath}
                onClick={runTabAction(() => onReloadTab(tabMenu.id))}
              />
              <MenuItem
                label="Cerrar"
                shortcut="Ctrl+W"
                onClick={runTabAction(() => onCloseTab(tabMenu.id))}
              />
              <MenuItem
                label="Cerrar las demás"
                disabled={!hasOthers}
                onClick={runTabAction(() => onCloseOthers(tabMenu.id))}
              />
              <MenuItem
                label="Cerrar las de la derecha"
                disabled={!hasRight}
                onClick={runTabAction(() => onCloseRight(tabMenu.id))}
              />
              <MenuSeparator />
              <MenuItem
                label="Desacoplar en ventana nueva"
                disabled={!hasPath}
                onClick={runTabAction(() => onDetachTab(tabMenu.id))}
              />
            </div>
          );
        })()}
    </div>
  );
};
