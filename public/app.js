const protocolSelect = document.getElementById('protocol-select');
const volumeRange = document.getElementById('volume-range');
const volumeValue = document.getElementById('volume-value');
const encodeForm = document.getElementById('encode-form');
const encodeText = document.getElementById('encode-text');
const encodeAudio = document.getElementById('encode-audio');
const downloadLink = document.getElementById('download-link');
const encodeOutput = document.getElementById('encode-output');
const decodeFileInput = document.getElementById('decode-file');
const decodeFileButton = document.getElementById('decode-file-button');
const decodedText = document.getElementById('decoded-text');
const recordToggle = document.getElementById('record-toggle');
const status = document.getElementById('status');
const linkPreview = document.getElementById('link-preview');
const previewImage = document.getElementById('preview-image');
const previewTitle = document.getElementById('preview-title');
const previewDescription = document.getElementById('preview-description');
const previewUrl = document.getElementById('preview-url');
const previewSource = document.getElementById('preview-source');

let mediaRecorder;
let audioChunks = [];
let audioContext;
let currentDownloadUrl;

function updateStatus(message, tone = 'info') {
  status.textContent = message || '';
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

function resetLinkPreview() {
  linkPreview.hidden = true;
  previewImage.hidden = true;
  previewImage.removeAttribute('src');
  previewTitle.textContent = '';
  previewTitle.hidden = true;
  previewDescription.textContent = '';
  previewDescription.hidden = true;
  previewSource.textContent = '';
  previewSource.hidden = true;
  previewUrl.textContent = '';
  previewUrl.href = '#';
  previewUrl.hidden = true;
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

async function fetchMetadata(targetUrl) {
  try {
    const response = await fetch(`/api/metadata?url=${encodeURIComponent(targetUrl)}`);
    if (!response.ok) {
      throw new Error('Metadata request failed');
    }
    const data = await response.json();
    if (!data || typeof data !== 'object') {
      return { url: targetUrl };
    }
    if (!data.url) {
      data.url = targetUrl;
    }
    return data;
  } catch (error) {
    console.warn('Unable to load metadata', error);
    return { url: targetUrl };
  }
}

function updateLinkPreview(metadata, fallbackUrl) {
  if (!metadata) {
    resetLinkPreview();
    return;
  }

  const targetUrl = metadata.url || fallbackUrl;
  const hasImage = Boolean(metadata.image);
  const hasTitle = Boolean(metadata.title);
  const hasDescription = Boolean(metadata.description);
  const hasContent = hasImage || hasTitle || hasDescription;
  const displaySource = metadata.siteName || formatDisplayUrl(targetUrl);

  if (!hasContent && !targetUrl) {
    resetLinkPreview();
    return;
  }

  if (hasImage) {
    previewImage.src = metadata.image;
    previewImage.hidden = false;
  } else {
    previewImage.removeAttribute('src');
    previewImage.hidden = true;
  }

  if (hasTitle) {
    previewTitle.textContent = metadata.title;
    previewTitle.hidden = false;
  } else {
    previewTitle.textContent = '';
    previewTitle.hidden = true;
  }

  if (hasDescription) {
    previewDescription.textContent = metadata.description;
    previewDescription.hidden = false;
  } else {
    previewDescription.textContent = '';
    previewDescription.hidden = true;
  }

  if (targetUrl) {
    previewUrl.href = targetUrl;
    previewUrl.textContent = displaySource || targetUrl;
    previewUrl.hidden = false;
    if (displaySource) {
      previewSource.textContent = displaySource;
      previewSource.hidden = false;
    } else {
      previewSource.textContent = '';
      previewSource.hidden = true;
    }
  } else {
    previewUrl.href = '#';
    previewUrl.textContent = '';
    previewUrl.hidden = true;
    previewSource.textContent = '';
    previewSource.hidden = true;
  }

  linkPreview.hidden = false;
}

function downloadBlobUrl(base64, mimeType) {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i += 1) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });
  if (currentDownloadUrl) {
    URL.revokeObjectURL(currentDownloadUrl);
  }
  currentDownloadUrl = URL.createObjectURL(blob);
  return currentDownloadUrl;
}

