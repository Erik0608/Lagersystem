const express = require('express');
const path = require('path');

module.exports = function createDashboardRouter({ db, min_quantity } = {}) {
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

	// Return how many items have quantity < min_quantity
	router.get('/low', (req, res) => {
		if (!db) return res.status(500).json({ error: 'DB not initialized' });
		const min = Number.isFinite(min_quantity) ? min_quantity : 0;
		db.get('SELECT COUNT(*) AS low FROM items WHERE quantity < ?', [min], (err, row) => {
			if (err) {
				console.error('DB error fetching low-count:', err);
				return res.status(500).json({ error: 'DB error' });
			}
			const lowCount = row && typeof row.low === 'number' ? row.low : Number(row.low) || 0;
			return res.json({ lowCount, min });
		});
	});

	return router;
};