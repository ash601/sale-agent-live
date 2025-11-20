// what: simple sales agent - captures mic, transcribes, gets AI suggestions
// input: mic audio stream
// return: real-time transcript and AI suggestions

const API_URL = 'http://localhost:8787';
let mediaStream = null;
let recognition = null;
let isListening = false;

// what: initialize Web Speech API for transcription
// input: none
// return: SpeechRecognition instance
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    throw new Error('Speech recognition not supported');
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
    updateTranscript('You', transcript, event.results[event.results.length - 1].isFinal);
    
    // what: send to AI when final result
    // input: transcript text
    // return: updates suggestion div
    if (event.results[event.results.length - 1].isFinal) {
      getAISuggestion(transcript);
    }
  };
  
  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    updateStatus(`Error: ${event.error}`);
  };
  
  recognition.onend = () => {
    if (isListening) {
      recognition.start(); // restart if still listening
    }
  };
  
  return recognition;
}

// what: start capturing audio and transcribing
// input: none
// return: starts media stream and recognition
async function startListening() {
  try {
    updateStatus('Requesting microphone access...');
    
    // what: get user media (mic)
    // input: audio constraints
    // return: MediaStream
    mediaStream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000
      } 
    });
    
    updateStatus('Microphone active. Starting transcription...');
    
    recognition = initSpeechRecognition();
    recognition.start();
    isListening = true;
    
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
    updateStatus('Listening...');
    
  } catch (error) {
    console.error('Error starting:', error);
    updateStatus(`Error: ${error.message}`);
  }
}

// what: stop listening and release resources
// input: none
// return: stops streams and recognition
function stopListening() {
  isListening = false;
  
  if (recognition) {
    recognition.stop();
    recognition = null;
  }
  
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
  updateStatus('Stopped');
}

// what: update transcript display
// input: speaker name, text, isFinal flag
// return: updates DOM
function updateTranscript(speaker, text, isFinal) {
  const transcriptDiv = document.getElementById('transcript');
  const className = speaker === 'You' ? 'speaker' : 'other';
  const final = isFinal ? '' : ' (listening...)';
  
  transcriptDiv.innerHTML += `<div class="${className}"><strong>${speaker}:</strong> ${text}${final}</div>`;
  transcriptDiv.scrollTop = transcriptDiv.scrollHeight;
}

// what: get AI suggestion from backend
// input: transcript text
// return: updates suggestion div with AI response
async function getAISuggestion(transcript) {
  try {
    // what: call backend for AI response
    // input: POST /ai/respond with transcript
    // return: suggestion text
    const response = await fetch(`${API_URL}/ai/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, context: '' })
    });
    
    if (!response.ok) throw new Error('AI response failed');
    
    const data = await response.json();
    document.getElementById('suggestion').textContent = data.suggestion || 'No suggestion';
    
  } catch (error) {
    console.error('AI suggestion error:', error);
    document.getElementById('suggestion').textContent = 'Error getting suggestion';
  }
}

// what: update status message
// input: status text
// return: updates status div
function updateStatus(text) {
  document.getElementById('status').textContent = text;
}

// what: setup button handlers
// input: none
// return: attaches event listeners
document.getElementById('startBtn').addEventListener('click', startListening);
document.getElementById('stopBtn').addEventListener('click', stopListening);

