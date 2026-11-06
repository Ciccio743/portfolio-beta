// Relais de cours pour l'appli Portfolio (Cloudflare Worker, gratuit).
// Routes :
//   /search?q=FR0011550185      -> recherche par ISIN, nom ou ticker (Yahoo Finance)
//   /quote?s=ESE.PA,PAEEM.PA    -> cours en euros + variation du jour
//   /fh/quote?symbol=AAPL       -> Finnhub avec la clé cachée (variable FINNHUB_KEY)
// Optionnel : variable ALLOWED_ORIGIN (ex. https://ciccio743.github.io) pour n'accepter que tes applis.

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const TYPES = { EQUITY: "Action", ETF: "ETF", MUTUALFUND: "Fonds", INDEX: "Indice" };

function cors(env, req) {
  const o = req.headers.get("Origin") || "";
  const allow = env.ALLOWED_ORIGIN ? (env.ALLOWED_ORIGIN.split(",").map(s => s.trim()).includes(o) ? o : "null") : "*";
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Methods": "GET, OPTIONS", "Vary": "Origin" };
}
const json = (data, h, ttl = 60) => new Response(JSON.stringify(data), { headers: { ...h, "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` } });

async function yget(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" }, cf: { cacheTtl: 60, cacheEverything: true } });
  if (!r.ok) throw new Error("yahoo " + r.status);
  return r.json();
}

async function chart(sym) {
  const j = await yget(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`);
  const m = j?.chart?.result?.[0]?.meta;
  if (!m || !(m.regularMarketPrice > 0)) return null;
  const prev = m.chartPreviousClose || m.previousClose;
  return { px: m.regularMarketPrice, cur: m.currency || "EUR", chg: prev > 0 ? m.regularMarketPrice / prev - 1 : null, name: m.longName || m.shortName || null };
}

const fxCache = {};
async function toEur(cur) {
  if (!cur || cur === "EUR") return 1;
  if (cur === "GBp" || cur === "GBX") return (await toEur("GBP")) / 100;
  if (cur === "ZAc") return (await toEur("ZAR")) / 100;
  if (fxCache[cur]) return fxCache[cur];
  const c = await chart(`${cur}EUR=X`);
  return (fxCache[cur] = c?.px || null);
}

async function search(q) {
  const j = await yget(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&lang=fr-FR&region=FR`);
  return (j.quotes || []).filter(x => x.symbol && TYPES[x.quoteType]).map(x => ({
    symbol: x.symbol, name: x.longname || x.shortname || x.symbol, type: TYPES[x.quoteType], exch: x.exchDisp || x.exchange || ""
  }));
}

export default {
  async fetch(req, env) {
    const h = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { headers: h });
    if (h["Access-Control-Allow-Origin"] === "null") return json({ error: "origine refusée" }, h, 0);
    const u = new URL(req.url);
    try {
      if (u.pathname === "/search") {
        const q = (u.searchParams.get("q") || "").trim();
        if (q.length < 2) return json([], h);
        return json(await search(q), h, 3600);
      }
      if (u.pathname === "/quote") {
        const syms = [...new Set((u.searchParams.get("s") || "").split(",").map(s => s.trim()).filter(Boolean))].slice(0, 60);
        const out = {};
        await Promise.all(syms.map(async s => {
          try {
            const c = await chart(s);
            if (!c) return;
            const r = await toEur(c.cur);
            if (r) out[s] = { eur: Math.round(c.px * r * 10000) / 10000, px: c.px, cur: c.cur, chg: c.chg };
          } catch (_) {}
        }));
        return json(out, h, 60);
      }
      if (u.pathname.startsWith("/fh/")) {
        if (!env.FINNHUB_KEY) return json({ error: "FINNHUB_KEY manquante" }, h, 0);
        const p = new URLSearchParams(u.search); p.delete("token"); p.set("token", env.FINNHUB_KEY);
        const r = await fetch(`https://finnhub.io/api/v1/${u.pathname.slice(4)}?${p}`, { cf: { cacheTtl: 60, cacheEverything: true } });
        return new Response(r.body, { status: r.status, headers: { ...h, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } });
      }
      return json({ ok: true, routes: ["/search?q=", "/quote?s=", "/fh/..."] }, h, 0);
    } catch (e) {
      return json({ error: String(e.message || e) }, h, 0);
    }
  }
};
