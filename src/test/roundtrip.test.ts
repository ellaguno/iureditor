// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markdownToHtml, buildTurndownService, prepareContent } from '../lib/markdown';

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'golden.md'),
  'utf-8'
);

// Normalización mínima: el round-trip no garantiza byte-igualdad (líneas en
// blanco colapsadas, separadores de tabla), pero sí igualdad semántica tras
// normalizar espaciado.
const normalize = (md: string): string =>
  md
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\| ?-{3,}.*$/gm, '|---|') // separadores de tabla equivalentes
    .trim();

const roundTrip = (md: string): string => {
  const html = markdownToHtml(md);
  const service = buildTurndownService();
  return service.turndown(html);
};

describe('round-trip markdown → HTML → markdown', () => {
  it('es estable para el fixture golden (idempotente tras primera pasada)', () => {
    const once = roundTrip(fixture);
    const twice = roundTrip(once);
    expect(normalize(twice)).toBe(normalize(once));
  });

  it('conserva los encabezados', () => {
    const out = roundTrip(fixture);
    expect(out).toContain('# Documento de prueba');
    expect(out).toContain('## Listas');
  });

  it('conserva el bloque mermaid verbatim', () => {
    const out = roundTrip(fixture);
    expect(out).toContain('```mermaid\nflowchart TD\n    A[Inicio] --> B{Decisión}');
    expect(out).toContain('B -->|No| A\n```');
  });

  it('conserva el código python con caracteres markdown dentro', () => {
    const out = roundTrip(fixture);
    expect(out).toContain('```python');
    expect(out).toContain('# comentario con # y | y *');
  });

  it('conserva las task lists', () => {
    const out = roundTrip(fixture);
    expect(out).toContain('- [ ] Tarea pendiente');
    expect(out).toContain('- [x] Tarea completada');
  });

  it('conserva la tabla con formato inline', () => {
    const out = roundTrip(fixture);
    expect(out).toContain('| Columna A | Columna B | Columna C |');
    expect(out).toContain('| celda 1 | **negrita** | dato |');
  });

  it('conserva negritas, cursivas, enlaces e imágenes', () => {
    const out = roundTrip(fixture);
    expect(out).toContain('**negritas**');
    expect(out).toContain('*cursivas*');
    expect(out).toContain('[enlace](https://example.com)');
    expect(out).toContain('![logo](assets/logo.png)');
  });

  it('no acumula backslashes en round-trips repetidos', () => {
    let md = fixture;
    for (let i = 0; i < 3; i++) md = roundTrip(md);
    expect(md).not.toMatch(/\\\\[#\-*+>|]/);
  });

  it('healEscapedMarkdown repara archivos corruptos vía prepareContent', () => {
    const corrupted = '\\\\# No es encabezado\n\\\\- no es lista';
    const html = prepareContent(corrupted);
    expect(html).not.toContain('\\\\');
  });

  it('no aplica cursivas/negritas dentro de código inline', () => {
    const html = markdownToHtml('Usa `mcgenera_posicion_k` y `con_*asteriscos*`.');
    expect(html).toContain('<code>mcgenera_posicion_k</code>');
    expect(html).toContain('<code>con_*asteriscos*</code>');
    expect(html).not.toContain('<em>');
    const out = roundTrip(fixture);
    expect(out).toContain('`mcgenera_posicion_k`');
    expect(out).toContain('`tabla_con_*asteriscos*`');
  });

  it('no aplica cursivas dentro de URLs de imágenes y enlaces', () => {
    const html = markdownToHtml(
      '![captura_de_pantalla](assets/captura_con_guiones_2.png) y [liga_x](https://x.com/ruta_con_guiones.html)'
    );
    expect(html).toContain('src="assets/captura_con_guiones_2.png"');
    expect(html).toContain('href="https://x.com/ruta_con_guiones.html"');
    expect(html).not.toContain('<em>');
    const out = roundTrip(fixture);
    expect(out).toContain('![captura_de_pantalla](assets/captura_con_guiones_bajos_2.png)');
    expect(out).toContain('[enlace_con_guiones](https://example.com/ruta_con_guiones/pagina_final.html)');
  });

  it('markdownToHtml genera div mermaid con data-code', () => {
    const html = markdownToHtml('```mermaid\ngraph LR\nA-->B\n```');
    expect(html).toContain('data-type="mermaid"');
    expect(html).toContain('data-code="graph LR');
  });

  it('convierte callouts a div[data-callout] y de vuelta a > [!TIPO]', () => {
    const html = markdownToHtml('> [!NOTE]\n> Primera línea.\n> Segunda línea.');
    expect(html).toContain('data-callout="note"');
    expect(html).not.toContain('<blockquote');

    const service = buildTurndownService();
    const md = service.turndown(html);
    expect(md).toContain('> [!NOTE]');
    expect(md).toContain('> Primera línea.');
    expect(md).toContain('> Segunda línea.');

    // Un blockquote normal NO debe convertirse en callout.
    const plain = markdownToHtml('> solo una cita');
    expect(plain).toContain('<blockquote');
    expect(plain).not.toContain('data-callout');
  });
});
