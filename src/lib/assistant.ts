// Estado y textos del panel «Asistente». Los hilos viven aquí (fuera de React)
// para sobrevivir a los cambios de vista de la barra lateral: uno por documento
// y alcance (proyecto vinculado o chat general), cada uno con su conversación
// en la instancia.
import { getLang, t, type I18nKey } from './i18n';
import { IureConversation, type ChatReference } from './iureChat';

export interface AssistantMessage {
  /** `note`: aviso del propio panel (p. ej. que la conversación se reinició). */
  role: 'user' | 'assistant' | 'note';
  content: string;
  /** Texto seleccionado que acompañó a la pregunta. */
  selection?: string;
  /** Documento completo que acompañó a la pregunta (sólo su nombre y tamaño). */
  document?: { name: string; words: number };
  references?: ChatReference[];
}

export interface AssistantThread {
  caseId: string | null;
  title: string;
  conversation: IureConversation;
  messages: AssistantMessage[];
}

const threads = new Map<string, AssistantThread>();

const keyOf = (path: string | null, caseId: string | null) => `${caseId ?? '-'}|${path ?? '-'}`;

const baseName = (path: string | null) => (path ? (path.split(/[\\/]/).pop() ?? path) : t('assistant.untitled'));

export const threadFor = (path: string | null, caseId: string | null): AssistantThread => {
  const key = keyOf(path, caseId);
  let thread = threads.get(key);
  if (!thread) {
    const title = `iureditor · ${baseName(path)}`;
    thread = { caseId, title, conversation: new IureConversation(caseId, title), messages: [] };
    threads.set(key, thread);
  }
  return thread;
};

/** Empieza de cero: borra la conversación en la instancia y vacía el hilo. */
export const resetThread = (path: string | null, caseId: string | null): void => {
  const key = keyOf(path, caseId);
  threads.get(key)?.conversation.dispose();
  threads.delete(key);
};

/** Conversación nueva en la instancia para el mismo hilo (los mensajes del
 *  panel se conservan). Se usa antes de mandar el documento completo: la
 *  instancia reenvía todo el historial en cada turno, y con el documento ya
 *  dentro cada pregunta costaría el documento entero otra vez. */
export const rotateConversation = (thread: AssistantThread): void => {
  thread.conversation.dispose();
  thread.conversation = new IureConversation(thread.caseId, thread.title);
};

/** Al cerrar la app: borra las conversaciones creadas. */
export const disposeAllThreads = (): void => {
  threads.forEach((th) => th.conversation.dispose());
  threads.clear();
};

export const ASSISTANT_SYSTEM_PROMPT = `You are an assistant inside a Markdown document editor (iureditor), helping the user write their document.
- Answer in the language of the question, concisely, in Markdown that can be pasted into the document as is.
- When asked for a piece of text (a clause, a paragraph, a list), reply only with that text, without introductions or closing remarks.
- When asked for a diagram, reply with a single \`\`\`mermaid code block.
- When the user includes selected text from the document, it is the passage the question refers to.
- If the information is not in the available sources, say so instead of guessing.`;

/** Mensaje a la instancia: la pregunta y, si la hay, la selección citada. */
export const buildQuestion = (question: string, selection: string): string => {
  if (!selection.trim()) return question;
  const label = getLang() === 'es' ? 'Texto seleccionado del documento' : 'Selected text from the document';
  const quoted = selection.trim().replace(/^/gm, '> ');
  return `${label}:\n${quoted}\n\n${question}`;
};

/** Quita las marcas de cita de la instancia ([1], [2, 3]) al insertar o copiar:
 *  fuera del panel no remiten a nada. Las notas al pie ([^1]) no se tocan. */
export const stripCitations = (text: string): string =>
  text.replace(/[ \t]?\[\d+(?:\s*[,;–-]\s*\d+)*\](?!\()/g, '').trim();

// ---------------------------------------------------------------------------
// Análisis del documento
// ---------------------------------------------------------------------------

/** Tope del documento que se manda (≈ 25-30 mil tokens). Más largo, se pide
 *  seleccionar la parte a analizar. */
export const DOC_CHAR_LIMIT = 100_000;

/** Markdown del documento listo para mandar: sin imágenes incrustadas en
 *  base64 (pueden pesar megas y no aportan al texto). */
export const prepareDocument = (markdown: string): string =>
  markdown.replace(/!\[([^\]]*)\]\(data:[^)]*\)/g, '![$1]()').trim();

export const countWords = (text: string): number => (text.match(/\S+/g) ?? []).length;

/** Mensaje con el documento completo entre marcas y la instrucción al final. */
export const buildDocumentMessage = (instruction: string, name: string, markdown: string): string => {
  const label = getLang() === 'es' ? `Documento «${name}»` : `Document "${name}"`;
  return `${label}:\n-----BEGIN DOCUMENT-----\n${markdown}\n-----END DOCUMENT-----\n\n${instruction}`;
};

export interface Analysis {
  id: string;
  label: I18nKey;
  prompt: I18nKey;
  /** Sólo tiene sentido en el chat de un proyecto. */
  caseOnly?: boolean;
}

export const ANALYSES: Analysis[] = [
  { id: 'review', label: 'assistant.analysis.review', prompt: 'assistant.analysis.reviewPrompt' },
  { id: 'summary', label: 'assistant.analysis.summary', prompt: 'assistant.analysis.summaryPrompt' },
  { id: 'missing', label: 'assistant.analysis.missing', prompt: 'assistant.analysis.missingPrompt' },
  { id: 'case', label: 'assistant.analysis.case', prompt: 'assistant.analysis.casePrompt', caseOnly: true },
];
