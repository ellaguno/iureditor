// @vitest-environment jsdom
// Round-trip COMPLETO: markdown → HTML → esquema de TipTap (lo que el editor
// realmente guarda en memoria) → HTML → markdown. El test de roundtrip.test.ts
// se salta el esquema, y ahí se escondían varios fallos: TipTap normaliza
// (`<li>` gana un `<p>`, las celdas también, las imágenes son bloques…).
import { describe, it, expect } from 'vitest';
import { generateJSON, generateHTML } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Typography from '@tiptap/extension-typography';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { Mermaid } from '../extensions/mermaid';
import { FootnoteRef, FootnoteDef } from '../extensions/footnote';
import { MathInline, MathBlock } from '../extensions/math';
import { LocalImage } from '../extensions/localImage';
import { Callout } from '../extensions/callout';
import { WikiLink } from '../extensions/wikiLink';
import { markdownToHtml, buildTurndownService } from '../lib/markdown';

const extensions = [
  StarterKit.configure({ codeBlock: false, link: false, underline: false }),
  Underline,
  Link,
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Highlight.configure({ multicolor: true }),
  TextStyle,
  Color,
  Subscript,
  Superscript,
  LocalImage.configure({ allowBase64: true }),
  Typography,
  CodeBlockLowlight.configure({ lowlight: createLowlight(common) }),
  Mermaid,
  FootnoteRef,
  FootnoteDef,
  MathInline,
  MathBlock,
  Callout,
  WikiLink,
];

const turndown = buildTurndownService();

/** Lo que hay en el editor tras abrir `md` (HTML canónico de TipTap). */
const open = (md: string): string => generateHTML(generateJSON(markdownToHtml(md), extensions), extensions);
/** Lo que se escribe en disco al guardar el editor que muestra `editorHtml`. */
const save = (editorHtml: string): string =>
  turndown.turndown(generateHTML(generateJSON(editorHtml, extensions), extensions));
/** Abrir → guardar → abrir: el documento debe ser el mismo. */
const reopen = (md: string): { first: string; saved: string; second: string } => {
  const first = open(md);
  const saved = save(first);
  const second = open(saved);
  return { first, saved, second };
};

