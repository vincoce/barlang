window.App = (() => {
  const USER_KEY = "qaUser_v1";
  const PROGRESS_KEY = "qaProgress_v1";
  const MASTERY_PCT = 90;

  function loadUserQA(){
    try { return JSON.parse(localStorage.getItem(USER_KEY) || "[]"); }
    catch { return []; }
  }
  function saveUserQA(arr){
    localStorage.setItem(USER_KEY, JSON.stringify(arr || []));
  }
  function upsertUserItem(item){
    const all = loadUserQA();
    const idx = all.findIndex(x => x.id === item.id);
    if (idx >= 0) all[idx] = item;
    else all.push(item);
    saveUserQA(all);
  }
  function deleteUserItem(id){
    const all = loadUserQA().filter(x => x.id !== id);
    saveUserQA(all);
  }

  function getQA(){
    const defaults = (window.QA || []).slice();
    const user = loadUserQA();
    const map = new Map();
    for (const q of defaults) map.set(q.id, q);
    for (const q of user) map.set(q.id, q); // override defaults
    return Array.from(map.values());
  }

  function loadProgress(){
    try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}"); }
    catch { return {}; }
  }
  function saveProgress(progress){
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress || {}));
  }

  function normalizeText(s, stripAccents=true){
    let x = String(s || "").toLowerCase();
    if (stripAccents){
      x = x.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }
    x = x.replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
    return x;
  }

  function uniqueTags(QA){
    const set = new Set();
    for (const q of QA){
      for (const t of (q.tags || [])) set.add(t);
    }
    return Array.from(set).sort((a,b)=>a.localeCompare(b,"hu"));
  }

  function shuffle(arr){
    const a = arr.slice();
    for (let i=a.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [a[i],a[j]] = [a[j],a[i]];
    }
    return a;
  }

  function exportText(list, ordered=true){
    const arr = ordered
      ? list.slice().sort((a,b)=>(a.id||"").localeCompare(b.id||"","hu"))
      : shuffle(list);

    return arr.map(x => `${x.id} ${x.q}\n${x.a}\n`).join("\n");
  }

  function keywordList(item){
    // keywords can be: "text" OR ["syn1","syn2"]
    const kws = item.keywords || [];
    const out = [];
    for (const kw of kws){
      if (Array.isArray(kw)) out.push(kw.map(x => String(x)));
      else out.push(String(kw));
    }
    return out;
  }

  function scoreAnswer(item, userText, opts){
    const wholeWord = !!opts?.wholeWord;
    const stripAccents = opts?.stripAccents !== false;

    const user = normalizeText(userText, stripAccents);
    const found = [];
    const missing = [];

    const kws = keywordList(item);

    function hasWord(hay, needle){
      const n = normalizeText(needle, stripAccents);
      if (!n) return false;
      if (!wholeWord) return hay.includes(n);
      const re = new RegExp(`(^|\\s)${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "i");
      return re.test(hay);
    }

    for (const kw of kws){
      if (Array.isArray(kw)){
        const ok = kw.some(s => hasWord(user, s));
        (ok ? found : missing).push(kw[0]);
      } else {
        const ok = hasWord(user, kw);
        (ok ? found : missing).push(kw);
      }
    }

    const total = kws.length;
    const got = found.length;
    const pct = total ? Math.round((got/total)*100) : 0;

    return { found, missing, total, got, pct };
  }

  function updateProgress(progress, id, score){
    const rec = progress[id] || { attempts:0, bestPct:0, mastered:false, lastPct:null, lastMissing:[] };
    rec.attempts += 1;
    rec.lastPct = score.pct;
    rec.lastMissing = score.missing.slice();
    rec.bestPct = Math.max(rec.bestPct || 0, score.pct);
    rec.mastered = rec.bestPct >= MASTERY_PCT;
    progress[id] = rec;
    saveProgress(progress);
  }

  function computeWeight(progress, id){
    const rec = progress[id];
    if (!rec) return 5;                 // new => high chance
    if (rec.mastered) return 1;         // mastered => low chance
    const miss = (rec.lastMissing || []).length;
    const last = rec.lastPct ?? 0;
    return 2 + miss + (MASTERY_PCT - last)/10;
  }

  function weightedPick(items, weightFn){
    const weights = items.map(x => Math.max(0.0001, weightFn(x)));
    const sum = weights.reduce((a,b)=>a+b,0);
    let r = Math.random()*sum;
    for (let i=0;i<items.length;i++){
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length-1];
  }

  // ---- ID helpers ----
  function parseId(id){
    const m = String(id || "").trim().match(/^(.+\/)(\d+)$/);
    if (!m) return null;
    return { prefix: m[1], num: parseInt(m[2], 10), rawNum: m[2] };
  }

  function nextId(prefix, qaAll, padWidth=0){
    const ids = (qaAll || []).map(x => x.id).filter(Boolean);
    let max = 0;
    for (const id of ids){
      const p = parseId(id);
      if (p && p.prefix === prefix) max = Math.max(max, p.num);
    }
    const next = max + 1;
    const numStr = padWidth > 0 ? String(next).padStart(padWidth, "0") : String(next);
    return `${prefix}${numStr}`;
  }

  // ---- Bulk parse (supports standalone II: lines) ----
  function bulkParseQA(text, defaultPrefix="III/", padWidth=0){
    const raw = (text || "").replace(/\r/g, "");
    const lines = raw.split("\n");

    const sectionOnlyRe = /^\s*(VIII|VII|VI|IV|V|III|II|I)\s*[:.]?\s*$/i;
    const headingRe = /^\s*(?:(VIII|VII|VI|IV|V|III|II|I)\b\s*[:.\-]?\s*)?(\d{1,3})\s*[.)-]\s*(.+?)\s*$/i;

    const items = [];
    let cur = null;
    let activePrefix = defaultPrefix;

    function pad(n){
      const s = String(n);
      return padWidth > 0 ? s.padStart(padWidth, "0") : s;
    }

    function pushCur(){
      if (!cur) return;
      cur.a = (cur.aLines.join("\n").trim());
      delete cur.aLines;
      items.push(cur);
    }

    for (const line of lines){
      const sec = line.match(sectionOnlyRe);
      if (sec){
        activePrefix = `${sec[1].toUpperCase()}/`;
        continue;
      }

      const m = line.match(headingRe);
      if (m){
        pushCur();

        const roman = m[1] ? m[1].toUpperCase() : null;
        const qNum = parseInt(m[2], 10);
        const qText = m[3].trim();

        const prefix = roman ? `${roman}/` : activePrefix;
        const id = `${prefix}${pad(qNum)}`;

        cur = { id, q: qText, aLines: [], tags: [prefix.replace("/","")] };
        continue;
      }

      if (cur) cur.aLines.push(line);
    }

    pushCur();
    return items.filter(x => x.q && x.q.trim().length);
  }

  function suggestKeywords(answer, max=10){
  const stop = new Set([
    "a","az","és","vagy","hogy","mint","mely","melyik","melyek","mi","mit","is","van","volt",
    "nem","igen","egy","két","ket","három","harom","négy","negy","öt","ot","hat","hét","het",
    "min","max","kb","pl","például","peldaul","illetékes","illetve","szerint",
    "alapján","alapjan","során","soran","kell","lehet","szabad","tilos","minden","olyan","ahol",
    "amikor","amely","amelyek","ua"
  ]);

  // 1) Tokenize from ORIGINAL (keep accents), but compute a normalized key for grouping
  const original = String(answer || "");

  // words (incl. accented letters), min 4 chars
  const rawTokens = original
    .toLowerCase()
    .match(/[\p{L}\p{N}]{4,}/gu) || [];

  // map: normalizedKey -> { bestForm: "őrszolgálat", score: number }
  const freq = new Map();

  function normKey(s){
    // normalize for grouping (strip accents + punctuation)
    return normalizeText(s, true);
  }

  function addToken(token, weight){
    const key = normKey(token);
    if (!key || stop.has(key)) return;

    const cur = freq.get(key) || { bestForm: token, score: 0 };

    // choose a nicer "bestForm":
    // prefer tokens that contain accents (more "Hungarian looking"),
    // and longer tokens over shorter
    const hasAccent = token.normalize("NFD").match(/[\u0300-\u036f]/);
    const curHasAccent = cur.bestForm.normalize("NFD").match(/[\u0300-\u036f]/);

    if ((hasAccent && !curHasAccent) || (token.length > cur.bestForm.length)){
      cur.bestForm = token;
    }

    cur.score += weight;
    freq.set(key, cur);
  }

  // unigram
  for (const t of rawTokens) addToken(t, 1);

  // 2) Bigrams: build from token list (still keep original forms)
  for (let i=0;i<rawTokens.length-1;i++){
    const a = rawTokens[i], b = rawTokens[i+1];
    const aKey = normKey(a), bKey = normKey(b);
    if (!aKey || !bKey) continue;
    if (stop.has(aKey) || stop.has(bKey)) continue;

    // store bigram under normalized key but keep accented display form
    const bigramForm = `${a} ${b}`;
    const bigramKey = `${aKey} ${bKey}`;
    const cur = freq.get(bigramKey) || { bestForm: bigramForm, score: 0 };
    // prefer accented/longer form
    const hasAccent = bigramForm.normalize("NFD").match(/[\u0300-\u036f]/);
    const curHasAccent = cur.bestForm.normalize("NFD").match(/[\u0300-\u036f]/);
    if ((hasAccent && !curHasAccent) || (bigramForm.length > cur.bestForm.length)){
      cur.bestForm = bigramForm;
    }
    cur.score += 0.7;
    freq.set(bigramKey, cur);
  }

  // 3) Sort by score, return bestForm (with accents)
  const sorted = Array.from(freq.values())
    .sort((x,y)=>y.score - x.score)
    .map(x=>x.bestForm);

  // 4) De-dupe similar suggestions
  const out = [];
  const seenKeys = new Set();
  for (const s of sorted){
    if (out.length >= max) break;
    const k = normKey(s);
    if (!k || seenKeys.has(k)) continue;
    // avoid near-duplicates (substring normalized)
    if (out.some(o => normKey(o).includes(k) || k.includes(normKey(o)))) continue;
    out.push(s);
    seenKeys.add(k);
  }

  return out;
}

  return {
    USER_KEY, PROGRESS_KEY,
    MASTERY_PCT,

    loadUserQA, saveUserQA, upsertUserItem, deleteUserItem,
    getQA,

    loadProgress, saveProgress,
    normalizeText, uniqueTags, shuffle, exportText,

    scoreAnswer, updateProgress, computeWeight, weightedPick,

    parseId, nextId, bulkParseQA, suggestKeywords,
  };
})();