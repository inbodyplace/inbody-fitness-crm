"use strict";

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const path = require("path");
const { getPool } = require("./db");

const app = express();
const PORT = process.env.PORT || 3001;

const INBODY_API_BASE = (
  process.env.INBODY_API_BASE_URL || "https://kr.developers.lookinbody.com"
).replace(/\/$/, "");
const INBODY_ACCOUNT = process.env.INBODY_ACCOUNT || "";
const INBODY_API_KEY = process.env.INBODY_API_KEY || "";
const WEBHOOK_HDR_NAME = process.env.WEBHOOK_HEADER_NAME || "";
const WEBHOOK_HDR_VALUE = process.env.WEBHOOK_HEADER_VALUE || "";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── InBody API client ────────────────────────────────────────────────────────
const inbody = axios.create({
  baseURL: INBODY_API_BASE,
  headers: {
    Account: INBODY_ACCOUNT,
    "API-KEY": INBODY_API_KEY,
    "Content-Type": "application/json",
  },
  timeout: 10000,
});

// ─── POST /webhook ────────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  // Custom header validation
  if (WEBHOOK_HDR_NAME && WEBHOOK_HDR_VALUE) {
    if (req.headers[WEBHOOK_HDR_NAME.toLowerCase()] !== WEBHOOK_HDR_VALUE) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const p = req.body;
  const isTemp = p.IsTempData === "true";
  const db = await getPool();

  const [result] = await db.execute(
    `INSERT INTO webhook_events (user_id, user_token, equip, equip_serial, test_at, account, is_temp, fetch_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      p.UserID || "",
      p.TelHP || null,
      p.Equip || null,
      p.EquipSerial || null,
      p.TestDatetimes || "",
      p.Account || null,
      isTemp ? 1 : 0,
      isTemp
        ? "skipped_temp"
        : INBODY_ACCOUNT && INBODY_API_KEY
          ? "pending"
          : "skipped_no_config",
    ],
  );
  const eventId = result.insertId;

  console.log(
    `[Webhook] UserID=${p.UserID} Equip=${p.Equip} Time=${p.TestDatetimes}${isTemp ? " (temp)" : ""}`,
  );
  res.status(200).json({ received: true });

  if (
    !isTemp &&
    INBODY_ACCOUNT &&
    INBODY_API_KEY &&
    p.UserID &&
    p.TestDatetimes
  ) {
    fetchAndStore(eventId, p.UserID, p.TestDatetimes, db);
  }
});

async function fetchAndStore(eventId, userId, testAt, db) {
  try {
    const res = await inbody.post("/InBody/GetInBodyDataByID", {
      UserID: userId,
      Datetimes: String(testAt),
    });
    await db.execute(
      `UPDATE webhook_events SET inbody_data=?, fetch_status='success' WHERE id=?`,
      [JSON.stringify(res.data), eventId],
    );
    console.log(`[InBody API] Fetched for UserID=${userId}`);
  } catch (err) {
    const msg = err.response?.data?.errorCode || err.message;
    await db.execute(
      `UPDATE webhook_events SET fetch_status='error', fetch_error=? WHERE id=?`,
      [msg, eventId],
    );
    console.error(`[InBody API] Failed for UserID=${userId}:`, msg);
  }
}

// ─── GET /api/stats ───────────────────────────────────────────────────────────
app.get("/api/stats", async (_req, res) => {
  const db = await getPool();
  const [[{ today }]] = await db.execute(
    `SELECT COUNT(*) AS today FROM webhook_events WHERE DATE(received_at) = CURDATE()`,
  );
  const [[{ total }]] = await db.execute(
    `SELECT COUNT(DISTINCT user_id) AS total FROM webhook_events`,
  );
  const [[{ week }]] = await db.execute(
    `SELECT COUNT(*) AS week FROM webhook_events WHERE received_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
  );
  res.json({
    todayMeasurements: today,
    totalMembers: total,
    weekMeasurements: week,
    apiConfigured: !!(INBODY_ACCOUNT && INBODY_API_KEY),
  });
});

// ─── GET /api/events ─────────────────────────────────────────────────────────
app.get("/api/events", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const db = await getPool();
  const [rows] = await db.execute(
    `SELECT id, user_id, equip, test_at, is_temp, fetch_status, received_at FROM webhook_events
     ORDER BY received_at DESC LIMIT ${limit}`,
  );
  res.json(rows);
});

// ─── GET /api/members/:userId/history ────────────────────────────────────────
app.get("/api/members/:userId/history", async (req, res) => {
  const db = await getPool();
  const [rows] = await db.execute(
    `SELECT id, test_at, equip, is_temp, fetch_status, inbody_data, received_at
     FROM webhook_events WHERE user_id = ? ORDER BY test_at DESC LIMIT 50`,
    [req.params.userId],
  );
  res.json(rows);
});

