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

// Dashboard
router.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/dashboard.html"));
});

// Lager
router.get("/lager", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/lager.html"));
});

module.exports = router;
