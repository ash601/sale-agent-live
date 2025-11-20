// what: /rag/search endpoint and profile CRUD (in-memory for MVP)
// input: POST /rag/search {query, profileId, k}
// return: {matches:[{id,score,text,metadata}]}
import express from 'express';
import fetch from 'node-fetch';
import { search as qSearch } from './qdrant.js';
import { pineconeAvailable, pcSearch } from './pinecone.js';

const router = express.Router();

// simple in-memory profiles; replace with DB later
const profiles = new Map();

async function embedQuery(text) {
	// what: embed one query string
	// input: text
	// return: 3072 float array
	const apiKey = process.env.OPENAI_API_KEY;
	const model = process.env.EMBED_MODEL || 'text-embedding-3-large';
	const resp = await fetch('https://api.openai.com/v1/embeddings', {
		method: 'POST',
		headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ model, input: text })
	});
	if (!resp.ok) throw new Error('embedding failed');
	const json = await resp.json();
	return json.data[0].embedding;
}

router.post('/search', async (req, res) => {
	try {
		const { query, profileId, k = 5 } = req.body || {};
		if (!query) return res.status(400).json({ error: 'query required' });
		const emb = await embedQuery(query);
		const filter = profileId ? { must: [{ key: 'profileId', match: { value: profileId } }] } : undefined;
		const matches = pineconeAvailable ? await pcSearch(emb, k, filter) : await qSearch(emb, k, filter);
		res.json({ matches });
	} catch (e) {
		res.status(500).json({ error: String(e) });
	}
});

router.get('/profiles', (_req, res) => {
	res.json({ profiles: Array.from(profiles.values()) });
});
router.post('/profiles', (req, res) => {
	const { id, name, industry, product, goals, risks, tone, key_questions } = req.body || {};
	if (!id || !name) return res.status(400).json({ error: 'id and name required' });
	const p = { id, name, industry, product, goals, risks, tone, key_questions };
	profiles.set(id, p);
	res.json(p);
});

export default router;


