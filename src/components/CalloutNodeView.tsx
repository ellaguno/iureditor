import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useEffect, useState } from 'react';
import {
  Info,
  Lightbulb,
  AlertCircle,
  AlertTriangle,
  ShieldAlert,
  ChevronDown,
  Network,
  PanelRight,
  PanelBottom,
  RefreshCw,
} from 'lucide-react';
import { CALLOUT_TYPES, CALLOUT_LABEL_KEY } from '../extensions/callout';
import type { CalloutType } from '../extensions/callout';
import { t, useLang } from '../lib/i18n';
import { MindmapView, MindmapShapeMenu } from './MindmapView';
import { regenerateLinkMap } from '../lib/linkMapEditor';
import { MINDMAP_VIEWS, mindmapViewOf } from '../lib/mindmap';
import type { MindmapView as MindmapViewMode } from '../lib/mindmap';

type IconType = React.ComponentType<{ className?: string }>;

const ICONS: Record<CalloutType, IconType> = {
  note: Info,
  tip: Lightbulb,
  important: AlertCircle,
  warning: AlertTriangle,
  caution: ShieldAlert,
  mindmap: Network,
};

// Vista del mapa mental (propiedad del documento: decide también cómo se
// exporta). «Sólo mapa» oculta la lista, que sigue editándose desde el mapa.
const VIEW_ICONS: Record<MindmapViewMode, IconType> = {
  below: PanelBottom,
  right: PanelRight,
  map: Network,
};
const VIEW_LABEL_KEY = {
  below: 'mindmap.view.below',
  right: 'mindmap.view.right',
  map: 'mindmap.view.map',
} as const;

// NodeView de callouts: cabecera (icono + etiqueta + selector de tipo) no
// editable, y cuerpo editable (NodeViewContent). El render/serialización a
// markdown lo define callout.ts (renderHTML → <div data-callout>).
export const CalloutNodeView = ({ node, editor, getPos, updateAttributes }: NodeViewProps) => {
  useLang();
  const type = (node.attrs.type as CalloutType) || 'note';
  const Icon = ICONS[type] ?? Info;
  const [open, setOpen] = useState(false);
  const mindmap = type === 'mindmap';
  const view = mindmapViewOf(node.attrs);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  return (
    <NodeViewWrapper className={`iur-callout iur-callout-${type}`} data-callout={type}>
      <div className="iur-callout-header flex items-center justify-between" contentEditable={false}>
        <div className="relative">
          <button
            type="button"
            title={t('callout.changeType')}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            className="iur-callout-title"
          >
            <Icon className="w-4 h-4" />
            <span>{t(CALLOUT_LABEL_KEY[type])}</span>
            <ChevronDown className="w-3.5 h-3.5 opacity-60" />
          </button>
          {open && (
            <div className="absolute left-0 top-full mt-1 z-20 min-w-[160px] py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl">
              {CALLOUT_TYPES.map((ct) => {
                const CtIcon = ICONS[ct];
                return (
                  <button
                    key={ct}
                    type="button"
                    onClick={() => {
                      updateAttributes({ type: ct });
                      setOpen(false);
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                  >
                    <CtIcon className="w-4 h-4 opacity-70" />
                    {t(CALLOUT_LABEL_KEY[ct])}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {mindmap && (
          <div className="flex items-center gap-3">
            {node.attrs.links && (
              <button
                type="button"
                title={t('mindmap.regenerate')}
                onClick={() => {
                  const pos = getPos();
                  if (pos !== undefined) regenerateLinkMap(editor, pos);
                }}
                className="iur-callout-title opacity-70 hover:opacity-100"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
            <MindmapShapeMenu
              shape={node.attrs.shape}
              onChange={(shape) => updateAttributes({ shape })}
            />
            <div className="iur-mindmap-views flex items-center">
              {MINDMAP_VIEWS.map((v) => {
                const ViewIcon = VIEW_ICONS[v];
                return (
                  <button
                    key={v}
                    type="button"
                    title={t(VIEW_LABEL_KEY[v])}
                    aria-pressed={view === v}
                    onClick={() => updateAttributes({ view: v === 'below' ? null : v })}
                    className={`iur-callout-title p-0.5 rounded ${
                      view === v ? 'bg-cyan-200/70 dark:bg-cyan-800/60' : 'opacity-60 hover:opacity-100'
                    }`}
                  >
                    <ViewIcon className="w-4 h-4" />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {/* Misma estructura con y sin mapa: cambiar de tipo no debe remontar
          el contenido editable. */}
      <div className={mindmap ? `iur-mindmap-layout iur-mindmap-${view}` : undefined}>
        <NodeViewContent className="iur-callout-body" />
        {mindmap && <MindmapView node={node} editor={editor} getPos={getPos} />}
      </div>
    </NodeViewWrapper>
  );
};
