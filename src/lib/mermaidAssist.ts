// Asistente de diagramas: pide a la IA de Iurefficient el código mermaid de un
// diagrama descrito en lenguaje natural (o un cambio sobre el borrador actual),
// lo valida con el parser de mermaid y, si no compila, reintenta una vez
// pasándole el error. Cada sesión de edición del diagrama es una conversación
// (ver iureChat.ts): los cambios sucesivos llevan el contexto de los anteriores.
import { getLang } from './i18n';
import type { IureConversation } from './iureChat';
import { mermaidSyntaxError } from './mermaid';

const SYSTEM_PROMPT = `You write Mermaid diagrams (Mermaid 11) for a Markdown editor.
Reply ONLY with a single \`\`\`mermaid code block: no explanations before or after it.
- One diagram per block. Pick the diagram type that best fits the request unless it names one.
- Quote node labels that contain parentheses, commas, colons, accents or other special characters, e.g. A["Juicio (amparo)"].
- Do not use HTML tags in labels except <br> for line breaks.
- Write the labels in the language of the user's request.
- If the current code is given and the request asks for a change, return the whole modified diagram, keeping everything the request does not mention.`;

/** Primer bloque de código mermaid de la respuesta (o la respuesta entera si
 *  el modelo no usó cerca de código). */
export const extractMermaid = (reply: string): string => {
  const fence = /```[ \t]*(?:mermaid)?[ \t]*\r?\n([\s\S]*?)```/i.exec(reply);
  return (fence ? fence[1] : reply).replace(/^\s*\n/, '').trimEnd();
};

const buildMessage = (request: string, current: string): string => {
  const es = getLang() === 'es';
  if (!current.trim()) return request;
  return es
    ? `Código actual del diagrama:\n\`\`\`mermaid\n${current}\n\`\`\`\n\nPetición: ${request}`
    : `Current diagram code:\n\`\`\`mermaid\n${current}\n\`\`\`\n\nRequest: ${request}`;
};

const buildRetry = (code: string, error: string): string =>
  getLang() === 'es'
    ? `Este código mermaid no compila:\n\`\`\`mermaid\n${code}\n\`\`\`\n\nError del parser:\n${error}\n\nCorrígelo y devuelve el diagrama completo.`
    : `This Mermaid code does not compile:\n\`\`\`mermaid\n${code}\n\`\`\`\n\nParser error:\n${error}\n\nFix it and return the whole diagram.`;


export interface AssistResult {
  code: string;
  /** Error del parser si ni el reintento compiló (el código se entrega igual
   *  para que el usuario lo corrija a mano). */
  error: string | null;
}

/** Genera o modifica un diagrama. Lanza si la instancia falla (sin sesión,
 *  cuota agotada, red…). */
export async function assistDiagram(
  conversation: IureConversation,
  request: string,
  current: string
): Promise<AssistResult> {
  const ask = async (message: string) => (await conversation.send(message, SYSTEM_PROMPT)).content;
  let code = extractMermaid(await ask(buildMessage(request, current)));
  let error = code ? await mermaidSyntaxError(code) : 'empty';
  if (error) {
    code = extractMermaid(await ask(buildRetry(code, error)));
    error = code ? await mermaidSyntaxError(code) : 'empty';
  }
  return { code, error };
}
