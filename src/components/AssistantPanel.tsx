import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Copy, CornerDownLeft, FileSearch, FileText, Info, Loader2, Replace, RotateCcw, Sparkles } from 'lucide-react';
import { t, useLang } from '../lib/i18n';
import { iure, type IureMirror } from '../lib/iurefficient';
import { ChatCancelled } from '../lib/iureChat';
import {
  ANALYSES,
  ASSISTANT_SYSTEM_PROMPT,
  DOC_CHAR_LIMIT,
  buildDocumentMessage,
  buildQuestion,
  countWords,
  prepareDocument,
  rotateConversation,
  stripCitations,
  threadFor,
  resetThread,
  type AssistantThread,
  type AssistantMessage,
} from '../lib/assistant';

/** Qué acompaña a la pregunta. */
type Context = 'none' | 'selection' | 'document';

// Panel lateral «Asistente»: preguntas a la IA de Iurefficient para el documento
// activo. Si el documento está vinculado a un proyecto, por omisión se pregunta
// en el chat de ese proyecto (busca en sus documentos y cita las fuentes); si
// no, en el chat general. La pregunta puede llevar la selección o el documento
// completo (análisis); la respuesta se inserta en el cursor como Markdown.
export const AssistantPanel = ({
  activePath,
  getSelection,
  getDocument,
  onInsert,
  onOpenIurefficient,
}: {
  activePath: string | null;
  /** Texto seleccionado en el editor activo ('' si no hay). */
  getSelection: () => string;
  /** Markdown y nombre del documento activo (null si no hay pestaña). */
  getDocument: () => { name: string; markdown: string } | null;
  /** Inserta Markdown en el editor activo, tras la selección o (`replace`) en
   *  su lugar; false si no se pudo (vista fuente, texto plano). */
  onInsert: (markdown: string, replace: boolean) => boolean;
  onOpenIurefficient: () => void;
}) => {
  useLang();
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [mirror, setMirror] = useState<IureMirror | null>(null);
  const [useCase, setUseCase] = useState(true);
  const [input, setInput] = useState('');
  const [selection, setSelection] = useState('');
  const [context, setContext] = useState<Context>('none');
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Texto de la respuesta según llega (streaming), mientras `busy`.
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ index: number; text: string } | null>(null);
  // El hilo vive fuera del componente (lib/assistant.ts): cambiar de vista en la
  // barra lateral no lo pierde. `version` fuerza el repintado al cambiarlo.
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const reqRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    iure
      .status()
      .then((s) => setLoggedIn(s.loggedIn))
      .catch(() => setLoggedIn(false));
  }, []);

  useEffect(() => {
    setUseCase(true);
    if (!activePath) {
      setMirror(null);
      return;
    }
    iure.mirrorOf(activePath).then(setMirror).catch(() => setMirror(null));
  }, [activePath]);

  const caseId = useCase ? (mirror?.caseId ?? null) : null;
  const thread: AssistantThread = threadFor(activePath, caseId);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [thread.messages.length, busy, streamText]);

  // Al enfocar la pregunta se relee la selección: si aparece una, pasa a ser el
  // contexto; si ya no hay, la opción «Selección» deja de valer.
  const refreshSelection = useCallback(() => {
    const sel = getSelection();
    setSelection(sel);
    setContext((c) => (sel && c === 'none' ? 'selection' : !sel && c === 'selection' ? 'none' : c));
  }, [getSelection]);

  // Cierra el menú de análisis al hacer clic fuera.
  useEffect(() => {
    if (!analyzeOpen) return;
    const close = () => setAnalyzeOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [analyzeOpen]);

  const send = async (text = input, ctx: Context = context, shown?: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const sel = ctx === 'selection' ? selection : '';
    let message = buildQuestion(question, sel);
    let document: AssistantMessage['document'];
    if (ctx === 'document') {
      const doc = getDocument();
      const markdown = prepareDocument(doc?.markdown ?? '');
      if (!doc || !markdown) {
        setError(t('assistant.docEmpty'));
        return;
      }
      if (markdown.length > DOC_CHAR_LIMIT) {
        setError(t('assistant.docTooLong', { n: markdown.length.toLocaleString(), max: DOC_CHAR_LIMIT.toLocaleString() }));
        return;
      }
      message = buildDocumentMessage(question, doc.name, markdown);
      document = { name: doc.name, words: countWords(markdown) };
      // El documento entra a una conversación nueva: si no, la instancia lo
      // reenviaría (y cobraría) en cada pregunta siguiente junto con el
      // documento de cualquier análisis anterior.
      if (thread.messages.some((m) => m.role !== 'note')) {
        rotateConversation(thread);
        thread.messages.push({ role: 'note', content: t('assistant.docNotice') });
      }
    }
    const req = ++reqRef.current;
    const asked: AssistantMessage = { role: 'user', content: shown ?? question, selection: sel || undefined, document };
    thread.messages.push(asked);
    setInput('');
    setBusy(true);
    setStreamText('');
    setError(null);
    bump();
    try {
      const reply = await thread.conversation.send(message, ASSISTANT_SYSTEM_PROMPT, (soFar) => {
        if (req === reqRef.current) setStreamText(soFar);
      });
      thread.messages.push({ role: 'assistant', content: reply.content, references: reply.references });
    } catch (e) {
      // La pregunta que falló (o se canceló) se quita del hilo para poder reintentarla.
      thread.messages.splice(thread.messages.indexOf(asked), 1);
      if (e instanceof ChatCancelled) {
        if (!shown) setInput(question);
      } else if (req === reqRef.current) {
        if (!shown) setInput(question);
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (req === reqRef.current) setBusy(false);
      bump();
    }
  };

  const cancel = () => {
    // Deja de leer la respuesta. La instancia la termina igual (y gasta la
    // cuota), pero no llega al panel.
    reqRef.current++;
    thread.conversation.cancel();
    setBusy(false);
  };

  const newThread = () => {
    cancel();
    resetThread(activePath, caseId);
    setError(null);
    bump();
    inputRef.current?.focus();
  };

  const flash = (index: number, text: string) => {
    setNotice({ index, text });
    setTimeout(() => setNotice((n) => (n?.index === index ? null : n)), 1800);
  };

  const insert = (index: number, content: string, replace = false) => {
    flash(index, onInsert(stripCitations(content), replace) ? t('assistant.inserted') : t('assistant.insertSource'));
  };

  const copy = (index: number, content: string) => {
    void navigator.clipboard.writeText(stripCitations(content)).then(() => flash(index, t('assistant.copied')));
  };

  if (loggedIn === null) return null;

  if (!loggedIn) {
    return (
      <div className="p-4 text-sm text-gray-600 dark:text-gray-300 space-y-3">
        <p>{t('assistant.needLogin')}</p>
        <button
          type="button"
          onClick={onOpenIurefficient}
          className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded hover:bg-primary-700"
        >
          {t('assistant.connect')}
        </button>
      </div>
    );
  }

  const suggestions = caseId
    ? [t('assistant.suggestCase1'), t('assistant.suggestCase2'), t('assistant.suggestCase3')]
    : [t('assistant.suggestGlobal1'), t('assistant.suggestGlobal2')];

  return (
    <div className="h-full flex flex-col text-sm">
      {/* Contexto: proyecto vinculado o chat general */}
      <div className="shrink-0 px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
        <div className="flex-1 min-w-0 text-xs">
          {mirror?.caseId ? (
            <div className="flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden">
              {[true, false].map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => setUseCase(v)}
                  title={v ? (mirror.caseTitle ?? '') : t('assistant.scopeGlobalHint')}
                  className={`flex-1 min-w-0 px-2 py-1 truncate ${
                    useCase === v
                      ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {v ? (mirror.caseTitle ?? t('assistant.scopeCase')) : t('assistant.scopeGlobal')}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-gray-500 dark:text-gray-400" title={t('assistant.noCaseHint')}>
              {t('assistant.scopeGlobal')}
            </span>
          )}
        </div>
        <div className="relative">
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              setAnalyzeOpen((o) => !o);
            }}
            title={t('assistant.analyze')}
            className="p-1 rounded text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 disabled:opacity-40"
          >
            <FileSearch className="w-3.5 h-3.5" />
          </button>
          {analyzeOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 w-56 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl">
              <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                {t('assistant.analyze')}
              </div>
              {ANALYSES.filter((a) => !a.caseOnly || caseId).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setAnalyzeOpen(false);
                    void send(t(a.prompt), 'document', t(a.label));
                  }}
                  className="w-full px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  {t(a.label)}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={newThread}
          title={t('assistant.newThread')}
          className="p-1 rounded text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Hilo */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-3">
        {thread.messages.length === 0 && !busy && (
          <div className="pt-2 space-y-2 text-xs text-gray-500 dark:text-gray-400">
            <p className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              {caseId ? t('assistant.introCase') : t('assistant.introGlobal')}
            </p>
            {!mirror?.caseId && <p>{t('assistant.noCaseHint')}</p>}
            <div className="flex flex-col gap-1 pt-1">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="text-left px-2 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {thread.messages.map((m, i) =>
          m.role === 'note' ? (
            <div key={i} className="flex items-start gap-1.5 text-xs text-gray-400 dark:text-gray-500">
              <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
              {m.content}
            </div>
          ) : m.role === 'user' ? (
            <div key={i} className="ml-6 px-2.5 py-1.5 rounded-lg bg-primary-50 dark:bg-primary-900/30 text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words">
              {m.document && (
                <div className="mb-1 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                  <FileText className="w-3 h-3 shrink-0" />
                  <span className="truncate">{t('assistant.docBadge', { words: m.document.words.toLocaleString() })}</span>
                </div>
              )}
              {m.selection && (
                <div className="mb-1 pl-2 border-l-2 border-primary-300 dark:border-primary-700 text-xs text-gray-500 dark:text-gray-400 line-clamp-3">
                  {m.selection}
                </div>
              )}
              {m.content}
            </div>
          ) : (
            <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <div className="px-2.5 py-2 text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words select-text">
                {m.content}
              </div>
              {m.references && m.references.length > 0 && (
                <details className="px-2.5 pb-1 text-xs text-gray-500 dark:text-gray-400">
                  <summary className="cursor-pointer select-none">
                    {t('assistant.sources', { n: m.references.length })}
                  </summary>
                  <ul className="mt-1 space-y-1">
                    {m.references.map((r) => (
                      <li key={`${r.index}-${r.title}`}>
                        <span className="font-medium text-gray-600 dark:text-gray-300">
                          [{r.index}] {r.title}
                        </span>
                        {r.excerpt && <span className="block line-clamp-2">{r.excerpt}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="flex items-center gap-1 px-1.5 py-1 border-t border-gray-100 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => insert(i, m.content)}
                  title={t('assistant.insertHint')}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs rounded text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/30"
                >
                  <CornerDownLeft className="w-3 h-3" />
                  {t('assistant.insert')}
                </button>
                {thread.messages[i - 1]?.selection && (
                  <button
                    type="button"
                    onClick={() => insert(i, m.content, true)}
                    title={t('assistant.replaceHint')}
                    className="flex items-center gap-1 px-2 py-0.5 text-xs rounded text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/30"
                  >
                    <Replace className="w-3 h-3" />
                    {t('assistant.replace')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => copy(i, m.content)}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <Copy className="w-3 h-3" />
                  {t('assistant.copy')}
                </button>
                {notice?.index === i && (
                  <span className="ml-auto flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <Check className="w-3 h-3" />
                    {notice.text}
                  </span>
                )}
              </div>
            </div>
          )
        )}
        {busy && (
          <div className="space-y-1">
            {streamText && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-2 text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words">
                {streamText}
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {streamText ? t('assistant.writing') : t('assistant.thinking')}
              <button type="button" onClick={cancel} className="ml-auto hover:underline">
                {t('editor.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Pregunta */}
      <div className="shrink-0 border-t border-gray-200 dark:border-gray-700 p-2 space-y-1.5">
        {error && <div className="text-xs text-amber-700 dark:text-amber-400">{error}</div>}
        <div className="flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden text-xs">
          {(['none', 'selection', 'document'] as const).map((c) => (
            <button
              key={c}
              type="button"
              disabled={c === 'selection' && !selection}
              onClick={() => setContext(c)}
              title={
                c === 'selection'
                  ? t('assistant.ctxSelectionHint', { n: selection.length })
                  : c === 'document'
                    ? t('assistant.ctxDocumentHint')
                    : undefined
              }
              className={`flex-1 min-w-0 px-1 py-0.5 truncate disabled:opacity-40 ${
                context === c
                  ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {c === 'none' ? t('assistant.ctxNone') : c === 'selection' ? t('assistant.ctxSelection') : t('assistant.ctxDocument')}
            </button>
          ))}
        </div>
        <div className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={refreshSelection}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={3}
            placeholder={caseId ? t('assistant.placeholderCase') : t('assistant.placeholderGlobal')}
            className="w-full resize-none pr-9 px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            title={t('assistant.send')}
            className="absolute right-1.5 bottom-2.5 p-1 rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[11px] leading-snug text-gray-400 dark:text-gray-500">{t('assistant.privacyDoc')}</p>
      </div>
    </div>
  );
};
