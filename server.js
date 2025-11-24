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

app.use('/', pagesRouter);      // Seiten
app.use('/api', apiRouter);     // API

// Open (oder erstellen) die SQLite DB
const db = new sqlite3.Database(path.join(__dirname, 'database.db'), (err) => {
  if (err) {
    console.error('Fehler beim Öffnen der Datenbank:', err.message);
    process.exit(1);
  }
  console.log('Verbunden mit database.db');
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

// Dashboard logic
