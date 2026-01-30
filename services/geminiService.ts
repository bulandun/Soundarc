import type { StructuralSegment } from '../types';

const jsonHeaders = {
  'Content-Type': 'application/json',
};

export async function transcribeAudio(audio: Blob): Promise<string> {
  const formData = new FormData();
  formData.append('file', audio, 'audio');

  const response = await fetch('/api/transcribe', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Transcription failed.');
  }

  const data = await response.json();
  return data.transcript || data.text || '';
}

export async function suggestArchivalSegments(
  base64Audio: string,
  mimeType: string,
  transcript: string,
  durationSeconds: number
): Promise<{ segments: StructuralSegment[]; temporal_index: string; description: string }> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      audio_base64: base64Audio,
      mime_type: mimeType,
      transcript,
      duration_seconds: durationSeconds,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Analysis failed.');
  }

  return response.json();
}

export async function generateArchivalNarrative(description: string): Promise<string> {
  const response = await fetch('/api/narrate', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ text: description }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Narration failed.');
  }

  const data = await response.json();
  return data.audio_base64 || '';
}

export function decodeBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    buffer[i] = binary.charCodeAt(i);
  }
  return buffer.buffer;
}

export async function decodeAudioBuffer(
  audioData: ArrayBuffer,
  audioContext: AudioContext,
  sampleRate: number,
  channels: number
): Promise<AudioBuffer> {
  const decoded = await audioContext.decodeAudioData(audioData.slice(0));
  if (decoded.sampleRate === sampleRate && decoded.numberOfChannels === channels) {
    return decoded;
  }

  const offlineCtx = new OfflineAudioContext(channels, decoded.length, sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start(0);
  return offlineCtx.startRendering();
}
