import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';

// Búsqueda y reemplazo con resaltado por decoraciones ProseMirror.
// Los resultados se recalculan en cada cambio de doc o de término.

export interface SearchResult {
  from: number;
  to: number;
}

interface SearchState {
  term: string;
  caseSensitive: boolean;
  results: SearchResult[];
  index: number;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    searchReplace: {
      setSearch: (term: string, caseSensitive?: boolean) => ReturnType;
      clearSearch: () => ReturnType;
      findNext: () => ReturnType;
      findPrev: () => ReturnType;
      replaceCurrent: (replacement: string) => ReturnType;
      replaceAll: (replacement: string) => ReturnType;
    };
  }
  interface Storage {
    searchReplace: SearchState;
  }
}

const key = new PluginKey<SearchState>('iur-search');

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Separador entre dos bloques de texto que no deben poder unirse con una
// búsqueda de `\n` (hay un diagrama, imagen, etc. entre ellos, o están en
// contenedores distintos): un carácter que ningún término escrito contiene.
const NO_JOIN = '\u0000';

interface Segment {
  /** Offset del bloque en el texto plano aplanado. */
  start: number;
  /** Posición PM del inicio del contenido del bloque. */
  pos: number;
  length: number;
}

/** Texto plano de todo el documento: los bloques de texto separados por `\n`
 *  (si son hermanos contiguos) y los saltos duros como `\n`. Así un término
 *  con `\n` encuentra tanto saltos duros como fronteras entre párrafos. */
const flatten = (doc: PMNode): { text: string; segments: Segment[] } => {
  let text = '';
  const segments: Segment[] = [];
  let prevParent: PMNode | null = null;
  let prevIndex = -2;
  doc.descendants((node, pos, parent, index) => {
    if (!node.isTextblock) return true;
    if (segments.length) text += parent === prevParent && index === prevIndex + 1 ? '\n' : NO_JOIN;
    // En un textblock, el offset del texto coincide con la posición relativa
    // (los nodos inline atómicos ocupan 1 → placeholder de 1 char).
    const body = node.textBetween(0, node.content.size, undefined, (leaf) =>
      leaf.type.name === 'hardBreak' ? '\n' : '￼'
    );
    segments.push({ start: text.length, pos: pos + 1, length: body.length });
    text += body;
    prevParent = parent;
    prevIndex = index;
    return false;
  });
  return { text, segments };
};

/** Offset del texto aplanado → posición PM. Un offset en una frontera (el
 *  separador) cae al final del bloque anterior. */
const toPos = (segments: Segment[], offset: number): number => {
  // Búsqueda binaria del último bloque que empieza en o antes del offset.
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].start <= offset) lo = mid;
    else hi = mid - 1;
  }
  const seg = segments[lo];
  if (!seg) return 0;
  return seg.pos + Math.min(Math.max(0, offset - seg.start), seg.length);
};

const findResults = (doc: PMNode, term: string, caseSensitive: boolean): SearchResult[] => {
  if (!term) return [];
  const re = new RegExp(escapeRegExp(term), caseSensitive ? 'g' : 'gi');
  const { text, segments } = flatten(doc);
  const results: SearchResult[] = [];
  for (const m of text.matchAll(re)) {
    if (m[0].length === 0) continue;
    const from = toPos(segments, m.index);
    const to = toPos(segments, m.index + m[0].length);
    results.push({ from, to });
  }
  return results;
};

/** Sustituye [from, to) por `replacement`. Un `\n` del reemplazo es:
 *  - fin de párrafo si la coincidencia cruzaba de un bloque a otro (así
 *    `\n\n` → `\n` quita párrafos vacíos sin fundir los que quedan);
 *  - salto duro si la coincidencia estaba dentro de un mismo bloque;
 *  - salto real dentro de un bloque de código. */
