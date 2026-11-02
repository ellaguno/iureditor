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
} from 'lucide-react';
import { CALLOUT_TYPES, CALLOUT_LABEL_KEY } from '../extensions/callout';
import type { CalloutType } from '../extensions/callout';
import { t, useLang } from '../lib/i18n';
import { MindmapView, MindmapShapeMenu } from './MindmapView';

type IconType = React.ComponentType<{ className?: string }>;

const ICONS: Record<CalloutType, IconType> = {
  note: Info,
  tip: Lightbulb,
  important: AlertCircle,
  warning: AlertTriangle,
  caution: ShieldAlert,
  mindmap: Network,
};

// Posición del mapa mental respecto a su lista: preferencia de la vista, no
// del documento (no viaja en el markdown).
type MapPlace = 'right' | 'below';
const PLACE_KEY = 'iur.mindmapPlace';
const readPlace = (): MapPlace => {
  try {
    return localStorage.getItem(PLACE_KEY) === 'below' ? 'below' : 'right';
  } catch {
    return 'right';
  }
};

// NodeView de callouts: cabecera (icono + etiqueta + selector de tipo) no
// editable, y cuerpo editable (NodeViewContent). El render/serialización a
// markdown lo define callout.ts (renderHTML → <div data-callout>).
export const CalloutNodeView = ({ node, editor, updateAttributes }: NodeViewProps) => {
  useLang();
  const type = (node.attrs.type as CalloutType) || 'note';
  const Icon = ICONS[type] ?? Info;
  const [open, setOpen] = useState(false);
  const mindmap = type === 'mindmap';
  const [place, setPlace] = useState<MapPlace>(readPlace);
  const togglePlace = () => {
    const next: MapPlace = place === 'right' ? 'below' : 'right';
    setPlace(next);
    try {
      localStorage.setItem(PLACE_KEY, next);
    } catch {
      // Sin almacenamiento: la preferencia dura lo que la sesión.
    }
  };

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
            <MindmapShapeMenu
              shape={node.attrs.shape}
              onChange={(shape) => updateAttributes({ shape })}
            />
            <button
              type="button"
              title={place === 'right' ? t('mindmap.placeBelow') : t('mindmap.placeRight')}
              onClick={togglePlace}
              className="iur-callout-title opacity-70 hover:opacity-100"
            >
              {place === 'right' ? (
                <PanelBottom className="w-4 h-4" />
              ) : (
                <PanelRight className="w-4 h-4" />
              )}
            </button>
          </div>
        )}
      </div>
      {/* Misma estructura con y sin mapa: cambiar de tipo no debe remontar
          el contenido editable. */}
      <div className={mindmap ? `iur-mindmap-layout iur-mindmap-${place}` : undefined}>
        <NodeViewContent className="iur-callout-body" />
        {mindmap && <MindmapView node={node} editor={editor} />}
      </div>
    </NodeViewWrapper>
  );
};
