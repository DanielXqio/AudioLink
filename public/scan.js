const scanToggle = document.getElementById('scan-toggle');
const status = document.getElementById('status');
const result = document.getElementById('result');
const resultText = document.getElementById('result-text');
const resultPreview = document.getElementById('result-preview');
const resultPreviewImage = document.getElementById('result-preview-image');
const resultPreviewTitle = document.getElementById('result-preview-title');
const resultPreviewDescription = document.getElementById('result-preview-description');
const resultPreviewLink = document.getElementById('result-preview-link');
const resultPreviewSource = document.getElementById('result-preview-source');

let mediaRecorder;
let audioChunks = [];
let audioContext;
let isScanning = false;

function setStatus(message, tone = 'muted') {
  status.textContent = message;
  status.dataset.tone = tone;
}

function float32ToBase64(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new Float32Array(buffer);
  view.set(float32Array);
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function resetPreview() {
  resultPreview.hidden = true;
  resultPreviewImage.hidden = true;
  resultPreviewImage.removeAttribute('src');
  resultPreviewTitle.textContent = '';
  resultPreviewTitle.hidden = true;
  resultPreviewDescription.textContent = '';
  resultPreviewDescription.hidden = true;
  resultPreviewLink.textContent = '';
  resultPreviewLink.href = '#';
  resultPreviewLink.hidden = true;
  resultPreviewSource.textContent = '';
  resultPreviewSource.hidden = true;
}

function formatDisplayUrl(urlString) {
  if (!urlString) {
    return '';
  }
  try {
    const url = new URL(urlString);
    return url.hostname + url.pathname.replace(/\/$/, '');
  } catch (error) {
    return urlString;
  }
}

function updatePreview(metadata, fallbackUrl) {
  if (!metadata) {
    resetPreview();
    return;
  }

  const targetUrl = metadata.url || fallbackUrl;
  const hasImage = Boolean(metadata.image);
  const hasTitle = Boolean(metadata.title);
  const hasDescription = Boolean(metadata.description);
  const hasContent = hasImage || hasTitle || hasDescription;

  if (!hasContent && !targetUrl) {
    resetPreview();
    return;
  }

  if (hasImage) {
    resultPreviewImage.src = metadata.image;
    resultPreviewImage.hidden = false;
  } else {
    resultPreviewImage.removeAttribute('src');
    resultPreviewImage.hidden = true;
  }

  if (hasTitle) {
    resultPreviewTitle.textContent = metadata.title;
    resultPreviewTitle.hidden = false;
  } else {
    resultPreviewTitle.textContent = '';
    resultPreviewTitle.hidden = true;
  }

  if (hasDescription) {
    resultPreviewDescription.textContent = metadata.description;
    resultPreviewDescription.hidden = false;
  } else {
    resultPreviewDescription.textContent = '';
    resultPreviewDescription.hidden = true;
  }

  if (targetUrl) {
    const displayUrl = formatDisplayUrl(targetUrl) || targetUrl;
    resultPreviewLink.href = targetUrl;
    resultPreviewLink.textContent = displayUrl;
    resultPreviewLink.hidden = false;
    resultPreviewSource.textContent = displayUrl;
    resultPreviewSource.hidden = false;
  } else {
    resultPreviewLink.href = '#';
    resultPreviewLink.textContent = '';
    resultPreviewLink.hidden = true;
    resultPreviewSource.textContent = '';
    resultPreviewSource.hidden = true;
  }

  resultPreview.hidden = false;
}

async function decodeFloat32(float32Array, sampleRate) {
  const base64 = float32ToBase64(float32Array);
  const response = await fetch('/api/decode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioBase64: base64, sampleRate }),
  });

  if (!response.ok) {
    const { error } = await response.json();
    throw new Error(error || 'Decoding failed.');
  }

  const payload = await response.json();
  if (payload.success) {
    result.hidden = false;
    resultText.textContent = payload.text || '';
    updatePreview(payload.metadata, payload.text);
    setStatus('Message detected! Check the decoded text below.', 'success');
  } else {
    result.hidden = true;
    resultText.textContent = '';
    resetPreview();
    setStatus(payload.message || 'No payload detected.', 'warning');
  }
}

async function stopScanning() {
  if (!mediaRecorder) {
    return;
  }
  mediaRecorder.stop();
  setStatus('Processing recording…');
  scanToggle.textContent = 'Scan Now';
  scanToggle.dataset.state = 'idle';
  scanToggle.setAttribute('aria-pressed', 'false');
  isScanning = false;
}

async function startScanning() {
  try {
    if (!audioContext) {
      audioContext = new AudioContext();
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
        mediaRecorder.stream.getTracks().forEach((track) => track.stop());
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const channelData = audioBuffer.getChannelData(0);
        await decodeFloat32(channelData, audioBuffer.sampleRate);
      } catch (error) {
        console.error('Unable to process recording', error);
        setStatus(error.message || 'Unable to process recording.', 'error');
      } finally {
        mediaRecorder = null;
        audioChunks = [];
      }
    };

    mediaRecorder.start();
    setStatus('Listening… hold the speaker close to your microphone.', 'active');
    scanToggle.textContent = 'Stop Listening';
    scanToggle.dataset.state = 'recording';
    scanToggle.setAttribute('aria-pressed', 'true');
    isScanning = true;
  } catch (error) {
    console.error('Microphone access denied', error);
    setStatus('Microphone access denied. Please enable audio permissions.', 'error');
    scanToggle.textContent = 'Scan Now';
    scanToggle.dataset.state = 'idle';
    scanToggle.setAttribute('aria-pressed', 'false');
    isScanning = false;
  }
}

scanToggle.addEventListener('click', async () => {
  if (isScanning && mediaRecorder?.state === 'recording') {
    await stopScanning();
  } else if (!isScanning) {
    await startScanning();
  }
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space' && !event.repeat) {
    event.preventDefault();
    scanToggle.click();
  }
});
