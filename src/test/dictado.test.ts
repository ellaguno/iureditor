// @vitest-environment jsdom
// Dictado de IureVoz por `iureditor://insert`: los tramos llegan uno por frase, con
// «\n» como salto de bloque y marcas de Markdown al inicio del renglón.
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { insertarDictado, editarDictado } from '../lib/dictado';

let editor: Editor | null = null;

const dictar = (...tramos: string[]) => {
  editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit], content: '<p></p>' });
  for (const t of tramos) insertarDictado(editor, t);
  // TipTap deja un párrafo vacío de cola tras una lista o un título (para seguir escribiendo)
  return editor.getHTML().replace(/<p><\/p>$/, '');
};

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('edición por voz', () => {
  const con = (...pasos: (string | ['edit', 'delete-word' | 'delete-line' | 'undo'])[]) => {
    editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit], content: '<p></p>' });
    for (const p of pasos) {
      if (typeof p === 'string') insertarDictado(editor, p);
      else editarDictado(editor, p[1]);
    }
    return editor.getHTML().replace(/<p><\/p>$/, '');
  };

  it('borrar palabra', () => {
    expect(con('Hola mundo cruel', ['edit', 'delete-word'])).toBe('<p>Hola mundo </p>');
  });

  it('borrar palabra dos veces', () => {
    expect(con('Hola mundo cruel', ['edit', 'delete-word'], ['edit', 'delete-word'])).toBe('<p>Hola </p>');
  });

  it('borrar línea: quita el párrafo actual completo y vuelve al anterior', () => {
    expect(con('Primero.\n', ' Segundo renglón', ['edit', 'delete-line'])).toBe('<p>Primero.</p>');
  });

  it('borrar línea en la única viñeta: se va la lista', () => {
    expect(con('Lista:\n- uno', ['edit', 'delete-line'])).toBe('<p>Lista:</p>');
  });

  it('borrar línea y seguir dictando en el renglón anterior', () => {
    expect(con('Primero.\n', ' Segundo', ['edit', 'delete-line'], ' Más')).toBe('<p>Primero. Más</p>');
  });

  it('borrar línea en una viñeta', () => {
    expect(con('Lista:\n- uno', '\n- dos', ['edit', 'delete-line'])).toBe('<p>Lista:</p><ul><li><p>uno</p></li></ul>');
  });
});

describe('dictado por enlace', () => {
  it('«punto y aparte» abre un párrafo nuevo', () => {
    expect(dictar('Hola', '.\n', ' Mundo')).toBe('<p>Hola.</p><p>Mundo</p>');
  });

  it('viñetas: cada «viñeta» es un elemento y un «punto y aparte» sale de la lista', () => {
    expect(dictar('Pendientes:\n- Revisar contrato', '\n- Llamar al cliente', '.\n', ' Fin')).toBe(
      '<p>Pendientes:</p><ul><li><p>Revisar contrato</p></li><li><p>Llamar al cliente.</p></li></ul><p>Fin</p>'
    );
  });

  it('viñetas numeradas', () => {
    expect(dictar('Elementos:\n1. Uno', '\n2. Dos', '\n3. Tres')).toBe(
      '<p>Elementos:</p><ol><li><p>Uno</p></li><li><p>Dos</p></li><li><p>Tres</p></li></ol>'
    );
  });

  it('«punto y aparte» y luego viñeta numerada: sin párrafo vacío en medio', () => {
    expect(dictar('fin.\n\n1. Otra')).toBe('<p>fin.</p><ol><li><p>Otra</p></li></ol>');
  });

  it('título al inicio del documento y párrafo después', () => {
    expect(dictar('\n# Informe de avance', '\n', 'Texto')).toBe('<h1>Informe de avance</h1><p>Texto</p>');
  });

  it('una marca a media frase no es marca', () => {
    expect(dictar('Uso el - y el # como signos')).toBe('<p>Uso el - y el # como signos</p>');
  });

  it('una viñeta sola y el texto en la frase siguiente', () => {
    expect(dictar('\n- ', ' comprar pan')).toBe('<ul><li><p>comprar pan</p></li></ul>');
  });
});
