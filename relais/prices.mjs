// Récupère les cours des ETF européens côté serveur (plusieurs sources) et écrit prices.json
import fs from "node:fs";
const list = JSON.parse(fs.readFileSync(new URL("./isins.json", import.meta.url)));
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", "Accept": "application/json,text/plain,*/*", "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let dbg = 0;
async function get(u, type = "json") {
  try {
    const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(12000) });
    if (dbg < 12) { dbg++; console.log("  ", r.status, u.slice(0, 90)); }
    if (!r.ok) return null;
    return type === "json" ? await r.json() : await r.text();
  } catch (e) { if (dbg < 12) { dbg++; console.log("   ERR", e.message, u.slice(0, 90)); } return null; }
}
const num = v => (typeof v === "number" ? v : v?.raw);
// 1) justETF (prix déjà en EUR)
async function justetf(it) {
  const d = await get(`https://www.justetf.com/api/etfs/${it.isin}/quote?locale=fr&currency=EUR&isin=${it.isin}`);
  const px = num(d?.latestQuote), prev = num(d?.previousQuote);
  return px > 0 ? { px, prev: prev > 0 ? prev : null, cur: "EUR", src: "justetf" } : null;
}
// 2) Yahoo
async function ychart(sym) {
  for (const h of ["query1", "query2"]) {
    const d = await get(`https://${h}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`);
    const m = d?.chart?.result?.[0]?.meta;
    if (m?.regularMarketPrice > 0) return { px: m.regularMarketPrice, prev: m.chartPreviousClose || null, cur: m.currency || "EUR", src: "yahoo:" + sym };
  }
  return null;
}
// 3) Stooq (CSV)
async function stooq(it) {
  const ex = (it.yahoo || "").split(".")[1];
  const suf = { PA: "fr", DE: "de", AS: "nl", L: "uk" }[ex]; if (!suf) return null;
  const t = await get(`https://stooq.com/q/l/?s=${it.yahoo.split(".")[0].toLowerCase()}.${suf}&f=sd2t2ohlcv&h&e=csv`, "text");
  const row = t?.trim().split("\n")[1]?.split(","); const px = +row?.[6];
  return px > 0 ? { px, prev: +row[3] || null, cur: suf === "uk" ? "GBp" : "EUR", src: "stooq", noCh: true } : null;
}
const fx = { EUR: 1 };
async function rate(cur) {
  if (cur === "GBp") { const g = await rate("GBP"); return g ? g / 100 : null; }
  if (fx[cur] !== undefined) return fx[cur];
  const c = await ychart(`${cur}EUR=X`); fx[cur] = c ? c.px : null; return fx[cur];
}
const out = { updated: new Date().toISOString(), prices: {} };
for (const it of list) {
  let c = await justetf(it);
  if (!c && it.yahoo) c = await ychart(it.yahoo);
  if (!c) c = await stooq(it);
  if (!c) { console.log("✗", it.isin, it.ticker); continue; }
  const r = await rate(c.cur); if (!r) { console.log("✗ fx", c.cur); continue; }
  const px = +(c.px * r).toFixed(4), prev = c.prev && !c.noCh ? +(c.prev * r).toFixed(4) : null;
  out.prices[it.isin] = { ticker: it.ticker, px, prev, ch: prev ? +((px / prev - 1) * 100).toFixed(2) : null, cur: "EUR", src: c.src };
  console.log("✓", it.isin, it.ticker, px, c.src);
  await sleep(400);
}
fs.writeFileSync("prices.json", JSON.stringify(out));
console.log(Object.keys(out.prices).length, "/", list.length);
if (!Object.keys(out.prices).length) process.exit(1);
