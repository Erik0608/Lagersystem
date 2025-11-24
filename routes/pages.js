const express = require('express');
const router = express.Router();
const path = require('path');

// Login Seite
router.get("/login", (req, res) => {
  if (req.session.userId) return res.redirect("/dashboard");
  res.sendFile(path.join(__dirname, "../public/login.html"));
});

// Registrieren Seite
router.get("/register", (req, res) => {
  if (req.session.userId) return res.redirect("/dashboard");
  res.sendFile(path.join(__dirname, "../public/register.html"));
});

// Lager
router.get("/lager", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/lager.html"));
});

// Einlagern
router.get("/einlagern", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/einlagern.html"));
});
module.exports = router;
