print = console.log
print("Starting server...")

// server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path')
const crypto = require('crypto');

const bcrypt = require("bcrypt");

const app = express();
const PORT = process.env.PORT || 3000;

//sesions for login
const session = require("express-session");

// settings
const min_quantity = 10;

// Sicherheit: kein "X-Powered-By", ein paar Schutz-Header für alle Antworten
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Sicherheit: Das Session-Geheimnis steht nicht mehr im Code. Entweder über die Umgebungsvariable
// SESSION_SECRET setzen oder es wird bei jedem Start ein zufälliges erzeugt (Sessions liegen ohnehin
// nur im Arbeitsspeicher und sind nach einem Neustart weg).
app.use(
  session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  })
);

// Sicherheit: API-Routen mit Daten nur für eingeloggte Benutzer
function requireLogin(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: "Nicht eingeloggt" });
}

// Sicherheit: Ohne Login sind nur Login- und Registrierseite direkt als Datei abrufbar.
// (express.static würde sonst /dashboard.html, /lager.html usw. an jeden ausliefern.)
const PUBLIC_PAGES = new Set(['/login.html', '/register.html']);
app.use((req, res, next) => {
  if (req.session && req.session.userId) return next();
  let p;
  try {
    p = path.posix.normalize(decodeURIComponent(req.path).replace(/\\/g, '/')).toLowerCase().replace(/[. ]+$/, '');
  } catch (e) {
    return res.status(400).send('Bad Request');
  }
  if (p.endsWith('.html') && !PUBLIC_PAGES.has(p)) return res.redirect('/login');
  next();
});

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

// Sicherheit: höchstens 10 Fehlversuche pro 15 Minuten, je IP-Adresse und Benutzername
const LOGIN_MAX_FAILS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginFails = new Map(); // "ip|benutzer" -> { n, reset }
const loginKey = (req, identifier) => `${req.ip}|${identifier.toLowerCase()}`;
function loginBlocked(key) {
  const e = loginFails.get(key);
  return !!e && e.reset > Date.now() && e.n >= LOGIN_MAX_FAILS;
}
function noteLoginFail(key) {
  const now = Date.now();
  let e = loginFails.get(key);
  if (!e || e.reset <= now) e = { n: 0, reset: now + LOGIN_WINDOW_MS };
  e.n += 1;
  loginFails.set(key, e);
}
setInterval(() => {
  const now = Date.now();
  for (const [key, e] of loginFails) if (e.reset <= now) loginFails.delete(key);
}, 60 * 1000).unref();

// Vergleichs-Hash für unbekannte Benutzer: gleiche Antwortzeit, egal ob es den Benutzer gibt
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

app.post("/api/login", (req, res) => {
  const body = req.body || {};
  const identifier = typeof body.identifier === "string" ? body.identifier : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!identifier || !password) {
    return res.status(400).json({ error: "Benutzername und Passwort nötig" });
  }
  const failKey = loginKey(req, identifier);
  if (loginBlocked(failKey)) {
    return res.status(429).json({ error: "Zu viele Fehlversuche. Bitte in ein paar Minuten erneut versuchen." });
  }

  // identifier = email ODER username
  db.get(
    `SELECT * FROM users WHERE username = ? OR email = ?`,
    [identifier, identifier],
    async (err, user) => {
      try {
        if (err) return res.status(500).json({ error: "DB Fehler" });

        const valid = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);

        // Gleiche Meldung für "User nicht gefunden" und "Falsches Passwort":
        // sonst lässt sich herausfinden, welche Benutzernamen es gibt.
        if (!user || !valid) {
          noteLoginFail(failKey);
          return res.status(400).json({ error: "Benutzername oder Passwort falsch" });
        }

        loginFails.delete(failKey);

        // Neue Session-ID beim Login (Schutz vor Session-Fixation)
        req.session.regenerate((regenErr) => {
          if (regenErr) return res.status(500).json({ error: "Serverfehler" });
          req.session.userId = user.id;
          res.json({ message: "Login erfolgreich" });
        });
      } catch (e) {
        console.error(e);
        if (!res.headersSent) res.status(500).json({ error: "Serverfehler" });
      }
    }
  );
});

// register
app.post("/api/register", async (req, res) => {
  const body = req.body || {};
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!password || (!username && !email)) {
    return res.status(400).json({ error: "Username oder Email + Passwort nötig" });
  }
  if (username.length > 100 || email.length > 254 || password.length > 200) {
    return res.status(400).json({ error: "Eingabe zu lang" });
  }

  let hash;
  try {
    hash = await bcrypt.hash(password, 10);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Serverfehler" });
  }

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
    res.clearCookie("connect.sid");
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
app.post('/items', requireLogin, (req, res) => {
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
app.get('/items', requireLogin, (req, res) => {
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
