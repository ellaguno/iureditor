import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Trash2 } from 'lucide-react';
import { resolveSrc, resolveAssetFsPath } from '../extensions/imageResolve';
import { t } from '../lib/i18n';

// NodeView de imágenes: sólo añade un menú contextual (botón derecho) con
// "Abrir en editor externo" (para SVG de draw.io u otros assets locales) y
// "Borrar". El render/serialización de la imagen no cambia (ver localImage.ts).
export const ImageNodeView = ({ node, selected, deleteNode }: NodeViewProps) => {
  const src: string = node.attrs.src || '';
  const alt: string = node.attrs.alt || '';
  const title: string | undefined = node.attrs.title || undefined;

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // Cache-bust: tras editar el asset en un editor externo y volver a la app,
  // se fuerza a la webview a recargar la imagen desde disco.
  const [bust, setBust] = useState(0);

  const display = resolveSrc(src);
  const fsPath = resolveAssetFsPath(src); // null si no es un asset local

  const displaySrc =
    bust && display && !display.startsWith('data:')
      ? `${display}${display.includes('?') ? '&' : '?'}iurv=${bust}`
      : display;

  // Al recuperar el foco (p. ej. al volver de draw.io) se refresca el asset.
  useEffect(() => {
    if (!fsPath) return;
    const onFocus = () => setBust((n) => n + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fsPath]);

  // Cierre del menú.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const openExternal = async () => {
    if (!fsPath) return;
    try {
      const { openPath } = await import('@tauri-apps/plugin-opener');
      await openPath(fsPath);
    } catch (err) {
      console.error('No se pudo abrir la imagen en un editor externo:', err);
    }
  };

  const contextMenu =
    menu &&
    createPortal(
      <div
        role="menu"
        onContextMenu={(e) => e.preventDefault()}
        style={{
          left: Math.min(menu.x, window.innerWidth - 220),
          top: Math.min(menu.y, window.innerHeight - 100),
        }}
        className="fixed z-50 min-w-[200px] py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl"
      >
        {fsPath && (
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              void openExternal();
            }}
            className="w-full px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <ExternalLink className="w-4 h-4 opacity-70" />
            {t('image.openExternal')}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setMenu(null);
            deleteNode();
          }}
          className="w-full px-3 py-1.5 text-left text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
        >
          <Trash2 className="w-4 h-4 opacity-70" />
          {t('image.delete')}
        </button>
      </div>,
      document.body
    );

  return (
    <NodeViewWrapper className="iur-image-node" data-type="image" onContextMenu={openMenu}>
      {contextMenu}
      <img
        src={displaySrc}
        alt={alt}
        title={title}
        data-orig-src={src}
        className={`max-w-full h-auto rounded-lg ${
          selected ? 'ring-2 ring-primary-400 dark:ring-primary-600' : ''
        }`}
      />
    </NodeViewWrapper>
  );
};
