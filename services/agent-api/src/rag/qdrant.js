// what: Qdrant client helpers for KB collection create/upsert/search
// input: env QDRANT_URL, QDRANT_API_KEY
// return: functions createCollectionIfMissing, upsertChunks, search
import { QdrantClient } from '@qdrant/js-client-rest';

const url = process.env.QDRANT_URL || 'http://localhost:6333';
const apiKey = process.env.QDRANT_API_KEY || undefined;
export const qdrant = new QdrantClient({ url, apiKey });

export const COLLECTION = 'sales_assistant_kb';

export async function createCollectionIfMissing() {
	// ensure cosine, size=3072 (OpenAI embeddings)
	const collections = await qdrant.getCollections();
	const exists = collections.collections.some(c => c.name === COLLECTION);
	if (exists) return;
	await qdrant.createCollection(COLLECTION, {
		vectors: {
			size: 3072,
			distance: 'Cosine'
		}
	});
}

export async function upsertChunks(chunks) {
	// chunks: [{id,text,embedding,metadata}]
	await createCollectionIfMissing();
	const points = chunks.map(c => ({
		id: c.id,
		vector: c.embedding,
		payload: { text: c.text, ...c.metadata }
	}));
	await qdrant.upsert(COLLECTION, {
		wait: true,
		points
	});
}

export async function search(embedding, limit = 5, filter = undefined) {
	await createCollectionIfMissing();
	const res = await qdrant.search(COLLECTION, {
		vector: embedding,
		limit,
		filter,
		with_payload: true
	});
	return res.map(hit => ({
		id: hit.id,
		score: hit.score,
		text: hit.payload?.text || '',
		metadata: hit.payload || {}
	}));
}


