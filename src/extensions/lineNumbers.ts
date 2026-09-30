import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

// Números de línea en el editor WYSIWYG. Usa la misma noción de «línea» que
// la barra de estado (lib/outline.ts → lineAtPos): cada bloque de texto es
// una línea y dentro de un bloque de código cuenta cada salto interno. El
// número es un widget absoluto al inicio del bloque; el CSS (.iur-ln-on) abre
// el hueco a la izquierda del editor.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    lineNumbers: {
      setLineNumbers: (enabled: boolean) => ReturnType;
    };
  }
}

interface LineState {
  enabled: boolean;
  decos: DecorationSet;
}

const key = new PluginKey<LineState>('iur-line-numbers');

const widget = (n: number) => {
  const el = document.createElement('span');
  el.className = 'iur-ln';
  el.contentEditable = 'false';
  el.setAttribute('aria-hidden', 'true');
  // El contenedor hereda tamaño y altura de línea del bloque y el número va
  // dentro, más pequeño: así comparte la línea base con el texto (también en
  // encabezados).
  const num = document.createElement('span');
  num.textContent = String(n);
  el.appendChild(num);
  return el;
};

export const buildLineDecorations = (doc: PMNode): DecorationSet => {
  const decos: Decoration[] = [];
  let line = 0;
  const add = (pos: number) => {
    line += 1;
    const n = line;
    decos.push(Decoration.widget(pos, () => widget(n), { side: -1, key: `ln-${n}`, ignoreSelection: true }));
  };
  doc.descendants((node, pos) => {
    if (node.type.name === 'tableRow') {
      // Una línea por fila: el número va junto a la primera celda.
      let first = -1;
      node.descendants((child, childPos) => {
        if (first === -1 && child.isTextblock) first = pos + 1 + childPos + 1;
        return first === -1;
      });
      if (first !== -1) add(first);
      else line += 1;
      return false;
    }
    if (!node.isTextblock) return true;
    add(pos + 1);
    if (node.type.spec.code) {
      // Una marca por cada línea interna del bloque de código.
      const text = node.textContent;
      for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
        add(pos + 1 + i + 1);
      }
    }
    return false;
  });
  return DecorationSet.create(doc, decos);
};

export const LineNumbers = Extension.create<{ enabled: boolean }>({
  name: 'lineNumbers',

  addOptions() {
    return { enabled: false };
  },

  addCommands() {
    return {
      setLineNumbers:
        (enabled) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(key, { enabled }).setMeta('addToHistory', false));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const initial = this.options.enabled;
    return [
      new Plugin<LineState>({
        key,
        state: {
          init: (_, state) => ({
            enabled: initial,
            decos: initial ? buildLineDecorations(state.doc) : DecorationSet.empty,
          }),
          apply: (tr, old, _oldState, newState) => {
            const meta = tr.getMeta(key) as { enabled: boolean } | undefined;
            const enabled = meta ? meta.enabled : old.enabled;
            if (!enabled) return old.enabled ? { enabled, decos: DecorationSet.empty } : old;
            if (meta || tr.docChanged) return { enabled, decos: buildLineDecorations(newState.doc) };
            return old;
          },
        },
        props: {
          decorations: (state) => key.getState(state)?.decos,
          attributes: (state): Record<string, string> =>
            key.getState(state)?.enabled ? { class: 'iur-ln-on' } : {},
        },
      }),
    ];
  },
});