describe('listas: lo que se escribe en el editor sobrevive a cerrar y abrir', () => {
  it('viñetas con marcador limpio `- ` y sin líneas de espacios', () => {
    const saved = save('<ul><li><p>uno</p></li><li><p>dos</p></li><li><p>tres</p></li></ul>');
    expect(saved).toBe('- uno\n- dos\n- tres');
  });

  it('sublistas sangradas al ancho del marcador y pegadas al ítem', () => {
    expect(save('<ul><li><p>uno</p><ul><li><p>sub</p></li></ul></li><li><p>dos</p></li></ul>')).toBe(
      '- uno\n  - sub\n- dos'
    );
    expect(save('<ol><li><p>uno</p><ul><li><p>a</p></li></ul></li><li><p>dos</p></li></ol>')).toBe(
      '1. uno\n   - a\n2. dos'
    );
  });

  it('ítem con dos párrafos no parte la lista al reabrir', () => {
    const { saved, first, second } = reopen('- uno\n\n  segundo párrafo\n- dos');
    expect(saved).toBe('- uno\n\n  segundo párrafo\n- dos');
    expect(first).toBe('<ul><li><p>uno</p><p>segundo párrafo</p></li><li><p>dos</p></li></ul>');
    expect(second).toBe(first);
  });

  it('párrafo tras una sublista pertenece al ítem padre', () => {
    const html = open('- a\n  - sub\n\n  b\n- c');
    expect(html).toBe(
      '<ul><li><p>a</p><ul><li><p>sub</p></li></ul><p>b</p></li><li><p>c</p></li></ul>'
    );
  });

  it('bloque de código dentro de un ítem', () => {
    const editor = '<ul><li><p>uno</p><pre><code>x = 1\ny = 2</code></pre></li><li><p>dos</p></li></ul>';
    const saved = save(editor);
    expect(saved).toBe('- uno\n\n  ```\n  x = 1\n  y = 2\n  ```\n- dos');
    expect(open(saved)).toBe('<ul><li><p>uno</p><pre><code>x = 1\ny = 2</code></pre></li><li><p>dos</p></li></ul>');
  });

  it('ítem vacío se conserva (y la lista sigue entera)', () => {
    const editor = '<ul><li><p>uno</p></li><li><p></p></li><li><p>tres</p></li></ul>';
    const saved = save(editor);
    expect(saved).toBe('- uno\n-\n- tres');
    expect(open(saved)).toBe(editor);
  });

  it('tareas anidadas conservan el anidamiento', () => {
    const md = '- [ ] a\n  - [x] b\n- [ ] c';
    const { saved, first, second } = reopen(md);
    expect(saved).toBe(md);
    expect(second).toBe(first);
    expect(first).toContain('<ul data-type="taskList"><li data-checked="true"');
  });

  it('lista dentro de una cita se vuelve lista de verdad y se guarda con `> -`', () => {
    const { first, saved } = reopen('> - uno\n> - dos');
    expect(first).toBe('<blockquote><ul><li><p>uno</p></li><li><p>dos</p></li></ul></blockquote>');
    expect(saved).toBe('> - uno\n> - dos');
  });

  it('lista en un callout también', () => {
    const { first, saved } = reopen('> [!NOTE]\n> Ojo:\n> - uno\n> - dos');
    expect(first).toContain('data-callout="note"');
    expect(first).toContain('<ul><li><p>uno</p></li>');
    expect(saved).toBe('> [!NOTE]\n> Ojo:\n>\n> - uno\n> - dos');
    expect(open(saved)).toBe(first);
  });
});

