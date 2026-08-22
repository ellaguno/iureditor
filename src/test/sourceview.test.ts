import { describe, expect, it } from 'vitest';
import { highlightCode, splitHighlightedLines } from '../lib/highlight';

describe('splitHighlightedLines', () => {
  it('parte texto plano sin etiquetas', () => {
    expect(splitHighlightedLines('a\nb\nc')).toEqual(['a', 'b', 'c']);
  });

  it('conserva las líneas vacías (inicio, medio y final)', () => {
    expect(splitHighlightedLines('\na\n\nb\n')).toEqual(['', 'a', '', 'b', '']);
  });

  it('un archivo vacío es una única línea vacía', () => {
    expect(splitHighlightedLines('')).toEqual(['']);
  });

  it('cierra y reabre spans que cruzan el salto de línea', () => {
    const html = '<span class="hljs-code">uno\ndos</span>';
    expect(splitHighlightedLines(html)).toEqual([
      '<span class="hljs-code">uno</span>',
      '<span class="hljs-code">dos</span>',
    ]);
  });

  it('maneja spans anidados abiertos a través de varias líneas', () => {
    const html = '<span class="a">x<span class="b">y\nz\n</span>w</span>';
    expect(splitHighlightedLines(html)).toEqual([
      '<span class="a">x<span class="b">y</span></span>',
      '<span class="a"><span class="b">z</span></span>',
      '<span class="a"><span class="b"></span>w</span>',
    ]);
  });

  it('el resaltado real de markdown se reparte bien formado', () => {
    const lines = splitHighlightedLines(highlightCode('# Título\n\n```js\nlet x = 1\n```', 'markdown'));
    expect(lines).toHaveLength(5);
    // Cada línea debe ser HTML balanceado: mismas aperturas que cierres.
    for (const line of lines) {
      const opens = (line.match(/<span/g) ?? []).length;
      const closes = (line.match(/<\/span>/g) ?? []).length;
      expect(opens).toBe(closes);
    }
    // Y el texto plano reconstruido coincide con el original.
    const text = lines
      .map((l) => l.replace(/<[^>]*>/g, ''))
      .join('\n')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    expect(text).toBe('# Título\n\n```js\nlet x = 1\n```');
  });
});
