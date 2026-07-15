import { describe, it, expect } from 'vitest';
import { splitFrontMatter, joinFrontMatter } from '../lib/markdown';

describe('splitFrontMatter', () => {
  it('separa un bloque YAML inicial y lo reconstruye verbatim', () => {
    const raw = '---\ntitle: Demanda\nautor: Eduardo\n---\n\n# Hechos\n\nTexto.';
    const { frontMatter, body } = splitFrontMatter(raw);
    expect(frontMatter).toBe('---\ntitle: Demanda\nautor: Eduardo\n---');
    expect(body).toBe('# Hechos\n\nTexto.');
    expect(joinFrontMatter(frontMatter, body)).toBe(raw);
  });

  it('acepta cierre con puntos suspensivos YAML (...)', () => {
    const raw = '---\ntitle: x\n...\ncuerpo';
    const { frontMatter, body } = splitFrontMatter(raw);
    expect(frontMatter).toBe('---\ntitle: x\n...');
    expect(body).toBe('cuerpo');
  });

  it('acepta front matter vacío', () => {
    const { frontMatter, body } = splitFrontMatter('---\n---\nhola');
    expect(frontMatter).toBe('---\n---');
    expect(body).toBe('hola');
  });

  it('no confunde una regla horizontal inicial con front matter', () => {
    const raw = '---\nEsto es texto normal\n---\nmás texto';
    const { frontMatter, body } = splitFrontMatter(raw);
    expect(frontMatter).toBe('');
    expect(body).toBe(raw);
  });

  it('ignora documentos sin front matter', () => {
    const raw = '# Título\n\nPárrafo con --- en medio.';
    expect(splitFrontMatter(raw)).toEqual({ frontMatter: '', body: raw });
  });

  it('no trata un delimitador a mitad de documento como front matter', () => {
    const raw = 'párrafo\n---\nkey: value\n---\n';
    expect(splitFrontMatter(raw).frontMatter).toBe('');
  });

  it('joinFrontMatter sin front matter devuelve el cuerpo tal cual', () => {
    expect(joinFrontMatter('', 'cuerpo')).toBe('cuerpo');
  });
});
