// ══════════════════════════════════════════════════════════════════
// coinbrief — AI-free intelligence briefing engine
// All analysis is computed from CoinStats API data using JS logic.
// No external AI API needed.
// ══════════════════════════════════════════════════════════════════

const $ = (sel) => document.querySelector(sel);
const API = window.location.origin;

let currentCoin = null;
let searchTimeout = null;

const searchInput = $("#searchInput");
const searchResults = $("#searchResults");
const searchSpinner = $("#searchSpinner");
const hero = $("#hero");
const loadingState = $("#loadingState");
const briefingWrap = $("#briefingWrap");

// ── Search ──────────────────────────────────────────────────────
searchInput.addEventListener("input", (e) => {
  clearTimeout(searchTimeout);
  const q = e.target.value.trim();
  if (q.length < 2) { searchResults.classList.remove("active"); return; }
  searchTimeout = setTimeout(() => searchCoins(q), 300);
});
searchInput.addEventListener("focus", () => {
  if (searchResults.children.length) searchResults.classList.add("active");
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) searchResults.classList.remove("active");
});

async function searchCoins(query) {
  searchSpinner.classList.add("active");
  try {
    const r = await fetch(`${API}/api/coins?name=${encodeURIComponent(query)}`);
    const d = await r.json();
    renderSearchResults(d.result || []);
  } catch (err) { console.error(err); }
  searchSpinner.classList.remove("active");
}

function renderSearchResults(coins) {
  if (!coins.length) {
    searchResults.innerHTML = `<div class="search-result-item"><span class="search-result-name" style="color:var(--text-muted)">No coins found</span></div>`;
    searchResults.classList.add("active");
    return;
  }
  searchResults.innerHTML = coins.slice(0, 8).map(c => `
    <div class="search-result-item" data-coin-id="${c.id}">
      <img src="${c.icon}" alt="${c.name}" onerror="this.style.display='none'" />
      <span class="search-result-name">${c.name}</span>
      <span class="search-result-symbol">${c.symbol}</span>
      <span class="search-result-rank">#${c.rank}</span>
    </div>`).join("");
  searchResults.classList.add("active");
  searchResults.querySelectorAll(".search-result-item").forEach(item => {
    item.addEventListener("click", () => {
      if (item.dataset.coinId) generateBriefing(item.dataset.coinId);
      searchResults.classList.remove("active");
      searchInput.value = "";
    });
  });
}

// ── Quick picks & buttons ───────────────────────────────────────
document.querySelectorAll(".quick-btn").forEach(btn => {
  btn.addEventListener("click", () => generateBriefing(btn.dataset.coin));
});
$("#backBtn").addEventListener("click", () => {
  briefingWrap.classList.remove("active");
  hero.style.display = "";
  loadingState.classList.remove("active");
  searchInput.focus();
});
$("#copyBtn").addEventListener("click", () => {
  const text = $(".briefing-card").innerText;
  navigator.clipboard.writeText(text).then(() => {
    const btn = $("#copyBtn span");
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = "Copy"), 2000);
  });
});
$("#refreshBtn").addEventListener("click", () => {
  if (currentCoin) generateBriefing(currentCoin);
});

