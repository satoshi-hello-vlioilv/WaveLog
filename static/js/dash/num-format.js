/* 数の表示形式（版 3.43.0。Excel の「セルの書式設定 → 表示形式」と同じ書式コード）。ダッシュボードの数字・グラフの数値ラベルと目盛り・表で使う。
   読めるコード（Excel と同じ決まり。評価関数 tools/num-format-check.mjs が Excel の答えと突き合わせる）:
   - 区分は ; で 4 つまで: 正;負;0;文字。1 つなら全部（負は − を付ける）・2 つなら 0 以上;負・3 つなら 正;負;0。負の区分は − を付けない
   - [>=100] などの条件（区分の頭）。条件がある区分は、条件に当たれば使う（Excel と同じく上から）
   - [赤] [Red] [青] [Blue] [緑] [Green] [黄] [Yellow] [紫] [Magenta] [水] [Cyan] [黒] [Black] [白] [White]: その区分の字の色
   - 0（0 を埋める）・#（要らない 0 は出さない）・?（空白で桁をそろえる）・.（小数点）・,（桁区切り。数の欄の後ろに置くと 1,000 で割る）
   - %（100 倍して % を付ける）・E+00 E-00（指数）・"字" と \字（そのままの字）・_x（x の幅の空白）・*x（読み飛ばす）・@（文字の値）
   - General・G/標準・標準: 既定の形（要らない 0 を出さない）。日付・時刻のコード（yyyy・mm・dd・h・ss）は使えない（check が知らせる）
   読めない字（引用符で囲んでいない英字など）も、そのままの字として出す（check で知らせる）。 */
