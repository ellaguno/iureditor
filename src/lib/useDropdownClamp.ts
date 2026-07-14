import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Los dropdowns HTML no pueden flotar fuera de la ventana (a diferencia de
 * los menús nativos): si el botón está cerca del borde derecho, un menú
 * anclado left-0 queda cortado. Este hook mide el menú al abrirse y lo
 * cambia a alineación derecha cuando no cabe.
 */
export const useDropdownClamp = (isOpen: boolean) => {
  const ref = useRef<HTMLDivElement>(null);
  const [alignRight, setAlignRight] = useState(false);

  useLayoutEffect(() => {
    if (!isOpen) {
      setAlignRight(false);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth - 4 && rect.width < window.innerWidth) {
      setAlignRight(true);
    }
  }, [isOpen]);

  return { ref, alignClass: alignRight ? 'right-0' : 'left-0' };
};
