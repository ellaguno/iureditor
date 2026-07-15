import type { SidebarView } from '../lib/prefs';
import type { HeadingInfo } from '../lib/outline';
import { FilesPanel } from './FilesPanel';
import { OutlinePanel } from './OutlinePanel';
import { t } from '../lib/i18n';

// Panel lateral con dos vistas: árbol de archivos de la carpeta de trabajo
// y esquema del documento (estilo Obsidian/Zettlr).
export const Sidebar = ({
  view,
  onViewChange,
  sourceMode,
  headings,
  onSelectHeading,
  workspace,
  activePath,
  onOpenFile,
  onPickFolder,
}: {
  view: SidebarView;
  onViewChange: (view: SidebarView) => void;
  sourceMode: boolean;
  headings: HeadingInfo[];
  onSelectHeading: (heading: HeadingInfo) => void;
  workspace: string | null;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onPickFolder: () => void;
}) => (
  <div className="w-64 shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 no-select">
    <div className="flex shrink-0 border-b border-gray-200 dark:border-gray-700">
      {(['files', 'outline'] as const).map((v) => (
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
          {v === 'files' ? t('files.title') : t('outline.title')}
        </button>
      ))}
    </div>
    <div className="flex-1 min-h-0">
      {view === 'files' ? (
        <FilesPanel
          root={workspace}
          activePath={activePath}
          onOpenFile={onOpenFile}
          onPickFolder={onPickFolder}
        />
      ) : sourceMode ? (
        <div className="px-3 py-3 text-xs italic text-gray-400 dark:text-gray-500">
          {t('outline.sourceMode')}
        </div>
      ) : (
        <OutlinePanel headings={headings} onSelect={onSelectHeading} />
      )}
    </div>
  </div>
);
