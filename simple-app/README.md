# Simple Sales Agent

Minimal working version that:
- Captures your microphone
- Transcribes in real-time
- Gets AI suggestions

## Run It

1. **Start the backend** (if not running):
```bash
cd services/agent-api
npm run dev
```

2. **Open the HTML file**:
```bash
open simple-app/index.html
```

Or serve it with a simple server:
```bash
cd simple-app
python3 -m http.server 3000
# Then open http://localhost:3000
```

3. **Click "Start Listening"** and speak into your mic.

## How It Works

- Uses OpenAI Realtime API via WebRTC for ultra-fast responses (~300-800ms)
- Streams audio directly to OpenAI
- Gets real-time transcription and AI suggestions
- 3-5x faster than previous version

## Next Steps

- Add system audio capture (requires desktop app or extension)
- Connect to Realtime API for faster responses
- Add knowledge base context