async function populateProtocols() {
  try {
    const response = await fetch('/api/protocols');
    const { protocols } = await response.json();
    protocolSelect.innerHTML = '';
    protocols.forEach(({ key }) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = key.replace('GGWAVE_PROTOCOL_', '').replace(/_/g, ' ');
      if (key === 'GGWAVE_PROTOCOL_AUDIBLE_FAST') {
        option.selected = true;
      }
      protocolSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Failed to load protocols', error);
    updateStatus('Unable to load ggwave protocols.', 'error');
  }
}

async function encodeMessage(event) {
  event.preventDefault();
  const text = encodeText.value.trim();
  if (!text) {
    updateStatus('Please enter a message before encoding.', 'warning');
    return;
  }

  updateStatus('Generating audio payload…');

  try {
    const response = await fetch('/api/encode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        protocol: protocolSelect.value,
        volume: Number(volumeRange.value),
      }),
    });

    if (!response.ok) {
      const { error } = await response.json();
      throw new Error(error || 'Failed to encode message.');
    }

    const result = await response.json();
    const { audioBase64, mimeType } = result;
    const objectUrl = downloadBlobUrl(audioBase64, mimeType);

    encodeAudio.src = `data:${mimeType};base64,${audioBase64}`;
    encodeAudio.load();
    downloadLink.href = objectUrl;
    encodeOutput.hidden = false;
    updateStatus('Audio ready. Play it or hold it near your microphone to decode.');
  } catch (error) {
    console.error(error);
    updateStatus(error.message || 'Encoding failed.', 'error');
  }
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

  const data = await response.json();
  if (!data.success) {
    updateStatus(data.message || 'No payload detected.', 'warning');
    resetLinkPreview();
    decodedText.textContent = '';
  } else {
    updateStatus('Successfully decoded message!');
    decodedText.textContent = data.text || '';
    resetLinkPreview();
    if (data.text && isHttpUrl(data.text)) {
      const metadata = await fetchMetadata(data.text);
      updateLinkPreview(metadata, data.text);
    }
  }
}

async function decodeUploadedFile() {
  const file = decodeFileInput.files?.[0];
  if (!file) {
    updateStatus('Please choose an audio file to decode.', 'warning');
    return;
  }

  updateStatus('Processing audio file…');

  try {
    if (!audioContext) {
      audioContext = new AudioContext();
    }
    const arrayBuffer = await file.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const channelData = decoded.getChannelData(0);
    await decodeFloat32(channelData, decoded.sampleRate);
  } catch (error) {
    console.error(error);
    updateStatus(error.message || 'Unable to decode file.', 'error');
  }
}

async function handleRecordingToggle() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    recordToggle.textContent = 'Start recording';
    updateStatus('Processing recording…');
    return;
  }

  try {
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
        if (!audioContext) {
          audioContext = new AudioContext();
        }
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const channelData = audioBuffer.getChannelData(0);
        await decodeFloat32(channelData, audioBuffer.sampleRate);
        updateStatus('Recording decoded.');
      } catch (error) {
        console.error(error);
        updateStatus(error.message || 'Unable to process recording.', 'error');
      }
    };
    mediaRecorder.start();
    recordToggle.textContent = 'Stop recording';
    updateStatus('Recording… play the encoded sound now.');
  } catch (error) {
    console.error(error);
    updateStatus('Microphone access denied.', 'error');
  }
}

volumeRange.addEventListener('input', () => {
  volumeValue.textContent = volumeRange.value;
});

encodeForm.addEventListener('submit', encodeMessage);
decodeFileButton.addEventListener('click', decodeUploadedFile);
recordToggle.addEventListener('click', handleRecordingToggle);

populateProtocols();
