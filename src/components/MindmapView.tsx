import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { AlertTriangle, Download, Image as ImageIcon } from 'lucide-react';
import {
  renderMermaidSvg,
  useDarkTheme,
  cleanupMermaidOrphans,
  lightSvgElement,
} from '../lib/mermaid';
import { mindmapFromCallout, mindmapFallbackRoot } from '../lib/mindmap';
import { saveSvg, savePng } from '../lib/diagramExport';
import { getLinkContext } from '../lib/linkContext';
import { t } from '../lib/i18n';

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

// Mapa mental de un callout `[!MINDMAP]`: se regenera (con debounce) al
// editar la lista del callout. Los nodos con wikilink se abren con un clic,
// igual que el enlace en el texto.
export const MindmapView = ({ node, editor }: { node: PMNode; editor: Editor }) => {
  const dark = useDarkTheme();
  const sourcePath: string | null = editor.storage.wikiLink?.sourcePath ?? null;
  const { code, links } = useMemo(
    () => mindmapFromCallout(node.toJSON(), mindmapFallbackRoot(sourcePath)),
    [node, sourcePath]
  );
  const hasBranches = useMemo(() => code.split('\n').length > 2, [code]);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      renderMermaidSvg(code)
        .then((rendered) => {
          if (cancelled) return;
          setSvg(markLinks(rendered, links));
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

  const onClick = (e: React.MouseEvent) => {
    const g = (e.target as Element).closest('g[id*="-node_"]');
    const m = g && NODE_INDEX_RE.exec(g.id);
    const parts = m ? links.get(Number(m[1])) : undefined;
    if (!parts) return;
    e.preventDefault();
    getLinkContext()?.open(parts, sourcePath);
  };

  const getExportSvg = async (): Promise<SVGElement | null> =>
    dark ? lightSvgElement(code) : (containerRef.current?.querySelector('svg') ?? null);
  const fileName = mindmapFallbackRoot(sourcePath);

  return (
    <div className="iur-mindmap group/map relative" contentEditable={false}>
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
      {!hasBranches && (
        <p className="text-xs italic text-gray-500 dark:text-gray-400 text-center mt-1">
          {t('mindmap.hint')}
        </p>
      )}
    </div>
  );
};
