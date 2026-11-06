// Conversación con el asistente de IA de Iurefficient. Cada una se crea en la
// instancia al enviar el primer mensaje (sin conversación propia, la instancia
// usaría como historial todo el chat del usuario o del proyecto) y se borra al
// descartarla. Con `caseId` es el chat del proyecto: busca en sus documentos y
// devuelve las fuentes citadas. La respuesta llega en streaming: cada fragmento
// va a `onToken` según lo escribe el modelo.
import { Channel, invoke } from '@tauri-apps/api/core';

export interface ChatReference {
  index: number;
  /** document, task, deadline… */
  kind: string;
  title: string;
  excerpt: string;
  entityId?: string | null;
}

export interface ChatReply {
  content: string;
  references: ChatReference[];
}

/** Error de una petición cancelada con `IureConversation.cancel()`. */
export class ChatCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'ChatCancelled';
  }
}

let nextRequestId = 1;

export class IureConversation {
  private id: Promise<string> | null = null;

  constructor(
    readonly caseId: string | null,
    private readonly title: string
  ) {}

  private ensure(): Promise<string> {
    if (!this.id) {
      this.id = invoke<string>('iure_chat_new', { caseId: this.caseId, title: this.title });
      // Si falló (sin sesión, red…), el siguiente envío vuelve a intentarlo.
      this.id.catch(() => {
        this.id = null;
      });
    }
    return this.id;
  }

  private pending = new Set<number>();

  /** Envía un mensaje; `onToken` recibe el texto acumulado según llega. Lanza
   *  `ChatCancelled` si se cancela antes de terminar. */
  async send(
    message: string,
    systemPrompt?: string,
    onToken?: (textSoFar: string) => void
  ): Promise<ChatReply> {
    const conversationId = await this.ensure();
    const requestId = nextRequestId++;
    let soFar = '';
    const channel = new Channel<string>();
    channel.onmessage = (token) => {
      soFar += token;
      onToken?.(soFar);
    };
    this.pending.add(requestId);
    try {
      const reply = await invoke<ChatReply | null>('iure_chat_send', {
        requestId,
        caseId: this.caseId,
        conversationId,
        message,
        systemPrompt: systemPrompt ?? null,
        onToken: channel,
      });
      if (!reply) throw new ChatCancelled();
      return reply;
    } finally {
      this.pending.delete(requestId);
    }
  }

  /** Deja de esperar las respuestas en curso (la instancia las termina igual). */
  cancel(): void {
    this.pending.forEach((requestId) => void invoke('iure_chat_cancel', { requestId }).catch(() => {}));
    this.pending.clear();
  }

  /** Borra la conversación en la instancia (si llegó a crearse). */
  dispose(): void {
    this.cancel();
    const id = this.id;
    this.id = null;
    void id
      ?.then((conversationId) => invoke('iure_chat_delete', { caseId: this.caseId, conversationId }))
      .catch(() => {});
  }
}
