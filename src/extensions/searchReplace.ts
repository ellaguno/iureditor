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

const findResults = (doc: PMNode, term: string, caseSensitive: boolean): SearchResult[] => {
  if (!term) return [];
  const results: SearchResult[] = [];
  const re = new RegExp(escapeRegExp(term), caseSensitive ? 'g' : 'gi');
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // En un textblock, el offset del texto coincide con la posición relativa
    // (los nodos inline atómicos ocupan 1 → placeholder de 1 char).
    const text = node.textBetween(0, node.content.size, undefined, '￼');
    for (const m of text.matchAll(re)) {
      if (m[0].length === 0) continue;
      results.push({ from: pos + 1 + m.index, to: pos + 1 + m.index + m[0].length });
    }
    return false;
  });
  return results;
};

const decorate = (state: SearchState): Decoration[] =>
  state.results.map((r, i) =>
    Decoration.inline(r.from, r.to, {
      class: i === state.index ? 'iur-search-hit iur-search-current' : 'iur-search-hit',
    })
  );

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
            tr.insertText(replacement, hit.from, hit.to);
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
              tr.insertText(replacement, hit.from, hit.to);
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
              return DecorationSet.create(newState.doc, decorate(storage));
            }
            if (tr.getMeta(key)) {
              return DecorationSet.create(newState.doc, decorate(storage));
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
