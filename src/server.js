const express = require('express');
const path = require('path');
const cheerio = require('cheerio');
const ggwaveFactory = require('ggwave');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

let ggwaveModule;
let ggwaveInstance;
let defaultParameters;
const METADATA_TIMEOUT_MS = 5000;

async function ensureGgWave() {
  if (ggwaveModule && ggwaveInstance) {
    return { ggwave: ggwaveModule, instance: ggwaveInstance };
  }

  ggwaveModule = await ggwaveFactory();
  defaultParameters = ggwaveModule.getDefaultParameters();
  ggwaveInstance = ggwaveModule.init(defaultParameters);
  if (typeof ggwaveModule.disableLog === 'function') {
    ggwaveModule.disableLog();
  }
  return { ggwave: ggwaveModule, instance: ggwaveInstance };
}

function getProtocolId(ggwave, protocolName) {
  if (!protocolName) {
    return ggwave.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST.value;
  }
  const protocol = ggwave.ProtocolId[protocolName];
  if (!protocol) {
    return null;
  }
  return protocol.value;
}

function float32ToWav(float32Array, sampleRate) {
  const buffer = new ArrayBuffer(44 + float32Array.length * 2);
  const view = new DataView(buffer);

  function writeString(offset, string) {
    for (let i = 0; i < string.length; i += 1) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + float32Array.length * bytesPerSample, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, 'data');
  view.setUint32(40, float32Array.length * bytesPerSample, true);

  const offset = 44;
  const bufferView = new DataView(buffer, offset);
  for (let i = 0; i < float32Array.length; i += 1) {
    let sample = Math.max(-1, Math.min(1, float32Array[i]));
    sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    bufferView.setInt16(i * 2, sample, true);
  }

  return Buffer.from(buffer);
}

function resample(float32Array, fromSampleRate, toSampleRate) {
  if (!float32Array || fromSampleRate === toSampleRate) {
    return float32Array;
  }
  const ratio = fromSampleRate / toSampleRate;
  const newLength = Math.round(float32Array.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i += 1) {
    const sourceIndex = i * ratio;
    const lower = Math.floor(sourceIndex);
    const upper = Math.min(lower + 1, float32Array.length - 1);
    const weight = sourceIndex - lower;
    result[i] = (1 - weight) * float32Array[lower] + weight * float32Array[upper];
  }
  return result;
}

function isHttpUrl(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

async function fetchLinkMetadata(urlString) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);
  try {
    const response = await fetch(urlString, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'AudioLink/1.0 (+https://github.com/ggerganov/ggwave)',
        accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const getMeta = (selectors) => {
      for (const selector of selectors) {
        const value = $(selector).attr('content');
        if (value) {
          return value.trim();
        }
      }
      return undefined;
    };

    const getText = (selector) => {
      const value = $(selector).first().text();
      return value ? value.trim() : undefined;
    };

    const title =
      getMeta(["meta[property='og:title']", "meta[name='twitter:title']", "meta[name='title']"]) ||
      getText('title');
    const description =
      getMeta([
        "meta[property='og:description']",
        "meta[name='description']",
        "meta[name='twitter:description']",
      ]);
    const image = getMeta([
      "meta[property='og:image']",
      "meta[name='twitter:image']",
      "meta[property='og:image:url']",
    ]);

    const metadata = {
      url: response.url || urlString,
    };

    if (title) {
      metadata.title = title;
    }
    if (description) {
      metadata.description = description;
    }
    if (image) {
      metadata.image = image;
    }

    if (!metadata.title && !metadata.description && !metadata.image) {
      return metadata;
    }

    return metadata;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn(`Metadata fetch timed out for ${urlString}`);
    } else {
      console.warn(`Unable to fetch metadata for ${urlString}:`, error.message);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

app.post('/api/encode', async (req, res) => {
  try {
    const { ggwave } = await ensureGgWave();
    const { text, protocol, volume = 10 } = req.body || {};

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'A text payload is required.' });
    }

    const protocolId = getProtocolId(ggwave, protocol);
    if (protocol && protocolId === null) {
      return res.status(400).json({ error: `Unknown protocol: ${protocol}` });
    }

    const waveformBytes = ggwave.encode(
      ggwaveInstance,
      text,
      protocolId,
      Number(volume) || 10,
    );

    const float32Array = new Float32Array(
      waveformBytes.buffer,
      waveformBytes.byteOffset,
      waveformBytes.length / Float32Array.BYTES_PER_ELEMENT,
    );

    const wavBuffer = float32ToWav(float32Array, defaultParameters.sampleRate);
    const base64 = wavBuffer.toString('base64');

    return res.json({
      audioBase64: base64,
      mimeType: 'audio/wav',
      sampleRate: defaultParameters.sampleRate,
      protocol: protocol || 'GGWAVE_PROTOCOL_AUDIBLE_FAST',
    });
  } catch (error) {
    console.error('Failed to encode text:', error);
    return res.status(500).json({ error: 'Encoding failed.' });
  }
});

app.post('/api/decode', async (req, res) => {
  try {
    const { ggwave } = await ensureGgWave();
    const { audioBase64, sampleRate } = req.body || {};

    if (!audioBase64) {
      return res.status(400).json({ error: 'Audio data is required.' });
    }

    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const arrayBuffer = audioBuffer.buffer.slice(
      audioBuffer.byteOffset,
      audioBuffer.byteOffset + audioBuffer.byteLength,
    );
    let float32Array = new Float32Array(arrayBuffer);

    const incomingSampleRate = Number(sampleRate) || defaultParameters.sampleRate;
    if (incomingSampleRate !== defaultParameters.sampleRate) {
      float32Array = resample(float32Array, incomingSampleRate, defaultParameters.sampleRate);
    }

    const byteArray = new Int8Array(
      float32Array.buffer,
      float32Array.byteOffset,
      float32Array.byteLength,
    );

    const decoded = ggwave.decode(ggwaveInstance, byteArray);

    if (!decoded || decoded.length === 0) {
      return res.status(200).json({ text: '', success: false, message: 'No payload detected.' });
    }

    const text = Buffer.from(decoded).toString('utf-8');
    let metadata = null;

    if (isHttpUrl(text)) {
      metadata = await fetchLinkMetadata(text);
    }

    return res.json({ text, success: true, metadata });
  } catch (error) {
    console.error('Failed to decode audio:', error);
    return res.status(500).json({ error: 'Decoding failed.' });
  }
});

app.get('/api/protocols', async (_req, res) => {
  try {
    const { ggwave } = await ensureGgWave();
    const entries = Object.entries(ggwave.ProtocolId)
      .filter(([, value]) => typeof value === 'object' && 'value' in value)
      .map(([key, value]) => ({ key, value: value.value }));
    res.json({ protocols: entries });
  } catch (error) {
    console.error('Failed to load protocols:', error);
    res.status(500).json({ error: 'Unable to list protocols.' });
  }
});

ensureGgWave()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize ggwave:', error);
    process.exit(1);
  });