describe('tablas', () => {
  it('lista de viñetas dentro de una celda sobrevive como lista', () => {
    const editor =
      '<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><ul><li><p>uno</p></li><li><p>dos</p></li></ul></td><td><p>x</p></td></tr></tbody></table>';
    const saved = save(editor);
    expect(saved).toBe('| A | B |\n| --- | --- |\n| <ul><li>uno</li><li>dos</li></ul> | x |');
    const reopened = open(saved);
    expect(reopened).toContain('<td colspan="1" rowspan="1"><ul><li><p>uno</p></li><li><p>dos</p></li></ul></td>');
    // Estable: una segunda vuelta no añade nada.
    expect(save(reopened)).toBe(saved);
  });

  it('tareas dentro de una celda', () => {
    const editor =
      '<table><tbody><tr><th><p>A</p></th></tr><tr><td><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>hecho</p></li></ul></td></tr></tbody></table>';
    const saved = save(editor);
    expect(saved).toContain('<ul data-type="taskList"><li data-type="taskItem" data-checked="true">hecho</li></ul>');
    expect(open(saved)).toContain('data-checked="true" data-type="taskItem"');
  });

  it('saltos de línea y varios párrafos en una celda → <br>, sin crecer en cada guardado', () => {
    const twoParas = '<table><tbody><tr><th><p>A</p></th></tr><tr><td><p>uno</p><p>dos</p></td></tr></tbody></table>';
    const saved = save(twoParas);
    expect(saved).toBe('| A |\n| --- |\n| uno<br>dos |');
    const reopened = open(saved);
    expect(reopened).toContain('<td colspan="1" rowspan="1"><p>uno<br>dos</p></td>');
    expect(save(reopened)).toBe(saved);
  });

  it('texto seguido de una lista en la celda no acumula <br>', () => {
    const editor =
      '<table><tbody><tr><th><p>A</p></th></tr><tr><td><p>intro</p><ul><li><p>a</p></li></ul></td></tr></tbody></table>';
    const saved = save(editor);
    expect(saved).toBe('| A |\n| --- |\n| intro<ul><li>a</li></ul> |');
    expect(save(open(saved))).toBe(saved);
  });

  it('imagen en una celda', () => {
    const editor =
      '<table><tbody><tr><th><p>A</p></th></tr><tr><td><p>2</p><img src="assets/x.png" alt="cap"></td></tr></tbody></table>';
    const saved = save(editor);
    expect(saved).toBe('| A |\n| --- |\n| 2<br>![cap](assets/x.png) |');
    const reopened = open(saved);
    expect(reopened).toContain('<p>2</p><img alt="cap" src="assets/x.png" data-orig-src="assets/x.png">');
    expect(save(reopened)).toBe(saved);
  });

  it('tabla de una columna: la fila separadora no se vuelve una fila de datos', () => {
    const { first, second } = reopen('| A |\n| --- |\n| 1 |');
    expect(first).toBe(second);
    expect(first.match(/<tr>/g)).toHaveLength(2);
  });

  it('pipe escapado dentro de una celda', () => {
    const { first, saved } = reopen('| A | B |\n|---|---|\n| a \\| b | 2 |');
    expect(first).toContain('<p>a | b</p>');
    expect(saved).toBe('| A | B |\n| --- | --- |\n| a \\| b | 2 |');
  });

  it('alineación de columnas (`:---:`) se conserva', () => {
    const md = '| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |';
    const { first, saved } = reopen(md);
    expect(first).toContain('<p style="text-align: center;">B</p>');
    expect(first).toContain('<p style="text-align: right;">3</p>');
    expect(saved).toBe('| A | B | C |\n| --- | :---: | ---: |\n| 1 | 2 | 3 |');
  });

  it('colspan se rellena con celdas vacías para no desplazar columnas', () => {
    const saved = save(
      '<table><tbody><tr><th colspan="2"><p>A</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>'
    );
    expect(saved).toBe('| A |  |\n| --- | --- |\n| 1 | 2 |');
  });

  it('fila corta se rellena al abrir', () => {
    const html = open('| A | B |\n|---|---|\n| 1 |');
    expect(html.match(/<td /g)).toHaveLength(2);
  });
});

describe('imágenes', () => {
  it('una imagen sola no deja un párrafo vacío delante', () => {
    const html = open('Antes\n\n![cap](assets/x.png)\n\nDespués');
    expect(html).toBe(
      '<p>Antes</p><img alt="cap" src="assets/x.png" data-orig-src="assets/x.png"><p>Después</p>'
    );
    expect(save(html)).toBe('Antes\n\n![cap](assets/x.png)\n\nDespués');
  });

  it('una imagen con URL blob: no se guarda en el markdown', () => {
    const saved = save('<p>a</p><img src="blob:http://localhost/abc" alt=""><p>b</p>');
    expect(saved).not.toContain('blob:');
  });

  it('las imágenes data: entran al editor (se fijan en assets/ después)', () => {
    const html = open('![x](data:image/png;base64,iVBORw0KGgo=)');
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
  });
});

describe('wikilinks: sobreviven a abrir y guardar', () => {
  const cases = [
    'Ver [[Nota]] y [[carpeta/Otra#Sección 2|el plan]].',
    'Incrustada: ![[diagrama.png]] y [[#Arriba]].',
    '# Título con [[Enlace]]',
    '- uno [[A]]\n- dos [[B|be]]',
    '| Nota | Ver |\n| --- | --- |\n| x | [[Nota\\|alias]] |',
    'Código `[[literal]]` intacto.',
  ];
  for (const md of cases) {
    it(md.split('\n')[0], () => {
      const { saved, first, second } = reopen(md);
      expect(saved).toBe(md);
      expect(second).toBe(first);
    });
  }

  it('es un nodo en el editor (no texto)', () => {
    expect(open('[[Nota|alias]]')).toContain('data-wikilink="Nota"');
    expect(open('`[[x]]`')).not.toContain('data-wikilink');
  });
});
