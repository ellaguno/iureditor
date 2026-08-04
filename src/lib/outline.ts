import type { Node as PMNode } from '@tiptap/pm/model';

// Extracción de encabezados del documento para el panel de esquema.

export interface HeadingInfo {
  /** Nivel 1–6. */
  level: number;
  /** Texto plano del encabezado. */
  text: string;
  /** Posición ProseMirror del nodo (para saltar a la sección). */
  pos: number;
}

/** Slug estilo GitHub para anclas de encabezados (conserva letras Unicode). */
export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');

/** Genera slugs únicos para una secuencia de textos (duplicados: -1, -2…).
 *  Determinista: el índice insertado y los ids de export coinciden. */
export const uniqueSlugs = (texts: string[]): string[] => {
  const seen = new Map<string, number>();
  return texts.map((text) => {
    const base = slugify(text) || 'seccion';
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  });
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** HTML de un índice (lista anidada de enlaces #ancla) desde los encabezados. */
export const buildTocHtml = (headings: HeadingInfo[]): string => {
  if (!headings.length) return '';
  const slugs = uniqueSlugs(headings.map((h) => h.text));
  const minLevel = Math.min(...headings.map((h) => h.level));
  const out: string[] = [];
  let depth = 0;
  headings.forEach((h, i) => {
    const d = Math.max(1, h.level - minLevel + 1);
    if (depth === 0) {
      out.push('<ul><li>');
      depth = 1;
    } else if (d > depth) {
      while (depth < d) {
        out.push('<ul><li>');
        depth++;
      }
    } else {
      while (depth > d) {
        out.push('</li></ul>');
        depth--;
      }
      out.push('</li><li>');
    }
    out.push(`<a href="#${slugs[i]}">${escapeHtml(h.text || 'Sección')}</a>`);
  });
  while (depth > 0) {
    out.push('</li></ul>');
    depth--;
  }
  return out.join('');
};

/** Línea (1-based) en la que cae una posición del documento. Cada bloque de
 *  texto cuenta como una línea; dentro de un bloque de código cuentan además
 *  sus saltos de línea internos. Es la noción de «línea» que puede ofrecer un
 *  editor WYSIWYG (no la línea del archivo markdown en disco). */
export const lineAtPos = (doc: PMNode, pos: number): number => {
  let line = 0;
  let found = 0;
  doc.descendants((node, nodePos) => {
    if (found) return false;
    if (!node.isTextblock) return true;
    if (nodePos > pos) {
      // La posición quedó entre bloques (p. ej. un diagrama seleccionado):
      // cuenta como la línea del último bloque de texto anterior.
      found = Math.max(1, line);
      return false;
    }
    line += 1;
    if (pos < nodePos + node.nodeSize) {
      const offset = Math.max(0, Math.min(pos - (nodePos + 1), node.content.size));
      line += (node.textBetween(0, offset).match(/\n/g) ?? []).length;
      found = line;
    } else {
      line += (node.textContent.match(/\n/g) ?? []).length;
    }
    return false; // los bloques de texto no anidan otros bloques
  });
  return found || Math.max(1, line);
};

/** Índice del encabezado «activo» para una posición: el último cuyo inicio
 *  queda en o antes de `pos` (-1 si la posición precede a todos). */
export const activeHeadingIndex = (headings: HeadingInfo[], pos: number): number => {
  let active = -1;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].pos <= pos) active = i;
    else break;
  }
  return active;
};

export const collectHeadings = (doc: PMNode): HeadingInfo[] => {
  const headings: HeadingInfo[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      headings.push({
        level: node.attrs.level as number,
        text: node.textContent,
        pos,
      });
      return false; // los encabezados no anidan otros bloques
    }
    return true;
  });
  return headings;
};
