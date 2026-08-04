// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { collectHeadings, lineAtPos, activeHeadingIndex } from '../lib/outline';

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

describe('lineAtPos', () => {
  let editor: Editor;

  afterEach(() => editor.destroy());

  it('cuenta cada bloque de texto como una línea', () => {
    editor = new Editor({
      extensions: [StarterKit],
      content: '<h1>Título</h1><p>Uno</p><p>Dos</p>',
    });
    const headings = collectHeadings(editor.state.doc);
    expect(lineAtPos(editor.state.doc, headings[0].pos + 1)).toBe(1);
    // Final del documento → último bloque.
    expect(lineAtPos(editor.state.doc, editor.state.doc.content.size - 1)).toBe(3);
  });

  it('suma los saltos internos de un bloque de código', () => {
    editor = new Editor({
      extensions: [StarterKit],
      content: '<p>Intro</p><pre><code>a\nb\nc</code></pre><p>Fin</p>',
    });
    // El párrafo final va después de las 3 líneas del código: línea 5.
    expect(lineAtPos(editor.state.doc, editor.state.doc.content.size - 1)).toBe(5);
  });

  it('posición al inicio del documento es la línea 1', () => {
    editor = new Editor({ extensions: [StarterKit], content: '<p>Hola</p>' });
    expect(lineAtPos(editor.state.doc, 0)).toBe(1);
  });
});

describe('activeHeadingIndex', () => {
  const headings = [
    { level: 1, text: 'A', pos: 0 },
    { level: 2, text: 'B', pos: 10 },
    { level: 2, text: 'C', pos: 20 },
  ];

  it('devuelve el último encabezado que empieza en o antes de pos', () => {
    expect(activeHeadingIndex(headings, 0)).toBe(0);
    expect(activeHeadingIndex(headings, 9)).toBe(0);
    expect(activeHeadingIndex(headings, 10)).toBe(1);
    expect(activeHeadingIndex(headings, 99)).toBe(2);
  });

  it('-1 si la posición precede a todos los encabezados', () => {
    expect(activeHeadingIndex([{ level: 1, text: 'A', pos: 5 }], 2)).toBe(-1);
    expect(activeHeadingIndex([], 0)).toBe(-1);
  });
});
