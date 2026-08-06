import { describe, it, expect } from 'vitest';
import {
  findMatches,
  injectSearchMarks,
  replaceAllMatches,
  replaceMatch,
} from '../lib/sourceSearch';
import { highlightCode } from '../lib/highlight';

const HIT = 'iur-search-hit';
// La coincidencia activa lleva además la clase del resaltado naranja.
const CUR = 'iur-search-hit iur-search-current';

describe('findMatches', () => {
  it('encuentra todas las apariciones en orden', () => {
    expect(findMatches('foo bar foo', 'foo', true)).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
  });

  it('sin distinguir mayúsculas por defecto', () => {
    expect(findMatches('Foo FOO', 'foo', false)).toHaveLength(2);
    expect(findMatches('Foo FOO', 'foo', true)).toHaveLength(0);
  });

  it('trata el término como texto literal, no como regexp', () => {
    expect(findMatches('a.c abc', 'a.c', true)).toEqual([{ start: 0, end: 3 }]);
    expect(findMatches('precio (usd)', '(usd)', true)).toEqual([{ start: 7, end: 12 }]);
  });

  it('no devuelve nada con término vacío', () => {
    expect(findMatches('hola', '', false)).toEqual([]);
  });

  it('no solapa coincidencias', () => {
    expect(findMatches('aaaa', 'aa', true)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it('los índices siguen siendo válidos con caracteres que cambian de largo al bajar a minúsculas', () => {
    // 'İ'.toLowerCase() ocupa 2 caracteres: buscar sobre el texto en
    // minúsculas desplazaría los índices posteriores.
    const text = 'İstanbul y luego foo';
    const [m] = findMatches(text, 'foo', false);
    expect(text.slice(m.start, m.end)).toBe('foo');
  });
});

describe('injectSearchMarks', () => {
  it('envuelve las coincidencias y marca la activa', () => {
    const out = injectSearchMarks('foo bar foo', findMatches('foo bar foo', 'foo', true), 1);
    expect(out).toBe(
      `<span class="${HIT}">foo</span> bar <span class="${HIT} iur-search-current">foo</span>`
    );
  });

  it('devuelve el HTML intacto si no hay coincidencias', () => {
    expect(injectSearchMarks('<span class="hljs-x">a</span>', [], 0)).toBe(
      '<span class="hljs-x">a</span>'
    );
  });

  it('cuenta una entidad HTML como un solo carácter', () => {
    // Texto plano "a & b": el '&' escapado no debe descuadrar los índices.
    const out = injectSearchMarks('a &amp; b', [{ start: 4, end: 5 }], 0);
    expect(out).toBe(`a &amp; <span class="${CUR}">b</span>`);
  });

  it('no cruza etiquetas: cierra y reabre el span a cada lado', () => {
    // Texto plano "abcd", partido en dos spans de resaltado.
    const out = injectSearchMarks(
      '<span class="hljs-k">ab</span>cd',
      [{ start: 1, end: 3 }],
      0
    );
    expect(out).toBe(
      `<span class="hljs-k">a<span class="${CUR}">b</span></span><span class="${CUR}">c</span>d`
    );
    // Y el HTML sigue balanceado.
    expect(out.match(/<span/g)?.length).toBe(out.match(/<\/span>/g)?.length);
  });

  it('sobre HTML real de highlight.js conserva el texto visible', () => {
    const code = '#!/bin/bash\necho "hola mundo"\n';
    const html = highlightCode(code, 'bash');
    const matches = findMatches(code, 'hola', false);
    expect(matches).toHaveLength(1);
    const marked = injectSearchMarks(html, matches, 0);
    const strip = (s: string) => s.replace(/<[^>]*>/g, '');
    expect(strip(marked)).toBe(strip(html));
    expect(marked).toContain(HIT);
    expect(marked.match(/<span/g)?.length).toBe(marked.match(/<\/span>/g)?.length);
  });
});

describe('reemplazo', () => {
  it('sustituye una coincidencia', () => {
    expect(replaceMatch('foo bar', { start: 4, end: 7 }, 'baz')).toBe('foo baz');
  });

  it('sustituye todas sin descuadrar los índices', () => {
    const text = 'foo bar foo';
    expect(replaceAllMatches(text, findMatches(text, 'foo', true), 'xyzzy')).toBe(
      'xyzzy bar xyzzy'
    );
  });
});
