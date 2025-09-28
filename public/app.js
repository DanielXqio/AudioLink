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
  } else {
    updateStatus('Successfully decoded message!');
  }
  decodedText.textContent = data.text || '';
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
