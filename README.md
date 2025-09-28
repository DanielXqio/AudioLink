# AudioLink

AudioLink is a proof-of-concept web application that uses the [ggwave](https://github.com/ggerganov/ggwave) library to transmit short text messages over sound. The Node.js backend wraps the ggwave encoder/decoder while the frontend provides simple controls to generate audio, play it, record microphone input, and recover messages.

## Features

- Encode arbitrary text into an audible waveform using ggwave protocols.
- Download or play the generated audio directly in the browser.
- Decode messages by uploading the generated audio file or recording through the microphone.
- Launch a dedicated "Scan Now" page to immediately listen for nearby sound payloads.
- Preview decoded links with fetched metadata (title, description, image) when available.
- Automatic protocol discovery from the ggwave module.

## Prerequisites

- Node.js 18+
- npm

## Getting started

```bash
npm install
npm run start
```

The server listens on [http://localhost:3000](http://localhost:3000). Open the address in your browser to use the main UI, or navigate to
[http://localhost:3000/scan.html](http://localhost:3000/scan.html) for the dedicated scanning experience.

## Project structure

```
├── public/
│   ├── app.js        # Main frontend logic (encoding, decoding, microphone recording)
│   ├── index.html    # Primary UI layout
│   ├── scan.css      # Landing page styling for sound scanning
│   ├── scan.html     # Standalone scanning landing page
│   └── scan.js       # Scan page microphone controls and decode wiring
├── src/
│   └── server.js     # Express server with ggwave bindings
├── package.json
└── README.md
```

## Notes

- Decoding works best when the playback device and microphone are near each other and ambient noise is limited.
- The backend resamples uploaded/recorded audio to ggwave's default sample rate (48 kHz) before decoding.
- The demo is intended for local testing and is not hardened for production use.
