declare module 'pagedjs' {
  /** Polyfill de Paged Media: pagina el contenido y aplica @page margin
   *  boxes (encabezados/pies con counter(page)). */
  export class Previewer {
    preview(
      content?: string,
      stylesheets?: string[],
      renderTo?: HTMLElement | null
    ): Promise<{ total: number }>;
  }
}