// ─── GET /api/members/:userId/inbody ─────────────────────────────────────────
// Fetch latest InBody data directly from InBody API (not from DB)
app.get("/api/members/:userId/inbody", async (req, res) => {
  if (!INBODY_ACCOUNT || !INBODY_API_KEY)
    return res.status(503).json({ error: "API not configured" });
  try {
    // 1. Get datetime list
    const dtRes = await inbody.post("/InBody/GetDatetimesByID", {
      UserID: req.params.userId,
    });
    const datetimes = Array.isArray(dtRes.data)
      ? dtRes.data
      : (dtRes.data?.datetimes ?? []);
    if (!datetimes.length) return res.json([]);

    // 2. Fetch last 10 measurements
    const toFetch = [...datetimes].reverse().slice(-10);
    const results = [];
    for (const dt of toFetch) {
      try {
        const r = await inbody.post("/InBody/GetInBodyDataByID", {
          UserID: req.params.userId,
          Datetimes: String(dt),
        });
        results.push({ datetimes: dt, ...r.data });
      } catch {
        /* skip */
      }
    }
    res.json(results);
  } catch (err) {
    res
      .status(err.response?.status || 500)
      .json({ error: err.response?.data?.errorCode || err.message });
  }
});

// ─── GET/POST /api/members/:userId/notes ─────────────────────────────────────
app.get("/api/members/:userId/notes", async (req, res) => {
  const db = await getPool();
  const [rows] = await db.execute(
    `SELECT id, note, created_at FROM member_notes WHERE user_id = ? ORDER BY created_at DESC`,
    [req.params.userId],
  );
  res.json(rows);
});

app.post("/api/members/:userId/notes", async (req, res) => {
  const { note } = req.body;
  if (!note?.trim()) return res.status(400).json({ error: "note is required" });
  const db = await getPool();
  const [result] = await db.execute(
    `INSERT INTO member_notes (user_id, note) VALUES (?, ?)`,
    [req.params.userId, note.trim()],
  );
  res.json({
    id: result.insertId,
    user_id: req.params.userId,
    note: note.trim(),
    created_at: new Date(),
  });
});

app.delete("/api/members/:userId/notes/:id", async (req, res) => {
  const db = await getPool();
  await db.execute(`DELETE FROM member_notes WHERE id = ? AND user_id = ?`, [
    req.params.id,
    req.params.userId,
  ]);
  res.json({ deleted: true });
});

// ─── POST /api/test-webhook ───────────────────────────────────────────────────
app.post("/api/test-webhook", async (req, res) => {
  const ts = new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);
  req.body = {
    EquipSerial: "CC71700163",
    TelHP: "01012344733",
    UserID: req.body?.userID || "testuser001",
    TestDatetimes: req.body?.testDatetimes || ts,
    Account: INBODY_ACCOUNT || "demo",
    Equip: "InBody770",
    Type: "InBody",
    IsTempData: "false",
  };
  // Reuse webhook handler
  const mockRes = { status: () => mockRes, json: () => {} };
  app._router.handle(
    { ...req, url: "/webhook", path: "/webhook" },
    mockRes,
    () => {},
  );

  // Simpler: just insert directly
  const p = req.body;
  const db = await getPool();
  const [result] = await db.execute(
    `INSERT INTO webhook_events (user_id, user_token, equip, equip_serial, test_at, account, is_temp, fetch_status)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      p.UserID,
      p.TelHP,
      p.Equip,
      p.EquipSerial,
      p.TestDatetimes,
      p.Account,
      INBODY_ACCOUNT && INBODY_API_KEY ? "pending" : "skipped_no_config",
    ],
  );
  const eventId = result.insertId;
  if (INBODY_ACCOUNT && INBODY_API_KEY)
    fetchAndStore(eventId, p.UserID, p.TestDatetimes, db);
  res.json({ message: "Test event injected", eventId });
});

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await getPool(); // test DB connection + init schema
    app.listen(PORT, () => {
      console.log("────────────────────────────────────────────");
      console.log(`  InBody Fitness CRM`);
      console.log(`  Dashboard : http://localhost:${PORT}/`);
      console.log(`  Webhook   : POST http://localhost:${PORT}/webhook`);
      console.log(
        `  API ready : ${INBODY_ACCOUNT && INBODY_API_KEY ? "Yes" : "No (set INBODY_ACCOUNT + INBODY_API_KEY)"}`,
      );
      console.log("────────────────────────────────────────────");
    });
  } catch (err) {
    console.error("Failed to connect to database:", err.message);
    console.error("Check DB_HOST, DB_USER, DB_PASSWORD, DB_NAME in .env");
    process.exit(1);
  }
}

start();
