// server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve index.html from project root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Open (oder erstellen) die SQLite DB
const db = new sqlite3.Database(path.join(__dirname, 'database.db'), (err) => {
  if (err) {
    console.error('Fehler beim Öffnen der Datenbank:', err.message);
    process.exit(1);
  }
  console.log('Verbunden mit database.db');
});

// Tabelle erstellen, falls nicht vorhanden
db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    (err) => {
      if (err) console.error('Fehler beim Erstellen der Tabelle:', err.message);
    }
  );
});

// API: alle Gegenstände holen
app.get('/items', (req, res) => {
  db.all('SELECT id, name, quantity, created_at FROM items ORDER BY id DESC', [], (err, rows) => {
    if (err) {
      console.error('DB Fehler:', err.message);
      return res.status(500).json({ error: 'Datenbankfehler' });
    }
    res.json(rows);
  });
});

// API: Gegenstand hinzufügen
app.post('/items', (req, res) => {
  const name = (req.body.name || '').toString().trim();
  const quantity = parseInt(req.body.quantity, 10) || 1;

  if (!name) {
    return res.status(400).json({ error: 'Name darf nicht leer sein' });
  }

  const stmt = db.prepare('INSERT INTO items (name, quantity) VALUES (?, ?)');
  stmt.run([name, quantity], function (err) {
    if (err) {
      console.error('Insert Fehler:', err.message);
      return res.status(500).json({ error: 'Konnte Eintrag nicht speichern' });
    }

    const newId = this.lastID;
    db.get('SELECT id, name, quantity, created_at FROM items WHERE id = ?', [newId], (err, row) => {
      if (err) {
        console.error('Select nach Insert Fehler:', err.message);
        return res.status(500).json({ error: 'Konnte Eintrag nicht lesen' });
      }
      res.status(201).json(row);
    });
  });
  stmt.finalize();
});

// Optional: healthcheck
app.get('/health', (req, res) => {
  db.get('SELECT 1 AS ok', [], (err) => {
    if (err) return res.status(500).send('DB nicht erreichbar');
    res.send('OK');
  });
});

// Server starten
app.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});
