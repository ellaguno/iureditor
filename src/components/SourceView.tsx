// Vista de código fuente: el markdown crudo en un textarea. Los cambios se
// aplican al editor WYSIWYG al volver, guardar o exportar (ver App.tsx).
export const SourceView = ({
  value,
  onChange,
  spellcheck,
}: {
  value: string;
  onChange: (markdown: string) => void;
  spellcheck: boolean;
}) => (
  <textarea
    autoFocus
    value={value}
    spellCheck={spellcheck}
    onChange={(e) => onChange(e.target.value)}
    className="flex-1 w-full resize-none bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 font-mono text-sm leading-relaxed px-4 py-3 focus:outline-none"
  />
);
