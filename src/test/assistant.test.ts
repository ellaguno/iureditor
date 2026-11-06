import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve('conv-1')) }));

import { buildQuestion, stripCitations, threadFor, resetThread } from '../lib/assistant';
import { setLang } from '../lib/i18n';

describe('stripCitations', () => {
  it('quita marcas [n] y [n, m] de la instancia', () => {
    expect(stripCitations('El expediente es 123/2024 [1]. Las partes son A y B [2, 3].')).toBe(
      'El expediente es 123/2024. Las partes son A y B.'
    );
  });

  it('no toca notas al pie ni enlaces', () => {
    const md = 'Texto[^1] y [ver](https://x.mx) y [2](#sec)';
    expect(stripCitations(md)).toBe(md);
  });
});

describe('buildQuestion', () => {
  it('sin selección es la pregunta tal cual', () => {
    expect(buildQuestion('¿Quién demanda?', '  ')).toBe('¿Quién demanda?');
  });

  it('cita la selección antes de la pregunta', () => {
    setLang('es');
    expect(buildQuestion('Mejóralo', 'Línea uno\nLínea dos')).toBe(
      'Texto seleccionado del documento:\n> Línea uno\n> Línea dos\n\nMejóralo'
    );
  });
});

describe('threadFor', () => {
  it('un hilo por documento y alcance, que se reinicia', () => {
    const a = threadFor('/d/a.md', 'case-1');
    expect(threadFor('/d/a.md', 'case-1')).toBe(a);
    expect(threadFor('/d/a.md', null)).not.toBe(a);
    a.messages.push({ role: 'user', content: 'hola' });
    resetThread('/d/a.md', 'case-1');
    expect(threadFor('/d/a.md', 'case-1').messages).toEqual([]);
  });
});

import { buildDocumentMessage, countWords, prepareDocument, rotateConversation } from '../lib/assistant';

describe('análisis del documento', () => {
  it('quita las imágenes en base64 y conserva las de archivo', () => {
    const md = 'Texto\n\n![firma](data:image/png;base64,AAAA)\n\n![logo](assets/logo.png)';
    expect(prepareDocument(md)).toBe('Texto\n\n![firma]()\n\n![logo](assets/logo.png)');
  });

  it('manda el documento entre marcas y la instrucción al final', () => {
    setLang('es');
    expect(buildDocumentMessage('Resúmelo', 'demanda.md', '# Hechos')).toBe(
      'Documento «demanda.md»:\n-----BEGIN DOCUMENT-----\n# Hechos\n-----END DOCUMENT-----\n\nResúmelo'
    );
  });

  it('cuenta palabras', () => {
    expect(countWords('  uno dos\n\ntres  ')).toBe(3);
  });

  it('rotar cambia la conversación y conserva los mensajes', () => {
    const th = threadFor('/d/b.md', null);
    th.messages.push({ role: 'user', content: 'hola' });
    const before = th.conversation;
    rotateConversation(th);
    expect(th.conversation).not.toBe(before);
    expect(th.messages).toHaveLength(1);
  });
});
