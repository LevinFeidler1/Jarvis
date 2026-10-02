/**
 * Optional realistic voice via ElevenLabs (free tier: ~10,000 credits/month).
 * Without a key — or when the quota is used up — the browser's own voice is
 * used, so voice mode never stops working.
 */
export interface SpeechSynth {
  speak(text: string): Promise<{ audio: Buffer; mime: string }>;
}

export class TtsQuotaError extends Error {}

export class ElevenLabsSynth implements SpeechSynth {
  constructor(
    private readonly opts: { apiKey: string; voiceId: string; model: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async speak(text: string): Promise<{ audio: Buffer; mime: string }> {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.opts.voiceId)}?output_format=mp3_44100_64`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "xi-api-key": this.opts.apiKey, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: this.opts.model,
        language_code: "de",
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 401 || res.status === 402 || res.status === 429) {
      // Key invalid or free credits used up → client falls back to the device voice.
      throw new TtsQuotaError(`ElevenLabs nicht verfügbar (HTTP ${res.status}).`);
    }
    if (!res.ok) throw new Error(`Sprachausgabe fehlgeschlagen (HTTP ${res.status}).`);
    return { audio: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg" };
  }
}
