// Carga perezosa de mermaid (~2MB) sólo cuando aparece un diagrama.
// Portado de MarkdownRenderer.tsx (Colaborador especialista).

let mermaidInstance: typeof import('mermaid').default | null = null;
let mermaidInitPromise: Promise<typeof import('mermaid').default> | null = null;

const BASE_CONFIG = {
  startOnLoad: false,
  theme: 'default' as const,
  securityLevel: 'strict' as const,
  // Fuente EXPLÍCITA y la misma que usa resvg al rasterizar (sans-serif →
  // DejaVu Sans en Rust): con 'inherit', mermaid medía el texto con la fuente
  // de la app pero el PNG se dibujaba con DejaVu (más ancha) y las etiquetas
  // salían descentradas o recortadas en su burbuja.
  fontFamily: '"DejaVu Sans", Verdana, Arial, sans-serif',
  // Labels como <text> SVG (no <foreignObject>): resvg (export PNG/DOCX)
  // omite foreignObject en silencio y los nodos salían como cajas vacías.
  // OJO: mermaid 11 sólo respeta htmlLabels:false en el NIVEL SUPERIOR de
  // la config; flowchart.htmlLabels por sí solo no aplica a los nodos.
  htmlLabels: false,
  flowchart: { htmlLabels: false },
  class: { htmlLabels: false },
  themeVariables: {
    // El tema default invierte el color de etiqueta de las secciones 0 y 3
    // (cScaleLabel = invert(labelTextColor)): en mapas mentales y timelines
    // eso daba texto blanco sobre relleno pastel, ilegible. Se fuerzan
    // oscuras como el resto de secciones.
    cScaleLabel0: '#333333',
    cScaleLabel3: '#333333',
  },
};

// Con htmlLabels:false los labels se dibujan como <text> SVG y mermaid no
// interpreta HTML: etiquetas como <b> o <i> aparecían literales en el
// diagrama. Se eliminan antes de renderizar (se conserva <br>, que mermaid
// sí traduce a salto de línea incluso en modo texto).
const stripHtmlInLabels = (code: string): string =>
  code.replace(/<\/?(?:b|strong|i|em|u|s|small|sup|sub|span|font|mark)(?:\s[^>]*)?>/gi, '');

export async function getMermaid() {
  if (mermaidInstance) return mermaidInstance;
  if (!mermaidInitPromise) {
    mermaidInitPromise = import('mermaid').then((mod) => {
      mermaidInstance = mod.default;
      mermaidInstance.initialize(BASE_CONFIG);
      return mermaidInstance;
    });
  }
  return mermaidInitPromise;
}

let renderCounter = 0;

// Cola de renders: uno a la vez, cediendo el hilo entre diagramas. Un
// documento con decenas de diagramas los disparaba todos a la vez al montar
// y congelaba la UI durante el arranque; encolados, la página pinta y
// responde entre diagrama y diagrama. También evita que un render normal se
// cuele en medio de un export (que cambia la configuración global de mermaid
// y la restaura al terminar).
let renderQueue: Promise<unknown> = Promise.resolve();

const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
  const run = renderQueue.then(async () => {
    const result = await job();
    // Ceder el hilo: deja pintar/atender input antes del siguiente diagrama.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return result;
  });
  renderQueue = run.catch(() => undefined); // un render fallido no rompe la cola
  return run;
};

/** Renderiza código mermaid a SVG (string). Lanza si el código es inválido. */
export function renderMermaidSvg(code: string): Promise<string> {
  return enqueue(async () => {
    const m = await getMermaid();
    const id = `iur-mermaid-${++renderCounter}`;
    const { svg } = await m.render(id, stripHtmlInLabels(code));
    return svg;
  });
}

/**
 * Render a tamaño completo (sin useMaxWidth) para export y PDF.
 * Restaura la configuración base al terminar.
 */
export function renderFullSizeDiagram(code: string): Promise<string> {
  return enqueue(async () => {
    const m = await getMermaid();
    const id = `iur-mermaid-full-${++renderCounter}`;

    m.initialize({
      ...BASE_CONFIG,
      flowchart: { useMaxWidth: false, htmlLabels: false, curve: 'basis' },
      sequence: { useMaxWidth: false, width: 150, height: 65 },
      gantt: { useMaxWidth: false, fontSize: 12 },
    });

    try {
      const { svg } = await m.render(id, stripHtmlInLabels(code));
      return svg;
    } finally {
      m.initialize(BASE_CONFIG);
    }
  });
}
