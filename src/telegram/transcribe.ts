/**
 * Speech-to-text for Telegram voice messages via an OpenAI-compatible
 * transcription endpoint. Default: Groq (free tier, whisper-large-v3-turbo).
 * Optional — without a key JARVIS asks for text instead.
 */
export interface Transcriber {
  transcribe(audio: Buffer, filename: string, mime: string): Promise<string>;
}

export class OpenAiCompatibleTranscriber implements Transcriber {
  constructor(
    private readonly opts: { apiKey: string; url: string; model: string; language?: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async transcribe(audio: Buffer, filename: string, mime: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), filename);
    form.append("model", this.opts.model);
    form.append("language", this.opts.language ?? "de");
    form.append("response_format", "json");
    const res = await this.fetchImpl(this.opts.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.opts.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Transkription fehlgeschlagen (HTTP ${res.status}).`);
    const data = (await res.json()) as { text?: string };
    return (data.text ?? "").trim();
  }
}
