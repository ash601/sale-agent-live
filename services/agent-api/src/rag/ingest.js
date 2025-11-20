// what: ingestion endpoints for text/urls/files with OpenAI embeddings
// input: POST /ingest {text?, url?, profileId?, tags?[]}
// return: {count} upserted
import express from 'express';
import fetch from 'node-fetch';
import { upsertChunks } from './qdrant.js';
import { pineconeAvailable, pcUpsert } from './pinecone.js';

const router = express.Router();

async function embed(texts) {
	// what: call OpenAI embeddings for batch of texts
	// input: array of strings
	// return: array of 3072 floats
	const apiKey = process.env.OPENAI_API_KEY;
	const model = process.env.EMBED_MODEL || 'text-embedding-3-large';
	const resp = await fetch('https://api.openai.com/v1/embeddings', {
		method: 'POST',
		headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ model, input: texts })
	});
	if (!resp.ok) throw new Error('embedding failed');
	const json = await resp.json();
	return json.data.map((d) => d.embedding);
}

function splitIntoChunks(text) {
	// what: simple paragraph/window split
	// input: raw text
	// return: string[] chunks
	const paras = text.split(/\n{2,}/).map(t => t.trim()).filter(Boolean);
	const chunks = [];
	let buf = '';
	for (const p of paras) {
		if ((buf + ' ' + p).length > 1200) {
			chunks.push(buf.trim());
			buf = p;
		} else {
			buf = (buf ? buf + ' ' : '') + p;
		}
	}
	if (buf) chunks.push(buf);
	return chunks;
}

router.post('/ingest', express.json({ limit: '4mb' }), async (req, res) => {
	try {
		const { text, url, profileId, tags = [] } = req.body || {};
		let raw = text || '';
		if (url) {
			const html = await fetch(url).then(r => r.text());
			raw += '\n' + html.replace(/<[^>]+>/g, ' ');
		}
		if (!raw.trim()) return res.status(400).json({ error: 'no content' });
		const parts = splitIntoChunks(raw).slice(0, 64);
		const vectors = await embed(parts);
		const payloads = parts.map((t, i) => ({
			id: `${Date.now()}-${i}`,
			text: t,
			embedding: vectors[i],
			metadata: { profileId, tags }
		}));
		if (pineconeAvailable) {
			await pcUpsert(payloads);
		} else {
			await upsertChunks(payloads);
		}
		res.json({ count: payloads.length });
	} catch (e) {
		res.status(500).json({ error: String(e) });
	}
});

export default router;


