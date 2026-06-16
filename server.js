import express from "express";
import cors from "cors";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

const API = "https://openapiv1.coinstats.app";
const KEY = () => ({ "X-API-KEY": process.env.COINSTATS_API_KEY });

// ─── Helper: proxy a CoinStats endpoint ─────────────────────────
async function proxy(endpoint, res) {
  const resp = await fetch(`${API}${endpoint}`, { headers: KEY() });
  if (!resp.ok) throw new Error(`CoinStats returned ${resp.status}`);
  return await resp.json();
}

// ─── Coin search / list ─────────────────────────────────────────
app.get("/api/coins", async (req, res) => {
  try {
    const { name } = req.query;
    const path = name
      ? `/coins?limit=10&name=${encodeURIComponent(name)}`
      : `/coins?limit=20`;
    res.json(await proxy(path, res));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Single coin data ───────────────────────────────────────────
app.get("/api/coin/:coinId", async (req, res) => {
  try {
    res.json(await proxy(`/coins/${req.params.coinId}`, res));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Price chart ────────────────────────────────────────────────
app.get("/api/chart/:coinId", async (req, res) => {
  try {
    const period = req.query.period || "1w";
    res.json(await proxy(`/coins/${req.params.coinId}/charts?period=${period}`, res));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── News feed ──────────────────────────────────────────────────
app.get("/api/news", async (req, res) => {
  try {
    res.json(await proxy(`/news?limit=5`, res));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Fear & Greed index ─────────────────────────────────────────
app.get("/api/fear-greed", async (req, res) => {
  try {
    res.json(await proxy(`/markets/fear-greed`, res));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Global market cap ──────────────────────────────────────────
app.get("/api/market-cap", async (req, res) => {
  try {
    res.json(await proxy(`/markets`, res));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Serve frontend ─────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  ⚡ coinbrief running at http://localhost:${PORT}\n`);
});
