// what: Soniox real-time diarization client
// input: audio stream, API key
// return: WebSocket connection for streaming transcription with speaker labels

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

const SONIOX_API_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
const LOG_FILE = path.join(process.cwd(), 'soniox_debug.log');

function logToFile(message) {
	const timestamp = new Date().toISOString();
	const logLine = `[${timestamp}] ${message}\n`;
	try {
		fs.appendFileSync(LOG_FILE, logLine);
	} catch (e) {
		console.error('Failed to write to log file:', e);
	}
}

// what: create Soniox WebSocket connection for real-time diarization
// input: API key, callback for transcripts
// return: WebSocket connection
export function createSonioxConnection(apiKey, onTranscript) {
	if (!apiKey) {
		throw new Error('SONIOX_API_KEY missing');
	}

	// what: create WebSocket connection (no auth in headers, no options needed)
	// input: API URL
	// return: WebSocket connection
	const ws = new WebSocket(SONIOX_API_URL);

	let configSent = false;
	let configAcknowledged = false;
	let readyToSendAudio = false;

	const maskedKey = apiKey ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}` : 'MISSING';
	logToFile(`Connecting to Soniox with key: ${maskedKey}`);

	ws.on('unexpected-response', (req, res) => {
		console.error('Soniox unexpected response:', res.statusCode, res.statusMessage);
		logToFile(`Soniox unexpected response: ${res.statusCode} ${res.statusMessage}`);

		let body = '';
		res.on('data', (chunk) => {
			body += chunk.toString();
		});
		res.on('end', () => {
			console.error('Soniox error body:', body);
			logToFile(`Soniox error body: ${body}`);
			// what: notify callback of connection failure
			// input: error details
			// return: calls onTranscript with error
			onTranscript('error', `Soniox connection failed: ${res.statusCode} ${res.statusMessage} - ${body || 'No details'}`, true);
		});
	});

	ws.on('open', () => {
		console.log('Soniox WebSocket connected - sending config immediately');
		logToFile('Soniox WebSocket connected - sending config immediately');
		// what: send initial JSON config immediately after connection opens (required by Soniox)
		// input: API key and audio config
		// return: configures Soniox for speaker diarization
		const config = {
			api_key: apiKey,
			model: 'stt-rt-v3',
			audio_format: 'pcm_s16le',
			sample_rate: 16000,
			num_channels: 1,
			enable_speaker_diarization: true,
			enable_language_identification: true,
			enable_endpoint_detection: true,
			language_hints: ['en']
		};
		// what: send config as first message (exactly like working example)
		// input: JSON config string
		// return: sends to Soniox
		ws.send(JSON.stringify(config));
		configSent = true;
		console.log('Config sent successfully - ready to send audio');
		logToFile(`Config sent: ${JSON.stringify({ ...config, api_key: '***' })}`);
		// what: start accepting audio immediately after config (don't wait for response)
		// input: none
		// return: marks as ready
		ws._readyToSendAudio = true;
		readyToSendAudio = true;
		console.log('Ready to send audio immediately after config');
		logToFile('Ready to send audio immediately after config');
	});

	ws.on('message', (data) => {
		try {
			const message = JSON.parse(data.toString());
			console.log('Soniox message received:', JSON.stringify(message, null, 2));
			logToFile(`Soniox message received: ${JSON.stringify(message)}`);

			// what: handle error responses (Soniox sends error before closing)
			// input: error message from Soniox
			// return: logs error and calls onTranscript with error
			if (message.error_code || message.error_message) {
				const errorCode = message.error_code || 'UNKNOWN';
				const errorMsg = message.error_message || `Error code: ${errorCode}`;
				console.error('Soniox API error:', errorCode, errorMsg);
				logToFile(`Soniox API error: ${errorCode} ${errorMsg}`);
				// what: handle 503 error (request termination - need to restart)
				// input: error code 503
				// return: special handling for restart
				if (errorCode === 503) {
					console.error('Soniox session terminated - need to restart request');
					logToFile('Soniox session terminated (503) - need to restart');
					onTranscript('error', `Soniox session terminated. Please restart. Error: ${errorMsg}`, true);
				} else {
					// what: notify callback of error
					// input: error message
					// return: calls onTranscript with error (will be forwarded to client)
					onTranscript('error', `Soniox error (${errorCode}): ${errorMsg}`, true);
				}
				return;
			}

			// what: mark config as acknowledged when we receive any response
			// input: any response from Soniox
			// return: marks config as acknowledged
			if (!configAcknowledged) {
				configAcknowledged = true;
				console.log('Soniox config acknowledged');
				logToFile('Soniox config acknowledged');
			}

			// what: handle transcript response with tokens (Soniox format)
			// input: Soniox response with tokens array
			// return: extracts transcripts from tokens and calls onTranscript
			if (message.tokens && Array.isArray(message.tokens)) {
				// what: filter out <end> token (endpoint detection signal)
				// input: tokens array
				// return: filtered tokens (excluding <end>)
				const validTokens = message.tokens.filter(t => t.text && t.text !== '<end>');
				// what: group tokens by speaker and final status
				// input: tokens array
				// return: grouped transcripts
				const finalTokens = validTokens.filter(t => t.is_final);
				const partialTokens = validTokens.filter(t => !t.is_final);
				
				// what: check if <end> token exists (endpoint detected)
				// input: tokens array
				// return: logs endpoint detection
				const hasEndpoint = message.tokens.some(t => t.text === '<end>');
				if (hasEndpoint) {
					console.log('Endpoint detected - speaker finished');
					logToFile('Endpoint detected - speaker finished');
				}

				// what: process final tokens
				// input: final tokens with speaker info
				// return: calls onTranscript for each speaker's final text
				if (finalTokens.length > 0) {
					// what: group by speaker
					// input: tokens
					// return: map of speaker -> text
					const bySpeaker = {};
					finalTokens.forEach(token => {
						const speakerId = token.speaker || '0';
						if (!bySpeaker[speakerId]) {
							bySpeaker[speakerId] = [];
						}
						bySpeaker[speakerId].push(token.text);
					});

					// what: send final transcript for each speaker
					// input: grouped tokens
					// return: calls onTranscript
					// what: process each speaker's final text
					// input: grouped tokens by speaker
					// return: calls onTranscript for each speaker
					Object.keys(bySpeaker).forEach(speakerId => {
						const text = bySpeaker[speakerId].join(' ').trim();
						if (text) {
							// what: map Soniox speaker IDs (S1, S2, S3, etc.) to our labels
							// input: speaker ID from Soniox (S1, S2, etc.)
							// return: 'you' or 'customer'
							// Note: First speaker (S1) is typically you, others (S2, S3, etc.) are customers
							const speaker = (speakerId === 'S1' || speakerId === '0') ? 'you' : 'customer';
							console.log('Final transcript:', { speaker, speakerId, text });
							logToFile(`Final transcript: ${speaker} (${speakerId}): ${text}`);
							onTranscript(speaker, text, true);
						}
					});
				}

				// what: process partial tokens (interim results)
				// input: partial tokens
				// return: calls onTranscript with isFinal=false
				if (partialTokens.length > 0) {
					const bySpeaker = {};
					partialTokens.forEach(token => {
						// what: extract speaker ID from partial token
						// input: token with speaker field
						// return: speaker ID string
						const speakerId = token.speaker || 'S1';
						if (!bySpeaker[speakerId]) {
							bySpeaker[speakerId] = [];
						}
						bySpeaker[speakerId].push(token.text);
					});

					Object.keys(bySpeaker).forEach(speakerId => {
						const text = bySpeaker[speakerId].join(' ').trim();
						if (text) {
							// what: map Soniox speaker IDs to our labels (for partial/interim tokens)
							// input: speaker ID from Soniox (S1, S2, etc.)
							// return: 'you' or 'customer'
							const speaker = (speakerId === 'S1' || speakerId === '0') ? 'you' : 'customer';
							onTranscript(speaker, text, false);
						}
					});
				}
			}

			// what: handle finished flag
			// input: finished flag from Soniox
			// return: logs completion
			if (message.finished) {
				console.log('Soniox transcription finished');
				logToFile('Soniox transcription finished');
			}
		} catch (error) {
			console.error('Soniox message parse error:', error);
			console.error('Raw message:', data.toString());
			logToFile(`Soniox message parse error: ${error.message}`);
		}
	});

	ws.on('error', (error) => {
		// what: ignore expected errors from intentional termination
		// input: error and termination flag
		// return: skips logging if intentional termination
		if (ws._intentionallyTerminating && error.message.includes('closed before the connection was established')) {
			ws._intentionallyTerminating = false;
			return; // Suppress expected termination error
		}
		console.error('Soniox WebSocket error:', error);
		logToFile(`Soniox WebSocket error: ${error.message}`);
		// what: only log error details if available
		// input: error object
		// return: logs details
		if (error.code || error.errno) {
			console.error('Error details:', {
				message: error.message,
				code: error.code,
				errno: error.errno,
				syscall: error.syscall,
				address: error.address,
				port: error.port
			});
		}
		// what: notify callback of connection error
		// input: error object
		// return: calls onTranscript with error
		onTranscript('error', `Soniox connection error: ${error.message}`, true);
	});

	ws.on('close', (code, reason) => {
		console.log('Soniox WebSocket closed:', code, reason?.toString());
		logToFile(`Soniox WebSocket closed: ${code} ${reason?.toString()}`);
		// what: clear any pending close timeout when WebSocket closes naturally
		// input: timeout stored on WebSocket
		// return: clears timeout
		if (ws._closeTimeout) {
			clearTimeout(ws._closeTimeout);
			ws._closeTimeout = null;
		}
		// what: clear termination flag
		// input: flag on WebSocket
		// return: clears flag
		ws._intentionallyTerminating = false;
		// what: only log unexpected closes (not normal 1000 or terminated connections)
		// input: close code and reason
		// return: logs unexpected closures
		if (code !== 1000 && code !== 1006) {
			const meaning = code === 1008 ? 'Policy violation' :
				code === 1011 ? 'Internal error' : 'Unknown';
			console.error('Unexpected Soniox close:', { code, reason: reason?.toString(), meaning });
			logToFile(`Unexpected Soniox close: ${code} ${reason?.toString()} - ${meaning}`);
		}
	});

	// what: initialize ready flag on ws object
	// input: none
	// return: sets initial flag
	ws._readyToSendAudio = false;

	return ws;
}

// what: send audio chunk to Soniox
// input: WebSocket connection, audio buffer
// return: sends audio data
let audioChunksSent = 0;

export function sendAudioChunk(ws, audioBuffer) {
	if (!ws || ws.readyState !== WebSocket.OPEN) {
		return;
	}
	
	// what: wait for config acknowledgment (first tokens received)
	// input: ready flag on ws
	// return: sends audio or drops chunk
	if (ws._readyToSendAudio !== true) {
		return; // Drop early chunks silently
	}
	
	// what: send binary audio data to Soniox (like working example)
	// input: audio buffer (Int16 PCM)
	// return: sends to Soniox
	ws.send(audioBuffer);
	audioChunksSent++;
	if (audioChunksSent % 500 === 0) {
		console.log(`Sent ${audioChunksSent} audio chunks to Soniox`);
	}
}

// what: close Soniox connection safely
// input: WebSocket connection
// return: closes connection only if it exists and is open/connecting
export function closeSonioxConnection(ws) {
	// what: check if WebSocket exists
	// input: WebSocket connection
	// return: returns early if no WebSocket
	if (!ws) {
		return;
	}
	
	// what: clear any existing close timeout for this WebSocket
	// input: timeout stored on WebSocket
	// return: clears timeout
	if (ws._closeTimeout) {
		clearTimeout(ws._closeTimeout);
		ws._closeTimeout = null;
	}
	
	const state = ws.readyState;
	
	// what: if already CLOSING or CLOSED, do nothing
	// input: WebSocket in CLOSING/CLOSED state
	// return: no action needed
	if (state === WebSocket.CLOSING || state === WebSocket.CLOSED) {
		return;
	}
	
	// what: close if open
	// input: WebSocket in OPEN state
	// return: closes connection properly
	if (state === WebSocket.OPEN) {
		try {
			ws.close(1000, 'Client disconnected');
		} catch (error) {
			// what: ignore errors if already closing/closed
			// input: error from close attempt
			// return: logs but doesn't throw
			console.warn('Error closing Soniox WebSocket (may already be closing):', error.message);
		}
	} else if (state === WebSocket.CONNECTING) {
		// what: mark as intentionally terminating to suppress expected errors
		// input: WebSocket
		// return: sets flag
		ws._intentionallyTerminating = true;
		// what: terminate connection if still connecting (abort connection attempt)
		// input: connecting WebSocket
		// return: forcefully terminates connection without waiting
		try {
			ws.terminate();
		} catch (error) {
			// what: ignore errors if already closed/terminated
			// input: error from terminate attempt
			// return: logs but doesn't throw
			console.warn('Error terminating Soniox WebSocket (may already be closed):', error.message);
		}
	}
}

