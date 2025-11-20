// what: sales agent with dual mode support - Simple (reliable) and Realtime (fast)
// input: mic audio stream, mode selection
// return: real-time transcript and AI suggestions

const API_URL = 'http://localhost:8787';
let mediaStream = null;
let recognition = null;
let pc = null; // WebRTC peer connection for Realtime mode
let dc = null; // Data channel for Realtime mode
let isListening = false;
let lastTranscript = '';
let currentMode = 'simple'; // 'simple' or 'realtime'
let suggestionBuffer = '';
let responseInProgress = false; // track if AI response is being generated
let dualSpeakerMode = false; // track if dual speaker mode is enabled
let sonioxWs = null; // Soniox WebSocket connection
let audioContext = null; // Web Audio API context for mixing
let conversationHistory = []; // track conversation for context
let selectedModel = 'gpt-4-turbo'; // selected AI model
let lastAISuggestionTranscript = ''; // prevent duplicate requests
let aiRequestTimeout = null; // debounce timer

// what: get current mode from checkbox
// input: none
// return: 'simple' or 'realtime'
function getMode() {
  return document.getElementById('realtimeMode').checked ? 'realtime' : 'simple';
}

// what: update mode status display
// input: none
// return: updates mode status text
function updateModeStatus() {
  const mode = getMode();
  const statusEl = document.getElementById('modeStatus');
  if (mode === 'realtime') {
    statusEl.textContent = 'Current: Realtime Mode (Fast)';
    statusEl.style.color = '#4CAF50';
  } else {
    statusEl.textContent = 'Current: Simple Mode (Reliable)';
    statusEl.style.color = '#888';
  }
  
  // what: update dual speaker mode status
  // input: none
  // return: updates dual speaker status
  const dualSpeakerEl = document.getElementById('dualSpeakerStatus');
  if (dualSpeakerMode) {
    dualSpeakerEl.textContent = 'On (Deepgram)';
    dualSpeakerEl.style.color = '#4CAF50';
  } else {
    dualSpeakerEl.textContent = 'Off';
    dualSpeakerEl.style.color = '#888';
  }
}

// what: get dual speaker mode from checkbox
// input: none
// return: boolean
function getDualSpeakerMode() {
  return document.getElementById('dualSpeakerMode').checked;
}

// what: get selected AI model
// input: none
// return: model name
function getSelectedModel() {
  return document.getElementById('aiModel').value;
}

// what: update model status display
// input: none
// return: updates model status text
function updateModelStatus() {
  const model = getSelectedModel();
  const statusEl = document.getElementById('modelStatus');
  if (model === 'groq') {
    statusEl.textContent = 'Groq (Fast)';
    statusEl.style.color = '#4CAF50';
  } else {
    statusEl.textContent = 'GPT-4 Turbo';
    statusEl.style.color = '#888';
  }
}

// what: initialize Web Speech API for transcription (Simple Mode)
// input: none
// return: SpeechRecognition instance
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    throw new Error('Speech recognition not supported. Use Chrome or Edge.');
  }
  
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  
  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    const isFinal = event.results[event.results.length - 1].isFinal;
    updateTranscript('You', transcript, isFinal);
    
    // what: send to AI when final result (user finished speaking)
    // input: transcript text
    // return: gets AI response
    if (isFinal && transcript.trim() && transcript !== lastTranscript) {
      lastTranscript = transcript;
      getAISuggestion(transcript);
    }
  };
  
  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    updateStatus(`Error: ${event.error}`, 'error');
  };
  
  recognition.onend = () => {
    if (isListening && currentMode === 'simple') {
      recognition.start(); // restart if still listening
    }
  };
  
  return recognition;
}

// what: extract transcript from event message (comprehensive fallbacks)
// input: event message object
// return: transcript text or empty string
function extractTranscript(msg) {
  // what: try all possible transcript field locations
  // input: event message
  // return: transcript text
  if (msg.transcript) return msg.transcript;
  if (msg.item?.transcript) return msg.item.transcript;
  if (msg.item?.input_audio?.transcript) return msg.item.input_audio.transcript;
  if (msg.item?.content) {
    if (Array.isArray(msg.item.content)) {
      const audioContent = msg.item.content.find(c => c.type === 'input_audio');
      if (audioContent?.transcript) return audioContent.transcript;
    } else if (typeof msg.item.content === 'object' && msg.item.content.transcript) {
      return msg.item.content.transcript;
    }
  }
  return '';
}

