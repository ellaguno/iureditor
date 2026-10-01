// Carga perezosa de mermaid (~2MB) sólo cuando aparece un diagrama.
// Portado de MarkdownRenderer.tsx (Colaborador especialista).

let mermaidInstance: typeof import('mermaid').default | null = null;
let mermaidInitPromise: Promise<typeof import('mermaid').default> | null = null;

const BASE_CONFIG = {
  startOnLoad: false,
  // Tema claro: es el de export (PDF/DOCX/HTML, SVG/PNG por diagrama), que
  // debe salir apto para imprimir aunque la app esté en tema oscuro.
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

// Tema oscuro, sólo para la vista en pantalla: con el tema default sobre el
// fondo oscuro del nodo, líneas, flechas, bordes de grupo y etiquetas de
// arista salían #333 sobre gris oscuro, casi invisibles. El tema 'dark' de
// mermaid deriva líneas y texto claros a partir del fondo; se le da el mismo
// fondo que el contenedor (gray-800) para que los contrastes calculados
// coincidan con lo que se ve. Sin los cScaleLabel del tema claro: aquí las
// secciones de mapas mentales/timelines ya son oscuras con texto claro.
const DARK_CONFIG = {
  ...BASE_CONFIG,
  theme: 'dark' as const,
  themeVariables: {
    darkMode: true,
    background: '#1f2937',
    // Relleno de nodos gray-700 (el del tema, casi negro, quedaba más oscuro
    // que el propio fondo y los nodos parecían agujeros).
    mainBkg: '#374151',
    primaryColor: '#374151',
    // Grupos (subgraph) discretos: el calculado era un gris azulado claro.
    clusterBkg: '#273244',
    clusterBorder: '#6b7280',
    // La primera sección de mapas mentales/timelines y la primera porción de
    // los pies salían casi negras (#0b0000): se cambia por un azul oscuro.
    cScale1: '#1e3a8a',
    // Etiquetas de sección claras sobre los rellenos oscuros del tema.
    ...Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`cScaleLabel${i}`, '#e5e7eb'])
    ),
  },
};

/** ¿La app está en tema oscuro? (clase `dark` en <html>, ver prefs.ts). */
export const isDarkTheme = (): boolean =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

// Configuración actualmente aplicada a la instancia global de mermaid, para
// re-inicializar sólo cuando cambia (tema de la app o render de export).
let appliedConfig: object | null = null;

const applyConfig = (m: typeof import('mermaid').default, config: object) => {
  if (appliedConfig === config) return;
  m.initialize(config);
  appliedConfig = config;
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
      applyConfig(mermaidInstance, BASE_CONFIG);
      return mermaidInstance;
    });
  }
  return mermaidInitPromise;
}

const FULL_SIZE_CONFIG = {
  ...BASE_CONFIG,
  flowchart: { useMaxWidth: false, htmlLabels: false, curve: 'basis' as const },
  sequence: { useMaxWidth: false, width: 150, height: 65 },
  gantt: { useMaxWidth: false, fontSize: 12 },
};

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

/**
 * Renderiza código mermaid a SVG (string). Lanza si el código es inválido.
 * Por defecto sigue el tema de la app (vista en pantalla); `theme: 'light'`
 * fuerza el tema claro (export de un diagrama suelto a SVG/PNG).
 */
export function renderMermaidSvg(
  code: string,
  { theme }: { theme?: 'light' | 'auto' } = {}
): Promise<string> {
  return enqueue(async () => {
    const m = await getMermaid();
    applyConfig(m, theme !== 'light' && isDarkTheme() ? DARK_CONFIG : BASE_CONFIG);
    const id = `iur-mermaid-${++renderCounter}`;
    const { svg } = await m.render(id, stripHtmlInLabels(code));
    return svg;
  });
}

/**
 * Render a tamaño completo (sin useMaxWidth) para export y PDF. Siempre con
 * el tema claro (apto para imprimir), sea cual sea el tema de la app.
 */
export function renderFullSizeDiagram(code: string): Promise<string> {
  return enqueue(async () => {
    const m = await getMermaid();
    const id = `iur-mermaid-full-${++renderCounter}`;

    applyConfig(m, FULL_SIZE_CONFIG);
    const { svg } = await m.render(id, stripHtmlInLabels(code));
    return svg;
  });
}
