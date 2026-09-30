// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { SearchReplace } from '../extensions/searchReplace';

describe('SearchReplace', () => {
  let editor: Editor;

  beforeEach(() => {
    editor = new Editor({
      extensions: [StarterKit, SearchReplace],
      content:
        '<p>Hola mundo. El mundo es grande y el Mundo gira.</p><p>Otro mundo aparte.</p>',
    });
  });

  afterEach(() => editor.destroy());

  it('encuentra todas las coincidencias (sin distinguir mayúsculas)', () => {
    editor.commands.setSearch('mundo');
    expect(editor.storage.searchReplace.results).toHaveLength(4);
  });

  it('distingue mayúsculas cuando se pide', () => {
    editor.commands.setSearch('Mundo', true);
    expect(editor.storage.searchReplace.results).toHaveLength(1);
  });

  it('navega circularmente con findNext/findPrev', () => {
    editor.commands.setSearch('mundo');
    const s = editor.storage.searchReplace;
    const start = s.index;
    editor.commands.findNext();
    expect(s.index).toBe((start + 1) % 4);
    editor.commands.findPrev();
    editor.commands.findPrev();
    expect(s.index).toBe((start + 3) % 4);
  });

  it('replaceCurrent reemplaza sólo la coincidencia actual', () => {
    editor.commands.setSearch('mundo');
    editor.commands.replaceCurrent('planeta');
    const text = editor.getText();
    expect(text).toContain('planeta');
    expect(editor.storage.searchReplace.results).toHaveLength(3);
  });

  it('replaceAll reemplaza todas', () => {
    editor.commands.setSearch('mundo');
    editor.commands.replaceAll('planeta');
    const text = editor.getText();
    expect(text.toLowerCase()).not.toContain('mundo');
    expect((text.match(/planeta/gi) || []).length).toBe(4);
  });

  it('los resultados se recalculan al editar el documento', () => {
    editor.commands.setSearch('mundo');
    editor.commands.insertContentAt(editor.state.doc.content.size, '<p>mundo final</p>');
    expect(editor.storage.searchReplace.results).toHaveLength(5);
  });

  it('clearSearch limpia resultados', () => {
    editor.commands.setSearch('mundo');
    editor.commands.clearSearch();
    expect(editor.storage.searchReplace.results).toHaveLength(0);
  });
});

describe('SearchReplace con saltos de línea', () => {
  let editor: Editor;
  afterEach(() => editor.destroy());

  const make = (content: string) => {
    editor = new Editor({ extensions: [StarterKit, SearchReplace], content });
  };

  it('\\n encuentra saltos duros y fronteras entre párrafos', () => {
    make('<p>uno<br>dos</p><p>tres</p>');
    editor.commands.setSearch('\n');
    expect(editor.storage.searchReplace.results).toHaveLength(2);
  });

  it('reemplazar \\n\\n por \\n quita párrafos vacíos sobrantes', () => {
    make('<p>uno</p><p></p><p></p><p>dos</p>');
    editor.commands.setSearch('\n\n');
    editor.commands.replaceAll('\n');
    // Una pasada deja un solo párrafo vacío; la segunda lo quita. Los
    // párrafos con texto nunca se funden.
    expect(editor.getHTML()).toBe('<p>uno</p><p></p><p>dos</p>');
    editor.commands.setSearch('\n\n');
    editor.commands.replaceAll('\n');
    expect(editor.getHTML()).toBe('<p>uno</p><p>dos</p>');
  });

  it('unir párrafos reemplazando \\n por espacio', () => {
    make('<p>uno</p><p>dos</p>');
    editor.commands.setSearch('\n');
    editor.commands.replaceAll(' ');
    expect(editor.getHTML()).toBe('<p>uno dos</p>');
  });

  it('quitar saltos duros', () => {
    make('<p>uno<br>dos</p>');
    editor.commands.setSearch('\n');
    editor.commands.replaceAll('');
    expect(editor.getHTML()).toBe('<p>unodos</p>');
  });

  it('no une bloques separados por un nodo no textual', () => {
    make('<p>uno</p><hr><p>dos</p>');
    editor.commands.setSearch('\n');
    expect(editor.storage.searchReplace.results).toHaveLength(0);
  });
});
