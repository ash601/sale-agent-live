# Dual Speaker Mode Setup Guide

## Prerequisites

1. **Soniox API Key**: Get your API key from https://soniox.com
2. **BlackHole** (macOS): Virtual audio device for capturing system audio
3. **Backend running**: Node.js server at `localhost:8787`

## Step 1: Install BlackHole (macOS)

1. Download BlackHole from: https://github.com/ExistentialAudio/BlackHole
2. Install the `.pkg` file
3. Open **Audio MIDI Setup** (Applications > Utilities)
4. Create a **Multi-Output Device**:
   - Click `+` → Create Multi-Output Device
   - Check both:
     - Your speakers/headphones
     - BlackHole (2ch or 16ch)
5. Set this Multi-Output Device as your system output

## Step 2: Configure Backend

Add to `services/agent-api/.env`:
```
SONIOX_API_KEY=your_soniox_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
```

## Step 3: Install Dependencies

```bash
cd services/agent-api
npm install
```

## Step 4: Start Backend

```bash
npm run dev
# or
npm start
```

## Step 5: Use Dual Speaker Mode

1. Open `simple-app/index.html` in browser
2. Check **"Dual Speaker Mode (You + Customer)"**
3. Click **"Start Listening"**
4. Speak and have the other person speak
5. You should see:
   - **You**: Your speech (green)
   - **Customer**: Their speech (blue)
   - AI suggestions when customer asks questions

## Troubleshooting

### BlackHole not found
- Make sure BlackHole is installed
- Check Audio MIDI Setup for BlackHole device
- Refresh browser and try again

### No system audio captured
- Verify Multi-Output Device is set as system output
- Check that audio is playing through the system
- Restart browser if needed

### Soniox connection fails
- Verify `SONIOX_API_KEY` is set in `.env`
- Check backend logs for errors
- Ensure backend is running on port 8787

### No transcripts appearing
- Check browser console for errors
- Verify microphone permissions
- Ensure audio is being captured

