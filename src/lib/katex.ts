// Carga perezosa de KaTeX (~280KB + CSS/fuentes) sólo cuando el documento
// contiene fórmulas. Mismo patrón que lib/mermaid.ts.

let katexPromise: Promise<typeof import('katex').default> | null = null;

export const getKatex = () => {
  if (!katexPromise) {
    katexPromise = Promise.all([
      import('katex'),
      // El CSS (con sus fuentes) sólo se paga si hay fórmulas.
      import('katex/dist/katex.min.css'),
    ]).then(([mod]) => mod.default);
  }
  return katexPromise;
};

/** Render para el editor (HTML + CSS de KaTeX). Lanza si el LaTeX es inválido. */
export const renderMathHtml = async (latex: string, displayMode: boolean): Promise<string> => {
  const katex = await getKatex();
  return katex.renderToString(latex, { displayMode, throwOnError: true });
};

/**
 * Render para exports (HTML/PDF): MathML nativo, que WebKit y los navegadores
 * modernos muestran sin depender del CSS ni las fuentes de KaTeX — el HTML
 * exportado sigue siendo autosuficiente.
 */
export const renderMathMathml = async (latex: string, displayMode: boolean): Promise<string> => {
  const katex = await getKatex();
  return katex.renderToString(latex, { displayMode, throwOnError: false, output: 'mathml' });
};