// what: extract response text from event message (comprehensive fallbacks)
// input: event message object
// return: response text or empty string
function extractResponseText(msg) {
  // what: try all possible response text field locations
  // input: event message
  // return: response text
  if (msg.item?.text) return msg.item.text;
  if (msg.part?.text) return msg.part.text;
  if (msg.item?.content) {
    if (Array.isArray(msg.item.content)) {
      const textContent = msg.item.content.find(c => c.type === 'output_text');
      if (textContent?.text) return textContent.text;
    } else if (typeof msg.item.content === 'object' && msg.item.content.text) {
      return msg.item.content.text;
    } else if (typeof msg.item.content === 'string') {
      return msg.item.content;
    }
  }
  if (msg.part?.content) {
    if (Array.isArray(msg.part.content)) {
      const textContent = msg.part.content.find(c => c.type === 'output_text');
      if (textContent?.text) return textContent.text;
    } else if (typeof msg.part.content === 'object' && msg.part.content.text) {
      return msg.part.content.text;
    }
  }
  return '';
}

// what: connect to OpenAI Realtime API (Realtime Mode)
// input: audio MediaStream
// return: connects and starts streaming
async function connectRealtime(stream) {
  try {
    updateStatus('Connecting to Realtime API...');
    
    // what: get token from backend
    // input: POST /realtime/token
    // return: {client_secret:{value}, url}
    const tokenResp = await fetch(`${API_URL}/realtime/token`, { method: 'POST' });
    if (!tokenResp.ok) throw new Error('Failed to get Realtime token');
    const { client_secret, url } = await tokenResp.json();
    
    // what: create WebRTC peer connection
    // input: STUN servers
    // return: RTCPeerConnection
    pc = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }]
    });
    
    // what: create data channel for JSON events
    // input: channel name
    // return: RTCDataChannel
    let sessionReady = false;
    dc = pc.createDataChannel('oai-events');
    dc.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        console.log('Realtime event:', msg.type, msg); // debug log
        
        // what: handle input audio buffer committed (legacy - transcripts are null, using Web Speech API instead)
        // input: input_audio_buffer.committed event
        // return: logs for debugging (no action needed)
        if (msg.type === 'input_audio_buffer.committed') {
          console.log('FULL EVENT (input_audio_buffer.committed):', JSON.stringify(msg, null, 2));
          // Note: Transcripts are always null here, Web Speech API handles transcription
        }
        
        // what: handle conversation item added (official pattern from OpenAI console)
        // input: conversation.item.added event
        // return: extracts transcript or response text from item content array
        if (msg.type === 'conversation.item.added' && msg.item) {
          console.log('FULL EVENT (conversation.item.added):', JSON.stringify(msg, null, 2));
          // what: extract transcript from message item with input_audio content
          // input: item with type "message" and content array
          // return: transcript text
          if (msg.item.type === 'message' && Array.isArray(msg.item.content)) {
            // Note: Transcripts are always null here, Web Speech API handles transcription
            // This handler only processes AI responses (output_text/output_audio)
          }
          
          // what: extract response text from output_text or output_audio item
          // input: item with content array
          // return: response text or audio transcript
          if (msg.item.type === 'output_text' || (msg.item.type === 'message' && Array.isArray(msg.item.content))) {
            const text = extractResponseText(msg);
            if (text) {
              suggestionBuffer = text;
              document.getElementById('suggestion').textContent = text;
            } else {
              // what: try to extract from output_audio transcript
              // input: message item with output_audio content
              // return: audio transcript text
              const audioContent = msg.item.content.find(c => c.type === 'output_audio');
              if (audioContent?.transcript) {
                suggestionBuffer = audioContent.transcript;
                document.getElementById('suggestion').textContent = audioContent.transcript;
              }
            }
          }
        }
        
        // what: handle conversation item done (when processing completes)
        // input: conversation.item.done event
        // return: extracts final transcript or response text
        if (msg.type === 'conversation.item.done' && msg.item) {
          console.log('FULL EVENT (conversation.item.done):', JSON.stringify(msg, null, 2));
          // what: extract transcript from message item with input_audio content
          // input: item with type "message" and content array
          // return: transcript text
          if (msg.item.type === 'message' && Array.isArray(msg.item.content)) {
            // Note: User transcripts are always null here, Web Speech API handles transcription
            // This handler only processes AI responses (output_text/output_audio)
            
            // what: extract AI response from output_audio or output_text
            // input: message item with assistant content
            // return: response text or audio transcript
            if (msg.item.role === 'assistant') {
              const textContent = msg.item.content.find(c => c.type === 'output_text');
              const audioContent = msg.item.content.find(c => c.type === 'output_audio');
              
              if (textContent?.text) {
                suggestionBuffer = textContent.text;
                document.getElementById('suggestion').textContent = textContent.text;
              } else if (audioContent?.transcript) {
                suggestionBuffer = audioContent.transcript;
                document.getElementById('suggestion').textContent = audioContent.transcript;
              }
            }
          }
          
          // what: extract response text from output_text item
          // input: item with content array
          // return: response text
          if (msg.item.type === 'output_text' || (msg.item.type === 'message' && Array.isArray(msg.item.content))) {
            const text = extractResponseText(msg);
            if (text) {
              suggestionBuffer = text;
              document.getElementById('suggestion').textContent = text;
            }
          }
        }
        
        // what: handle input audio transcript deltas (what you're saying) - GA API format
        // input: response.output_audio_transcript.delta event
        // return: shows live transcript as you speak
        if (msg.type === 'response.output_audio_transcript.delta') {
          if (msg.delta) {
            // This is the model's audio transcript, not user input - skip
          }
        }
        
        // what: handle text response deltas (streaming suggestions) - GA API format
        // input: response.output_text.delta event
        // return: updates suggestion display incrementally
        if (msg.type === 'response.output_text.delta' && msg.delta) {
          suggestionBuffer += msg.delta;
          document.getElementById('suggestion').textContent = suggestionBuffer;
        }
        
        // what: handle content part deltas (alternative format for streaming response)
        // input: response.content_part.delta event
        // return: updates suggestion display incrementally
        if (msg.type === 'response.content_part.delta' && msg.part?.type === 'output_text' && msg.delta) {
          suggestionBuffer += msg.delta;
          document.getElementById('suggestion').textContent = suggestionBuffer;
        }
        
        // what: handle response output item added (may come before .done)
        // input: response.output_item.added event
        // return: shows response text or audio transcript
        if (msg.type === 'response.output_item.added' && (msg.item?.type === 'output_text' || msg.item?.type === 'output_audio')) {
          console.log('FULL EVENT (response.output_item.added):', JSON.stringify(msg, null, 2));
          if (msg.item.type === 'output_text') {
            const text = extractResponseText(msg);
            if (text) {
              suggestionBuffer = text;
              document.getElementById('suggestion').textContent = text;
            }
          } else if (msg.item.type === 'output_audio' && msg.item.transcript) {
            suggestionBuffer = msg.item.transcript;
            document.getElementById('suggestion').textContent = msg.item.transcript;
          }
        }
        
        // what: handle response output item done (complete response)
        // input: response.output_item.done event
        // return: shows complete response text or audio transcript
        if (msg.type === 'response.output_item.done' && (msg.item?.type === 'output_text' || msg.item?.type === 'output_audio')) {
          console.log('FULL EVENT (response.output_item.done):', JSON.stringify(msg, null, 2));
          if (msg.item.type === 'output_text') {
            const text = extractResponseText(msg);
            console.log('RESPONSE TEXT FROM OUTPUT_ITEM:', text);
            if (text) {
              suggestionBuffer = text;
              document.getElementById('suggestion').textContent = text;
            }
          } else if (msg.item.type === 'output_audio' && msg.item.transcript) {
            console.log('RESPONSE AUDIO TRANSCRIPT FROM OUTPUT_ITEM:', msg.item.transcript);
            suggestionBuffer = msg.item.transcript;
            document.getElementById('suggestion').textContent = msg.item.transcript;
          }
        }
        
        // what: handle response completion
        // input: response.done event
        // return: finalizes suggestion and clears response flag
        if (msg.type === 'response.done') {
          responseInProgress = false;
          updateStatus('Response received', 'connected');
        }
        
        // what: handle session status updates
        // input: session.updated event
        // return: updates status display
        if (msg.type === 'session.updated') {
          if (msg.session?.status === 'connected' || msg.session?.status === 'ready') {
            sessionReady = true;
            updateStatus('Ready - Speak now!', 'connected');
          }
        }
        
        // what: handle session created/ready
        // input: session.created event
        // return: marks session as ready
        if (msg.type === 'session.created') {
          sessionReady = true;
          updateStatus('Ready - Speak now!', 'connected');
        }
        
        // what: handle response started
        // input: response.created event
        // return: shows thinking status and sets response flag
        if (msg.type === 'response.created') {
          responseInProgress = true;
          document.getElementById('suggestion').textContent = 'Thinking...';
          suggestionBuffer = '';
        }
        
        
        // what: handle errors
        // input: error events
        // return: shows error in status
        if (msg.type === 'error') {
          updateStatus(`Error: ${msg.error?.message || 'Unknown error'}`, 'error');
        }
      } catch (e) {
        // ignore non-json or malformed messages
      }
    };
    
    // what: wait for data channel to open before sending config
    // input: none
    // return: sends session config when ready
    dc.onopen = () => {
      console.log('Data channel opened');
      // what: send session config for GA API format
      // input: session update message with type: "realtime"
      // return: configures Realtime session
      // Note: temperature and max_response_output_tokens are not valid in session.update
      // They should be set in response.create if needed
      dc.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'realtime',
          model: 'gpt-realtime',
          instructions: 'You are a sales assistant. Give short, actionable suggestions (1-2 sentences) based on what the user says in a sales call. Only respond when the user finishes speaking.',
          audio: {
            output: { voice: 'alloy' }
          }
        }
      }));
    };
    
    dc.onerror = (error) => {
      console.error('Data channel error:', error);
      updateStatus('Connection error', 'error');
    };
    
    // what: add audio track to peer connection
    // input: audio track from stream
    // return: adds track to PC
    for (const track of stream.getAudioTracks()) {
      pc.addTrack(track, stream);
    }
    
    // what: create and send offer
    // input: none
    // return: SDP exchange with OpenAI
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    // what: SDP exchange with GA API endpoint
    // input: offer SDP, ephemeral key
    // return: answer SDP
    const sdpResp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${client_secret.value}`,
        'Content-Type': 'application/sdp'
      },
      body: offer.sdp
    });
    
    if (!sdpResp.ok) throw new Error('SDP exchange failed');
    
    const answer = { type: 'answer', sdp: await sdpResp.text() };
    await pc.setRemoteDescription(answer);
    
    // what: set session ready immediately after SDP exchange succeeds
    // input: none
    // return: enables transcript and response processing
    sessionReady = true;
    
    updateStatus('Connected - Listening...', 'connected');
    
    // what: start Web Speech API for user input transcription (Realtime API doesn't provide user transcripts)
    // input: none
    // return: transcribes user speech and triggers Realtime responses
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      
      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        const isFinal = event.results[event.results.length - 1].isFinal;
        updateTranscript('You', transcript, isFinal);
        
        // what: trigger Realtime AI response when user finishes speaking
        // input: final transcript
        // return: sends response.create to Realtime API (only if no response in progress)
        if (isFinal && transcript.trim() && transcript !== lastTranscript && !responseInProgress) {
          lastTranscript = transcript;
          setTimeout(() => {
            if (dc && dc.readyState === 'open' && !responseInProgress) {
              responseInProgress = true;
              dc.send(JSON.stringify({
                type: 'response.create'
              }));
              document.getElementById('suggestion').textContent = 'Thinking...';
              suggestionBuffer = '';
            }
          }, 200);
        }
      };
      
      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        updateStatus(`Transcription error: ${event.error}`, 'error');
      };
      
      recognition.onend = () => {
        if (isListening && currentMode === 'realtime') {
          recognition.start(); // restart if still listening
        }
      };
      
      recognition.start();
      updateStatus('Ready - Speak now!', 'connected');
    } else {
      updateStatus('Warning: Speech recognition not available', 'error');
    }
    
  } catch (error) {
    console.error('Realtime connection error:', error);
    updateStatus(`Error: ${error.message}`, 'error');
    throw error;
  }
}

// what: connect to Deepgram for dual speaker diarization
// input: audio MediaStream
// return: connects and starts streaming
async function connectSoniox(stream) {
  try {
    updateStatus('Connecting to Deepgram...');
    
    // what: create WebSocket connection to backend
    // input: WebSocket URL
    // return: WebSocket connection
    const wsUrl = 'ws://localhost:8787/diarization/stream';
    sonioxWs = new WebSocket(wsUrl);
    
    sonioxWs.onopen = () => {
      console.log('Deepgram WebSocket connected');
      updateStatus('Deepgram connected. Starting audio stream...', 'connected');
      
      // what: start streaming audio to Deepgram
      // input: audio stream
      // return: processes audio and sends chunks
      audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      
      let audioChunkCount = 0;
      processor.onaudioprocess = (event) => {
        if (sonioxWs && sonioxWs.readyState === WebSocket.OPEN) {
          const inputData = event.inputBuffer.getChannelData(0);
          // what: convert Float32Array to Int16Array for Deepgram
          // input: Float32 audio data
          // return: Int16 PCM data
          const int16Data = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          sonioxWs.send(int16Data.buffer);
          audioChunkCount++;
          if (audioChunkCount % 100 === 0) {
            console.log(`Sent ${audioChunkCount} audio chunks to backend`);
          }
        } else {
          console.warn('Backend WebSocket not ready, state:', sonioxWs?.readyState);
        }
      };
      
      source.connect(processor);
      processor.connect(audioContext.destination);
      
      updateStatus('Listening to both speakers...', 'connected');
    };
    
    sonioxWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log('Received message from backend:', msg);
        
        // what: handle error messages from backend
        // input: error message
        // return: displays error to user
        if (msg.type === 'error') {
          console.error('Backend error:', msg.message);
          updateStatus(`Error: ${msg.message}`, 'error');
          return;
        }
        
        if (msg.type === 'transcript') {
          console.log('Updating transcript:', { speaker: msg.speaker, text: msg.text, isFinal: msg.isFinal });
          updateTranscript(msg.speaker, msg.text, msg.isFinal);
          
          // what: trigger AI response for customer statements (or you for testing)
          // input: final transcript from customer or you
          // return: gets AI suggestion
          if (msg.isFinal && msg.text.trim()) {
            // what: respond to customer OR you (for testing when alone)
            // input: speaker and text
            // return: triggers AI suggestion
            if (msg.speaker === 'customer') {
              console.log('Customer statement detected, getting AI suggestion...');
              getAISuggestion(msg.text, 'customer');
            } else if (msg.speaker === 'you' && msg.text.trim().length > 10) {
              // what: test mode - respond to your own questions for testing
              // input: your transcript
              // return: gets AI suggestion as if you were customer
              console.log('Your statement detected (test mode), getting AI suggestion...');
              getAISuggestion(msg.text, 'customer'); // Treat as customer for testing
            }
          }
        } else {
          console.log('Unknown message type from backend:', msg);
        }
      } catch (error) {
        console.error('Soniox message error:', error);
        console.error('Raw message:', event.data);
      }
    };
    
    sonioxWs.onerror = (error) => {
      console.error('Soniox WebSocket error:', error);
      updateStatus('Soniox connection error - Check console and ensure SONIOX_API_KEY is set', 'error');
    };
    
    sonioxWs.onclose = (event) => {
      console.log('Soniox WebSocket closed', event.code, event.reason);
      if (event.code !== 1000) {
        console.error('Unexpected close:', event.code, event.reason);
        updateStatus(`Connection closed: ${event.code} ${event.reason || 'Unknown reason'}`, 'error');
      }
      if (audioContext) {
        audioContext.close();
        audioContext = null;
      }
    };
    
  } catch (error) {
    console.error('Soniox connection error:', error);
    updateStatus(`Error: ${error.message}`, 'error');
    throw error;
  }
}

// what: capture audio with system audio support (BlackHole)
// input: none
// return: mixed audio stream
async function captureDualAudio() {
  try {
    // what: enumerate audio devices to find BlackHole
    // input: none
    // return: list of audio devices
    const devices = await navigator.mediaDevices.enumerateDevices();
    const blackhole = devices.find(d => 
      d.kind === 'audioinput' && 
      (d.label.toLowerCase().includes('blackhole') || d.label.toLowerCase().includes('black hole'))
    );
    
    // what: get microphone stream
    // input: audio constraints
    // return: microphone MediaStream
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
        channelCount: 1
      }
    });
    
    // what: create audio context for mixing
    // input: sample rate
    // return: AudioContext
    const ctx = new AudioContext({ sampleRate: 16000 });
    const micSource = ctx.createMediaStreamSource(micStream);
    
    // what: create destination for mixed audio
    // input: none
    // return: MediaStreamAudioDestinationNode
    const destination = ctx.createMediaStreamDestination();
    micSource.connect(destination);
    
    // what: add system audio if BlackHole is available
    // input: BlackHole device
    // return: adds system audio to mix
    if (blackhole) {
      try {
        const systemStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: blackhole.deviceId },
            sampleRate: 16000,
            channelCount: 1
          }
        });
        const systemSource = ctx.createMediaStreamSource(systemStream);
        systemSource.connect(destination);
        updateStatus('System audio captured (BlackHole)', 'connected');
      } catch (error) {
        console.warn('Could not capture system audio:', error);
        updateStatus('Warning: System audio not available. Using microphone only.', 'error');
      }
    } else {
      updateStatus('Warning: BlackHole not found. Install BlackHole for system audio capture.', 'error');
    }
    
    return destination.stream;
    
  } catch (error) {
    console.error('Audio capture error:', error);
    throw error;
  }
}

// what: start listening with selected mode
// input: none
// return: starts audio capture and transcription
async function startListening() {
  try {
    currentMode = getMode();
    dualSpeakerMode = getDualSpeakerMode();
    updateStatus('Requesting microphone access...');
    
    // what: get audio stream based on mode
    // input: mode selection
    // return: MediaStream
    if (dualSpeakerMode) {
      // what: capture dual audio (mic + system)
      // input: none
      // return: mixed audio stream
      mediaStream = await captureDualAudio();
    } else {
      // what: get user media (mic only)
      // input: audio constraints
      // return: MediaStream
      mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: currentMode === 'realtime' ? 24000 : 16000,
          channelCount: 1
        } 
      });
    }
    
    isListening = true;
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
    document.getElementById('realtimeMode').disabled = true;
    document.getElementById('dualSpeakerMode').disabled = true;
    document.getElementById('aiModel').disabled = true;
    
    if (dualSpeakerMode) {
      updateStatus('Starting dual speaker transcription...');
      await connectSoniox(mediaStream);
    } else if (currentMode === 'realtime') {
      updateStatus('Microphone active. Connecting to Realtime API...');
      await connectRealtime(mediaStream);
    } else {
      updateStatus('Microphone active. Starting transcription...');
      recognition = initSpeechRecognition();
      recognition.start();
      updateStatus('Listening... Speak now!', 'connected');
    }
    
  } catch (error) {
    console.error('Error starting:', error);
    updateStatus(`Error: ${error.message}`, 'error');
    stopListening();
  }
}

// what: stop listening and disconnect
// input: none
// return: closes connections and releases resources
function stopListening() {
  isListening = false;
  lastTranscript = '';
  suggestionBuffer = '';
  responseInProgress = false; // reset response flag
  conversationHistory = []; // clear conversation history
  lastAISuggestionTranscript = ''; // reset duplicate prevention
  if (aiRequestTimeout) {
    clearTimeout(aiRequestTimeout);
    aiRequestTimeout = null;
  }
  
  // what: stop recognition in both modes (used in Realtime mode for user transcription)
  // input: none
  // return: stops speech recognition
  if (recognition) {
    recognition.stop();
    recognition = null;
  }
  
  // what: close Soniox connection
  // input: none
  // return: closes WebSocket and audio context
  if (sonioxWs) {
    sonioxWs.close();
    sonioxWs = null;
  }
  
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  
  if (currentMode === 'realtime') {
    if (dc) {
      dc.close();
      dc = null;
    }
    if (pc) {
      pc.close();
      pc = null;
    }
  }
  
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
  document.getElementById('realtimeMode').disabled = false;
  document.getElementById('dualSpeakerMode').disabled = false;
  document.getElementById('aiModel').disabled = false;
  updateStatus('Stopped');
  document.getElementById('suggestion').textContent = 'Waiting for conversation...';
}

// what: update transcript display
// input: speaker name, text, isFinal flag
// return: updates DOM
function updateTranscript(speaker, text, isFinal) {
  const transcriptDiv = document.getElementById('transcript');
  // what: map speaker labels for dual speaker mode
  // input: speaker label
  // return: display label and CSS class
  let displaySpeaker = speaker;
  let className = 'speaker';
  
  if (dualSpeakerMode) {
    if (speaker === 'you') {
      displaySpeaker = 'You';
      className = 'speaker you';
    } else if (speaker === 'customer') {
      displaySpeaker = 'Customer';
      className = 'speaker customer';
    } else {
      displaySpeaker = speaker === 'You' ? 'You' : 'Customer';
      className = speaker === 'You' ? 'speaker you' : 'speaker customer';
    }
  } else {
    className = speaker === 'You' ? 'speaker' : 'other';
  }
  
  // what: update last line if interim, or add new line if final
  // input: transcript state
  // return: updates display
  const lastDiv = transcriptDiv.querySelector('div:last-child');
  if (lastDiv && !isFinal && lastDiv.classList.contains(className.split(' ')[0])) {
    lastDiv.innerHTML = `<strong>${displaySpeaker}:</strong> ${text} <span style="color:#888">(listening...)</span>`;
  } else {
    if (lastDiv && !isFinal) {
      lastDiv.remove();
    }
    transcriptDiv.innerHTML += `<div class="${className}"><strong>${displaySpeaker}:</strong> ${text}${isFinal ? '' : ' <span style="color:#888">(listening...)</span>'}</div>`;
  }
  transcriptDiv.scrollTop = transcriptDiv.scrollHeight;
  
  // what: add to conversation history for context
  // input: speaker, text, isFinal
  // return: updates conversation history
  if (isFinal && dualSpeakerMode) {
    const speakerKey = speaker === 'you' || speaker === 'You' ? 'you' : 'customer';
    conversationHistory.push({
      speaker: speakerKey,
      text: text,
      timestamp: Date.now()
    });
    // what: keep only last 20 messages for context
    // input: conversation history
    // return: limits history size
    if (conversationHistory.length > 20) {
      conversationHistory.shift();
    }
  }
}

// what: get AI suggestion (Simple Mode or Dual Speaker Mode)
// input: transcript text, speaker
// return: updates suggestion div with AI response
async function getAISuggestion(transcript, speaker = 'you') {
  try {
    // what: prevent duplicate requests and concurrent calls
    // input: transcript, speaker
    // return: skips if duplicate or request in progress
    if (responseInProgress) {
      console.log('AI request already in progress, skipping duplicate');
      return;
    }
    
    // what: prevent duplicate transcript requests
    // input: transcript
    // return: skips if same transcript
    const requestKey = `${speaker}:${transcript}`;
    if (requestKey === lastAISuggestionTranscript) {
      console.log('Duplicate transcript request, skipping');
      return;
    }
    
    // what: debounce rapid requests (wait 500ms)
    // input: none
    // return: clears previous timeout
    if (aiRequestTimeout) {
      clearTimeout(aiRequestTimeout);
    }
    
    aiRequestTimeout = setTimeout(async () => {
      responseInProgress = true;
      lastAISuggestionTranscript = requestKey;
      
      try {
        console.log('getAISuggestion called:', { transcript: transcript.substring(0, 50), speaker, model: getSelectedModel() });
        document.getElementById('suggestion').textContent = 'Thinking...';
        
        // what: call backend for AI response
        // input: POST /ai/respond with transcript, speaker, conversation
        // return: suggestion text
        const requestBody = { 
          transcript, 
          speaker: dualSpeakerMode ? speaker : 'you',
          context: '',
          conversation: dualSpeakerMode ? conversationHistory.slice(-10) : [], // last 10 messages for context
          model: getSelectedModel() // pass selected model
        };
        console.log('Sending AI request:', requestBody);
        
        const response = await fetch(`${API_URL}/ai/respond`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage;
          try {
            const errorData = JSON.parse(errorText);
            errorMessage = errorData.error || errorText;
          } catch {
            errorMessage = errorText;
          }
          
          console.error('AI response error:', response.status, errorMessage);
          
          // what: handle rate limit errors gracefully
          // input: response status
          // return: user-friendly error message
          if (response.status === 429) {
            throw new Error('Rate limit exceeded. Please wait a moment and try again.');
          } else if (response.status === 401) {
            throw new Error('API key invalid or expired. Please check your API key in .env file.');
          }
          throw new Error(errorMessage || 'AI response failed');
        }
        
        const data = await response.json();
        console.log('AI response received:', data);
        const suggestion = data.suggestion || '';
        if (suggestion && !suggestion.startsWith('Error:')) {
          document.getElementById('suggestion').textContent = suggestion;
          updateStatus('Response received', 'connected');
        } else {
          // No response needed (e.g., you spoke, not customer)
          console.log('Empty suggestion received - backend returned no response');
          document.getElementById('suggestion').textContent = 'Waiting for customer question...';
        }
      } catch (error) {
        console.error('AI suggestion error:', error);
        document.getElementById('suggestion').textContent = `Error: ${error.message}`;
        updateStatus(`Error: ${error.message}`, 'error');
      } finally {
        responseInProgress = false;
      }
    }, 500); // 500ms debounce
    
  } catch (error) {
    console.error('AI suggestion error:', error);
    responseInProgress = false;
  }
}

// what: update status message
// input: status text, optional type
// return: updates status div
function updateStatus(text, type = '') {
  const statusEl = document.getElementById('status');
  statusEl.textContent = text;
  statusEl.className = 'status ' + (type || (text.includes('Error') ? 'error' : text.includes('Listening') || text.includes('Ready') || text.includes('Connected') ? 'connected' : ''));
  
  // what: add to debug log
  // input: status text
  // return: appends to debug div
  const debugEl = document.getElementById('debug');
  if (debugEl) {
    const time = new Date().toLocaleTimeString();
    debugEl.innerHTML += `<div>[${time}] ${text}</div>`;
    debugEl.scrollTop = debugEl.scrollHeight;
    debugEl.classList.add('show');
  }
}

// what: setup button handlers and mode toggle
// input: none
// return: attaches event listeners
document.getElementById('startBtn').addEventListener('click', startListening);
document.getElementById('stopBtn').addEventListener('click', stopListening);
document.getElementById('realtimeMode').addEventListener('change', () => {
  if (!isListening) {
    updateModeStatus();
  }
});

document.getElementById('dualSpeakerMode').addEventListener('change', () => {
  if (!isListening) {
    dualSpeakerMode = getDualSpeakerMode();
    updateModeStatus();
  }
});

document.getElementById('aiModel').addEventListener('change', () => {
  if (!isListening) {
    selectedModel = getSelectedModel();
    updateModelStatus();
  }
});

// what: initialize mode status on load
// input: none
// return: sets initial mode status
updateModeStatus();
updateModelStatus();
