print = console.log
print("Starting server...")

// server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path')

const bcrypt = require("bcrypt");

const app = express();
const PORT = process.env.PORT || 3000;

//sesions for login
const session = require("express-session");

// settings
const min_quantity = 10;

app.use(
  session({
    secret: "12345",
    resave: false,
    saveUninitialized: false,
  })
);

// router
const pagesRouter = require('./routes/pages');
const apiRouter = require('./routes/api');

app.use(express.static(path.join(__dirname, "public"), { index: false }));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add root redirect BEFORE mounting pagesRouter so it takes precedence
app.get("/", (req, res) => {
  if (req.session && req.session.userId) {
    print("redirect to dashboard");
    return res.redirect("/dashboard");
  } else {
    print("redirect to login");
    return res.redirect("/login");
  }
});

// Open (oder erstellen) die SQLite DB
const db = new sqlite3.Database(path.join(__dirname, 'database.db'), (err) => {
  if (err) {
    console.error('Fehler beim Öffnen der Datenbank:', err.message);
    process.exit(1);
  }
  console.log('Verbunden mit database.db');

  // Mount dashboard router now that DB is ready
  const createDashboardRouter = require('./routes/dashboard');
  app.use('/dashboard', createDashboardRouter({ db, min_quantity }));

  // Mount remaining routers
  app.use('/', pagesRouter);      // Seiten
  app.use('/api', apiRouter);     // API
});

