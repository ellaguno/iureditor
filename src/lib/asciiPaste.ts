// Preprocesado de texto plano pegado desde terminales u otras herramientas:
//
//  1. normalizePastedText: normaliza fines de línea. Las terminales (sobre
//     todo en Windows, tmux o al copiar salida de comandos) entregan CRLF o
//     CR sueltos; los regex multilinea de markdownToHtml anclan con `$` y un
//     `\r` residual rompe fences, tablas y deja párrafos fantasma.
//  2. asciiToMarkdown: detecta tablas ASCII (bordes `+---+` estilo
//     MySQL/psql, o cajas Unicode `┌─┬─┐`) y las convierte en tablas
//     markdown de pipes que el pipeline existente renderiza como nodos
//     reales; los bloques con pinta de diagrama ASCII (cajas con flechas,
//     árboles `├──`) se envuelven en un fence ```text para preservar el
//     monoespaciado.
//  3. plainTextToHtml: inserción manual de texto plano como párrafos
//     (respaldo cuando sólo hubo que limpiar CRs y no aplica conversión).

/** CRLF y CR sueltos → LF. */
export const normalizePastedText = (text: string): string => text.replace(/\r\n?/g, '\n');

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Texto plano → párrafos HTML. Sólo las líneas EN BLANCO separan párrafos;
 *  un salto simple queda como salto duro (<br>) dentro del mismo párrafo.
 *  (El paste por defecto de ProseMirror convierte cada salto en un párrafo
 *  nuevo, que al serializar gana una línea en blanco — texto pegado desde
 *  una terminal acababa con "retornos de más".) */
export const plainTextToHtml = (text: string): string =>
  text
    .split(/\n{2,}/)
    .filter(p => p.trim() !== '')
    .map(p => `<p>${p.replace(/^\n+|\n+$/g, '').split('\n').map(escapeHtml).join('<br>')}</p>`)
    .join('');

// ── Clasificación de líneas ─────────────────────────────────────────────────

// Borde ASCII estilo MySQL/ascii-table: +----+----+ (admite = y : de psql).
const PLUS_BORDER = /^\s*\+(?:[-=:]+\+)+\s*$/;

// Borde de caja Unicode: la línea sólo contiene caracteres de dibujo de caja
// y al menos un trazo horizontal (┌─┬─┐, ├─┼─┤, ╚═╩═╝…).
const isBoxBorder = (line: string): boolean =>
  /^\s*[─-╿]+\s*$/.test(line) && /[─━═]/.test(line);

const isBorderLine = (line: string): boolean => PLUS_BORDER.test(line) || isBoxBorder(line);

// Fila de tabla: empieza y termina con un delimitador vertical (| │ ║ ┃).
const PIPE_ROW = /^\s*[|│║┃].+[|│║┃]\s*$/;
const isPipeRow = (line: string): boolean => PIPE_ROW.test(line);

// Separador de psql sin bordes:  ----+------+----
const PSQL_SEP = /^\s*:?-+:?(?:\+:?-+:?)+\s*$/;

// Caracteres de dibujo (cajas, flechas, bloques Unicode).
const DRAW_RE = /[─-╿←-⇿■-◿]/;

// Línea de puro trazo ASCII una vez quitados los espacios: `|`, `v`, `+--->`.
const PURE_TRACE = /^[+\-|\\/<>^v.:*_]+$/;

// ¿La línea parece parte de un diagrama ASCII? O contiene caracteres de
// dibujo Unicode, o es puro trazo, o una fracción alta de sus caracteres son
// estructurales.
const isDiagramLine = (line: string): boolean => {
  const compact = line.replace(/\s+/g, '');
  if (!compact) return false;
  if (DRAW_RE.test(compact)) return true;
  if (PURE_TRACE.test(compact)) return true;
  const structural = (compact.match(/[+\-|\\/<>^_=.]/g) ?? []).length;
  return structural >= 2 && structural / compact.length >= 0.3;
};

// Un bloque sólo se trata como diagrama si alguna línea tiene una señal
// fuerte (dibujo Unicode, borde, línea encajonada) o si TODO el bloque es
// puro trazo (conectores `|` / `v` entre cajas). Evita que dos líneas de
// prosa con signos sueltos acaben dentro de un fence.
const hasStrongDiagramLine = (run: string[]): boolean =>
  run.some(
    l =>
      DRAW_RE.test(l) ||
      PLUS_BORDER.test(l) ||
      /^\s*[+|].*[+|]\s*$/.test(l) ||
      /[-+]{4,}/.test(l.trim())
  ) || run.every(l => PURE_TRACE.test(l.replace(/\s+/g, '')));

