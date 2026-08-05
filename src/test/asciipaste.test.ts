import { describe, it, expect } from 'vitest';
import { normalizePastedText, asciiToMarkdown, plainTextToHtml } from '../lib/asciiPaste';
import { markdownToHtml } from '../lib/markdown';

describe('normalizePastedText', () => {
  it('convierte CRLF y CR sueltos a LF', () => {
    expect(normalizePastedText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });
});

describe('plainTextToHtml', () => {
  it('escapa HTML y separa párrafos por saltos de línea', () => {
    expect(plainTextToHtml('a < b\n\nc & d')).toBe('<p>a &lt; b</p><p>c &amp; d</p>');
  });

  it('ignora líneas en blanco', () => {
    expect(plainTextToHtml('\nuno\n\n\ndos\n')).toBe('<p>uno</p><p>dos</p>');
  });
});

describe('asciiToMarkdown — tablas', () => {
  it('convierte una tabla estilo MySQL (+---+) en tabla markdown', () => {
    const input = [
      '+----+-------+',
      '| id | name  |',
      '+----+-------+',
      '|  1 | Ana   |',
      '|  2 | Luis  |',
      '+----+-------+',
    ].join('\n');
    const { text, changed } = asciiToMarkdown(input);
    expect(changed).toBe(true);
    expect(text).toContain('| id | name |');
    expect(text).toContain('| --- | --- |');
    expect(text).toContain('| 1 | Ana |');
    expect(text).toContain('| 2 | Luis |');
    expect(text).not.toContain('+----+');
  });

  it('convierte una tabla de caja Unicode (┌─┬─┐) en tabla markdown', () => {
    const input = [
      '┌────┬───────┐',
      '│ id │ name  │',
      '├────┼───────┤',
      '│  1 │ Ana   │',
      '└────┴───────┘',
    ].join('\n');
    const { text, changed } = asciiToMarkdown(input);
    expect(changed).toBe(true);
    expect(text).toContain('| id | name |');
    expect(text).toContain('| 1 | Ana |');
    expect(text).not.toContain('│');
  });

  it('convierte una tabla psql sin bordes laterales (----+----)', () => {
    const input = [' id | name ', '----+-------', '  1 | Ana', '  2 | Luis', '(2 rows)'].join(
      '\n'
    );
    const { text, changed } = asciiToMarkdown(input);
    expect(changed).toBe(true);
    expect(text).toContain('| id | name |');
    expect(text).toContain('| 2 | Luis |');
    expect(text).toContain('(2 rows)');
  });

  it('rellena filas con menos columnas que el encabezado', () => {
    const input = ['+---+---+', '| a | b |', '+---+---+', '| 1 |', '+---+---+'].join('\n');
    const { text } = asciiToMarkdown(input);
    expect(text).toContain('| 1 |  |');
  });

  it('deja intacta una tabla markdown de pipes', () => {
    const input = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    const { text, changed } = asciiToMarkdown(input);
    expect(changed).toBe(false);
    expect(text).toBe(input);
  });

  it('acepta entrada con CRLF', () => {
    const input = '+---+---+\r\n| a | b |\r\n+---+---+\r\n| 1 | 2 |\r\n+---+---+';
    const { text, changed } = asciiToMarkdown(input);
    expect(changed).toBe(true);
    expect(text).toContain('| a | b |');
    expect(text).not.toContain('\r');
  });

  it('conserva la prosa alrededor de la tabla', () => {
    const input = [
      'Hola Gerardo, espero que estés bien.',
      '',
      '+--------+-------+',
      '| item   | horas |',
      '+--------+-------+',
      '| demo   | 48    |',
      '+--------+-------+',
      '',
      'Saludos,',
    ].join('\n');
    const { text, changed } = asciiToMarkdown(input);
    expect(changed).toBe(true);
    expect(text).toContain('Hola Gerardo, espero que estés bien.');
    expect(text).toContain('| item | horas |');
    expect(text).toContain('Saludos,');
  });
});

describe('asciiToMarkdown — diagramas', () => {
  it('envuelve un diagrama de cajas ASCII en un fence', () => {
    const input = [
      '+--------+     +--------+',
      '| inicio | --> | fin    |',
      '+--------+     +--------+',
    ].join('\n');
    const { text, changed } = asciiToMarkdown(input);
    expect(changed).toBe(true);
    expect(text).toContain('```text');
    expect(text).toContain('| inicio | --> | fin    |');
  });

  it('envuelve un árbol de directorios (├──) en un fence', () => {
    const input = ['├── src/', '│   └── main.ts', '└── package.json'].join('\n');
    const { text, changed } = asciiToMarkdown(input);
    expect(changed).toBe(true);
    expect(text).toContain('```text');
    expect(text).toContain('├── src/');
  });

  it('fusiona en un solo fence un diagrama con conectores y líneas en blanco', () => {
    const input = [
      '+-----+',
      '| uno |',
      '+-----+',
      '',
      '   |',
      '   v',
      '',
      '+-----+',
      '| dos |',
      '+-----+',
    ].join('\n');
    const { text, changed } = asciiToMarkdown(input);
    expect(changed).toBe(true);
    expect(text.match(/```text/g)).toHaveLength(1);
    expect(text).toContain('| uno |');
    expect(text).toContain('   v');
    expect(text).toContain('| dos |');
  });

  it('una caja de una sola columna es arte ASCII, no tabla', () => {
    const input = ['+-------+', '| hola  |', '| mundo |', '+-------+'].join('\n');
    const { text, changed } = asciiToMarkdown(input);
    expect(changed).toBe(true);
    expect(text).toContain('```text');
    expect(text).not.toContain('| --- |');
  });
});

describe('integración con markdownToHtml (lo que inserta el editor)', () => {
  it('una tabla MySQL pegada termina como <table> real', () => {
    const input = [
      '+----+-------+',
      '| id | name  |',
      '+----+-------+',
      '|  1 | Ana   |',
      '+----+-------+',
    ].join('\n');
    const html = markdownToHtml(asciiToMarkdown(input).text);
    expect(html).toContain('<table>');
    expect(html).toContain('<th>id</th>');
    expect(html).toContain('<td>Ana</td>');
  });

  it('un diagrama pegado termina como bloque de código', () => {
    const input = [
      '+--------+     +--------+',
      '| inicio | --> | fin    |',
      '+--------+     +--------+',
    ].join('\n');
    const html = markdownToHtml(asciiToMarkdown(input).text);
    expect(html).toContain('<pre><code');
    expect(html).toContain('| inicio | --&gt; | fin    |');
  });
});

describe('asciiToMarkdown — sin falsos positivos', () => {
  it('no toca prosa normal', () => {
    const input =
      'Hola Gerardo, espero que estés bien.\n\n' +
      'Desde nuestra demo liberamos dos funcionalidades: ponderación de proyectos ' +
      'y heatmap de carga por persona.\n\n¿Te parece que lo tengamos esta semana?';
    const { text, changed } = asciiToMarkdown(input);
    expect(changed).toBe(false);
    expect(text).toBe(input);
  });

  it('no toca listas, encabezados ni reglas horizontales de markdown', () => {
    const input = '# Título\n\n- uno\n- dos\n\n---\n\nTexto final.';
    const { changed } = asciiToMarkdown(input);
    expect(changed).toBe(false);
  });

  it('no toca código con operadores', () => {
    const input = 'const x = a || b;\nif (x > 2 && y < 3) return x + y;';
    const { changed } = asciiToMarkdown(input);
    expect(changed).toBe(false);
  });
});
