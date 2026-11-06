// Conversación con el asistente de IA de Iurefficient. Cada una se crea en la
// instancia al enviar el primer mensaje (sin conversación propia, la instancia
// usaría como historial todo el chat del usuario o del proyecto) y se borra al
// descartarla. Con `caseId` es el chat del proyecto: busca en sus documentos y
// devuelve las fuentes citadas.
import { invoke } from '@tauri-apps/api/core';

export interface ChatReference {
  index: number;
  /** document, task, deadline… */
  kind: string;
  title: string;
  excerpt: string;
}

export interface ChatReply {
  content: string;
  references: ChatReference[];
}

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

  async send(message: string, systemPrompt?: string): Promise<ChatReply> {
    const conversationId = await this.ensure();
    return invoke<ChatReply>('iure_chat_send', {
      caseId: this.caseId,
      conversationId,
      message,
      systemPrompt: systemPrompt ?? null,
    });
  }

  /** Borra la conversación en la instancia (si llegó a crearse). */
  dispose(): void {
    const id = this.id;
    this.id = null;
    void id
      ?.then((conversationId) => invoke('iure_chat_delete', { caseId: this.caseId, conversationId }))
      .catch(() => {});
  }
}
