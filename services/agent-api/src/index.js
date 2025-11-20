// what: minimal API server for health and OpenAI Realtime SDP/token proxy
// input: env OPENAI_API_KEY, OPENAI_REALTIME_MODEL, OPENAI_REALTIME_URL
// return: HTTP server with /health and /realtime/token endpoints
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import expressWs from 'express-ws';
import path from 'path';
import { fileURLToPath } from 'url';
import ingestRouter from './rag/ingest.js';
import searchRouter from './rag/search.js';
import toolsRouter from './tools/index.js';
import crmRouter from './crm/index.js';
import { createDeepgramConnection, sendDeepgramAudioChunk, closeDeepgramConnection } from './diarization/deepgram.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
expressWs(app); // Enable WebSocket support
app.use(cors());
app.use(express.json());

// what: serve simple-app static files
// input: HTTP requests to /simple-app
// return: serves HTML, JS, CSS files
app.use('/simple-app', express.static(path.join(__dirname, '../../../simple-app')));

app.use('/rag', ingestRouter);
app.use('/rag', searchRouter);
app.use('/', toolsRouter);
app.use('/', crmRouter);

app.get('/health', (_req, res) => {
	// what: healthcheck
	// input: none
	// return: ok json
	res.json({ ok: true, ts: Date.now() });
});

app.post('/realtime/token', async (_req, res) => {
	// what: generate ephemeral client secret and provide SDP URL for Realtime GA API
	// input: none (later: user auth)
	// return: {client_secret:{value}, url}
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY missing' });
	const model = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime';
	
	try {
		// what: create ephemeral client secret using GA API
		// input: POST /v1/realtime/client_secrets
		// return: ephemeral key
		const sessionConfig = JSON.stringify({
			session: {
				type: 'realtime',
				model: model,
				audio: {
					output: { voice: 'alloy' }
				}
			}
		});
		
		const secretResp = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: sessionConfig
		});
		
		if (!secretResp.ok) {
			const error = await secretResp.text();
			throw new Error(`Failed to create client secret: ${error}`);
		}
		
		const secretData = await secretResp.json();
		const ephemeralKey = secretData.value;
		
		// what: SDP exchange URL for GA API
		// input: model name
		// return: URL for WebRTC SDP exchange
		const sdpUrl = `https://api.openai.com/v1/realtime/calls`;
		
		res.json({ client_secret: { value: ephemeralKey }, url: sdpUrl });
	} catch (error) {
		console.error('Realtime token error:', error);
		res.status(500).json({ error: String(error.message || error) });
	}
});

// what: WebSocket endpoint for Deepgram diarization streaming (faster than Soniox)
// input: WebSocket connection, audio chunks
// return: streams transcripts with speaker labels
app.ws('/diarization/stream', async (ws, req) => {
	console.log('Diarization WebSocket client connected');
	
	const deepgramKey = process.env.DEEPGRAM_API_KEY;
	if (!deepgramKey) {
		ws.close(1008, 'DEEPGRAM_API_KEY missing');
		return;
	}
	
	// what: create Deepgram connection
	// input: API key, transcript callback
	// return: Deepgram WebSocket
	let deepgramWs;
	try {
		deepgramWs = createDeepgramConnection(deepgramKey, (speaker, text, isFinal) => {
			// what: forward transcript to client
			// input: speaker, text, isFinal
			// return: sends to client WebSocket
			if (ws.readyState === 1) { // WebSocket.OPEN
				ws.send(JSON.stringify({
					type: 'transcript',
					speaker,
					text,
					isFinal
				}));
			}
		});
	} catch (error) {
		console.error('Failed to create Deepgram connection:', error);
		ws.send(JSON.stringify({
			type: 'error',
			message: `Failed to connect to Deepgram: ${error.message}`
		}));
		ws.close(1008, 'Deepgram connection failed');
		return;
	}
	
	// what: forward audio chunks to Deepgram
	// input: audio data from client
	// return: sends to Deepgram
	let audioChunkCount = 0;
	ws.on('message', (data) => {
		if (Buffer.isBuffer(data)) {
			audioChunkCount++;
			if (audioChunkCount % 100 === 0) {
				console.log(`Received ${audioChunkCount} audio chunks from client, size: ${data.length} bytes`);
			}
			// what: send audio to Deepgram
			// input: audio data
			// return: sends to Deepgram
			sendDeepgramAudioChunk(deepgramWs, data);
		}
	});
	
	ws.on('close', () => {
		console.log('Diarization WebSocket client disconnected');
		// what: close Deepgram connection when client disconnects
		// input: Deepgram WebSocket
		// return: closes connection
		if (deepgramWs) {
			closeDeepgramConnection(deepgramWs);
		}
	});
	
	ws.on('error', (error) => {
		console.error('Diarization WebSocket error:', error);
		// what: close Deepgram connection on client error
		// input: Deepgram WebSocket
		// return: closes connection
		if (deepgramWs) {
			closeDeepgramConnection(deepgramWs);
		}
	});
});

