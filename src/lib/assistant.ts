// Estado y textos del panel «Asistente». Los hilos viven aquí (fuera de React)
// para sobrevivir a los cambios de vista de la barra lateral: uno por documento
// y alcance (proyecto vinculado o chat general), cada uno con su conversación
// en la instancia.
import { getLang, t } from './i18n';
import { IureConversation, type ChatReference } from './iureChat';

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Texto seleccionado que acompañó a la pregunta. */
  selection?: string;
  references?: ChatReference[];
}

export interface AssistantThread {
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
    thread = {
      conversation: new IureConversation(caseId, `iureditor · ${baseName(path)}`),
      messages: [],
    };
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
