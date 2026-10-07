// @vitest-environment jsdom
// Comportamiento del wikilink dentro de un editor real: escribir `]]` crea el
// enlace, retroceso lo devuelve a texto, en código no se convierte, y al
// renombrar se reapunta sin reemplazar el documento.
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { WikiLink } from '../extensions/wikiLink';
import { VaultIndex } from '../lib/vaultIndex';
import { retargetEditorLinks, findHeading, findLinkTo } from '../lib/editorLinks';
import { markdownToHtml } from '../lib/markdown';

let editor: Editor | null = null;

const make = (html = '<p></p>') => {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, WikiLink],
    content: html,
  });
  return editor;
};

/** Teclea `text` carácter a carácter (pasa por las reglas de entrada). */
const type = (e: Editor, text: string) => {
  for (const ch of text) {
    const { from, to } = e.state.selection;
    const handled = e.view.someProp('handleTextInput', (f) => f(e.view, from, to, ch, () => e.state.tr));
    if (!handled) e.view.dispatch(e.state.tr.insertText(ch, from, to));
  }
};

const wikiNodes = (e: Editor) => {
  const out: Record<string, unknown>[] = [];
  e.state.doc.descendants((n) => {
    if (n.type.name === 'wikiLink') out.push(n.attrs);
  });
  return out;
};

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('wikilink en el editor', () => {
  it('escribir `]]` convierte el texto en enlace', () => {
    const e = make();
    type(e, 'Ver [[Nota#Uno|alias]]');
    expect(wikiNodes(e)).toEqual([{ target: 'Nota', heading: 'Uno', alias: 'alias', embed: false }]);
    expect(e.state.doc.textContent.startsWith('Ver ')).toBe(true);
  });

  it('`![[…]]` es una incrustación', () => {
    const e = make();
    type(e, '![[foto.png]]');
    expect(wikiNodes(e)).toEqual([{ target: 'foto.png', heading: '', alias: '', embed: true }]);
    expect(e.state.doc.textContent).toBe('');
  });

  it('en código queda como texto', () => {
    const e = make('<pre><code></code></pre>');
    e.commands.setTextSelection(1);
    type(e, '[[x]]');
    expect(wikiNodes(e)).toEqual([]);
  });

  it('retroceso tras el enlace lo devuelve a texto editable', () => {
    const e = make(markdownToHtml('a [[Nota|b]]'));
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    e.commands.keyboardShortcut('Backspace');
    expect(wikiNodes(e)).toEqual([]);
    expect(e.state.doc.textContent).toBe('a [[Nota|b');
  });

  it('reapunta enlaces al renombrar y conserva el historial', () => {
    const v = new VaultIndex('/v');
    v.upsert('/v/Idea.md', '# Idea', 1);
    v.upsert('/v/Hoy.md', '', 1);
    const e = make(markdownToHtml('Ver [[Idea|la idea]] y [otra](Idea.md#x) y [[Hoy]].'));
    const n = retargetEditorLinks(e, v, '/v/Hoy.md', '/v/Idea.md', '/v/Gran idea.md');
    expect(n).toBe(2);
    expect(wikiNodes(e).map((a) => a.target)).toEqual(['Gran idea', 'Hoy']);
    let href = '';
    e.state.doc.descendants((node) => {
      const link = node.marks.find((m) => m.type.name === 'link');
      if (link) href = String(link.attrs.href);
    });
    expect(href).toBe('Gran%20idea.md#x');
    expect(e.can().undo()).toBe(true);
  });

  it('encuentra secciones y enlaces para saltar a ellos', () => {
    const v = new VaultIndex('/v');
    v.upsert('/v/Idea.md', '', 1);
    const e = make(markdownToHtml('# Inicio\n\ntexto [[Idea]]\n\n## Plan B'));
    expect(findHeading(e.state.doc, 'plan b')).not.toBeNull();
    const hit = findLinkTo(e.state.doc, v, '/v/Hoy.md', '/v/Idea.md');
    expect(hit && e.state.doc.nodeAt(hit.from)?.type.name).toBe('wikiLink');
  });
});
