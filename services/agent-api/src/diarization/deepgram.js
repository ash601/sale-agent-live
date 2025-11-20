// what: Deepgram real-time diarization client (faster and more reliable than Soniox)
// input: audio stream, API key
// return: WebSocket connection for streaming transcription with speaker labels

import WebSocket from 'ws';

const DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen';

// what: create Deepgram WebSocket connection for real-time diarization
// input: API key, callback for transcripts
// return: WebSocket connection
export function createDeepgramConnection(apiKey, onTranscript) {
	if (!apiKey) {
		throw new Error('DEEPGRAM_API_KEY missing');
	}

	// what: build WebSocket URL with query parameters
	// input: base URL and params
	// return: full WebSocket URL with diarization enabled
	const params = new URLSearchParams({
		encoding: 'linear16',
		sample_rate: '16000',
		channels: '1',
		diarize: 'true',
		punctuate: 'true',
		interim_results: 'true',
		endpointing: '500',
		vad_events: 'true'
	});
	
	const wsUrl = `${DEEPGRAM_WS_URL}?${params.toString()}`;
	console.log('Connecting to Deepgram...');
	
	// what: create WebSocket with auth header
	// input: API key in Authorization header
	// return: WebSocket connection
	const ws = new WebSocket(wsUrl, {
		headers: {
			'Authorization': `Token ${apiKey}`
		}
	});

	ws.on('open', () => {
		console.log('Deepgram WebSocket connected');
	});

	ws.on('message', (data) => {
		try {
			const message = JSON.parse(data.toString());
			console.log('Deepgram full response:', JSON.stringify(message, null, 2));
			
			// what: handle Deepgram transcript response
			// input: Deepgram response
			// return: extracts transcripts and calls onTranscript
			if (message.channel && message.channel.alternatives && message.channel.alternatives.length > 0) {
				const alternative = message.channel.alternatives[0];
				const transcript = alternative.transcript;
				const isFinal = message.is_final || false;
				
				// what: extract speaker from words (Deepgram diarization)
				// input: words array with speaker info
				// return: speaker ID
				let speaker = 'you'; // default
				if (alternative.words && alternative.words.length > 0) {
					const firstWord = alternative.words[0];
					if (firstWord.speaker !== undefined) {
						// what: map Deepgram speaker IDs (0, 1, 2, etc.) to our labels
						// input: speaker ID from Deepgram
						// return: 'you' or 'customer'
						speaker = firstWord.speaker === 0 ? 'you' : 'customer';
					}
				}
				
				if (transcript && transcript.trim()) {
					console.log('Deepgram transcript:', { speaker, transcript, isFinal });
					onTranscript(speaker, transcript, isFinal);
				}
			}
			
			// what: handle metadata (connection info)
			// input: metadata response
			// return: logs metadata
			if (message.metadata) {
				console.log('Deepgram metadata:', message.metadata);
			}
			
			// what: handle errors
			// input: error response
			// return: logs error and calls onTranscript
			if (message.error) {
				console.error('Deepgram error:', message.error);
				onTranscript('error', `Deepgram error: ${message.error}`, true);
			}
		} catch (error) {
			console.error('Deepgram message parse error:', error);
		}
	});

	ws.on('error', (error) => {
		console.error('Deepgram WebSocket error:', error);
		onTranscript('error', `Deepgram connection error: ${error.message}`, true);
	});

	ws.on('close', (code, reason) => {
		console.log('Deepgram WebSocket closed:', code, reason?.toString());
		if (code !== 1000) {
			console.error('Unexpected Deepgram close:', code, reason?.toString());
		}
	});

	return ws;
}

// what: send audio chunk to Deepgram
// input: WebSocket connection, audio buffer (Int16 PCM)
// return: sends audio data
let audioChunksSent = 0;

export function sendDeepgramAudioChunk(ws, audioBuffer) {
	if (!ws || ws.readyState !== WebSocket.OPEN) {
		return;
	}
	
	// what: send binary audio data to Deepgram (raw PCM16)
	// input: audio buffer (Int16 PCM)
	// return: sends to Deepgram
	ws.send(audioBuffer);
	audioChunksSent++;
	if (audioChunksSent % 500 === 0) {
		console.log(`Sent ${audioChunksSent} audio chunks to Deepgram`);
	}
}

// what: close Deepgram connection
// input: WebSocket connection
// return: closes connection and sends close message
export function closeDeepgramConnection(ws) {
	if (ws && ws.readyState === WebSocket.OPEN) {
		// what: send close message (Deepgram expects this)
		// input: empty buffer
		// return: signals end of stream
		try {
			ws.send(JSON.stringify({ type: 'CloseStream' }));
		} catch (error) {
			console.warn('Error sending close message:', error);
		}
		ws.close();
	}
}

