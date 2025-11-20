// what: optional Pinecone client wrapper (used when env PINECONE_API_KEY set)
// input: env PINECONE_* and index name
// return: upsert/search functions matching qdrant.js shape
import fetch from 'node-fetch';

const apiKey = process.env.PINECONE_API_KEY;
const index = process.env.PINECONE_INDEX || 'sales-assistant-kb';
const base = process.env.PINECONE_HOST; // e.g., https://yourindex.svc.us-east1-aws.pinecone.io

export const pineconeAvailable = !!(apiKey && base);

export async function pcUpsert(chunks) {
	const body = {
		vectors: chunks.map(c => ({ id: String(c.id), values: c.embedding, metadata: { text: c.text, ...c.metadata } }))
	};
	const resp = await fetch(`${base}/vectors/upsert`, {
		method: 'POST',
		headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!resp.ok) throw new Error('pinecone upsert failed');
}

export async function pcSearch(embedding, topK = 5, filter = undefined) {
	const body = {
		vector: embedding,
		topK,
		includeMetadata: true,
		filter
	};
	const resp = await fetch(`${base}/query`, {
		method: 'POST',
		headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!resp.ok) throw new Error('pinecone search failed');
	const json = await resp.json();
	return (json.matches || []).map((m) => ({
		id: m.id,
		score: m.score,
		text: m.metadata.text,
		metadata: m.metadata
	}));
}


