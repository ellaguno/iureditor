// Operaciones sobre los enlaces de un documento ABIERTO en el editor: ubicar
// una sección, un enlace o un texto (para saltar a él al abrir la nota) y
// reapuntar enlaces tras renombrar una nota sin reemplazar el documento
// (se conservan el cursor y el historial de deshacer).

import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { foldText } from './fuzzy';
import type { VaultIndex } from './vaultIndex';
import { normPath } from './vaultIndex';

export interface DocRange {
  from: number;
  to: number;
}

/** Encabezado cuyo texto coincide (sin mayúsculas ni acentos). */
export const findHeading = (doc: PMNode, heading: string): DocRange | null => {
  const want = foldText(heading.trim());
  let hit: DocRange | null = null;
  doc.descendants((node, pos) => {
    if (hit) return false;
    if (node.type.name === 'heading' && foldText(node.textContent.trim()) === want) {
      hit = { from: pos + 1, to: pos + 1 + node.content.size };
      return false;
    }
    return true;
  });
  return hit;
};

/** Primera aparición de `needle` en el texto del documento. */
export const findText = (doc: PMNode, needle: string): DocRange | null => {
  const want = foldText(needle);
  if (!want) return null;
  let hit: DocRange | null = null;
  doc.descendants((node, pos) => {
    if (hit) return false;
    if (node.isText && node.text) {
      const i = foldText(node.text).indexOf(want);
      if (i >= 0) hit = { from: pos + i, to: pos + i + needle.length };
    }
    return true;
  });
  return hit;
};

/** Primer enlace (wikilink o enlace markdown) de `sourcePath` que apunta a
 *  `targetPath`. */
export const findLinkTo = (
  doc: PMNode,
  index: VaultIndex,
  sourcePath: string,
  targetPath: string
): DocRange | null => {
  const targetKey = normPath(targetPath);
  let hit: DocRange | null = null;
  doc.descendants((node, pos) => {
    if (hit) return false;
    if (node.type.name === 'wikiLink') {
      if (index.resolveKey(String(node.attrs.target ?? ''), sourcePath) === targetKey) {
        hit = { from: pos, to: pos + node.nodeSize };
      }
      return false;
    }
    if (node.isText) {
      const link = node.marks.find((m) => m.type.name === 'link');
      const href = link ? String(link.attrs.href ?? '') : '';
      // Reutiliza la lógica del renombrado: ¿«renombrar target» tocaría
      // este href? Entonces apunta a target.
      if (href && index.renamedMdHref(href, sourcePath, targetPath, targetPath) !== null) {
        hit = { from: pos, to: pos + node.nodeSize };
      }
    }
    return true;
  });
  return hit;
};

/** Reapunta en el editor los enlaces de `sourcePath` que van a `oldPath`.
 *  Devuelve cuántos cambió. Usa el índice previo al renombrado. */
export const retargetEditorLinks = (
  editor: Editor,
  index: VaultIndex,
  sourcePath: string,
  oldPath: string,
  newPath: string
): number => {
  const { tr } = editor.state;
  let count = 0;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'wikiLink') {
      const next = index.renamedWikiTarget(String(node.attrs.target ?? ''), sourcePath, oldPath, newPath);
      if (next !== null) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, target: next });
        count++;
      }
      return false;
    }
    if (node.isText) {
      const link = node.marks.find((m) => m.type.name === 'link');
      if (link) {
        const href = index.renamedMdHref(String(link.attrs.href ?? ''), sourcePath, oldPath, newPath);
        if (href !== null) {
          const end = pos + node.nodeSize;
          tr.removeMark(pos, end, link.type);
          tr.addMark(pos, end, link.type.create({ ...link.attrs, href }));
          count++;
        }
      }
    }
    return true;
  });
  if (count) editor.view.dispatch(tr);
  return count;
};
