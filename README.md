# AudioLink

AudioLink is a proof-of-concept web application that uses the [ggwave](https://github.com/ggerganov/ggwave) library to transmit short text messages over sound. The Node.js backend wraps the ggwave encoder/decoder while the frontend provides simple controls to generate audio, play it, record microphone input, and recover messages.

## Features

- Encode arbitrary text into an audible waveform using ggwave protocols.
- Download or play the generated audio directly in the browser.
- Decode messages by uploading the generated audio file or recording through the microphone.
]
- Automatic protocol discovery from the ggwave module.

## Prerequisites

- Node.js 18+
- npm

## Getting started

```bash
npm install
npm run start
```



## Project structure

```
├── public/

├── src/
│   └── server.js     # Express server with ggwave bindings
├── package.json
└── README.md
```

## Notes

- Decoding works best when the playback device and microphone are near each other and ambient noise is limited.
- The backend resamples uploaded/recorded audio to ggwave's default sample rate (48 kHz) before decoding.
- The demo is intended for local testing and is not hardened for production use.
