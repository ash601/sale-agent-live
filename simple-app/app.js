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
        
        // what: handle input audio buffer committed (THIS IS WHERE TRANSCRIPT COMES)
        // input: input_audio_buffer.committed event
        // return: shows transcript and triggers response
        if (msg.type === 'input_audio_buffer.committed') {
          console.log('FULL EVENT (input_audio_buffer.committed):', JSON.stringify(msg, null, 2));
          const transcript = extractTranscript(msg);
          console.log('TRANSCRIPT FROM COMMITTED:', transcript);
          if (transcript) {
            updateTranscript('You', transcript, true);
            setTimeout(() => {
              if (dc && dc.readyState === 'open') {
                dc.send(JSON.stringify({
                  type: 'response.create'
                }));
              }
            }, 200);
            document.getElementById('suggestion').textContent = 'Thinking...';
            suggestionBuffer = '';
          }
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
            const audioContent = msg.item.content.find(c => c.type === 'input_audio');
            if (audioContent) {
              // Transcript might be null here, wait for conversation.item.done
              const transcript = audioContent.transcript || '';
              console.log('TRANSCRIPT FROM ITEM.ADDED:', transcript);
              if (transcript) {
                updateTranscript('You', transcript, true);
                setTimeout(() => {
                  if (dc && dc.readyState === 'open') {
                    dc.send(JSON.stringify({
                      type: 'response.create'
                    }));
                  }
                }, 200);
                document.getElementById('suggestion').textContent = 'Thinking...';
                suggestionBuffer = '';
              }
            }
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
            const audioContent = msg.item.content.find(c => c.type === 'input_audio');
            if (audioContent) {
              const transcript = audioContent.transcript || '';
              console.log('TRANSCRIPT FROM ITEM.DONE:', transcript);
              if (transcript) {
                updateTranscript('You', transcript, true);
                setTimeout(() => {
                  if (dc && dc.readyState === 'open') {
                    dc.send(JSON.stringify({
                      type: 'response.create'
                    }));
                  }
                }, 200);
                document.getElementById('suggestion').textContent = 'Thinking...';
                suggestionBuffer = '';
              }
            }
            
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
        // return: finalizes suggestion
        if (msg.type === 'response.done') {
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
        // return: shows thinking status
        if (msg.type === 'response.created') {
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
        // return: sends response.create to Realtime API
        if (isFinal && transcript.trim() && transcript !== lastTranscript) {
          lastTranscript = transcript;
          setTimeout(() => {
            if (dc && dc.readyState === 'open') {
              dc.send(JSON.stringify({
                type: 'response.create'
              }));
            }
          }, 200);
          document.getElementById('suggestion').textContent = 'Thinking...';
          suggestionBuffer = '';
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

// what: start listening with selected mode
// input: none
// return: starts audio capture and transcription
async function startListening() {
  try {
    currentMode = getMode();
    updateStatus('Requesting microphone access...');
    
    // what: get user media (mic)
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
    
    isListening = true;
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
    document.getElementById('realtimeMode').disabled = true;
    
    if (currentMode === 'realtime') {
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
  
  // what: stop recognition in both modes (used in Realtime mode for user transcription)
  // input: none
  // return: stops speech recognition
  if (recognition) {
    recognition.stop();
    recognition = null;
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
  updateStatus('Stopped');
  document.getElementById('suggestion').textContent = 'Waiting for conversation...';
}

// what: update transcript display
// input: speaker name, text, isFinal flag
// return: updates DOM
function updateTranscript(speaker, text, isFinal) {
  const transcriptDiv = document.getElementById('transcript');
  const className = speaker === 'You' ? 'speaker' : 'other';
  
  // what: update last line if interim, or add new line if final
  // input: transcript state
  // return: updates display
  const lastDiv = transcriptDiv.querySelector('div:last-child');
  if (lastDiv && !isFinal && lastDiv.classList.contains(className)) {
    lastDiv.innerHTML = `<strong>${speaker}:</strong> ${text} <span style="color:#888">(listening...)</span>`;
  } else {
    if (lastDiv && !isFinal) {
      lastDiv.remove();
    }
    transcriptDiv.innerHTML += `<div class="${className}"><strong>${speaker}:</strong> ${text}${isFinal ? '' : ' <span style="color:#888">(listening...)</span>'}</div>`;
  }
  transcriptDiv.scrollTop = transcriptDiv.scrollHeight;
}

// what: get AI suggestion (Simple Mode only)
// input: transcript text
// return: updates suggestion div with AI response
async function getAISuggestion(transcript) {
  try {
    document.getElementById('suggestion').textContent = 'Thinking...';
    
    // what: call backend for AI response
    // input: POST /ai/respond with transcript
    // return: suggestion text
    const response = await fetch(`${API_URL}/ai/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, context: '' })
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || 'AI response failed');
    }
    
    const data = await response.json();
    const suggestion = data.suggestion || 'No suggestion available';
    document.getElementById('suggestion').textContent = suggestion;
    updateStatus('Response received', 'connected');
    
  } catch (error) {
    console.error('AI suggestion error:', error);
    document.getElementById('suggestion').textContent = `Error: ${error.message}`;
    updateStatus(`Error: ${error.message}`, 'error');
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

// what: initialize mode status on load
// input: none
// return: sets initial mode status
updateModeStatus();
