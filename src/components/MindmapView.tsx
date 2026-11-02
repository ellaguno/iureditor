import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import {
  AlertTriangle,
  Download,
  Image as ImageIcon,
  ChevronDown,
  Underline,
  Square,
  RectangleHorizontal,
  Circle,
  Cloud,
  Zap,
  Hexagon,
  CornerDownRight,
  Plus,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import {
  renderMermaidSvg,
  useDarkTheme,
  cleanupMermaidOrphans,
  lightSvgElement,
} from '../lib/mermaid';
import { mindmapFromCallout, mindmapFallbackRoot, MINDMAP_SHAPES, isMindmapShape } from '../lib/mindmap';
import type { MindmapShape } from '../lib/mindmap';
import { saveSvg, savePng } from '../lib/diagramExport';
import { getLinkContext } from '../lib/linkContext';
import { nodeAt, focusNode, addChild, addSibling, removeNode, canRemove } from '../lib/mindmapEdit';
import { t } from '../lib/i18n';

type IconType = React.ComponentType<{ className?: string }>;

const SHAPE_ICONS: Record<MindmapShape, IconType> = {
  default: Underline,
  square: Square,
  rounded: RectangleHorizontal,
  circle: Circle,
  cloud: Cloud,
  bang: Zap,
  hexagon: Hexagon,
};

// Clave i18n literal por forma (t() exige claves de la unión).
const SHAPE_LABEL_KEY = {
  default: 'mindmap.shape.default',
  square: 'mindmap.shape.square',
  rounded: 'mindmap.shape.rounded',
  circle: 'mindmap.shape.circle',
  cloud: 'mindmap.shape.cloud',
  bang: 'mindmap.shape.bang',
  hexagon: 'mindmap.shape.hexagon',
} as const;

/** Selector de la forma de los nodos, en la cabecera del callout. */
export const MindmapShapeMenu = ({
  shape,
  onChange,
}: {
  shape: unknown;
  onChange: (shape: MindmapShape | null) => void;
}) => {
  const current: MindmapShape = isMindmapShape(shape) ? shape : 'default';
  const CurrentIcon = SHAPE_ICONS[current];
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        title={t('mindmap.shape')}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="iur-callout-title opacity-70 hover:opacity-100"
      >
        <CurrentIcon className="w-4 h-4" />
        <span className="font-normal">{t(SHAPE_LABEL_KEY[current])}</span>
        <ChevronDown className="w-3.5 h-3.5 opacity-60" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 min-w-[160px] py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl">
          {MINDMAP_SHAPES.map((sh) => {
            const ShIcon = SHAPE_ICONS[sh];
            return (
              <button
                key={sh}
                type="button"
                onClick={() => {
                  onChange(sh === 'default' ? null : sh);
                  setOpen(false);
                }}
                className={`w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 ${
                  sh === current
                    ? 'text-primary-700 dark:text-primary-300 font-medium'
                    : 'text-gray-700 dark:text-gray-200'
                }`}
              >
                <ShIcon className="w-4 h-4 opacity-70" />
                {t(SHAPE_LABEL_KEY[sh])}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const NODE_INDEX_RE = /-node_(\d+)$/;

/** Marca en el SVG los nodos con wikilink (cursor y subrayado vía CSS). Se
 *  hace sobre el string, antes de montarlo: tocar el DOM ya montado no
 *  sobrevive a los re-render del NodeView. */
const markLinks = (svg: string, links: Map<number, unknown>): string => {
  if (!links.size) return svg;
  const holder = document.createElement('div');
  holder.innerHTML = svg;
  holder.querySelectorAll('g[id*="-node_"]').forEach((g) => {
    const m = NODE_INDEX_RE.exec(g.id);
    if (m && links.has(Number(m[1]))) g.classList.add('iur-mindmap-link');
  });
  return holder.innerHTML;
};

const TOOL_BTN =
  'p-1 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-transparent';

// Mapa mental de un callout `[!MINDMAP]`: se regenera (con debounce) al
// editar la lista del callout. Es también un control de la lista: el nodo
// del cursor se resalta, un clic lleva el cursor a su elemento (doble clic
// selecciona su texto) y la barra bajo el nodo añade ramas o las elimina.
// Ctrl+clic en un nodo con wikilink abre la nota.
export const MindmapView = ({
  node,
  editor,
  getPos,
}: {
  node: PMNode;
  editor: Editor;
  getPos: () => number | undefined;
}) => {
  const dark = useDarkTheme();
  const sourcePath: string | null = editor.storage.wikiLink?.sourcePath ?? null;
  const { code, links, nodes } = useMemo(
    () => mindmapFromCallout(node.toJSON(), mindmapFallbackRoot(sourcePath)),
    [node, sourcePath]
  );
  const hasBranches = nodes.length > 1;
  // SVG y el código del que salió: mientras llega el render de un cambio
  // (debounce) el dibujo no corresponde a la lista y no se edita desde él.
  const [rendered, setRendered] = useState({ svg: '', code: '' });
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const svg = rendered.svg;
  const inSync = rendered.code === code;

  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      renderMermaidSvg(code)
        .then((out) => {
          if (cancelled) return;
          setRendered({ svg: markLinks(out, links), code });
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
          cleanupMermaidOrphans(containerRef.current);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [code, links, dark]);

  // Nodo del cursor (sólo si el cursor está en el texto de un nodo).
  const cursor = useEditorState({ editor, selector: ({ editor: e }) => e?.state.selection.from ?? -1 });
  const pos = getPos();
  const current = pos === undefined || cursor < 0 ? -1 : nodeAt(node, pos, nodes, cursor);
  const currentRef = current >= 0 ? nodes[current] : null;

  // Id del <svg> que generó mermaid: base de los ids de nodo (`<id>-node_N`).
  const svgId = useMemo(() => /<svg[^>]*\sid="([\w-]+)"/.exec(svg)?.[1] ?? '', [svg]);

  // Posición de la barra de herramientas: bajo el nodo resaltado.
  const [toolPos, setToolPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const wrap = wrapRef.current;
      const g = current >= 0 && svgId ? wrap?.querySelector(`#${svgId}-node_${current}`) : null;
      if (!wrap || !g || !inSync) return setToolPos(null);
      const r = g.getBoundingClientRect();
      const w = wrap.getBoundingClientRect();
      setToolPos({ left: r.left - w.left + r.width / 2, top: r.bottom - w.top + 4 });
    };
    place();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(place);
    ro.observe(wrap);
    const scroller = containerRef.current;
    scroller?.addEventListener('scroll', place);
    return () => {
      ro.disconnect();
      scroller?.removeEventListener('scroll', place);
    };
  }, [current, svgId, inSync]);

  const indexOf = (target: EventTarget): number => {
    const g = (target as Element).closest('g[id*="-node_"]');
    const m = g && NODE_INDEX_RE.exec(g.id);
    return m ? Number(m[1]) : -1;
  };

  const onClick = (e: React.MouseEvent) => {
    const i = indexOf(e.target);
    if (i < 0 || !inSync) return;
    e.preventDefault();
    const parts = links.get(i);
    if (parts && (e.ctrlKey || e.metaKey)) {
      getLinkContext()?.open(parts, sourcePath);
      return;
    }
    if (pos !== undefined) focusNode(editor, node, pos, nodes[i], e.detail >= 2);
  };

  const act = (fn: typeof addChild) => {
    if (pos !== undefined && currentRef) fn(editor, node, pos, currentRef);
  };
  const currentLink = current >= 0 ? links.get(current) : undefined;

  const getExportSvg = async (): Promise<SVGElement | null> =>
    dark ? lightSvgElement(code) : (containerRef.current?.querySelector('svg') ?? null);
  const fileName = mindmapFallbackRoot(sourcePath);

  return (
    <div ref={wrapRef} className="iur-mindmap group/map relative" contentEditable={false}>
      {svgId && current >= 0 && inSync && (
        <style>{`#${svgId}-node_${current} > :first-child { stroke: #0284c7; stroke-width: 3px; }`}</style>
      )}
      {svg && (
        <div className="absolute top-1 right-1 z-10 hidden group-hover/map:flex gap-1">
          <button
            type="button"
            title={t('mermaid.exportSvg')}
            onClick={() => {
              void getExportSvg().then((el) => el && saveSvg(el, `${fileName}.svg`));
            }}
            className="p-1.5 rounded bg-white/90 dark:bg-gray-700/90 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t('mermaid.exportPng')}
            onClick={() => {
              void getExportSvg().then((el) => el && savePng(el, `${fileName}.png`));
            }}
            className="p-1.5 rounded bg-white/90 dark:bg-gray-700/90 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 shadow-sm"
          >
            <ImageIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {error ? (
        <div className="p-2 text-xs">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-medium mb-1">
            <AlertTriangle className="w-4 h-4" />
            {t('mermaid.error')}
          </div>
          <pre className="text-red-600 dark:text-red-400 whitespace-pre-wrap">{error}</pre>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="iur-mindmap-svg flex justify-center overflow-x-auto"
        onClick={onClick}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {toolPos && currentRef && (
        <div
          className="iur-mindmap-tools absolute z-10 -translate-x-1/2 flex gap-0.5 p-0.5 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-md"
          style={{ left: toolPos.left, top: toolPos.top }}
          // Sin robar el foco al editor: el cursor sigue en la lista.
          onMouseDown={(e) => e.preventDefault()}
        >
          <button type="button" title={t('mindmap.addChild')} onClick={() => act(addChild)} className={TOOL_BTN}>
            <CornerDownRight className="w-4 h-4" />
          </button>
          <button type="button" title={t('mindmap.addSibling')} onClick={() => act(addSibling)} className={TOOL_BTN}>
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            title={t('mindmap.remove')}
            disabled={!canRemove(currentRef)}
            onClick={() => act(removeNode)}
            className={TOOL_BTN}
          >
            <Trash2 className="w-4 h-4" />
          </button>
          {currentLink && (
            <button
              type="button"
              title={t('mindmap.openLink')}
              onClick={() => getLinkContext()?.open(currentLink, sourcePath)}
              className={TOOL_BTN}
            >
              <ExternalLink className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
      {!hasBranches && (
        <p className="text-xs italic text-gray-500 dark:text-gray-400 text-center mt-1">
          {t('mindmap.hint')}
        </p>
      )}
    </div>
  );
};