app.post('/ai/respond', async (req, res) => {
	// what: AI response endpoint with GPT Turbo or Groq support
	// input: {transcript, speaker, context?, conversation?, model?}
	// return: {suggestion}
	const { transcript, speaker, context = '', conversation = [], model = 'gpt-4-turbo' } = req.body || {};
	if (!transcript) return res.status(400).json({ error: 'transcript required' });
	if (!speaker) return res.status(400).json({ error: 'speaker required' });
	
	// what: determine which API to use based on model
	// input: model name
	// return: API config
	const useGroq = model === 'groq' || model === 'llama' || model.startsWith('mixtral');
	const apiKey = useGroq ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY;
	const apiUrl = useGroq ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
	
	if (!apiKey) {
		return res.status(500).json({ error: useGroq ? 'GROQ_API_KEY missing' : 'OPENAI_API_KEY missing' });
	}
	
	try {
		// what: build conversation context
		// input: conversation history
		// return: formatted messages array
		const messages = [
			{
				role: 'system',
				content: 'You are a sales assistant. CRITICAL: You MUST ALWAYS provide a helpful, actionable response (1-2 sentences) when the CUSTOMER speaks. Never skip a response. If the customer asks a question, answer it directly. If they make a statement, acknowledge it and provide value. If they express concern, address it. ALWAYS respond - this is mandatory.'
			}
		];
		
		// what: add conversation history if provided
		// input: conversation array
		// return: adds to messages
		if (conversation.length > 0) {
			conversation.forEach(msg => {
				messages.push({
					role: msg.speaker === 'customer' ? 'user' : 'assistant',
					content: msg.text
				});
			});
		}
		
		// what: add current transcript
		// input: current speaker and transcript
		// return: adds to messages
		const speakerLabel = speaker === 'customer' ? 'CUSTOMER' : 'YOU (salesperson)';
		messages.push({
			role: speaker === 'customer' ? 'user' : 'assistant',
			content: `${speakerLabel} said: ${transcript}${context ? `\n\nContext: ${context}` : ''}`
		});
		
		// what: always respond to customer input (not just questions)
		// input: speaker and transcript
		// return: determines if AI should respond
		const shouldRespond = speaker === 'customer' && transcript.trim().length > 0;
		
		if (!shouldRespond) {
			console.log('AI respond skipped:', { speaker, transcriptLength: transcript.trim().length });
			return res.json({ suggestion: '' }); // No response needed
		}
		
		console.log('AI respond triggered:', { speaker, transcript: transcript.substring(0, 50), model: useGroq ? 'Groq' : 'GPT-4 Turbo' });
		
		// what: select model based on provider
		// input: model preference
		// return: model name
		let modelName = 'gpt-4o'; // User-specified model

		// Alternative OpenAI models: 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo-preview', 'gpt-4-turbo-2024-04-09'
		if (useGroq) {
			modelName = 'llama-3.3-70b-versatile'; // Fast Groq model (updated from deprecated llama-3.1-70b-versatile)
			// Alternative Groq models: 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'llama-3.3-70b-versatile'
		}
		
		console.log('Making API call:', { apiUrl, modelName, useGroq, apiKeyPresent: !!apiKey });
		
		// what: retry API call up to 2 times on failure
		// input: API URL, request body
		// return: API response
		let response;
		let lastError;
		const maxRetries = 2;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				response = await fetch(apiUrl, {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${apiKey}`,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						model: modelName,
						messages: messages,
						max_tokens: 200,
						temperature: 0.7
					})
				});
				
				if (response.ok) {
					break; // Success, exit retry loop
				}
				
				// what: handle non-ok responses
				// input: response status
				// return: throws error or retries
				
				// what: don't retry auth errors (401) - these are permanent
				// input: 401 status
				// return: throws error immediately
				if (response.status === 401) {
					const errorText = await response.text();
					let errorMessage = `Invalid ${useGroq ? 'Groq' : 'OpenAI'} API key. `;
					errorMessage += `Please check your ${useGroq ? 'GROQ' : 'OPENAI'}_API_KEY in services/agent-api/.env file. `;
					errorMessage += `Get a valid key from: ${useGroq ? 'https://console.groq.com/keys' : 'https://platform.openai.com/api-keys'}`;
					lastError = new Error(errorMessage);
					throw lastError;
				}
				
				// what: handle rate limits (429) with longer wait times
				// input: 429 status
				// return: waits longer and retries
				if (response.status === 429) {
					if (attempt < maxRetries) {
						const waitTime = (attempt + 1) * 2000; // 2s, 4s for rate limits
						console.warn(`${useGroq ? 'Groq' : 'OpenAI'} rate limit hit, waiting ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})`);
						await new Promise(resolve => setTimeout(resolve, waitTime));
						continue;
					}
				}
				
				// what: retry on server errors (500+)
				// input: 500+ status
				// return: waits and retries
				if (response.status >= 500) {
					if (attempt < maxRetries) {
						const waitTime = (attempt + 1) * 1000; // 1s, 2s
						console.warn(`${useGroq ? 'Groq' : 'OpenAI'} API error ${response.status}, retrying in ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})`);
						await new Promise(resolve => setTimeout(resolve, waitTime));
						continue;
					}
				}
				
				const errorText = await response.text();
				lastError = new Error(`${useGroq ? 'Groq' : 'OpenAI'} API error: ${response.status} - ${errorText}`);
				throw lastError;
			} catch (error) {
				lastError = error;
				if (attempt < maxRetries && (error.message.includes('fetch failed') || error.message.includes('network'))) {
					// what: retry on network errors
					// input: attempt number
					// return: waits and retries
					const waitTime = (attempt + 1) * 1000;
					console.warn(`Network error, retrying in ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})`);
					await new Promise(resolve => setTimeout(resolve, waitTime));
					continue;
				}
				throw error;
			}
		}
		
		if (!response || !response.ok) {
			throw lastError || new Error(`${useGroq ? 'Groq' : 'OpenAI'} API call failed after ${maxRetries + 1} attempts`);
		}
		
		const data = await response.json();
		console.log('Raw API response:', JSON.stringify(data, null, 2));
		
		// what: extract suggestion from API response with multiple fallback paths
		// input: API response data
		// return: extracted suggestion text
		let suggestion = '';
		
		// what: handle different API response structures
		// input: API response data
		// return: extracted suggestion
		if (data.choices && Array.isArray(data.choices) && data.choices.length > 0) {
			const choice = data.choices[0];
			suggestion = choice?.message?.content || 
			            choice?.message?.text || 
			            choice?.text || 
			            choice?.delta?.content || 
			            choice?.content || 
			            '';
		} else if (data.text) {
			// what: handle alternative response format
			// input: data.text
			// return: suggestion text
			suggestion = data.text;
		} else if (data.response) {
			// what: handle another alternative format
			// input: data.response
			// return: suggestion text
			suggestion = data.response;
		}
		
		// what: normalize suggestion (trim whitespace, handle null/undefined)
		// input: raw suggestion
		// return: normalized suggestion string
		suggestion = (suggestion || '').trim();
		
		// what: ensure we always have a valid response - ALWAYS use fallback if empty
		// input: suggestion from API
		// return: fallback response if empty
		if (!suggestion || suggestion === '' || suggestion === 'No suggestion' || suggestion === 'null' || suggestion === 'undefined') {
			console.warn('Empty suggestion from API, using fallback response', {
				rawSuggestion: suggestion,
				hasChoices: !!data.choices,
				choicesLength: data.choices?.length || 0,
				firstChoice: data.choices?.[0] || null
			});
			
			// what: generate context-aware fallback based on transcript content
			// input: transcript text
			// return: appropriate fallback response
			const transcriptLower = transcript.toLowerCase();
			if (transcriptLower.includes('?') || transcriptLower.includes('question')) {
				suggestion = 'I understand your question. Let me help you with that.';
			} else if (transcriptLower.includes('no') || transcriptLower.includes('not') || transcriptLower.includes('concern')) {
				suggestion = 'I hear your concern. Let me address that for you.';
			} else if (transcriptLower.includes('problem') || transcriptLower.includes('issue') || transcriptLower.includes('wrong')) {
				suggestion = 'I understand there\'s an issue. Let me help resolve that.';
			} else {
				suggestion = 'I understand. How can I assist you further?';
			}
			
			console.log('Fallback suggestion generated:', suggestion);
		}
		
		// what: final validation - ensure suggestion is never empty
		// input: suggestion string
		// return: guaranteed non-empty suggestion
		if (!suggestion || suggestion.trim() === '') {
			console.error('CRITICAL: Suggestion is still empty after fallback, using default');
			suggestion = 'I understand. How can I help you?';
		}
		
		console.log('AI response received:', { 
			suggestionLength: suggestion.length, 
			suggestionPreview: suggestion.substring(0, 100),
			hasChoices: !!data.choices,
			choicesLength: data.choices?.length || 0,
			usedFallback: !data.choices?.[0]?.message?.content && !data.choices?.[0]?.text
		});
		
		// what: send response with guaranteed non-empty suggestion
		// input: suggestion string
		// return: JSON response
		res.json({ suggestion: suggestion.trim() });
	} catch (error) {
		console.error('AI respond error:', error);
		console.error('Error stack:', error.stack);
		// what: return error message instead of empty suggestion
		// input: error object
		// return: error response
		res.status(500).json({ 
			error: String(error.message || error),
			suggestion: `Error: ${error.message || 'Unknown error'}` // Return error as suggestion for debugging
		});
	}
});

// what: validate API keys on startup
// input: environment variables
// return: logs warnings for missing/invalid keys
const openaiKey = process.env.OPENAI_API_KEY;
const groqKey = process.env.GROQ_API_KEY;
const deepgramKey = process.env.DEEPGRAM_API_KEY;

console.log('API Keys Status:');
console.log(`  OpenAI: ${openaiKey ? '✓ Set' : '✗ Missing'}`);
console.log(`  Groq: ${groqKey ? '✓ Set' : '✗ Missing'}`);
console.log(`  Deepgram: ${deepgramKey ? '✓ Set' : '✗ Missing'}`);

if (!openaiKey) {
	console.warn('⚠️  WARNING: OPENAI_API_KEY not set. GPT-4 Turbo will not work.');
}
if (!groqKey) {
	console.warn('⚠️  WARNING: GROQ_API_KEY not set. Groq model will not work.');
}
if (!deepgramKey) {
	console.warn('⚠️  WARNING: DEEPGRAM_API_KEY not set. Dual speaker mode will not work.');
}

const port = process.env.PORT || 8787;
app.listen(port, () => {
	console.log(`agent-api listening on http://localhost:${port}`);
});