const replaceRange = (tr: Transaction, from: number, to: number, replacement: string) => {
  const $from = tr.doc.resolve(from);
  const $to = tr.doc.resolve(to);
  const schema = tr.doc.type.schema;
  const hardBreak = schema.nodes.hardBreak;
  if (!replacement.includes('\n') || $from.parent.type.spec.code) {
    if (replacement) tr.insertText(replacement, from, to);
    else tr.delete(from, to);
    return;
  }
  const marks = $from.marks();
  const parts = replacement.split('\n');
  if ($from.parent !== $to.parent || !hardBreak) {
    // Se borra el tramo (une los bloques) y cada `\n` vuelve a partirlo.
    tr.delete(from, to);
    let pos = from;
    parts.forEach((part, i) => {
      if (i > 0) {
        tr.split(pos);
        pos += 2;
      }
      if (part) {
        tr.insertText(part, pos);
        pos += part.length;
      }
    });
    return;
  }
  const nodes = parts.flatMap((part, i) => {
    const out: PMNode[] = i > 0 ? [hardBreak.create()] : [];
    if (part) out.push(schema.text(part, marks));
    return out;
  });
  tr.replaceWith(from, to, nodes);
};

/** Resaltado de las coincidencias. Los párrafos vacíos que una coincidencia
 *  abarca (p. ej. `\n\n`) no tienen texto que marcar: se resalta el bloque. */
const decorate = (doc: PMNode, state: SearchState): Decoration[] =>
  state.results.flatMap((r, i) => {
    const cls = i === state.index ? 'iur-search-hit iur-search-current' : 'iur-search-hit';
    const out = [Decoration.inline(r.from, r.to, { class: cls })];
    doc.nodesBetween(r.from, r.to, (node, pos) => {
      if (node.isTextblock && node.content.size === 0 && pos > r.from - 1 && pos + 1 < r.to) {
        out.push(Decoration.node(pos, pos + node.nodeSize, { class: cls }));
      }
      return !node.isTextblock;
    });
    return out;
  });

export const SearchReplace = Extension.create({
  name: 'searchReplace',

  addStorage(): SearchState {
    return { term: '', caseSensitive: false, results: [], index: 0 };
  },

  addCommands() {
    const refresh = (tr: Transaction, storage: SearchState) =>
      tr.setMeta(key, { ...storage });

    return {
      setSearch:
        (term, caseSensitive = false) =>
        ({ tr, dispatch, state }) => {
          const s = this.storage as SearchState;
          s.term = term;
          s.caseSensitive = caseSensitive;
          s.results = findResults(state.doc, term, caseSensitive);
          // Arranca en el resultado más cercano a la selección actual.
          const selFrom = state.selection.from;
          const nearest = s.results.findIndex((r) => r.from >= selFrom);
          s.index = nearest >= 0 ? nearest : 0;
          if (dispatch) dispatch(refresh(tr, s));
          return true;
        },

      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          const s = this.storage as SearchState;
          s.term = '';
          s.results = [];
          s.index = 0;
          if (dispatch) dispatch(refresh(tr, s));
          return true;
        },

      findNext:
        () =>
        ({ tr, dispatch }) => {
          const s = this.storage as SearchState;
          if (!s.results.length) return false;
          s.index = (s.index + 1) % s.results.length;
          if (dispatch) dispatch(refresh(tr, s));
          return true;
        },

      findPrev:
        () =>
        ({ tr, dispatch }) => {
          const s = this.storage as SearchState;
          if (!s.results.length) return false;
          s.index = (s.index - 1 + s.results.length) % s.results.length;
          if (dispatch) dispatch(refresh(tr, s));
          return true;
        },

      replaceCurrent:
        (replacement) =>
        ({ tr, dispatch }) => {
          const s = this.storage as SearchState;
          const hit = s.results[s.index];
          if (!hit) return false;
          if (dispatch) {
            replaceRange(tr, hit.from, hit.to, replacement);
            dispatch(tr);
          }
          return true;
        },

      replaceAll:
        (replacement) =>
        ({ tr, dispatch }) => {
          const s = this.storage as SearchState;
          if (!s.results.length) return false;
          if (dispatch) {
            // De atrás hacia adelante para no invalidar posiciones.
            for (const hit of [...s.results].reverse()) {
              replaceRange(tr, hit.from, hit.to, replacement);
            }
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage as SearchState;

    const recompute = (state: EditorState) => {
      storage.results = findResults(state.doc, storage.term, storage.caseSensitive);
      if (storage.index >= storage.results.length) storage.index = 0;
    };

    return [
      new Plugin({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, old, _oldState, newState) => {
            if (tr.docChanged && storage.term) {
              recompute(newState);
              return DecorationSet.create(newState.doc, decorate(newState.doc, storage));
            }
            if (tr.getMeta(key)) {
              return DecorationSet.create(newState.doc, decorate(newState.doc, storage));
            }
            return tr.docChanged ? old.map(tr.mapping, tr.doc) : old;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
