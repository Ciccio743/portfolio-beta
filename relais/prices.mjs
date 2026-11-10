// Récupère les cours des ETF européens (Yahoo, côté serveur) et écrit prices.json
import fs from "node:fs";
const list = JSON.parse(fs.readFileSync(new URL("./isins.json", import.meta.url)));
const UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function j(u) { for (let k = 0; k < 3; k++) { try { const r = await fetch(u, { headers: UA }); if (r.ok) return await r.json(); } catch (e) {} await sleep(800 * (k + 1)); } return null; }
async function chart(sym) {
  const d = await j(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`);
  const m = d?.chart?.result?.[0]?.meta; if (!m || !(m.regularMarketPrice > 0)) return null;
  return { px: m.regularMarketPrice, prev: m.chartPreviousClose || m.previousClose || null, cur: m.currency || "EUR", t: m.regularMarketTime || 0 };
}
const EX = [".PA", ".AS", ".DE", ".MI", ".BR", ".L"];
async function resolve(isin) {
  const d = await j(`https://query2.finance.yahoo.com/v1/finance/search?q=${isin}&quotesCount=10&newsCount=0`);
  const qs = (d?.quotes || []).map(q => q.symbol).filter(Boolean);
  for (const e of EX) { const s = qs.find(x => x.endsWith(e)); if (s) return s; }
  return qs[0] || null;
}
const fx = { EUR: 1 };
async function rate(cur) {
  if (cur === "GBp") return (await rate("GBP")) / 100;
  if (fx[cur] != null) return fx[cur];
  const c = await chart(`${cur}EUR=X`); fx[cur] = c ? c.px : null; return fx[cur];
}
const out = { updated: new Date().toISOString(), prices: {} };
for (const it of list) {
  let sym = it.yahoo, c = sym ? await chart(sym) : null;
  if (!c) { sym = await resolve(it.isin); c = sym ? await chart(sym) : null; }
  if (!c) { console.log("✗", it.isin, it.ticker); continue; }
  const r = await rate(c.cur); if (!r) { console.log("✗ fx", c.cur); continue; }
  const px = +(c.px * r).toFixed(4), prev = c.prev ? +(c.prev * r).toFixed(4) : null;
  out.prices[it.isin] = { sym, ticker: it.ticker, px, prev, ch: prev ? +((px / prev - 1) * 100).toFixed(2) : null, cur: "EUR", t: c.t };
  console.log("✓", it.isin, sym, px);
  await sleep(250);
}
fs.writeFileSync("prices.json", JSON.stringify(out));
console.log(Object.keys(out.prices).length, "/", list.length);
if (!Object.keys(out.prices).length) process.exit(1);
