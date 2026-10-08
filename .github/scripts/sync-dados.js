const fs = require("fs");
const TOKEN = process.env.GH_TOKEN;
const FILE = "index.html";
const CARD_KEYS = ["hojeManual", "hoje", "proximos", "vencendo", "atrasados", "novidades"];

function extrairIssueInfo(url) {
  if (!url) return null;
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: m[3] };
}

async function issueFechada(url, cache) {
  const info = extrairIssueInfo(url);
  if (!info) return null;
  const key = `${info.owner}/${info.repo}#${info.number}`;
  if (cache.has(key)) return cache.get(key);
  const api = `https://api.github.com/repos/${info.owner}/${info.repo}/issues/${info.number}`;
  const resp = await fetch(api, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "daily-joao-theo-sync" },
  });
  if (!resp.ok) { cache.set(key, null); return null; }
  const data = await resp.json();
  const fechada = data.state === "closed";
  cache.set(key, fechada);
  return fechada;
}

function hojeFmt() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
}

function extrairDados(html) {
  const start = html.indexOf("const DADOS = {");
  if (start === -1) throw new Error("DADOS nao encontrado");
  let depth = 0, i = start + "const DADOS = ".length;
  for (; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return { data: JSON.parse(html.slice(start + "const DADOS = ".length, i)), start, end: i };
}

function reinserirDados(html, start, end, data) {
  return html.slice(0, start) + "const DADOS = " + JSON.stringify(data, null, 1) + ";" + html.slice(end);
}

async function main() {
  if (!TOKEN) { console.log("sem GH_TOKEN, abortando"); return; }
  const html = fs.readFileSync(FILE, "utf8");
  const { data, start, end } = extrairDados(html);
  const cache = new Map();
  let mudou = false;
  const feitoNovos = [];
  const feitoExistentesUrls = new Set((data.feito || []).map(f => f.u));

  for (const key of CARD_KEYS) {
    const lista = data[key];
    if (!Array.isArray(lista) || !lista.length) continue;
    const mantidos = [];
    for (const item of lista) {
      const fechada = item.u ? await issueFechada(item.u, cache) : null;
      if (fechada && !feitoExistentesUrls.has(item.u)) {
        feitoNovos.push({ d: hojeFmt(), t: item.t, c: item.c || "", u: item.u || "" });
        feitoExistentesUrls.add(item.u);
        mudou = true;
      } else { mantidos.push(item); }
    }
    data[key] = mantidos;
  }

  if (!mudou) { console.log("nada fechou, sem mudancas"); return; }
  data.feito = [...feitoNovos, ...(data.feito || [])];
  fs.writeFileSync(FILE, reinserirDados(html, start, end, data), "utf8");
  console.log(`sincronizado: ${feitoNovos.length} item(ns) movido(s) pra feito`);
}
main().catch(e => { console.error(e); process.exit(1); });
