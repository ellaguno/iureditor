import { describe, expect, it } from 'vitest';
import {
  applyEol,
  detectEol,
  ensureSaveExtension,
  hasTextExtension,
  isMarkdownPath,
  normalizeEol,
} from '../lib/fileio';

describe('finales de línea (CRLF)', () => {
  it('detecta CRLF y LF', () => {
    expect(detectEol('a\r\nb')).toBe('crlf');
    expect(detectEol('a\nb')).toBe('lf');
    expect(detectEol('sin saltos')).toBe('lf');
  });

  it('normaliza CRLF y CR sueltos a LF', () => {
    expect(normalizeEol('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('repone CRLF al guardar y deja LF intacto', () => {
    expect(applyEol('a\nb\nc', 'crlf')).toBe('a\r\nb\r\nc');
    expect(applyEol('a\nb', 'lf')).toBe('a\nb');
  });

  it('cargar y guardar un archivo CRLF es identidad', () => {
    const original = 'línea 1\r\n\r\nlínea 3\r\n';
    expect(applyEol(normalizeEol(original), detectEol(original))).toBe(original);
  });
});

describe('ensureSaveExtension', () => {
  it('añade .md cuando no hay extensión', () => {
    expect(ensureSaveExtension('/docs/informe')).toBe('/docs/informe.md');
  });

  it('respeta .md y .markdown', () => {
    expect(ensureSaveExtension('/docs/informe.md')).toBe('/docs/informe.md');
    expect(ensureSaveExtension('/docs/informe.MARKDOWN')).toBe('/docs/informe.MARKDOWN');
  });

  it('respeta una extensión de texto explícita (no la convierte a .md)', () => {
    expect(ensureSaveExtension('/docs/notas.txt')).toBe('/docs/notas.txt');
    expect(ensureSaveExtension('/docs/config.env')).toBe('/docs/config.env');
    expect(ensureSaveExtension('/docs/datos.csv')).toBe('/docs/datos.csv');
  });

  it('una extensión desconocida sigue recibiendo .md', () => {
    expect(ensureSaveExtension('/docs/informe.v2')).toBe('/docs/informe.v2.md');
  });
});

describe('hasTextExtension / isMarkdownPath', () => {
  it('clasifica txt como texto y no como markdown', () => {
    expect(hasTextExtension('/a/b/notas.txt')).toBe(true);
    expect(isMarkdownPath('/a/b/notas.txt')).toBe(false);
  });

  it('los dotfiles tipo .env cuentan como texto', () => {
    expect(hasTextExtension('/a/b/.env')).toBe(true);
  });
});