(function(){
  "use strict";
  const COLORS = {
    red: "#c62828", 赤: "#c62828", blue: "#1f5fbf", 青: "#1f5fbf", green: "#2e7d32", 緑: "#2e7d32", yellow: "#8a6d00", 黄: "#8a6d00",
    magenta: "#a3218e", 紫: "#a3218e", cyan: "#00838f", 水: "#00838f", black: "#1f2933", 黒: "#1f2933", white: "#ffffff", 白: "#ffffff",
  };
  const GENERAL = /^(general|g\/標準|標準)$/i;

  /** 区分に分ける（"…"・\x・[…] の中の ; は区切りでない） */
  function split(code) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (q) { cur += ch; if (ch === '"') q = false; continue; }
      if (ch === '"') { q = true; cur += ch; continue; }
      if (ch === "\\" || ch === "_" || ch === "*") { cur += ch + (code[i + 1] ?? ""); i++; continue; }
      if (ch === "[") { const j = code.indexOf("]", i); if (j > i) { cur += code.slice(i, j + 1); i = j; continue; } }
      if (ch === ";") { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.slice(0, 4);
  }

  /** 1 つの区分 → {cond, color, toks, text}。toks: {t: "lit"|"d"|"dot"|"pct"|"exp"|"at"|"gen", ...} */
  function section(src) {
    let s = src, cond = null, color = "";
    const warn = [];
    for (let m; (m = s.match(/^\s*\[([^\]]*)\]/));) {
      const b = m[1].trim(), c = b.match(/^(<=|>=|<>|<|>|=)\s*(-?[\d.]+(?:e[+-]?\d+)?)$/i);
      if (c) cond = { op: c[1], v: +c[2] };
      else if (COLORS[b.toLowerCase()] || COLORS[b]) color = COLORS[b.toLowerCase()] || COLORS[b];
      else if (/^color\d+$/i.test(b)) color = "";
      else warn.push(`[${b}] は使えません`);
      s = s.slice(m[0].length);
    }
    const toks = [], lit = (x) => { const last = toks[toks.length - 1]; if (last && last.t === "lit") last.v += x; else toks.push({ t: "lit", v: x }); };
    let afterDot = false, sawExp = false;
    if (GENERAL.test(s.trim()) || /(general|g\/標準)/i.test(s)) {
      const m = s.match(/(general|g\/標準)/i), at = m ? m.index : 0, len = m ? m[0].length : s.length;
      if (at) lit(unquote(s.slice(0, at)));
      toks.push({ t: "gen" });
      if (at + len < s.length) lit(unquote(s.slice(at + len)));
      return { cond, color, toks, warn };
    }
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '"') { const j = s.indexOf('"', i + 1); lit(j < 0 ? s.slice(i + 1) : s.slice(i + 1, j)); i = j < 0 ? s.length : j; continue; }
      if (ch === "\\") { lit(s[i + 1] ?? ""); i++; continue; }
      if (ch === "_") { lit(" "); i++; continue; }
      if (ch === "*") { i++; continue; }
      if (ch === "0" || ch === "#" || ch === "?") { toks.push({ t: "d", c: ch, frac: afterDot, exp: sawExp }); continue; }
      if (ch === "." && !afterDot && !sawExp) { afterDot = true; toks.push({ t: "dot" }); continue; }
      if (ch === ",") { toks.push({ t: "comma" }); continue; }
      if (ch === "%") { toks.push({ t: "pct" }); continue; }
      if ((ch === "E" || ch === "e") && (s[i + 1] === "+" || s[i + 1] === "-") && !sawExp) { sawExp = true; toks.push({ t: "exp", sign: s[i + 1] }); i++; continue; }
      if (ch === "@") { toks.push({ t: "at" }); continue; }
      if (/[A-Za-z]/.test(ch)) warn.push(/[ymdhs]/i.test(ch) ? "日付・時刻の書式は使えません（数に使う書式です）" : `「${ch}」は "" で囲んでください`);
      lit(ch);
    }
    // , の意味: 数の欄の間なら桁区切り、数の欄の後ろ（小数点・指数より前に数の欄が無い所）なら 1,000 で割る
    let group = false, scale = 0;
    toks.forEach((t, k) => {
      if (t.t !== "comma") return;
      const before = toks.slice(0, k).some((x) => x.t === "d" && !x.frac && !x.exp), after = toks.slice(k + 1).find((x) => x.t === "d" || x.t === "dot" || x.t === "exp");
      if (before && after && after.t === "d" && !after.frac && !after.exp) group = true;
      else if (before) scale++;
      else lit(",");
      t.t = "skip";
    });
    return { cond, color, toks: toks.filter((t) => t.t !== "skip"), group, scale, warn };
  }
  const unquote = (s) => s.replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1");

  const cache = new Map();
  function compile(code) {
    const key = String(code ?? "");
    let hit = cache.get(key);
    if (!hit) {
      const secs = split(key).map(section);
      hit = { secs, warn: [...new Set(secs.flatMap((x) => x.warn))] };
      if (cache.size > 300) cache.clear();
      cache.set(key, hit);
    }
    return hit;
  }

  const test = (c, v) => (c.op === ">" ? v > c.v : c.op === ">=" ? v >= c.v : c.op === "<" ? v < c.v : c.op === "<=" ? v <= c.v : c.op === "=" ? v === c.v : v !== c.v);
  /** 値に使う区分と、− を付けるか */
  function choose(secs, v) {
    const nums = secs.slice(0, 3);
    if (nums.some((x) => x.cond)) {
      // 条件付き: 1 つ目・2 つ目の条件を順に見て、どちらにも当たらなければ残りの区分（Excel と同じ）
      // 負の数を受け持つ条件（[<0]・[<=-1] など）の区分では − を付けない（区分の字で負を表す）
      const neg = (x) => !!(x.cond && (x.cond.op === "<" || x.cond.op === "<=") && x.cond.v <= 0);
      for (let i = 0; i < Math.min(2, nums.length); i++) if (nums[i].cond && test(nums[i].cond, v)) return { s: nums[i], minus: v < 0 && !neg(nums[i]) };
      const rest = nums.find((x, i) => i >= 1 && !x.cond) || nums[nums.length - 1];
      return { s: rest, minus: v < 0 };
    }
    if (nums.length === 1) return { s: nums[0], minus: v < 0 };
    if (v < 0) return { s: nums[1], minus: false };
    if (v === 0 && nums.length >= 3) return { s: nums[2], minus: false };
    return { s: nums[0], minus: false };
  }

  /** 丸め（0.1 + 0.2 の誤差を出さない）→ 小数 n 桁の字 */
  function fixed(x, n) {
    const r = Number(Math.round(Number(`${x}e${n}`)) + `e-${n}`);
    return (Number.isFinite(r) ? r : x).toFixed(n);
  }
  const groupDigits = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  function general(x) {
    if (!Number.isFinite(x)) return String(x);
    const a = Math.abs(x);
    if (a !== 0 && (a >= 1e11 || a < 1e-9)) return x.toExponential(5).replace(/\.?0+e/, "E").replace("E+", "E+").replace(/E(-?)(\d)$/, "E$10$2");
    return String(Number(x.toPrecision(10)));
  }

  /** 数を 1 つの区分で書く（v は符号を除いた値） */
  function number(sec, v) {
    const toks = sec.toks;
    if (toks.some((t) => t.t === "gen")) return toks.map((t) => (t.t === "gen" ? general(v) : t.t === "lit" ? t.v : "")).join("");
    let x = v * Math.pow(100, toks.filter((t) => t.t === "pct").length) / Math.pow(1000, sec.scale);
    const intT = toks.filter((t) => t.t === "d" && !t.frac && !t.exp), fracT = toks.filter((t) => t.t === "d" && t.frac && !t.exp), expT = toks.filter((t) => t.t === "d" && t.exp);
    const hasExp = toks.some((t) => t.t === "exp");
    let e = 0;
    if (hasExp && x !== 0) {
      const lead = Math.max(1, intT.filter((t) => t.c === "0").length || intT.length);
      e = Math.floor(Math.log10(x)) - (lead - 1);
      if (intT.length > 1 && intT.some((t) => t.c === "#")) e = Math.floor(Math.floor(Math.log10(x)) / intT.length) * intT.length;   // ##0.0E+0: 3 桁ずつ
      x = x / Math.pow(10, e);
      if (Number(fixed(x, fracT.length)) >= Math.pow(10, Math.max(1, intT.length))) { x /= 10; e += 1; }
    }
    const [ip, fp = ""] = fixed(x, fracT.length).split(".");
    // 整数の所: 右から埋める。0 は 0 を埋め・? は空白・# は何も。数の欄より多い桁は左端の欄にまとめて出す
    let intDigits = ip === "0" && !intT.some((t) => t.c === "0") ? "" : ip;
    const minLen = intT.length - intT.findIndex((t) => t.c === "0");
    if (intT.some((t) => t.c === "0") && intDigits.length < minLen) intDigits = intDigits.padStart(minLen, "0");
    const intOut = new Map();
    if (sec.group) intT.forEach((t, k) => intOut.set(t, k ? "" : groupDigits(intDigits)));   // 桁区切りの形（#,##0）は全部の桁を頭の欄に
    else {
      let rest = intDigits;
      for (let k = intT.length - 1; k >= 0; k--) {
        const t = intT[k];
        if (k === 0) intOut.set(t, rest || (t.c === "?" ? " " : ""));
        else if (rest) { intOut.set(t, rest.slice(-1)); rest = rest.slice(0, -1); }
        else intOut.set(t, t.c === "?" ? " " : "");
      }
    }
    // 小数の所: 左から。# は後ろの 0 を出さない・? は後ろの 0 を空白
    const fracOut = new Map();
    let fd = fp.split("");
    for (let k = fracT.length - 1; k >= 0 && fd[k] === "0" && fracT[k].c !== "0"; k--) fd[k] = fracT[k].c === "?" ? " " : "";
    fracT.forEach((t, k) => fracOut.set(t, fd[k] ?? ""));
    const expDigits = String(Math.abs(e)).padStart(expT.filter((t) => t.c === "0").length, "0");
    const expOut = new Map(); expT.forEach((t, k) => expOut.set(t, k === 0 ? expDigits : ""));
    const showDot = fracT.length > 0 || toks.some((t) => t.t === "dot");
    return toks.map((t) => {
      if (t.t === "lit") return t.v;
      if (t.t === "pct") return "%";
      if (t.t === "dot") return showDot ? "." : "";
      if (t.t === "exp") return `E${e < 0 ? "-" : t.sign === "+" ? "+" : ""}`;
      if (t.t === "at") return "";
      if (t.t === "d") return t.exp ? expOut.get(t) : t.frac ? fracOut.get(t) : intOut.get(t);
      return "";
    }).join("");
  }

  /** 値 → {text, color}。数でない値は 4 つ目の区分（@）か、そのままの字 */
  function format(v, code) {
    const { secs } = compile(code);
    if (v == null || v === "") return { text: "", color: "" };
    if (typeof v !== "number" || !Number.isFinite(v)) {
      const t = secs[3] || (secs.length === 1 && secs[0].toks.some((x) => x.t === "at") ? secs[0] : null);
      return t ? { text: t.toks.map((x) => (x.t === "at" ? String(v) : x.t === "lit" ? x.v : "")).join(""), color: t.color } : { text: String(v), color: "" };
    }
    const { s, minus } = choose(secs, v);
    if (!s || (!s.toks.length && !s.color)) return { text: "", color: "" };
    const body = number(s, Math.abs(v));
    const zeroish = minus && !/[1-9]/.test(body);      // 丸めて 0 になった負の数は − を付けない（Excel と同じ）
    return { text: (minus && !zeroish ? "-" : "") + body, color: s.color };
  }
  const text = (v, code) => format(v, code).text;
  /** コードを確かめる → 知らせ（使えない字など）の並び。空なら使える */
  const check = (code) => compile(code).warn;
  /** そのままの字（単位など）を含むか（数字の自動の単位「本・件」を出さない決め手） */
  const hasLiteral = (code) => compile(code).secs.slice(0, 1).some((s) => s.toks.some((t) => t.t === "lit" && t.v.trim() && !/^[\s\-+()]+$/.test(t.v)));

  /* ---------- 画面の選び（分類・桁・桁区切り・負の数・前後の字）→ コード ---------- */
  const CATS = [["", "標準"], ["num", "数値"], ["cur", "通貨"], ["pct", "パーセンテージ"], ["sci", "指数"], ["custom", "ユーザー定義"]];
  const NEGS = [["minus", "-1,234"], ["tri", "▲1,234"], ["paren", "(1,234)"], ["red", "-1,234（赤）"], ["redtri", "▲1,234（赤）"]];
  const q = (s) => (s ? `"${String(s).replace(/"/g, "")}"` : "");
  /** ui {cat, dec, sep, neg, pre, suf} → 書式コード（標準は ""） */
  function build(ui) {
    const u = ui || {}, dec = Math.max(0, Math.min(6, +u.dec || 0)), frac = dec ? "." + "0".repeat(dec) : "";
    if (!u.cat) return "";
    if (u.cat === "custom") return String(u.code || "");
    if (u.cat === "pct") return `${q(u.pre)}0${frac}%${q(u.suf)}`;
    if (u.cat === "sci") return `${q(u.pre)}0${frac || ".00"}E+00${q(u.suf)}`;
    const pre = u.cat === "cur" ? (u.pre ?? "¥") : u.pre;
    const body = `${q(pre)}${u.sep === false ? "0" : "#,##0"}${frac}${q(u.suf)}`;
    const neg = u.neg || "minus";
    if (neg === "tri") return `${body};"▲"${body}`;
    if (neg === "paren") return `${body};(${body})`;
    if (neg === "red") return `${body};[赤]-${body}`;
    if (neg === "redtri") return `${body};[赤]"▲"${body}`;
    return body;
  }
  /* ---------- 値の計算（版 3.45.0。利用者の要望 3: 数に四則演算を足す。ダッシュボードの書式の「計算」） ----------
     値は x（「値」「X」も同じ）。演算子から書けば前に値を置く（「÷1000」＝x÷1000・「×100」・「+5」・「-3」）。
     使える物: 数・小数点・＋ − × ÷ ^（累乗）・かっこ・全角の字。式は読むだけ（eval を使わない）。→ {fn(x)|null, error, text} */
  const ZEN = /[０-９．（）＋－＊／＾]/g;
  function expr(src) {
    let s = String(src == null ? "" : src).trim();
    if (!s) return { fn: null, error: "", text: "" };
    s = s.replace(ZEN, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[×✕]/g, "*").replace(/÷/g, "/").replace(/[−–]/g, "-")
      .replace(/値|ｘ|Ｘ|X/g, "x").replace(/\s+/g, "");
    if (/^[*/+^]/.test(s) || (/^-/.test(s) && !s.includes("x"))) s = "x" + s;
    const toks = [], bad = s.replace(/(\d+\.?\d*|\.\d+)|([x+\-*/^()])/g, (m, n, o) => { toks.push(n != null ? { n: +n } : { o }); return ""; });
    if (bad) return { fn: null, error: `使えない字です: ${[...new Set(bad)].join(" ")}`, text: "" };
    let i = 0, usesX = false;
    const peek = () => toks[i], eat = (o) => (toks[i] && toks[i].o === o ? (i++, true) : false);
    const fail = (m) => { throw new Error(m); };
    function sum() { let a = prod(); for (;;) { if (eat("+")) { const l = a, r = prod(); a = (x) => l(x) + r(x); } else if (eat("-")) { const l = a, r = prod(); a = (x) => l(x) - r(x); } else return a; } }
    function prod() { let a = pow(); for (;;) { if (eat("*")) { const l = a, r = pow(); a = (x) => l(x) * r(x); } else if (eat("/")) { const l = a, r = pow(); a = (x) => l(x) / r(x); } else return a; } }
    function pow() { const a = unary(); if (eat("^")) { const b = pow(); return (x) => a(x) ** b(x); } return a; }
    function unary() { if (eat("-")) { const a = unary(); return (x) => -a(x); } if (eat("+")) return unary(); return atom(); }
    function atom() {
      const t = peek(); if (!t) fail("式が途中で終わっています");
      if (t.n != null) { i++; return () => t.n; }
      if (eat("x")) { usesX = true; return (x) => x; }
      if (eat("(")) { const a = sum(); if (!eat(")")) fail("かっこが閉じていません"); return a; }
      return fail(`「${t.o}」の前に数か値がありません`);
    }
    try {
      const f = sum();
      if (i < toks.length) fail(`「${toks[i].o ?? toks[i].n}」の前に演算子がありません`);
      if (!usesX) fail("値（x）を使っていません。例: ÷1000・x×100");
      const text = s.replace(/\*/g, "×").replace(/\//g, "÷").replace(/x/g, "値");
      return { fn: (x) => { const v = f(x); return Number.isFinite(v) ? v : null; }, error: "", text };
    } catch (e) { return { fn: null, error: e.message, text: "" }; }
  }
  WL.numFormat = { format, text, check, hasLiteral, build, compile, expr, CATS, NEGS, COLORS };
})();
