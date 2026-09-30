// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { LineNumbers } from '../extensions/lineNumbers';
import { lineAtPos } from '../lib/outline';

describe('LineNumbers', () => {
  let editor: Editor;
  afterEach(() => editor.destroy());

  const numbers = () =>
    Array.from(editor.view.dom.querySelectorAll('.iur-ln')).map((el) => el.textContent);

  it('numera cada bloque y cada línea de código, como la barra de estado', () => {
    editor = new Editor({
      extensions: [StarterKit, LineNumbers.configure({ enabled: true })],
      content: '<h1>T</h1><p>a</p><pre><code>x\ny\nz</code></pre><p>b</p>',
    });
    expect(numbers()).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(editor.view.dom.classList.contains('iur-ln-on')).toBe(true);
    // El último bloque coincide con lineAtPos.
    expect(lineAtPos(editor.state.doc, editor.state.doc.content.size - 1)).toBe(6);
  });

  it('se activa y desactiva sin tocar el documento', () => {
    editor = new Editor({ extensions: [StarterKit, LineNumbers], content: '<p>a</p><p>b</p>' });
    expect(numbers()).toEqual([]);
    editor.commands.setLineNumbers(true);
    expect(numbers()).toEqual(['1', '2']);
    editor.commands.setLineNumbers(false);
    expect(numbers()).toEqual([]);
    expect(editor.view.dom.classList.contains('iur-ln-on')).toBe(false);
    expect(editor.getHTML()).toBe('<p>a</p><p>b</p>');
  });
});
