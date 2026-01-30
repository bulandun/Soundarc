import express from 'express';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

app.use(express.json({ limit: '10mb' }));

const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;

const ai = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;

const toJson = (rawText: string): any => {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('Model did not return JSON.');
  }
  return JSON.parse(match[0]);
};

const buildTemporalIndex = (segments: Array<{ start_time: number; end_time: number; summary: string }>) =>
  segments
    .map((segment) => `${segment.start_time.toFixed(2)}-${segment.end_time.toFixed(2)}: ${segment.summary}`)
    .join('\n');

app.post('/api/transcribe', upload.single('file'), async (req, res) => {
  if (!elevenLabsApiKey) {
    return res.status(500).send('Missing ELEVENLABS_API_KEY on server.');
  }
  if (!req.file) {
    return res.status(400).send('No audio file provided.');
  }

  try {
    const formData = new FormData();
    formData.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
    formData.append('model_id', 'scribe_v1');

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': elevenLabsApiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const message = await response.text();
      return res.status(response.status).send(message || 'ElevenLabs transcription failed.');
    }

    const data = await response.json();
    const transcript = data.text || data.transcript || '';
    return res.json({ transcript });
  } catch (error) {
    console.error(error);
    return res.status(500).send('Server transcription error.');
  }
});

app.post('/api/analyze', async (req, res) => {
  if (!ai) {
    return res.status(500).send('Missing GEMINI_API_KEY on server.');
  }

  const { transcript, duration_seconds: durationSeconds } = req.body as {
    transcript?: string;
    duration_seconds?: number;
  };

  if (!transcript) {
    return res.status(400).send('Transcript required.');
  }

  try {
    const prompt = `You are an archival audio analyst.\n\nGiven the transcript below, segment the recording into structural segments.\nReturn ONLY valid JSON matching this schema:\n{\n  "description": string,\n  "temporal_index": string,\n  "segments": [\n    {\n      "id": string,\n      "start_time": number,\n      "end_time": number,\n      "type": "Speech"|"Tune"|"Song"|"Silence"|"Other",\n      "summary": string,\n      "confidence": number,\n      "segment_metadata": {\n        "tune_type"?: string,\n        "meter"?: string,\n        "tempo_bpm_range"?: [number, number],\n        "instruments"?: string[],\n        "region"?: string,\n        "performers"?: string[],\n        "evidence"?: string[]\n      }\n    }\n  ]\n}\n\nRecording duration (seconds): ${durationSeconds ?? 'unknown'}\n\nTranscript:\n${transcript}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const rawText = response.text || '';
    const parsed = toJson(rawText);
    const now = new Date().toISOString();

    const segments = Array.isArray(parsed.segments) ? parsed.segments : [];
    const normalized = segments.map((segment: any, index: number) => ({
      id: segment.id || `seg_${index + 1}`,
      start_time: Number(segment.start_time ?? 0),
      end_time: Number(segment.end_time ?? 0),
      type: segment.type || 'Speech',
      summary: segment.summary || 'Segment summary unavailable.',
      confidence: Number(segment.confidence ?? 0.6),
      alternatives: segment.alternatives || undefined,
      notes: segment.notes || undefined,
      segment_metadata: segment.segment_metadata || {},
      provenance: {
        generated_by: 'gemini-2.5-flash',
        generated_at: now,
        generation_method: 'segment_analysis',
        human_review_status: 'unreviewed',
      },
    }));

    const temporalIndex =
      parsed.temporal_index || (normalized.length ? buildTemporalIndex(normalized) : '');

    return res.json({
      description: parsed.description || 'Semantic overview unavailable.',
      temporal_index: temporalIndex,
      segments: normalized,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).send('Gemini analysis error.');
  }
});

app.post('/api/narrate', async (req, res) => {
  if (!elevenLabsApiKey) {
    return res.status(500).send('Missing ELEVENLABS_API_KEY on server.');
  }

  const { text } = req.body as { text?: string };
  if (!text) {
    return res.status(400).send('Narration text required.');
  }

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM', {
      method: 'POST',
      headers: {
        'xi-api-key': elevenLabsApiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      return res.status(response.status).send(message || 'ElevenLabs narration failed.');
    }

    const audioBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');
    return res.json({ audio_base64: base64Audio });
  } catch (error) {
    console.error(error);
    return res.status(500).send('Narration server error.');
  }
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`API server listening on ${port}`);
});
