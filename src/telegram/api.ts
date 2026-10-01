/** Minimal Telegram Bot API client (https://core.telegram.org/bots/api). Free, no phone number needed. */

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; first_name?: string; username?: string };
  date: number;
  text?: string;
  caption?: string;
  voice?: { file_id: string; duration: number; mime_type?: string; file_size?: number };
  audio?: { file_id: string; duration: number; mime_type?: string; file_size?: number; file_name?: string };
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  photo?: Array<{ file_id: string; width: number; height: number; file_size?: number }>;
  /** Set when the message was forwarded from someone else. */
  forward_origin?: { type: string };
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: { id: number }; message?: TgMessage; data?: string };
}

export class TelegramApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
    // The token is part of the URL — never include the URL in errors or logs.
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description ?? `HTTP ${res.status}`}`);
    return data.result as T;
  }

  getMe() {
    return this.call<{ id: number; username: string; first_name: string }>("getMe", {});
  }

  setWebhook(url: string, secret: string) {
    return this.call<boolean>("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  }

  getWebhookInfo() {
    return this.call<{ url: string; pending_update_count: number; last_error_message?: string }>("getWebhookInfo", {});
  }

  sendMessage(chatId: number | string, text: string, buttons?: InlineButton[][]) {
    // Telegram limit: 4096 characters per message.
    return this.call<TgMessage>("sendMessage", {
      chat_id: chatId,
      text: text.length > 4000 ? `${text.slice(0, 3990)} …` : text,
      link_preview_options: { is_disabled: true },
      ...(buttons?.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
    });
  }

  sendChatAction(chatId: number | string, action: "typing" | "upload_document") {
    return this.call<boolean>("sendChatAction", { chat_id: chatId, action }).catch(() => false);
  }

  answerCallbackQuery(id: string, text?: string) {
    return this.call<boolean>("answerCallbackQuery", { callback_query_id: id, ...(text ? { text: text.slice(0, 190) } : {}) }).catch(() => false);
  }

  clearButtons(chatId: number | string, messageId: number) {
    return this.call<unknown>("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
  }

  /** Bots can download files up to 20 MB. */
  async downloadFile(fileId: string): Promise<{ data: Buffer; path: string }> {
    const f = await this.call<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
    if (!f.file_path) throw new Error("Datei ist zu groß für Telegram-Bots (max. 20 MB).");
    const res = await this.fetchImpl(`https://api.telegram.org/file/bot${this.token}/${f.file_path}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Download fehlgeschlagen (HTTP ${res.status}).`);
    return { data: Buffer.from(await res.arrayBuffer()), path: f.file_path };
  }
}
