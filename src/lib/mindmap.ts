// Mapas mentales: un callout `> [!MINDMAP] Centro` cuyo cuerpo es una lista
// con sangría se dibuja como diagrama `mindmap` de mermaid. Este módulo
// (puro, sin DOM) traduce el JSON ProseMirror del callout a código mermaid;
// lo usan la vista en el editor (CalloutNodeView) y los exports
// (HTML/PDF/DOCX), así que el mapa sale igual en todos lados.

import { wikiDisplay } from './wikilinks';
import type { WikiParts } from './wikilinks';
import { stripNoteExt } from './vaultIndex';
import { t } from './i18n';

/** Forma mínima del JSON ProseMirror (compatible con JSONContent de TipTap
 *  y con el PMNode de exportDocx). */
export interface MindmapJson {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: MindmapJson[];
  text?: string;
  marks?: { type: string }[];
}

export interface MindmapCode {
  code: string;
  /** Índice de nodo (orden de aparición; la raíz es 0) → primer wikilink de
   *  su etiqueta. Mermaid numera los nodos en ese mismo orden
   *  (`<id-del-svg>-node_N`), lo que permite hacerlos clicables. */
  links: Map<number, WikiParts>;
}

/** Formas de nodo de mermaid. `default` es la de mermaid sin delimitadores
 *  (texto subrayado). En markdown van como metadato del callout:
 *  `> [!MINDMAP|bang] Centro`. */
export const MINDMAP_SHAPES = ['default', 'square', 'rounded', 'circle', 'cloud', 'bang', 'hexagon'] as const;
export type MindmapShape = (typeof MINDMAP_SHAPES)[number];

export const isMindmapShape = (s: unknown): s is MindmapShape =>
  typeof s === 'string' && (MINDMAP_SHAPES as readonly string[]).includes(s);

const SHAPE_DELIMS: Record<MindmapShape, [string, string]> = {
  default: ['', ''],
  square: ['[', ']'],
  rounded: ['(', ')'],
  circle: ['((', '))'],
  cloud: [')', '('],
  bang: ['))', '(('],
  hexagon: ['{{', '}}'],
};

/** Centro por omisión: el nombre de la nota (o «Mapa mental» si no tiene). */
export const mindmapFallbackRoot = (sourcePath: string | null | undefined): string =>
  sourcePath ? stripNoteExt(sourcePath.split(/[\\/]/).pop() ?? '') : t('mindmap.root');

/** ¿Es el nodo un callout de mapa mental? */
export const isMindmapCallout = (node: MindmapJson): boolean =>
  node.type === 'callout' && node.attrs?.type === 'mindmap';

const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);

