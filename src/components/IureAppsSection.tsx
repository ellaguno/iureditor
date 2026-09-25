import { useEffect, useState } from 'react';
import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { apps, type AppId, type AppStatus } from '../lib/iurefficient';
import { t, useLang } from '../lib/i18n';

const REPOS: Record<AppId, string> = {
  transcribe: 'https://github.com/ellaguno/iuretranscribe',
  editor: 'https://github.com/ellaguno/iureditor',
  dav: 'https://github.com/ellaguno/iuredav',
  ocr: 'https://github.com/ellaguno/iureocr',
};

// «Apps de Iurefficient»: las apps de escritorio, cuáles están instaladas en
// este equipo, la última versión publicada y de dónde descargarlas.
export const IureAppsSection = ({ version }: { version?: string }) => {
  useLang();
  const [list, setList] = useState<AppStatus[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (withNetwork: boolean) => {
    setLoading(true);
    try {
      setList(await apps.status(withNetwork));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load(false).then(() => load(true));
  }, []);

  const launch = async (a: AppStatus) => {
    try {
      await apps.launch(a.id);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-semibold text-gray-700 dark:text-gray-200">{t('apps.title')}</span>
        <button type="button" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title={t('apps.refresh')} onClick={() => void load(true)} disabled={loading}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {list === null ? (
        <div className="text-gray-400">{t('apps.searching')}</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.map((a) => (
            <li key={a.id} className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate" title={a.description}>
                <span className="text-gray-800 dark:text-gray-100">{a.name}</span>
                <span className="text-gray-400">
                  {a.id === 'editor' ? `${t('apps.thisApp')}${version ? ` ${version}` : ''}` : a.installed ? t('apps.installed') : t('apps.notInstalled')}
                  {a.latestVersion ? t('apps.latest', { version: a.latestVersion }) : ''}
                </span>
              </span>
              {a.id !== 'editor' &&
                (a.installed ? (
                  <button type="button" className="text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-0.5" title={a.path ?? ''} onClick={() => void launch(a)}>
                    <ExternalLink size={11} /> {t('apps.open')}
                  </button>
                ) : (
                  <button type="button" className="text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-0.5" onClick={() => void openUrl(a.downloadUrl)}>
                    <Download size={11} /> {t('apps.download')}
                  </button>
                ))}
              <button type="button" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title={t('apps.github')} onClick={() => void openUrl(REPOS[a.id])}>
                <ExternalLink size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <div className="text-red-600 dark:text-red-400 mt-1">{error}</div>}
    </div>
  );
};
