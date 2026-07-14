import { useState } from 'react';
import { t } from '../lib/i18n';

export const ImageModal = ({
  isOpen,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (url: string, alt: string) => void;
}) => {
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');

  if (!isOpen) return null;

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
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/image.jpg"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
              autoFocus
            />
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