// En las etiquetas sin forma explícita mermaid no admite ( ) [ ] { } (abren
// una forma de nodo); `<` `>` los quita el saneado y un `*` literal se pierde
// (el escape `\*` tampoco sobrevive). Se cambian por sus parecidos de ancho
// completo / el asterisco matemático, que se ven casi igual.
const SAFE_CHARS: Record<string, string> = {
  '(': '（',
  ')': '）',
  '[': '［',
  ']': '］',
  '{': '｛',
  '}': '｝',
  '<': '＜',
  '>': '＞',
  '*': '∗',
  '`': 'ʼ',
};
const safeText = (s: string): string => s.replace(/[()[\]{}<>*`]/g, (c) => SAFE_CHARS[c]);

/** Contenido inline → etiqueta markdown de mermaid (negrita/cursiva) y el
 *  primer wikilink que contenga. */
const inlineLabel = (
  content: MindmapJson[] | undefined
): { label: string; link: WikiParts | null } => {
  // Tramos con el mismo formato se funden: `**a****b**` rompería el markdown.
  const runs: { text: string; bold: boolean; italic: boolean }[] = [];
  let link: WikiParts | null = null;
  const push = (text: string, bold: boolean, italic: boolean) => {
    const last = runs[runs.length - 1];
    if (last && last.bold === bold && last.italic === italic) last.text += text;
    else runs.push({ text, bold, italic });
  };
  for (const child of content ?? []) {
    if (child.type === 'text') {
      const marks = new Set((child.marks ?? []).map((m) => m.type));
      push(safeText(child.text ?? ''), marks.has('bold'), marks.has('italic'));
    } else if (child.type === 'wikiLink') {
      const parts: WikiParts = {
        target: String(child.attrs?.target ?? ''),
        heading: String(child.attrs?.heading ?? ''),
        alias: String(child.attrs?.alias ?? ''),
      };
      if (!link) link = parts;
      push(safeText(wikiDisplay(parts)), false, false);
    } else if (child.type === 'hardBreak') {
      push(' ', false, false);
    } else if (child.type === 'mathInline') {
      push(safeText(String(child.attrs?.latex ?? '')), false, false);
    }
  }
  const label = runs
    .map(({ text, bold, italic }) => {
      // Los espacios de los bordes van fuera de los delimitadores (markdown
      // no reconoce `** a**`). Negrita+cursiva sale sólo en negrita: el
      // `***x***` de mermaid no aplica la cursiva.
      const m = /^(\s*)(.*?)(\s*)$/s.exec(text)!;
      if (!m[2]) return text;
      const d = bold ? '**' : italic ? '*' : '';
      return `${m[1]}${d}${m[2]}${d}${m[3]}`;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return { label, link };
};

/**
 * Callout de mapa mental → código `mindmap`. El primer párrafo (o título) es
 * el centro; si no hay, se usa `fallbackRoot` (el nombre de la nota). Las
 * listas son las ramas, con su anidación; otros párrafos sueltos cuelgan del
 * centro como ramas.
 */
export const mindmapFromCallout = (callout: MindmapJson, fallbackRoot: string): MindmapCode => {
  const lines: string[] = [];
  const links = new Map<number, WikiParts>();
  let count = 0;
  const indent = (level: number) => '  '.repeat(level + 1);
  const shape = isMindmapShape(callout.attrs?.shape) ? callout.attrs.shape : 'default';
  const [open, close] = SHAPE_DELIMS[shape];

  // Todos los nodos con la forma del mapa (el centro lo resalta mermaid con
  // su color). Con delimitadores el nodo lleva un id (`n3[Texto]`).
  const addNode = (level: number, content: MindmapJson[] | undefined) => {
    const { label, link } = inlineLabel(content);
    const text = label || '…';
    if (link) links.set(count, link);
    lines.push(`${indent(level)}${open ? `n${count}${open}${text}${close}` : text}`);
    count++;
  };

  const addList = (list: MindmapJson, level: number) => {
    for (const item of list.content ?? []) {
      const children = item.content ?? [];
      const first = children.find((c) => c.type === 'paragraph' || c.type === 'heading');
      addNode(level, first?.content);
      for (const c of children) if (LISTS.has(c.type ?? '')) addList(c, level + 1);
    }
  };

  const blocks = callout.content ?? [];
  const rootIdx = blocks.findIndex(
    (b) => (b.type === 'paragraph' || b.type === 'heading') && inlineLabel(b.content).label
  );
  const firstList = blocks.findIndex((b) => LISTS.has(b.type ?? ''));
  // El centro sólo puede ir antes de la primera lista; después sería una rama.
  const hasRoot = rootIdx >= 0 && (firstList < 0 || rootIdx < firstList);
  addNode(0, hasRoot ? blocks[rootIdx].content : [{ type: 'text', text: fallbackRoot }]);
  blocks.forEach((b, i) => {
    if (hasRoot && i === rootIdx) return;
    if (LISTS.has(b.type ?? '')) addList(b, 1);
    else if ((b.type === 'paragraph' || b.type === 'heading') && inlineLabel(b.content).label) {
      addNode(1, b.content);
    }
  });

  return { code: `mindmap\n${lines.join('\n')}`, links };
};
