// what: minimal API server for health and OpenAI Realtime SDP/token proxy
// input: env OPENAI_API_KEY, OPENAI_REALTIME_MODEL, OPENAI_REALTIME_URL
// return: HTTP server with /health and /realtime/token endpoints
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import ingestRouter from './rag/ingest.js';
import searchRouter from './rag/search.js';
import toolsRouter from './tools/index.js';
import crmRouter from './crm/index.js';

const app = express();
app.use(cors());
app.use(express.json());
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

app.post('/ai/respond', async (req, res) => {
	// what: simple AI response endpoint using OpenAI chat
	// input: {transcript, context?}
	// return: {suggestion}
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY missing' });
	
	const { transcript, context = '' } = req.body || {};
	if (!transcript) return res.status(400).json({ error: 'transcript required' });
	
	try {
		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				messages: [
					{
						role: 'system',
						content: 'You are a sales assistant. Give short, actionable suggestions (1-2 sentences) based on what the user said in a sales call.'
					},
					{
						role: 'user',
						content: context ? `Context: ${context}\n\nUser said: ${transcript}` : `User said: ${transcript}`
					}
				],
				max_tokens: 150,
				temperature: 0.7
			})
		});
		
		if (!response.ok) {
			const errorText = await response.text();
			console.error('OpenAI API error:', response.status, errorText);
			throw new Error(`OpenAI API error: ${response.status}`);
		}
		
		const data = await response.json();
		const suggestion = data.choices[0]?.message?.content || 'No suggestion';
		
		res.json({ suggestion });
	} catch (error) {
		console.error('AI respond error:', error);
		res.status(500).json({ error: String(error.message || error) });
	}
});

const port = process.env.PORT || 8787;
app.listen(port, () => {
	console.log(`agent-api listening on http://localhost:${port}`);
});