// ── Parseo de tablas ────────────────────────────────────────────────────────

// Divide una fila en celdas quitando los delimitadores de los extremos.
const splitCells = (line: string): string[] => {
  const trimmed = line.trim().replace(/^[|│║┃]/, '').replace(/[|│║┃]\s*$/, '');
  return trimmed.split(/[|│║┃]/).map(c => c.trim());
};

// Emite una tabla markdown a partir de filas de celdas (la primera es el
// encabezado; se rellenan filas cortas para que todas tengan igual anchura).
const emitMarkdownTable = (rows: string[][]): string[] => {
  const cols = Math.max(...rows.map(r => r.length));
  const pad = (r: string[]): string[] => [...r, ...Array(cols - r.length).fill('')];
  const fmt = (r: string[]): string => `| ${pad(r).join(' | ')} |`;
  return [fmt(rows[0]), `| ${Array(cols).fill('---').join(' | ')} |`, ...rows.slice(1).map(fmt)];
};

// ── Conversión principal ────────────────────────────────────────────────────

export interface AsciiConversion {
  text: string;
  /** true si se convirtió al menos una tabla o diagrama. */
  changed: boolean;
}

export const asciiToMarkdown = (input: string): AsciiConversion => {
  const source = normalizePastedText(input);
  const lines = source.split('\n');
  const out: string[] = [];
  let changed = false;
  // Índice en `out` del cierre del último fence emitido: si entre ese cierre
  // y el bloque actual sólo hay líneas en blanco, se fusionan en un único
  // fence (diagramas con huecos internos: caja, flecha, caja).
  let lastFenceClose = -1;

  const pushBlank = () => {
    if (out.length > 0 && out[out.length - 1] !== '') out.push('');
  };

  const emitTable = (rows: string[][]) => {
    pushBlank();
    out.push(...emitMarkdownTable(rows));
    out.push('');
    changed = true;
  };

  const emitFence = (body: string[]) => {
    const trimmed = body.map(l => l.replace(/[ \t]+$/, ''));
    if (lastFenceClose >= 0 && out.slice(lastFenceClose + 1).every(l => l === '')) {
      // Fusionar con el fence anterior conservando las líneas en blanco.
      const blanks = out.length - (lastFenceClose + 1);
      out.splice(lastFenceClose);
      out.push(...Array(blanks).fill(''), ...trimmed, '```');
    } else {
      pushBlank();
      out.push('```text', ...trimmed, '```');
    }
    lastFenceClose = out.length - 1;
    out.push('');
    changed = true;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Bloque "con trazo": bordes, filas con pipes o líneas de diagrama.
    if (isBorderLine(line) || isPipeRow(line) || isDiagramLine(line)) {
      let j = i;
      while (
        j < lines.length &&
        (isBorderLine(lines[j]) || isPipeRow(lines[j]) || isDiagramLine(lines[j]))
      ) {
        j++;
      }
      const run = lines.slice(i, j);
      const borders = run.filter(isBorderLine).length;
      const pipeRows = run.filter(isPipeRow);
      const pureTable = run.every(l => isBorderLine(l) || isPipeRow(l));

      if (pureTable && borders === 0) {
        // Sólo filas de pipes: puede ser ya una tabla markdown; el pipeline
        // existente la maneja. No tocar.
        out.push(...run);
      } else if (pureTable && pipeRows.length >= 2) {
        const rows = pipeRows.map(splitCells);
        if (Math.max(...rows.map(r => r.length)) >= 2) {
          emitTable(rows);
        } else if (hasStrongDiagramLine(run)) {
          // Caja de una sola columna: es arte ASCII, no una tabla.
          emitFence(run);
        } else {
          out.push(...run);
        }
      } else if (run.length >= 2 && hasStrongDiagramLine(run)) {
        emitFence(run);
      } else {
        out.push(...run);
      }
      i = j;
      continue;
    }

    // Tabla psql sin bordes laterales:  cabecera / ----+---- / filas.
    if (line.includes('|') && i + 1 < lines.length && PSQL_SEP.test(lines[i + 1])) {
      let j = i + 2;
      while (j < lines.length && lines[j].includes('|') && !isPipeRow(lines[j])) j++;
      const rows = [lines[i], ...lines.slice(i + 2, j)].map(l =>
        l.split('|').map(c => c.trim())
      );
      if (rows.length >= 2 && rows[0].length >= 2) {
        emitTable(rows);
        i = j;
        continue;
      }
    }

    out.push(line);
    i++;
  }

  if (!changed) return { text: source, changed: false };
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n'), changed: true };
};
