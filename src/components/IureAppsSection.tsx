import { useEffect, useState } from 'react';
import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { apps, type AppStatus } from '../lib/iurefficient';

const REPOS: Record<string, string> = {
  transcribe: 'https://github.com/ellaguno/iuretranscribe',
  editor: 'https://github.com/ellaguno/iureditor',
  dav: 'https://github.com/ellaguno/iuredav',
};

// «Apps de Iurefficient»: las tres apps de escritorio, cuáles están instaladas en
// este equipo, la última versión publicada y de dónde descargarlas.
export const IureAppsSection = ({ version }: { version?: string }) => {
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
        <span className="font-semibold text-gray-700 dark:text-gray-200">Apps de Iurefficient</span>
        <button type="button" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="Actualizar" onClick={() => void load(true)} disabled={loading}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {list === null ? (
        <div className="text-gray-400">Buscando apps instaladas…</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.map((a) => (
            <li key={a.id} className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate" title={a.description}>
                <span className="text-gray-800 dark:text-gray-100">{a.name}</span>
                <span className="text-gray-400">
                  {a.id === 'editor' ? ` · esta app${version ? ` ${version}` : ''}` : a.installed ? ' · instalada' : ' · no instalada'}
                  {a.latestVersion ? ` · última ${a.latestVersion}` : ''}
                </span>
              </span>
              {a.id !== 'editor' &&
                (a.installed ? (
                  <button type="button" className="text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-0.5" title={a.path ?? ''} onClick={() => void launch(a)}>
                    <ExternalLink size={11} /> Abrir
                  </button>
                ) : (
                  <button type="button" className="text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-0.5" onClick={() => void openUrl(a.downloadUrl)}>
                    <Download size={11} /> Descargar
                  </button>
                ))}
              <button type="button" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="Código y releases en GitHub" onClick={() => void openUrl(REPOS[a.id])}>
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
