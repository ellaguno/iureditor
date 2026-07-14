import { useState } from 'react';
import { FolderOpen, Loader2 } from 'lucide-react';
import { t } from '../lib/i18n';

export const ImageModal = ({
  isOpen,
  onClose,
  onSubmit,
  onBrowse,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (url: string, alt: string) => void;
  /** Abre el diálogo nativo, copia la imagen a assets/ y devuelve el src
   *  relativo a insertar (o null si se canceló). */
  onBrowse?: () => Promise<string | null>;
}) => {
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');
  const [browsing, setBrowsing] = useState(false);

  if (!isOpen) return null;

  const handleBrowse = async () => {
    if (!onBrowse || browsing) return;
    setBrowsing(true);
    try {
      const src = await onBrowse();
      if (src) {
        setUrl(src);
        if (!alt) {
          const name = src.split('/').pop() || '';
          setAlt(name.replace(/\.[a-z0-9]+$/i, ''));
        }
      }
    } finally {
      setBrowsing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-4 w-96">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
          {t('editor.insertImage')}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
              {t('editor.imageUrl')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/image.jpg"
                className="flex-1 min-w-0 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
                autoFocus
              />
              {onBrowse && (
                <button
                  type="button"
                  onClick={() => void handleBrowse()}
                  disabled={browsing}
                  title={t('editor.browseImage')}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                >
                  {browsing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FolderOpen className="w-4 h-4" />
                  )}
                  <span className="text-sm">{t('editor.browse')}</span>
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
              {t('editor.altText')}
            </label>
            <input
              type="text"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder={t('editor.imageDescription')}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            {t('editor.cancel')}
          </button>
          <button
            onClick={() => {
              onSubmit(url, alt);
              setUrl('');
              setAlt('');
            }}
            className="px-3 py-1.5 bg-primary-600 text-white rounded hover:bg-primary-700"
          >
            {t('editor.insert')}
          </button>
        </div>
      </div>
    </div>
  );
};
