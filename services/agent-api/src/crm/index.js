// what: minimal CRM lookup stub and calendar profile inference
// input: GET /crm/lookup?email=... | GET /calendar/next
// return: basic account/contact info; demo data if no CRM keys
import express from 'express';

const router = express.Router();

const demo = {
	'jane@acme.com': { account: 'Acme Corp', industry: 'Manufacturing', plan: 'Enterprise', arr: 240000 },
	'ops@globex.com': { account: 'Globex', industry: 'Energy', plan: 'Growth', arr: 96000 }
};

router.get('/crm/lookup', (req, res) => {
	const email = String(req.query.email || '').toLowerCase();
	const rec = demo[email];
	if (!rec) return res.status(404).json({ error: 'not found' });
	res.json(rec);
});

router.get('/calendar/next', (_req, res) => {
	// MOCK: return a profile suggestion from next meeting title
	res.json({ profileHint: 'Acme Corp' });
});

export default router;


