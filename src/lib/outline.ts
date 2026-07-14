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
