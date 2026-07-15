// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { markdownToHtml, buildTurndownService } from '../lib/markdown';
import { buildTocHtml, uniqueSlugs } from '../lib/outline';

const roundTrip = (md: string): string => {
  const html = markdownToHtml(md);
  return buildTurndownService().turndown(html);
};

describe('notas al pie', () => {
  it('convierte referencias y definiciones a nodos y de vuelta', () => {
    const md = 'Texto con una nota[^1] y otra[^nota-b].\n\n[^1]: Primera nota.\n\n[^nota-b]: Segunda **importante**.';
    const html = markdownToHtml(md);
    expect(html).toContain('<sup data-fn-ref="1">1</sup>');
    expect(html).toContain('<sup data-fn-ref="nota-b">nota-b</sup>');
    expect(html).toContain('<div data-fn-def="1">Primera nota.</div>');
    expect(html).toContain('<div data-fn-def="nota-b">Segunda <strong>importante</strong>.</div>');

    const out = roundTrip(md);
    expect(out).toContain('nota[^1]');
    expect(out).toContain('otra[^nota-b]');
    expect(out).toContain('[^1]: Primera nota.');
    expect(out).toContain('[^nota-b]: Segunda **importante**.');
  });

  it('es idempotente en round-trip doble', () => {
    const md = 'A[^1].\n\n[^1]: Nota.';
    const once = roundTrip(md);
    expect(roundTrip(once)).toBe(once);
  });

  it('no confunde checkboxes de task list con referencias', () => {
    const md = '- [x] hecho\n- [ ] pendiente';
    const out = roundTrip(md);
    expect(out).toContain('- [x] hecho');
    expect(out).toContain('- [ ] pendiente');
  });
});

describe('listas anidadas', () => {
  it('conserva la anidación de listas con viñetas', () => {
    const md = '- padre\n    - hijo\n        - nieto\n- otro padre';
    const html = markdownToHtml(md);
    expect(html).toBe(
      '<ul><li>padre<ul><li>hijo<ul><li>nieto</li></ul></li></ul></li><li>otro padre</li></ul>'
    );
  });

  it('round-trip estable de lista anidada', () => {
    const md = '- padre\n    - hijo\n- otro';
    const once = roundTrip(md);
    expect(roundTrip(once)).toBe(once);
    // La anidación sobrevive: el hijo sigue indentado
    expect(once).toMatch(/-\s+padre\n\s+-\s+hijo/);
  });

  it('lista ordenada anidada dentro de lista con viñetas', () => {
    const md = '- padre\n    1. uno\n    2. dos';
    const html = markdownToHtml(md);
    expect(html).toBe('<ul><li>padre<ol><li>uno</li><li>dos</li></ol></li></ul>');
  });

  it('task list anidada conserva estado', () => {
    const md = '- [x] padre\n    - [ ] hijo';
    const html = markdownToHtml(md);
    expect(html).toContain('data-checked="true"');
    expect(html).toContain('data-checked="false"');
    // La sublista vive dentro del <li> del padre
    expect(html).toMatch(/<li data-type="taskItem" data-checked="true"><p>padre<\/p><ul/);
  });

  it('listas planas siguen funcionando igual', () => {
    expect(markdownToHtml('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(markdownToHtml('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
  });
});

describe('índice (TOC)', () => {
  it('genera slugs únicos y deduplicados', () => {
    expect(uniqueSlugs(['Hechos', 'Hechos', 'Fundamentos de Derecho'])).toEqual([
      'hechos',
      'hechos-1',
      'fundamentos-de-derecho',
    ]);
  });

  it('construye una lista anidada de enlaces', () => {
    const toc = buildTocHtml([
      { level: 1, text: 'Título', pos: 0 },
      { level: 2, text: 'Sección A', pos: 10 },
      { level: 2, text: 'Sección B', pos: 20 },
      { level: 1, text: 'Cierre', pos: 30 },
    ]);
    expect(toc).toBe(
      '<ul><li><a href="#título">Título</a><ul><li><a href="#sección-a">Sección A</a></li>' +
        '<li><a href="#sección-b">Sección B</a></li></ul></li><li><a href="#cierre">Cierre</a></li></ul>'
    );
  });

  it('devuelve vacío sin encabezados', () => {
    expect(buildTocHtml([])).toBe('');
  });
});
