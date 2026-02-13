window.App = (() => {
  const USER_KEY = "qaUser_v1";
  const PROGRESS_KEY = "qaProgress_v1";
  const MASTERY_PCT = 90;

const SRS = {
  // Box intervals (ms). Tune if you want.
  // 0 = new/unseen (due now)
  intervals: [
    0,                 // box0: immediate
    6 * 60 * 60 * 1000,  // box1: 6h
    1 * 24 * 60 * 60 * 1000, // box2: 1d
    3 * 24 * 60 * 60 * 1000, // box3: 3d
    7 * 24 * 60 * 60 * 1000, // box4: 7d
    14 * 24 * 60 * 60 * 1000 // box5: 14d
  ],
  maxBox: 5,
};

function srsEnsure(progress, id){
  const rec = progress[id] || (progress[id] = {});
  if (typeof rec.box !== "number") rec.box = 0;
  if (typeof rec.due !== "number") rec.due = 0; // due timestamp ms
  if (typeof rec.seen !== "number") rec.seen = 0;
  if (typeof rec.correctStreak !== "number") rec.correctStreak = 0;
  return rec;
};

function srsIsDue(progress, id, nowMs){
  const rec = progress[id];
  if (!rec) return true; // unseen = due
  const due = typeof rec.due === "number" ? rec.due : 0;
  return due <= (nowMs ?? Date.now());
};

function srsCounts(items, progress, nowMs){
  const now = nowMs ?? Date.now();
  let due = 0, newCount = 0;
  for (const it of items){
    const rec = progress[it.id];
    if (!rec) { newCount++; due++; continue; }
    if ((rec.due ?? 0) <= now) due++;
  }
  return { due, newCount, total: items.length };
};

// Call this after you compute a score result
function srsApplyResult(progress, id, isSuccess){
  const now = Date.now();
  const rec = srsEnsure(progress, id);

  rec.seen = (rec.seen || 0) + 1;

  if (isSuccess){
    rec.correctStreak = (rec.correctStreak || 0) + 1;
    rec.box = Math.min(SRS.maxBox, (rec.box ?? 0) + 1);
  } else {
    rec.correctStreak = 0;
    // Leitner style: drop back (tune: either -1 or to 0)
    rec.box = Math.max(0, (rec.box ?? 0) - 1);
  }

  const interval = SRS.intervals[rec.box] ?? 0;
  rec.due = now + interval;

  return rec;
};

// Pick next item: due first; among due, prefer lower boxes and recently failed.
function pickNextSrs(items, progress){
  const now = Date.now();
  if (!items.length) return null;

  const due = [];
  const notDue = [];

  for (const it of items){
    if (srsIsDue(progress, it.id, now)) due.push(it);
    else notDue.push(it);
  }

  const pool = due.length ? due : items; // if nothing due, allow anything

  // Weighting: lower box => higher weight; more misses => higher weight
  const weighted = pool.map(it => {
    const rec = progress[it.id] || {};
    const box = typeof rec.box === "number" ? rec.box : 0;
    const lastPct = rec.lastPct ?? 0;
    const lastMissing = (rec.lastMissing || []).length;

    // weight formula (simple + effective)
    let w = 1;
    w += (SRS.maxBox - box) * 2;
    if (lastPct < (MASTERY_PCT ?? 80)) w += 2;
    w += Math.min(5, lastMissing);

    return { it, w };
  });

  const totalW = weighted.reduce((s,x)=>s+x.w,0);
  let r = Math.random() * totalW;
  for (const x of weighted){
    r -= x.w;
    if (r <= 0) return x.it;
  }
  return weighted[weighted.length - 1].it;
};


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

  function bulkParseQA(text, defaultPrefix, pad){
  const raw = String(text || "").replace(/\r/g, "");
  const lines = raw.split("\n");

  // Section header: "I." or "II:" or "III :" etc.
  const sectionHeaderRe = /^\s*([IVXLCDM]{1,10})\s*([.:])\s*$/i;

  // Question start: "4. Kérdés" or "4.Kérdés" or "4) Kérdés"
  const qStartRe = /^\s*(\d{1,4})\s*[.)]\s*(.+?)\s*$/;

  const items = [];
  let currentPrefix = (defaultPrefix || "III/").toUpperCase();
  let current = null;

  function padNum(n){
    const p = parseInt(pad, 10) || 0;
    if (p <= 0) return String(n);
    return String(n).padStart(p, "0");
  }

  function flush(){
    if (!current) return;

    current.q = (current.q || "").trim();
    current.a = (current.aLines || []).join("\n").trim();
    delete current.aLines;

    if (current.q){
      // Ensure section tag exists
      const sec = currentPrefix.replace("/", "");
      current.tags = Array.isArray(current.tags) ? current.tags : [];
      if (!current.tags.includes(sec)) current.tags.unshift(sec);

      if (!current.keywords) current.keywords = [];

      items.push(current);
    }
    current = null;
  }

  for (let i = 0; i < lines.length; i++){
    const line = lines[i];

    // SECTION change (I. / II: / III:)
    const secM = line.match(sectionHeaderRe);
    if (secM){
      flush();
      const roman = secM[1].toUpperCase();
      currentPrefix = roman + "/";
      continue;
    }

    // QUESTION start
    const qm = line.match(qStartRe);
    if (qm){
      flush();

      const qNr = parseInt(qm[1], 10);
      const qText = qm[2].trim();

      current = {
        // IMPORTANT: ID from source number, not nextId()
        id: `${currentPrefix}${padNum(qNr)}`,
        tags: [currentPrefix.replace("/", "")],
        q: qText,
        aLines: [],
        keywords: []
      };
      continue;
    }

    // ANSWER lines (multi-line, until next question/section)
    if (current){
      // ignore leading empty lines, keep the rest as-is
      if (current.aLines.length === 0 && !line.trim()) continue;
      current.aLines.push(line.replace(/\s+$/,""));
    }
  }

  flush();
  return items;
};

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


function toKeywordSet(item){
  const set = new Set();
  const kws = item.keywords || [];
  for (const kw of kws){
    const base = Array.isArray(kw) ? kw[0] : kw;
    const k = normalizeText(base, true);
    if (k) set.add(k);
  }
  return set;
}

function jaccard(aSet, bSet){
  if (!aSet.size && !bSet.size) return 0;
  let inter = 0;
  for (const x of aSet) if (bSet.has(x)) inter++;
  const union = aSet.size + bSet.size - inter;
  return union ? inter / union : 0;
}

function char3grams(s){
  const x = normalizeText(s, true).replace(/\s+/g," ");
  const grams = new Set();
  if (x.length < 3) return grams;
  for (let i=0;i<x.length-2;i++){
    grams.add(x.slice(i,i+3));
  }
  return grams;
}

function combinedSimilarity(aItem, bItem){
  // 1) keyword overlap (strong)
  const aK = toKeywordSet(aItem);
  const bK = toKeywordSet(bItem);
  const kwSim = jaccard(aK, bK);

  // 2) answer text similarity (fallback/extra)
  const aG = char3grams(aItem.a || "");
  const bG = char3grams(bItem.a || "");
  const txtSim = jaccard(aG, bG);

  // Weighted combo: keywords dominate if present
  const hasKw = aK.size > 0 && bK.size > 0;
  return hasKw ? (0.75 * kwSim + 0.25 * txtSim) : txtSim;
}

/**
 * Pick distractors for item:
 * difficulty:
 *  - "easy": random from section
 *  - "hard": highest similarity (most confusable)
 *  - "mixed": half hard + half random
 */
function pickDistractors(item, candidates, count, difficulty="hard"){
  const pool = candidates.filter(x => x.id !== item.id);

  if (difficulty === "easy"){
    return shuffle(pool).slice(0, count);
  }

  if (difficulty === "hard"){
    const scored = pool
      .map(x => ({ x, s: combinedSimilarity(item, x) }))
      .sort((a,b)=> b.s - a.s);

    // take top N*3, then shuffle a bit to avoid always same
    const top = scored.slice(0, Math.max(count * 3, count)).map(z=>z.x);
    return shuffle(top).slice(0, count);
  }

  // mixed
  const hardN = Math.ceil(count / 2);
  const easyN = count - hardN;
  const hard = pickDistractors(item, pool, hardN, "hard");
  const hardIds = new Set(hard.map(x=>x.id));
  const rest = pool.filter(x=>!hardIds.has(x.id));
  const easy = shuffle(rest).slice(0, easyN);
  return shuffle(hard.concat(easy)).slice(0, count);
}

function autoKeywordsFromAnswer(answer, max=10){
  // Uses your existing suggestKeywords() (accent-preserving)
  const sugg = suggestKeywords(answer, max);

  // Convert into keywords format:
  // keywords can be string OR array of synonyms; we store strings by default.
  // (You can later edit to add synonyms with | in admin.)
  return (sugg || []).map(s => String(s).trim()).filter(Boolean);
}

    return {
		autoKeywordsFromAnswer,
		pickDistractors,
    USER_KEY, PROGRESS_KEY,
    MASTERY_PCT,

    loadUserQA, saveUserQA, upsertUserItem, deleteUserItem,
    getQA,

    loadProgress, saveProgress,
    normalizeText, uniqueTags, shuffle, exportText,

    scoreAnswer, updateProgress, computeWeight, weightedPick,

    parseId, nextId, bulkParseQA, suggestKeywords,

    // ===== SRS exports (ADD) =====
    SRS,                 // optional but handy
    srsEnsure,           // optional
    srsIsDue,
    srsCounts,
    srsApplyResult,
    pickNextSrs,
  };
})();