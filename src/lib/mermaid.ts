// Carga perezosa de mermaid (~2MB) sólo cuando aparece un diagrama.
// Portado de MarkdownRenderer.tsx (Colaborador especialista).

let mermaidInstance: typeof import('mermaid').default | null = null;
let mermaidInitPromise: Promise<typeof import('mermaid').default> | null = null;

const BASE_CONFIG = {
  startOnLoad: false,
  theme: 'default' as const,
  securityLevel: 'strict' as const,
  fontFamily: 'inherit',
  // Labels como <text> SVG (no <foreignObject>): resvg (export PNG/DOCX)
  // omite foreignObject en silencio y los nodos salían como cajas vacías.
  // OJO: mermaid 11 sólo respeta htmlLabels:false en el NIVEL SUPERIOR de
  // la config; flowchart.htmlLabels por sí solo no aplica a los nodos.
  htmlLabels: false,
  flowchart: { htmlLabels: false },
  class: { htmlLabels: false },
};

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

/** Renderiza código mermaid a SVG (string). Lanza si el código es inválido. */
export async function renderMermaidSvg(code: string): Promise<string> {
  const m = await getMermaid();
  const id = `iur-mermaid-${++renderCounter}`;
  const { svg } = await m.render(id, code);
  return svg;
}

/**
 * Render a tamaño completo (sin useMaxWidth) para export y PDF.
 * Restaura la configuración base al terminar.
 */
export async function renderFullSizeDiagram(code: string): Promise<string> {
  const m = await getMermaid();
  const id = `iur-mermaid-full-${++renderCounter}`;

  m.initialize({
    ...BASE_CONFIG,
    flowchart: { useMaxWidth: false, htmlLabels: false, curve: 'basis' },
    sequence: { useMaxWidth: false, width: 150, height: 65 },
    gantt: { useMaxWidth: false, fontSize: 12 },
  });

  try {
    const { svg } = await m.render(id, code);
    return svg;
  } finally {
    m.initialize(BASE_CONFIG);
  }
}
