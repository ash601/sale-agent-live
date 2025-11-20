// what: Realtime tool schema and handlers
// input: POST /tools/rpc {name, arguments}
// return: JSON result for the tool
import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

export const toolSchema = [
	{
		name: 'rag.search',
		description: 'Search the knowledge base for relevant facts. Always call before long answers.',
		parameters: {
			type: 'object',
			properties: {
				query: { type: 'string' },
				k: { type: 'integer', minimum: 1, maximum: 10 },
				profileId: { type: 'string' }
			},
			required: ['query']
		}
	}
];

router.get('/tools/schema', (_req, res) => {
	res.json({ tools: toolSchema });
});

router.post('/tools/rpc', async (req, res) => {
	const { name, arguments: args } = req.body || {};
	try {
		if (name === 'rag.search') {
			const resp = await fetch('http://localhost:' + (process.env.PORT || 8787) + '/rag/search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ query: args.query, k: args.k || 5, profileId: args.profileId })
			});
			const json = await resp.json();
			return res.json(json);
		}
		return res.status(404).json({ error: 'unknown tool' });
	} catch (e) {
		res.status(500).json({ error: String(e) });
	}
});

export default router;


