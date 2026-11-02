// Edición de un mapa mental desde el dibujo: cada acción (seleccionar un
// nodo, añadir rama hija o hermana, eliminar) es una transacción sobre la
// lista del callout, que sigue siendo el único modelo. Los nodos se ubican
// con las rutas que da mindmapFromCallout (MindmapNodeRef).

import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { MindmapNodeRef } from './mindmap';

const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);
const isTextBlock = (n: PMNode) => n.type.name === 'paragraph' || n.type.name === 'heading';

/** Posición (antes del nodo) y nodo al final de `path`, desde el callout. */
const resolvePath = (
  callout: PMNode,
  calloutPos: number,
  path: number[]
): { pos: number; node: PMNode } => {
  let node = callout;
  let pos = calloutPos;
  for (const i of path) {
    let p = pos + 1;
    for (let j = 0; j < i; j++) p += node.child(j).nodeSize;
    pos = p;
    node = node.child(i);
  }
  return { pos, node };
};

/** Tramo de texto de la etiqueta de un nodo (su párrafo), o null. */
export const labelRange = (
  callout: PMNode,
  calloutPos: number,
  ref: MindmapNodeRef
): { from: number; to: number } | null => {
  if (ref.kind === 'fallback') return null;
  const { pos, node } = resolvePath(callout, calloutPos, ref.path);
  if (ref.kind !== 'item') return { from: pos + 1, to: pos + node.nodeSize - 1 };
  let p = pos + 1;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (isTextBlock(child)) return { from: p + 1, to: p + child.nodeSize - 1 };
    p += child.nodeSize;
  }
  return null;
};

/** Índice del nodo cuyo texto contiene la posición `at` (-1 si ninguno). */
export const nodeAt = (
  callout: PMNode,
  calloutPos: number,
  refs: MindmapNodeRef[],
  at: number
): number => {
  if (at <= calloutPos || at >= calloutPos + callout.nodeSize) return -1;
  return refs.findIndex((ref) => {
    const r = labelRange(callout, calloutPos, ref);
    return !!r && at >= r.from && at <= r.to;
  });
};

/** Lleva el cursor al texto del nodo (al final, o seleccionándolo entero). */
export const focusNode = (
  editor: Editor,
  callout: PMNode,
  calloutPos: number,
  ref: MindmapNodeRef,
  selectAll = false
): void => {
  const r = labelRange(callout, calloutPos, ref);
  if (!r) return;
  editor
    .chain()
    .setTextSelection(selectAll ? r : r.to)
    .scrollIntoView()
    .focus()
    .run();
};

/** Elemento de lista vacío del tipo que corresponde a `list`. */
const emptyItem = (editor: Editor, list: PMNode | null): PMNode => {
  const { schema } = editor;
  const itemType = list?.firstChild?.type ?? schema.nodes.listItem;
  return itemType.create(null, schema.nodes.paragraph.create());
};

/** Inserta `content` en `at` y deja el cursor `cursorOffset` más adelante. */
const insertAndFocus = (editor: Editor, at: number, content: PMNode, cursorOffset: number) => {
  const tr = editor.state.tr.insert(at, content);
  tr.setSelection(TextSelection.create(tr.doc, at + cursorOffset)).scrollIntoView();
  editor.view.dispatch(tr);
  editor.view.focus();
};

/** Añade una rama hija (al final de sus hijas) y pone el cursor en ella. */
export const addChild = (
  editor: Editor,
  callout: PMNode,
  calloutPos: number,
  ref: MindmapNodeRef
): void => {
  const { schema } = editor;
  if (ref.kind === 'item') {
    const { pos, node: item } = resolvePath(callout, calloutPos, ref.path);
    // ¿Ya tiene sublista? La nueva rama va al final de la última.
    let p = pos + 1;
    let sub: { pos: number; node: PMNode } | null = null;
    for (let i = 0; i < item.childCount; i++) {
      const child = item.child(i);
      if (LISTS.has(child.type.name)) sub = { pos: p, node: child };
      p += child.nodeSize;
    }
    if (sub) {
      insertAndFocus(editor, sub.pos + sub.node.nodeSize - 1, emptyItem(editor, sub.node), 2);
    } else {
      const list = schema.nodes.bulletList.create(null, emptyItem(editor, null));
      insertAndFocus(editor, pos + item.nodeSize - 1, list, 3);
    }
    return;
  }
  // Centro o párrafo suelto: rama de primer nivel, al final de la primera
  // lista del callout (o en una lista nueva tras el centro).
  let p = calloutPos + 1;
  for (let i = 0; i < callout.childCount; i++) {
    const child = callout.child(i);
    if (LISTS.has(child.type.name)) {
      insertAndFocus(editor, p + child.nodeSize - 1, emptyItem(editor, child), 2);
      return;
    }
    p += child.nodeSize;
  }
  const list = schema.nodes.bulletList.create(null, emptyItem(editor, null));
  const after =
    ref.kind === 'fallback'
      ? calloutPos + callout.nodeSize - 1
      : (() => {
          const { pos, node } = resolvePath(callout, calloutPos, ref.path);
          return pos + node.nodeSize;
        })();
  insertAndFocus(editor, after, list, 3);
};

/** Añade una rama hermana (justo después) y pone el cursor en ella. En el
 *  centro equivale a añadir una hija. */
export const addSibling = (
  editor: Editor,
  callout: PMNode,
  calloutPos: number,
  ref: MindmapNodeRef
): void => {
  if (ref.kind !== 'item') return addChild(editor, callout, calloutPos, ref);
  const { pos, node: item } = resolvePath(callout, calloutPos, ref.path);
  const list = resolvePath(callout, calloutPos, ref.path.slice(0, -1)).node;
  insertAndFocus(editor, pos + item.nodeSize, emptyItem(editor, list), 2);
};

/** ¿Se puede eliminar el nodo? (el centro no). */
export const canRemove = (ref: MindmapNodeRef): boolean =>
  ref.kind === 'item' || ref.kind === 'para';

/** Elimina el nodo con sus ramas hijas. Si era el único de su lista, se va
 *  la lista entera. */
export const removeNode = (
  editor: Editor,
  callout: PMNode,
  calloutPos: number,
  ref: MindmapNodeRef
): void => {
  if (!canRemove(ref)) return;
  let target = resolvePath(callout, calloutPos, ref.path);
  if (ref.kind === 'item') {
    const list = resolvePath(callout, calloutPos, ref.path.slice(0, -1));
    if (list.node.childCount === 1) target = list;
  }
  editor
    .chain()
    .deleteRange({ from: target.pos, to: target.pos + target.node.nodeSize })
    .focus()
    .run();
};
