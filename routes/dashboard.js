const express = require('express');
const path = require('path');

module.exports = function createDashboardRouter({ db } = {}) {
	const router = express.Router();

	// Serve the dashboard HTML (ensure user is authenticated)
	router.get('/', (req, res) => {
		if (!req.session || !req.session.userId) return res.redirect('/login');
		return res.sendFile(path.join(__dirname, '../public/dashboard.html'));
	});

	// Return only the items count
	router.get('/count', (req, res) => {
		if (!db) return res.status(500).json({ error: 'DB not initialized' });
		db.get('SELECT COUNT(*) AS count FROM items', [], (err, row) => {
			if (err) {
				console.error('DB error fetching item count:', err);
				return res.status(500).json({ error: 'DB error' });
			}
			const count = row && typeof row.count === 'number' ? row.count : Number(row.count) || 0;
			return res.json({ count });
		});
	});

	return router;
};