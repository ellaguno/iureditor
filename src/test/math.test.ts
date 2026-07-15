// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { markdownToHtml, buildTurndownService } from '../lib/markdown';

const roundTrip = (md: string): string => {
  const html = markdownToHtml(md);
  return buildTurndownService().turndown(html);
};

describe('math inline ($…$)', () => {
  it('convierte a nodo y de vuelta', () => {
    const md = 'La fórmula $E = mc^2$ es famosa.';
    const html = markdownToHtml(md);
    expect(html).toContain('data-math-inline="true"');
    expect(html).toContain('data-latex="E = mc^2"');
    expect(roundTrip(md)).toBe(md);
  });

  it('no confunde importes en pesos', () => {
    const md = 'El precio subió de $100 a $200 pesos.';
    const html = markdownToHtml(md);
    expect(html).not.toContain('data-math-inline');
    expect(html).toContain('$100 a $200');
  });

  it('no abre fórmula con $ escapado', () => {
    const md = 'Literal \\$x\\$ sin fórmula.';
    expect(markdownToHtml(md)).not.toContain('data-math-inline');
  });

  it('conserva LaTeX con caracteres especiales de markdown', () => {
    const md = 'Fracción $\\frac{a_1}{b_2} \\cdot x^{n}$ inline.';
    const out = roundTrip(md);
    expect(out).toBe(md);
  });

  it('el $ dentro de código inline no abre fórmula', () => {
    const md = 'Var `$HOME` y `$PATH` de shell.';
    expect(markdownToHtml(md)).not.toContain('data-math-inline');
  });
});

describe('math en bloque ($$…$$)', () => {
  it('multilínea convierte y regresa', () => {
    const md = 'Antes.\n\n$$\n\\int_0^1 x\\,dx = \\frac{1}{2}\n$$\n\nDespués.';
    const html = markdownToHtml(md);
    expect(html).toContain('data-math-block="true"');
    expect(html).toContain('\\int_0^1');
    const out = roundTrip(md);
    expect(out).toContain('$$\n\\int_0^1 x\\,dx = \\frac{1}{2}\n$$');
  });

  it('una sola línea también funciona', () => {
    const md = '$$a^2 + b^2 = c^2$$';
    const html = markdownToHtml(md);
    expect(html).toContain('data-math-block="true"');
    const out = roundTrip(md);
    expect(out).toBe('$$\na^2 + b^2 = c^2\n$$');
  });

  it('es idempotente', () => {
    const md = 'Texto $a+b$ y bloque:\n\n$$\nx = y\n$$';
    const once = roundTrip(md);
    expect(roundTrip(once)).toBe(once);
  });

  it('$$ dentro de bloque de código queda literal', () => {
    const md = '```txt\n$$no es math$$\n```';
    const html = markdownToHtml(md);
    expect(html).not.toContain('data-math-block');
    expect(html).toContain('$$no es math$$');
  });
});
