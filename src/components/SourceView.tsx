import { useRef } from 'react';
import { highlightCode } from '../lib/highlight';

// Vista de código fuente: el markdown crudo (o un archivo no-markdown) en un
// editor con resaltado de sintaxis. Se implementa con el patrón overlay: un
// <textarea> transparente encima de un <pre> resaltado, sincronizados en
// scroll y tipografía. Los cambios se aplican al editor WYSIWYG al volver,
// guardar o exportar (ver App.tsx).
export const SourceView = ({
  value,
  onChange,
  spellcheck,
  language = 'markdown',
}: {
  value: string;
  onChange: (markdown: string) => void;
  spellcheck: boolean;
  /** Lenguaje de resaltado (null = sin resaltar). */
  language?: string | null;
}) => {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const syncScroll = () => {
    if (taRef.current && preRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  // El '\n' final conserva la altura de la última línea al terminar en salto.
  const html = highlightCode(value, language) + '\n';
  // Tipografía/espaciado IDÉNTICOS en ambas capas para que el texto alinee.
  const shared =
    'm-0 border-0 p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words';

  return (
    <div className="iur-source relative flex-1 w-full overflow-hidden">
      <pre
        ref={preRef}
        aria-hidden="true"
        className={`${shared} absolute inset-0 overflow-auto pointer-events-none`}
      >
        <code className="hljs bg-transparent" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
      <textarea
        ref={taRef}
        autoFocus
        value={value}
        spellCheck={spellcheck && language === 'markdown'}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        className={`${shared} absolute inset-0 w-full h-full resize-none overflow-auto bg-transparent text-transparent focus:outline-none`}
        style={{ WebkitTextFillColor: 'transparent', caretColor: '#f3f4f6' }}
      />
    </div>
  );
};