// User Tabelle
db.run(
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password TEXT NOT NULL
  )`
);

//login

app.post("/api/login", (req, res) => {
  const { identifier, password } = req.body;

  // identifier = email ODER username
  db.get(
    `SELECT * FROM users WHERE username = ? OR email = ?`,
    [identifier, identifier],
    async (err, user) => {
      if (err) return res.status(500).json({ error: "DB Fehler" });

      if (!user)
        return res.status(400).json({ error: "User nicht gefunden" });

      const valid = await bcrypt.compare(password, user.password);

      if (!valid) return res.status(400).json({ error: "Falsches Passwort" });

      // Session setzen
      req.session.userId = user.id;

      res.json({ message: "Login erfolgreich" });
    }
  );
});

// register
app.post("/api/register", async (req, res) => {
  const { username, email, password } = req.body;

  if (!password || (!username && !email)) {
    return res.status(400).json({ error: "Username oder Email + Passwort nötig" });
  }

  const hash = await bcrypt.hash(password, 10);

  db.run(
    `INSERT INTO users (username, email, password) VALUES (?, ?, ?)`,
    [username || null, email || null, hash],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(400).json({ error: "User existiert bereits" });
      }
      res.json({ message: "Registrierung erfolgreich" });
    }
  );
});

// protected route
app.get("/api/me", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Nicht eingeloggt" });
  }

  db.get(
    `SELECT id, username, email FROM users WHERE id = ?`,
    [req.session.userId],
    (err, user) => {
      if (err) return res.status(500).json({ error: "DB Fehler" });
      res.json(user);
    }
  );
});

// logout
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ message: "Logout erfolgreich" });
  });
});

// Tabelle erstellen, falls nicht vorhanden
db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      description TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    (err) => {
      if (err) console.error('Fehler beim Erstellen der Tabelle:', err.message);
    }
  );
});

// API: Gegenstand hinzufügen (oder Menge erhöhen, falls Name schon existiert)
app.post('/items', (req, res) => {
  const name = (req.body.name || '').toString().trim();
  const quantity = parseInt(req.body.quantity, 10) || 1;
  const desc = (req.body.desc || req.body.description || '').toString().trim(); // <-- added

  if (!name) {
    return res.status(400).json({ error: 'Name darf nicht leer sein' });
  }

  // Suche nach bestehendem Eintrag (case-insensitive dank COLLATE NOCASE)
  db.get('SELECT id, name, description, quantity, created_at FROM items WHERE name = ? COLLATE NOCASE', [name], (err, row) => {
    if (err) {
      console.error('DB Fehler beim Prüfen vorhandener Items:', err.message);
      return res.status(500).json({ error: 'Datenbankfehler' });
    }

    if (row) {
      // Update: Menge addieren, optional Beschreibung aktualisieren wenn übergeben
      const newQty = (row.quantity || 0) + quantity;

      if (desc) {
        // If a description was provided, update both quantity and description
        db.run('UPDATE items SET quantity = ?, description = ? WHERE id = ?', [newQty, desc, row.id], function (updateErr) {
          if (updateErr) {
            console.error('Update Fehler:', updateErr.message);
            return res.status(500).json({ error: 'Konnte Eintrag nicht aktualisieren' });
          }
          // Rückgabe des aktualisierten Eintrags
          db.get('SELECT id, name, description, quantity, created_at FROM items WHERE id = ?', [row.id], (getErr, updatedRow) => {
            if (getErr) {
              console.error('Select nach Update Fehler:', getErr.message);
              return res.status(500).json({ error: 'Konnte Eintrag nicht lesen' });
            }
            return res.json(updatedRow);
          });
        });
      } else {
        // Only update quantity
        db.run('UPDATE items SET quantity = ? WHERE id = ?', [newQty, row.id], function (updateErr) {
          if (updateErr) {
            console.error('Update Fehler:', updateErr.message);
            return res.status(500).json({ error: 'Konnte Eintrag nicht aktualisieren' });
          }
          // Rückgabe des aktualisierten Eintrags
          db.get('SELECT id, name, description, quantity, created_at FROM items WHERE id = ?', [row.id], (getErr, updatedRow) => {
            if (getErr) {
              console.error('Select nach Update Fehler:', getErr.message);
              return res.status(500).json({ error: 'Konnte Eintrag nicht lesen' });
            }
            return res.json(updatedRow);
          });
        });
      }
    } else {
      // Neuer Eintrag
      const stmt = db.prepare('INSERT INTO items (name, quantity, description) VALUES (?, ?, ?)');
      stmt.run([name, quantity, desc], function (insertErr) { // <-- use desc here
        if (insertErr) {
          console.error('Insert Fehler:', insertErr.message);
          return res.status(500).json({ error: 'Konnte Eintrag nicht speichern' });
        }
        const newId = this.lastID;
        db.get('SELECT id, name, description, quantity, created_at FROM items WHERE id = ?', [newId], (getErr, newRow) => {
          if (getErr) {
            console.error('Select nach Insert Fehler:', getErr.message);
            return res.status(500).json({ error: 'Konnte Eintrag nicht lesen' });
          }
          res.status(201).json(newRow);
        });
      });
      stmt.finalize();
    }
  });
});

// GET /items - list items
app.get('/items', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const min = req.query.min !== undefined && req.query.min !== '' ? parseInt(req.query.min, 10) : null; // <-- added
  const max = req.query.max !== undefined && req.query.max !== '' ? parseInt(req.query.max, 10) : null; // <-- added

  const where = [];
  const params = [];

  if (q) {
    // if q is numeric allow matching id as well
    if (/^\d+$/.test(q)) {
      where.push('(id = ? OR name LIKE ? COLLATE NOCASE)');
      params.push(parseInt(q, 10), `%${q}%`);
    } else {
      where.push('name LIKE ? COLLATE NOCASE');
      params.push(`%${q}%`);
    }
  }

  if (min !== null && !Number.isNaN(min)) {
    where.push('quantity >= ?');
    params.push(min);
  }
  if (max !== null && !Number.isNaN(max)) {
    where.push('quantity <= ?');
    params.push(max);
  }

  const sql = `SELECT id, name, description, quantity, created_at FROM items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC`; // include desc

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('DB Fehler beim Laden der Items:', err.message);
      return res.status(500).json({ error: 'Datenbankfehler' });
    }
    res.json(rows || []);
  });
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
