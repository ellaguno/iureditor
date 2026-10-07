import { Node, InputRule, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { WikiLinkMenu } from '../components/WikiLinkMenu';
import { suggestionPopup } from './suggestionPopup';
import { formatWikiLink, parseWikiInner, wikiDisplay } from '../lib/wikilinks';
import type { WikiParts } from '../lib/wikilinks';
import { getLinkContext, subscribeLinks } from '../lib/linkContext';
import type { LinkCandidate } from '../lib/linkContext';

export interface WikiLinkStorage {
  /** Ruta del documento de este editor: base para resolver los enlaces. */
  sourcePath: string | null;
}

declare module '@tiptap/core' {
  interface Storage {
    wikiLink: WikiLinkStorage;
  }
  interface Commands<ReturnType> {
    wikiLink: {
      /** Inserta un wikilink en el cursor. */
      insertWikiLink: (parts: WikiParts, embed?: boolean) => ReturnType;
    };
  }
}

// Wikilinks estilo Obsidian (`[[Nota#Sección|alias]]`). lib/markdown.ts los
// convierte en <span data-wikilink> al cargar y la regla de Turndown los
// devuelve a la sintaxis original. En el editor son átomos: se muestran como
// enlace (roto si la nota no existe) y un clic abre la nota. Retroceso
// justo detrás de uno lo devuelve a texto `[[…` para editarlo.

const partsOf = (node: PMNode): WikiParts => ({
  target: String(node.attrs.target ?? ''),
  heading: String(node.attrs.heading ?? ''),
  alias: String(node.attrs.alias ?? ''),
});

const sourceOf = (editor: Editor): string | null => editor.storage.wikiLink?.sourcePath ?? null;

const suggestionKey = new PluginKey('wikiLinkSuggestion');

/** Dentro de código (bloque o marca) un `[[x]]` es texto literal. */
const inCode = ($pos: ResolvedPos): boolean =>
  !!$pos.parent.type.spec.code || $pos.marks().some((m) => m.type.spec.code);

export const WikiLink = Node.create<Record<string, never>, WikiLinkStorage>({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addStorage() {
    return { sourcePath: null };
  },

  addAttributes() {
    return {
      target: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-wikilink') ?? '',
        renderHTML: () => ({}),
      },
      heading: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-heading') ?? '',
        renderHTML: () => ({}),
      },
      alias: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-alias') ?? '',
        renderHTML: () => ({}),
      },
      embed: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-embed') === 'true',
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-wikilink]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const parts = partsOf(node);
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-wikilink': parts.target,
        ...(parts.heading ? { 'data-heading': parts.heading } : {}),
        ...(parts.alias ? { 'data-alias': parts.alias } : {}),
        ...(node.attrs.embed ? { 'data-embed': 'true' } : {}),
        class: 'wikilink',
      }),
      wikiDisplay(parts),
    ];
  },

  renderText({ node }) {
    return formatWikiLink(partsOf(node), { embed: !!node.attrs.embed });
  },

  addCommands() {
    return {
      insertWikiLink:
        (parts, embed = false) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { ...parts, embed } }),
    };
  },

  addNodeView() {
    return ({ node, editor }) => {
      let current = node;
      const dom = document.createElement('span');
      dom.contentEditable = 'false';

      const paint = () => {
        const parts = partsOf(current);
        const ctx = getLinkContext();
        const missing =
          !!ctx && ctx.ready() && !!parts.target && !ctx.resolve(parts.target, sourceOf(editor));
        dom.className = `wikilink${missing ? ' wikilink-missing' : ''}${
          current.attrs.embed ? ' wikilink-embed' : ''
        }`;
        dom.textContent = wikiDisplay(parts);
        dom.title = formatWikiLink(parts, { embed: !!current.attrs.embed });
      };
      paint();
      const unsubscribe = subscribeLinks(paint);

      dom.addEventListener('mousedown', (e) => {
        // Sin esto, el mousedown selecciona el nodo y mueve el foco.
        if (e.button === 0) e.preventDefault();
      });
      dom.addEventListener('click', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        getLinkContext()?.open(partsOf(current), sourceOf(editor));
      });

      return {
        dom,
        update: (next) => {
          if (next.type !== current.type) return false;
          current = next;
          paint();
          return true;
        },
        ignoreMutation: () => true,
        destroy: unsubscribe,
      };
    };
  },

  addInputRules() {
    // Escribir el `]]` de cierre convierte `[[Nota]]` (o `![[…]]`) en enlace.
    return [
      new InputRule({
        find: /(!?)\[\[([^[\]\n]+?)\]\]$/,
        handler: ({ state, range, match }) => {
          if (inCode(state.doc.resolve(range.from))) return null;
          const p = parseWikiInner(match[2]);
          if (!p.target && !p.heading) return null;
          state.tr.replaceWith(
            range.from,
            range.to,
            this.type.create({ target: p.target, heading: p.heading, alias: p.alias, embed: match[1] === '!' })
          );
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Retroceso tras un enlace: vuelve a texto editable (`[[Nota`), con el
      // autocompletado abierto de nuevo.
      Backspace: ({ editor }) => {
        const { selection } = editor.state;
        if (!selection.empty) return false;
        const before = selection.$from.nodeBefore;
        if (!before || before.type.name !== this.name) return false;
        const raw = formatWikiLink(partsOf(before), { embed: !!before.attrs.embed }).slice(0, -2);
        const from = selection.from - before.nodeSize;
        return editor
          .chain()
          .command(({ tr }) => {
            tr.replaceWith(from, selection.from, editor.schema.text(raw));
            return true;
          })
          .run();
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<LinkCandidate>({
        editor: this.editor,
        pluginKey: suggestionKey,
        char: '[[',
        allowSpaces: true,
        allowedPrefixes: null,
        allow: ({ state, range }) => !inCode(state.doc.resolve(range.from)),
        // El último `[[` sin cerrar antes del cursor, en el mismo nodo de texto.
        findSuggestionMatch: ({ $position }) => {
          const before = $position.nodeBefore;
          if (!before?.isText || !before.text) return null;
          const text = before.text;
          const idx = text.lastIndexOf('[[');
          if (idx < 0) return null;
          const query = text.slice(idx + 2);
          if (query.includes(']]') || query.length > 150) return null;
          const textFrom = $position.pos - text.length;
          const embed = idx > 0 && text[idx - 1] === '!';
          const from = textFrom + idx - (embed ? 1 : 0);
          return { range: { from, to: $position.pos }, query, text: text.slice(idx) };
        },
        items: ({ query, editor }) => getLinkContext()?.suggest(query, sourceOf(editor)) ?? [],
        command: ({ editor, range, props }) => {
          const embed = editor.state.doc.textBetween(range.from, range.from + 1) === '!';
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent({ type: 'wikiLink', attrs: { ...props.parts, embed } })
            .run();
        },
        render: suggestionPopup<LinkCandidate>(WikiLinkMenu),
      }),
    ];
  },
});