// ══════════════════════════════════════════════════════════════════
// MAIN: Generate Briefing
// ══════════════════════════════════════════════════════════════════
async function generateBriefing(coinId) {
  currentCoin = coinId;
  hero.style.display = "none";
  briefingWrap.classList.remove("active");
  loadingState.classList.add("active");
  setStep(1);

  try {
    // Step 1: Fetch all data in parallel from CoinStats API
    const [coinResp, chartResp, newsResp, fgResp] = await Promise.all([
      fetch(`${API}/api/coin/${coinId}`),
      fetch(`${API}/api/chart/${coinId}?period=1w`),
      fetch(`${API}/api/news`),
      fetch(`${API}/api/fear-greed`).catch(() => null),
    ]);

    if (!coinResp.ok) throw new Error("Coin not found. Try a different coin.");

    const coinData = await coinResp.json();
    const chartData = await chartResp.json();
    const newsData = await newsResp.json();
    const fgData = fgResp && fgResp.ok ? await fgResp.json() : null;

    setStep(2);

    // Step 2: Compute signals
    const signals = computeSignals(coinData);
    const chartAnalysis = analyzeChart(chartData);
    const newsAnalysis = analyzeNews(newsData);
    const fearGreed = fgData?.now || fgData?.value || null;

    setStep(3);

    // Step 3: Generate briefing from signals (pure JS — no AI API)
    const briefing = buildBriefing(coinData, signals, chartAnalysis, newsAnalysis, fearGreed);

    renderBriefing(coinData, briefing, chartData);
    loadingState.classList.remove("active");
    briefingWrap.classList.add("active");
  } catch (err) {
    console.error("Briefing error:", err);
    loadingState.classList.remove("active");
    hero.style.display = "";
    showError(err.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// SIGNAL ENGINE — pre-processes raw CoinStats data into metrics
// ══════════════════════════════════════════════════════════════════

function computeSignals(coin) {
  const s = {};
  const h1 = coin.priceChange1h || 0;
  const d1 = coin.priceChange1d || 0;
  const w1 = coin.priceChange1w || 0;
  const m1 = coin.priceChange1m || 0;

  // Momentum (weighted multi-timeframe)
  const raw = h1 * 0.15 + d1 * 0.35 + w1 * 0.3 + m1 * 0.2;
  s.momentum = Math.round(Math.max(0, Math.min(100, 50 + raw * 2)));

  // Volume intensity (volume / market cap ratio)
  const vmc = coin.volume && coin.marketCap ? (coin.volume / coin.marketCap) * 100 : 0;
  s.volumeRatio = Math.round(vmc * 100) / 100;
  s.volumeLevel = vmc > 15 ? "extreme" : vmc > 8 ? "high" : vmc > 3 ? "normal" : "low";

  // Volatility (spread of timeframe changes)
  const changes = [h1, d1, w1, m1];
  s.volatility = Math.round((Math.max(...changes) - Math.min(...changes)) * 100) / 100;

  // Trend consistency
  const pos = changes.filter(v => v > 0).length;
  const neg = changes.filter(v => v < 0).length;
  s.trendAlign = pos === 4 ? "all-bull" : neg === 4 ? "all-bear" : pos >= 3 ? "mostly-bull" : neg >= 3 ? "mostly-bear" : "mixed";

  // Short vs long divergence
  s.divergence = Math.round(((h1 + d1) / 2 - (w1 + m1) / 2) * 100) / 100;

  // Market tier
  s.tier = coin.rank <= 5 ? "blue-chip" : coin.rank <= 20 ? "large" : coin.rank <= 50 ? "mid" : coin.rank <= 100 ? "small" : "micro";

  // Risk score (if available from CoinStats)
  s.risk = coin.riskScore ?? null;

  // Raw values
  s.h1 = h1; s.d1 = d1; s.w1 = w1; s.m1 = m1;

  return s;
}

function analyzeChart(chartData) {
  if (!chartData || !Array.isArray(chartData) || chartData.length < 2) {
    return { valid: false };
  }
  const prices = chartData.map(p => p[1] || p.price || 0).filter(Boolean);
  if (prices.length < 2) return { valid: false };

  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const start = prices[0];
  const end = prices[prices.length - 1];
  const mid = Math.floor(prices.length / 2);
  const firstAvg = prices.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
  const secondAvg = prices.slice(mid).reduce((a, b) => a + b, 0) / (prices.length - mid);

  return {
    valid: true,
    high, low, start, end,
    range: Math.round((high - low) / low * 1000) / 10,
    change: Math.round((end - start) / start * 1000) / 10,
    trend: secondAvg > firstAvg * 1.01 ? "uptrend" : secondAvg < firstAvg * 0.99 ? "downtrend" : "sideways",
    points: prices.length,
  };
}

function analyzeNews(newsData) {
  const articles = newsData?.result || newsData || [];
  if (!Array.isArray(articles) || !articles.length) return { count: 0, headlines: [] };
  return {
    count: articles.length,
    headlines: articles.slice(0, 5).map(a => a.title || a.headline || ""),
  };
}

// ══════════════════════════════════════════════════════════════════
// BRIEFING ENGINE — generates structured analysis from signals
// No external AI. Pure data-driven logic.
// ══════════════════════════════════════════════════════════════════

function buildBriefing(coin, sig, chart, news, fearGreed) {
  return {
    whatsHappening: buildWhatsHappening(coin, sig, chart),
    signals: buildSignals(coin, sig, chart, fearGreed),
    whatToWatch: buildWhatToWatch(coin, sig, chart),
    newsContext: buildNewsContext(news, coin),
    verdict: buildVerdict(sig, chart, fearGreed),
  };
}

function buildWhatsHappening(coin, sig, chart) {
  const name = coin.name;
  const sym = coin.symbol;
  const price = fmt(coin.price);

  // Price action sentence
  let action;
  if (Math.abs(sig.d1) < 0.5) {
    action = `${name} is trading flat at ${price}, with minimal movement over the past 24 hours.`;
  } else if (sig.d1 > 0) {
    action = `${name} is up ${sig.d1.toFixed(1)}% in the last 24 hours, currently trading at ${price}.`;
  } else {
    action = `${name} has dropped ${Math.abs(sig.d1).toFixed(1)}% in the last 24 hours to ${price}.`;
  }

  // Volume context
  let vol;
  if (sig.volumeLevel === "extreme") {
    vol = `Trading volume is extremely elevated at $${fmtCompact(coin.volume)} — ${sig.volumeRatio.toFixed(1)}% of market cap, suggesting major positioning activity.`;
  } else if (sig.volumeLevel === "high") {
    vol = `Volume is running above average at $${fmtCompact(coin.volume)}, indicating heightened trader interest.`;
  } else if (sig.volumeLevel === "low") {
    vol = `Volume is notably thin at $${fmtCompact(coin.volume)}, meaning the current move has weak conviction behind it.`;
  } else {
    vol = `Volume sits at $${fmtCompact(coin.volume)}, within the normal range for ${sym}.`;
  }

  // Trend context
  let trend = "";
  if (chart.valid) {
    if (chart.trend === "uptrend" && sig.d1 > 0) {
      trend = ` The 7-day chart shows a clear uptrend with a ${chart.change}% net gain.`;
    } else if (chart.trend === "downtrend" && sig.d1 < 0) {
      trend = ` The weekly chart confirms the bearish pressure, down ${Math.abs(chart.change)}% over 7 days.`;
    } else if (chart.trend === "sideways") {
      trend = ` The 7-day chart is largely range-bound, oscillating between $${fmtCompact(chart.low)} and $${fmtCompact(chart.high)}.`;
    } else if (chart.trend === "uptrend" && sig.d1 < 0) {
      trend = ` Despite today's pullback, the 7-day trend remains positive at +${chart.change}%.`;
    } else if (chart.trend === "downtrend" && sig.d1 > 0) {
      trend = ` Today's bounce is against the broader 7-day downtrend (${chart.change}% net).`;
    }
  }

  return action + " " + vol + trend;
}

function buildSignals(coin, sig, chart, fearGreed) {
  const signals = [];

  // Momentum signal
  if (sig.momentum >= 65) signals.push({ label: `Momentum ${sig.momentum}/100`, type: "bullish", detail: "Multi-timeframe momentum is positive" });
  else if (sig.momentum <= 35) signals.push({ label: `Momentum ${sig.momentum}/100`, type: "bearish", detail: "Multi-timeframe momentum is negative" });
  else signals.push({ label: `Momentum ${sig.momentum}/100`, type: "neutral", detail: "Momentum is flat — no strong directional bias" });

  // Trend alignment
  if (sig.trendAlign === "all-bull") signals.push({ label: "All timeframes green", type: "bullish" });
  else if (sig.trendAlign === "all-bear") signals.push({ label: "All timeframes red", type: "bearish" });
  else if (sig.trendAlign === "mixed") signals.push({ label: "Mixed signals across timeframes", type: "neutral" });

  // Volume
  if (sig.volumeLevel === "extreme" || sig.volumeLevel === "high") {
    signals.push({ label: `Volume ${sig.volumeRatio.toFixed(1)}% of mcap`, type: sig.d1 > 0 ? "bullish" : "bearish" });
  } else if (sig.volumeLevel === "low") {
    signals.push({ label: "Low volume", type: "bearish" });
  }

  // Divergence
  if (sig.divergence > 5) signals.push({ label: "Short-term accelerating", type: "bullish" });
  else if (sig.divergence < -5) signals.push({ label: "Short-term weakening", type: "bearish" });

  // 7d chart range
  if (chart.valid && chart.range > 20) {
    signals.push({ label: `${chart.range}% weekly range`, type: "neutral" });
  }

  // Fear & Greed
  if (fearGreed != null) {
    const fg = typeof fearGreed === "object" ? fearGreed.value : fearGreed;
    if (fg >= 75) signals.push({ label: `Market greed: ${fg}`, type: "bearish" });
    else if (fg <= 25) signals.push({ label: `Market fear: ${fg}`, type: "bullish" });
    else signals.push({ label: `Fear/greed: ${fg}`, type: "neutral" });
  }

  // Risk score
  if (sig.risk != null && sig.risk > 60) {
    signals.push({ label: `Risk score: ${sig.risk}`, type: "bearish" });
  }

  return signals.length ? signals : [{ label: "Insufficient data for signals", type: "neutral" }];
}

function buildWhatToWatch(coin, sig, chart) {
  const points = [];

  // Key levels
  if (chart.valid) {
    if (sig.d1 > 0) {
      points.push(`Watch the 7-day high of $${fmt(chart.high)} as resistance — a break above it could accelerate the move.`);
    } else {
      points.push(`The 7-day low of $${fmt(chart.low)} is the key support level — losing it would signal further downside.`);
    }
  }

  // Volume follow-through
  if (sig.volumeLevel === "high" || sig.volumeLevel === "extreme") {
    points.push(`Volume is elevated. If it sustains above average for the next 24h, this move has legs. If it dries up, expect a reversal.`);
  } else if (sig.volumeLevel === "low") {
    points.push(`Volume is weak. This move needs a volume pickup to be taken seriously — watch for a spike in the next session.`);
  }

  // Divergence warning
  if (sig.divergence > 5) {
    points.push(`Short-term price is running ahead of the longer trend. This kind of divergence often leads to a cooldown pullback within 48 hours.`);
  } else if (sig.divergence < -5) {
    points.push(`Short-term weakness is diverging from the longer trend. Watch whether the longer timeframe holds or the short-term drags it down.`);
  }

  // Monthly context
  if (Math.abs(sig.m1) > 20) {
    const dir = sig.m1 > 0 ? "gained" : "lost";
    points.push(`${coin.name} has ${dir} ${Math.abs(sig.m1).toFixed(1)}% over 30 days — a move of that magnitude often triggers a period of consolidation.`);
  }

  if (points.length === 0) {
    points.push(`No extreme signals detected. Monitor the 24h volume trend and whether ${coin.symbol} holds its current range.`);
  }

  return points.join(" ");
}

function buildNewsContext(news, coin) {
  if (!news.count) return `No recent news headlines found for the broader crypto market. Price action appears to be driven by technical flows rather than narrative.`;

  const headlineStr = news.headlines.filter(Boolean).slice(0, 3).join("; ");
  return `${news.count} recent headlines detected. Top stories: ${headlineStr}. Consider these for context, but note that news sentiment alone is not a trading signal.`;
}

function buildVerdict(sig, chart, fearGreed) {
  // Score: weighted combination of signals
  let score = sig.momentum; // base from momentum (0-100)

  // Adjust for trend consistency
  if (sig.trendAlign === "all-bull") score += 8;
  else if (sig.trendAlign === "all-bear") score -= 8;
  else if (sig.trendAlign === "mixed") score -= 2;

  // Adjust for volume conviction
  if (sig.volumeLevel === "extreme" || sig.volumeLevel === "high") {
    score += sig.d1 > 0 ? 5 : -5;
  } else if (sig.volumeLevel === "low") {
    score -= 3;
  }

  // Chart trend bonus
  if (chart.valid) {
    if (chart.trend === "uptrend") score += 4;
    else if (chart.trend === "downtrend") score -= 4;
  }

  // Fear & greed contrarian nudge
  if (fearGreed != null) {
    const fg = typeof fearGreed === "object" ? fearGreed.value : fearGreed;
    if (fg >= 80) score -= 3;
    else if (fg <= 20) score += 3;
  }

  score = Math.round(Math.max(0, Math.min(100, score)));

  // Label
  const label =
    score >= 70 ? "Strongly Bullish" :
    score >= 58 ? "Bullish" :
    score >= 42 ? "Neutral" :
    score >= 30 ? "Bearish" : "Strongly Bearish";

  // Summary
  let summary;
  if (score >= 65) {
    summary = `Multiple signals are aligned to the upside: momentum reads ${sig.momentum}/100 with ${sig.trendAlign === "all-bull" ? "all timeframes green" : "a positive tilt across timeframes"}. `;
    summary += sig.volumeLevel === "high" || sig.volumeLevel === "extreme"
      ? "Volume confirms the move, adding conviction."
      : "However, volume hasn't confirmed the move yet — watch for follow-through before adding exposure.";
  } else if (score <= 35) {
    summary = `Signals are skewed bearish: momentum at ${sig.momentum}/100 with ${sig.trendAlign === "all-bear" ? "all timeframes red" : "weakness across most timeframes"}. `;
    summary += sig.volumeLevel === "high" || sig.volumeLevel === "extreme"
      ? "Selling volume is elevated, suggesting active distribution."
      : "Low volume on the drop could mean this is a weak-hand shakeout rather than a real breakdown.";
  } else {
    summary = `The picture is mixed. Momentum reads ${sig.momentum}/100 — neither strongly bullish nor bearish. `;
    summary += `Timeframes are ${sig.trendAlign === "mixed" ? "pointing in different directions" : "mostly aligned but without strong conviction"}. `;
    summary += "This is a wait-and-see setup. Let the next 24h of data resolve the ambiguity before taking a position.";
  }

  return { score, label, summary };
}

// ══════════════════════════════════════════════════════════════════
// RENDER — displays the briefing card
// ══════════════════════════════════════════════════════════════════

function renderBriefing(coin, briefing, chartData) {
  $("#bCoinIcon").src = coin.icon || "";
  $("#bCoinIcon").alt = coin.name;
  $("#bCoinName").textContent = `${coin.name} intelligence briefing`;
  $("#bCoinMeta").textContent = `${coin.symbol} · Rank #${coin.rank} · Generated ${new Date().toLocaleString()}`;

  const price = coin.price || 0;
  $("#bPrice").textContent = fmt(price);
  const chg = coin.priceChange1d || 0;
  const chgEl = $("#bChange");
  chgEl.textContent = `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}% today`;
  chgEl.className = `b-change ${chg >= 0 ? "up" : "down"}`;

  const vol = coin.volume || 0;
  const mcap = coin.marketCap || 0;
  const w = coin.priceChange1w || 0;
  const m = coin.priceChange1m || 0;
  $("#bMetrics").innerHTML = `
    <div class="b-metric"><div class="b-metric-label">Market cap</div><div class="b-metric-val">$${fmtCompact(mcap)}</div></div>
    <div class="b-metric"><div class="b-metric-label">24h volume</div><div class="b-metric-val">$${fmtCompact(vol)}</div></div>
    <div class="b-metric"><div class="b-metric-label">7d change</div><div class="b-metric-val" style="color:${w >= 0 ? "var(--green)" : "var(--red)"}">${w.toFixed(1)}%</div></div>
    <div class="b-metric"><div class="b-metric-label">30d change</div><div class="b-metric-val" style="color:${m >= 0 ? "var(--green)" : "var(--red)"}">${m.toFixed(1)}%</div></div>`;

  renderSparkline(chartData);

  $("#bWhatsHappening").textContent = briefing.whatsHappening;
  $("#bWhatToWatch").textContent = briefing.whatToWatch;
  $("#bNewsContext").textContent = briefing.newsContext;

  $("#bSignals").innerHTML = briefing.signals
    .map(s => `<span class="signal-chip ${s.type}">${s.label}</span>`)
    .join("");

  const v = briefing.verdict;
  const gc = v.score >= 58 ? "bullish" : v.score <= 42 ? "bearish" : "neutral";
  $("#verdictGauge").className = `verdict-gauge ${gc}`;
  $("#verdictScore").textContent = v.score;
  $("#verdictLabel").textContent = v.label;
  $("#verdictText").textContent = v.summary;

  $("#bTimestamp").textContent = `Generated ${new Date().toLocaleTimeString()} · Data from CoinStats API`;
}

function renderSparkline(chartData) {
  const canvas = $("#sparkline");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 80 * dpr;
  canvas.style.width = rect.width + "px";
  canvas.style.height = "80px";
  ctx.scale(dpr, dpr);
  const w = rect.width, h = 80;

  if (!chartData || !Array.isArray(chartData) || chartData.length < 2) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--text-muted");
    ctx.font = "12px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Chart data unavailable", w / 2, h / 2);
    return;
  }

  const prices = chartData.map(p => p[1] || p.price || 0).filter(Boolean);
  if (prices.length < 2) return;
  const min = Math.min(...prices), max = Math.max(...prices), range = max - min || 1;
  const isUp = prices[prices.length - 1] >= prices[0];
  const color = isUp ? "#1b9e5e" : "#d63031";

  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  prices.forEach((p, i) => {
    const x = (i / (prices.length - 1)) * w;
    const y = h - 8 - ((p - min) / range) * (h - 16);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, isUp ? "rgba(27,158,94,0.12)" : "rgba(214,48,49,0.12)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fill();
}

// ── Formatting helpers ──────────────────────────────────────────
function fmt(n) {
  if (n >= 1) return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 0.01) return "$" + n.toFixed(4);
  return "$" + n.toFixed(8);
}
function fmtCompact(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(1) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(2);
}
function setStep(step) {
  for (let i = 1; i <= 3; i++) {
    $(`#step${i}`).className = i < step ? "step done" : i === step ? "step active" : "step";
  }
}
function showError(msg) {
  let el = $(".error-msg");
  if (!el) { el = document.createElement("div"); el.className = "error-msg"; hero.after(el); }
  el.textContent = msg;
  el.classList.add("active");
  setTimeout(() => el.classList.remove("active"), 5000);
}
