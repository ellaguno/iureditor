// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { collectHeadings } from '../lib/outline';

describe('collectHeadings', () => {
  let editor: Editor;

  beforeEach(() => {
    editor = new Editor({
      extensions: [StarterKit],
      content:
        '<h1>Título</h1><p>Intro.</p><h2>Sección A</h2><p>Texto.</p>' +
        '<h3>Detalle</h3><h2>Sección B</h2><blockquote><p>cita</p></blockquote>',
    });
  });

  afterEach(() => editor.destroy());

  it('extrae todos los encabezados en orden con su nivel', () => {
    const headings = collectHeadings(editor.state.doc);
    expect(headings.map((h) => [h.level, h.text])).toEqual([
      [1, 'Título'],
      [2, 'Sección A'],
      [3, 'Detalle'],
      [2, 'Sección B'],
    ]);
  });

  it('las posiciones apuntan al nodo de encabezado correcto', () => {
    const headings = collectHeadings(editor.state.doc);
    for (const h of headings) {
      const node = editor.state.doc.nodeAt(h.pos);
      expect(node?.type.name).toBe('heading');
      expect(node?.textContent).toBe(h.text);
    }
  });

  it('documento sin encabezados devuelve lista vacía', () => {
    editor.commands.setContent('<p>Solo párrafos.</p>');
    expect(collectHeadings(editor.state.doc)).toEqual([]);
  });
});
