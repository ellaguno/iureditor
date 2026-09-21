import type { SidebarView } from '../lib/prefs';
import type { HeadingInfo } from '../lib/outline';
import { FilesPanel } from './FilesPanel';
import { OutlinePanel } from './OutlinePanel';
import { SearchPanel } from './SearchPanel';
import { IurefficientPanel } from './IurefficientPanel';
import { t } from '../lib/i18n';

// Panel lateral con tres vistas: árbol de archivos de la carpeta de trabajo,
// búsqueda en esos archivos y esquema del documento (estilo Obsidian/Zettlr).
export const Sidebar = ({
  view,
  onViewChange,
  sourceMode,
  headings,
  outlinePos,
  onSelectHeading,
  workspace,
  activePath,
  onOpenFile,
  onPickFolder,
  onCreateFile,
  onCreateFolder,
  onSelectDir,
  onGoUp,
  onEnterDir,
  onOpenSearchResult,
  activeDirty,
  onSaveActive,
}: {
  view: SidebarView;
  onViewChange: (view: SidebarView) => void;
  sourceMode: boolean;
  headings: HeadingInfo[];
  /** Posición del documento que marca la sección activa en el esquema. */
  outlinePos: number;
  onSelectHeading: (heading: HeadingInfo) => void;
  workspace: string | null;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onPickFolder: () => void;
  onCreateFile: (dir: string, name: string) => Promise<boolean>;
  onCreateFolder: (dir: string, name: string) => Promise<boolean>;
  onSelectDir: (dir: string) => void;
  onGoUp: () => void;
  onEnterDir: (dir: string) => void;
  /** Abre un resultado de la búsqueda en archivos (ruta + línea). */
  onOpenSearchResult: (path: string, line: number) => void;
  /** Para el panel de Iurefficient: estado y guardado de la pestaña activa. */
  activeDirty: boolean;
  onSaveActive: () => Promise<string | null>;
}) => (
  <div className="w-64 shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 no-select">
    <div className="flex shrink-0 border-b border-gray-200 dark:border-gray-700">
      {(['files', 'search', 'outline', 'iurefficient'] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onViewChange(v)}
          className={`flex-1 py-1.5 text-xs font-medium ${
            view === v
              ? 'text-gray-900 dark:text-gray-100 border-b-2 border-primary-500'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          {v === 'files' ? t('files.title') : v === 'search' ? t('fsearch.title') : v === 'iurefficient' ? t('iure.title') : t('outline.title')}
        </button>
      ))}
    </div>
    <div className="flex-1 min-h-0">
      {view === 'iurefficient' ? (
        <IurefficientPanel activePath={activePath} activeDirty={activeDirty} onOpenFile={onOpenFile} onSaveActive={onSaveActive} />
      ) : view === 'search' ? (
        <SearchPanel workspace={workspace} onOpenResult={onOpenSearchResult} />
      ) : view === 'files' ? (
        <FilesPanel
          root={workspace}
          activePath={activePath}
          onOpenFile={onOpenFile}
          onPickFolder={onPickFolder}
          onCreateFile={onCreateFile}
          onCreateFolder={onCreateFolder}
          onSelectDir={onSelectDir}
          onGoUp={onGoUp}
          onEnterDir={onEnterDir}
        />
      ) : sourceMode ? (
        <div className="px-3 py-3 text-xs italic text-gray-400 dark:text-gray-500">
          {t('outline.sourceMode')}
        </div>
      ) : (
        <OutlinePanel headings={headings} activePos={outlinePos} onSelect={onSelectHeading} />
      )}
    </div>
  </div>
);
