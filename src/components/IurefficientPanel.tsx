import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudUpload, LogOut, RefreshCw, Search, FileText, FolderOpen, Check, AlertCircle } from 'lucide-react';
import {
  iure,
  getAutoSync,
  setAutoSync,
  type IureCase,
  type IureMirror,
  type IureRemoteDoc,
  type IureStatus,
  type SyncEvent,
} from '../lib/iurefficient';
import { IureAppsSection } from './IureAppsSection';

// Panel lateral «Iurefficient»: conectar con la cuenta, abrir documentos de un
// proyecto (se descargan como espejo local) y guardarlos de vuelta como versión.
export const IurefficientPanel = ({
  activePath,
  activeDirty,
  onOpenFile,
  onSaveActive,
}: {
  activePath: string | null;
  activeDirty: boolean;
  onOpenFile: (path: string) => void;
  /** Guarda la pestaña activa en disco (pide ruta si no tiene) y devuelve la ruta. */
  onSaveActive: () => Promise<string | null>;
}) => {
  const [status, setStatus] = useState<IureStatus | null>(null);
  const [domain, setDomain] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpToken, setTotpToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [cases, setCases] = useState<IureCase[]>([]);
  const [selected, setSelected] = useState<IureCase | null>(null);
  const [docs, setDocs] = useState<IureRemoteDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [mirror, setMirror] = useState<IureMirror | null>(null);
  const [autoSync, setAutoSyncState] = useState(getAutoSync());
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await iure.status();
      setStatus(s);
      if (s.domain && !domain) setDomain(s.domain);
      if (s.email && !email) setEmail(s.email);
    } catch (e) {
      setError(String(e));
    }
  }, [domain, email]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Vínculo del documento activo con Iurefficient.
  useEffect(() => {
    if (!activePath) {
      setMirror(null);
      return;
    }
    iure.mirrorOf(activePath).then(setMirror).catch(() => setMirror(null));
  }, [activePath]);

  // Aviso de sincronización automática tras guardar.
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<SyncEvent>).detail;
      setNotice(d.ok ? { ok: true, text: 'Versión subida a Iurefficient' } : { ok: false, text: d.error ?? 'No se pudo subir la versión' });
    };
    window.addEventListener('iure-synced', handler);
    return () => window.removeEventListener('iure-synced', handler);
  }, []);

  const searchCases = useCallback(async (q: string) => {
    try {
      setCases(await iure.cases(q));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (!status?.loggedIn) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void searchCases(query), 300);
  }, [query, status?.loggedIn, searchCases]);

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await iure.login(domain.trim(), email.trim(), password, totpToken ?? undefined, totpToken ? totpCode.trim() : undefined);
      if (r.requiresTotp) {
        setTotpToken(r.totpToken);
      } else if (r.loggedIn) {
        setPassword('');
        setTotpToken(null);
        setTotpCode('');
        await refresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await iure.logout();
    setSelected(null);
    setDocs([]);
    await refresh();
  };

  const openCase = async (c: IureCase) => {
    setSelected(c);
    setLoadingDocs(true);
    setError(null);
    try {
      setDocs(await iure.caseDocuments(c.id));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingDocs(false);
    }
  };

  const openDoc = async (d: IureRemoteDoc) => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const path = await iure.openDocument(selected.id, `${selected.caseNumber} · ${selected.title}`, d.id, d.fileName);
      onOpenFile(path);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const uploadVersion = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const path = activeDirty ? await onSaveActive() : activePath;
      if (!path) return;
      await iure.uploadVersion(path);
      setNotice({ ok: true, text: 'Versión subida a Iurefficient' });
    } catch (e) {
      setNotice({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const saveNewTo = async (c: IureCase | null) => {
    setChoosing(false);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const path = activeDirty || !activePath ? await onSaveActive() : activePath;
      if (!path) return;
      const m = await iure.saveNew(path, c?.id ?? null, c ? `${c.caseNumber} · ${c.title}` : null);
      setMirror(m);
      setNotice({ ok: true, text: `Guardado en ${c ? c.caseNumber : 'General'} como documento nuevo` });
    } catch (e) {
      setNotice({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100';
  const btn = 'inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50';
  const btnGhost = 'inline-flex items-center gap-1 px-2 py-1 text-xs rounded text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50';

  if (!status) {
    return <div className="px-3 py-3 text-xs text-gray-400">Comprobando la conexión…</div>;
  }

  if (!status.loggedIn) {
    return (
      <div className="flex flex-col h-full text-xs">
      <div className="flex flex-col gap-2 px-3 py-3 text-xs flex-1 min-h-0 overflow-y-auto">
        <p className="text-gray-600 dark:text-gray-300">
          Conecta tu cuenta para abrir documentos de tus {status.caseLabel}s y guardarlos como versiones. La contraseña no se guarda; sólo la sesión, en el llavero del sistema.
        </p>
        <input className={input} placeholder="Dominio (p. ej. 2.ds.iurefficient.com)" value={domain} onChange={(e) => setDomain(e.target.value)} spellCheck={false} />
        <input className={input} type="email" placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)} spellCheck={false} />
        {totpToken ? (
          <input className={input} placeholder="Código de verificación (6 dígitos)" value={totpCode} inputMode="numeric" onChange={(e) => setTotpCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void login()} />
        ) : (
          <input className={input} type="password" placeholder="Contraseña de Iurefficient" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void login()} />
        )}
        <button type="button" className={btn} disabled={busy || !domain.trim() || !email.trim() || (totpToken ? totpCode.trim().length < 6 : !password)} onClick={() => void login()}>
          {busy ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />} {totpToken ? 'Verificar' : 'Conectar'}
        </button>
        {(error ?? status.error) && <p className="text-red-600 dark:text-red-400">{error ?? status.error}</p>}
      </div>
      <IureAppsSection />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full text-xs">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2">
        <span className="truncate text-gray-700 dark:text-gray-200" title={`${status.email} · ${status.domain}`}>
          {status.name ?? status.email}
        </span>
        <button type="button" className={btnGhost} title="Cerrar sesión" onClick={() => void logout()}>
          <LogOut size={12} />
        </button>
      </div>

      {/* Documento activo */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex flex-col gap-1.5">
        <div className="text-[11px] uppercase tracking-wide text-gray-400">Documento activo</div>
        {mirror ? (
          <>
            <div className="truncate text-gray-600 dark:text-gray-300" title={mirror.caseTitle ?? 'General'}>
              <CloudUpload size={12} className="inline mr-1" />
              {mirror.caseTitle ?? 'General (sin proyecto)'}
            </div>
            <button type="button" className={btn} disabled={busy || !activePath} onClick={() => void uploadVersion()}>
              <CloudUpload size={12} /> Subir versión ahora
            </button>
            <label className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={autoSync} onChange={(e) => { setAutoSync(e.target.checked); setAutoSyncState(e.target.checked); }} />
              Subir versión al guardar (Ctrl+S)
            </label>
          </>
        ) : (
          <>
            <div className="text-gray-500 dark:text-gray-400">No vinculado a Iurefficient.</div>
            <button type="button" className={btn} disabled={busy} onClick={() => setChoosing((v) => !v)}>
              <CloudUpload size={12} /> Guardar en Iurefficient…
            </button>
            {choosing && (
              <div className="flex flex-col gap-1 pl-1">
                <button type="button" className={btnGhost} onClick={() => void saveNewTo(null)}>General (sin {status.caseLabel})</button>
                {selected && (
                  <button type="button" className={btnGhost} onClick={() => void saveNewTo(selected)}>
                    {selected.caseNumber} · {selected.title}
                  </button>
                )}
                {!selected && <span className="text-gray-400">Elige abajo un {status.caseLabel} para guardarlo ahí.</span>}
              </div>
            )}
          </>
        )}
        {notice && (
          <div className={`flex items-center gap-1 ${notice.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {notice.ok ? <Check size={12} /> : <AlertCircle size={12} />} <span className="truncate" title={notice.text}>{notice.text}</span>
          </div>
        )}
      </div>

      {/* Proyectos y documentos */}
      <div className="px-3 py-2 flex items-center gap-1">
        <Search size={12} className="text-gray-400" />
        <input className={input} placeholder={`Buscar ${status.caseLabel}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {!selected ? (
          cases.length === 0 ? (
            <div className="px-3 py-2 text-gray-400">Sin resultados</div>
          ) : (
            cases.map((c) => (
              <button key={c.id} type="button" className="w-full text-left px-3 py-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 flex items-start gap-1.5" onClick={() => void openCase(c)}>
                <FolderOpen size={12} className="mt-0.5 shrink-0 text-gray-400" />
                <span className="min-w-0">
                  <span className="block truncate text-gray-800 dark:text-gray-100"><b>{c.caseNumber}</b> · {c.title}</span>
                  {c.clientName && <span className="block truncate text-gray-400">{c.clientName}</span>}
                </span>
              </button>
            ))
          )
        ) : (
          <>
            <button type="button" className="w-full text-left px-3 py-1.5 text-primary-600 dark:text-primary-400 hover:underline" onClick={() => { setSelected(null); setDocs([]); }}>
              ← {status.caseLabel}s
            </button>
            <div className="px-3 pb-1 truncate text-gray-700 dark:text-gray-200" title={selected.title}><b>{selected.caseNumber}</b> · {selected.title}</div>
            {loadingDocs ? (
              <div className="px-3 py-2 text-gray-400">Cargando documentos…</div>
            ) : docs.length === 0 ? (
              <div className="px-3 py-2 text-gray-400">Sin documentos</div>
            ) : (
              docs.map((d) => (
                <button key={d.id} type="button" disabled={!d.editable || busy} title={d.editable ? d.fileName : `${d.fileName} (no es texto ni Markdown)`} className="w-full text-left px-3 py-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center gap-1.5 disabled:opacity-40" onClick={() => void openDoc(d)}>
                  <FileText size={12} className="shrink-0 text-gray-400" />
                  <span className="truncate text-gray-800 dark:text-gray-100">{d.title || d.fileName}</span>
                </button>
              ))
            )}
          </>
        )}
      </div>
      {error && <div className="px-3 py-2 text-red-600 dark:text-red-400 border-t border-gray-200 dark:border-gray-700">{error}</div>}
      <IureAppsSection />
    </div>
  );
};
