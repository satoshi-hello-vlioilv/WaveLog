#!/usr/bin/env node
/* js_types.js: 画面のJSを TypeScript の検査器で調べる（§9.566）。
 *
 * 画面のJSは `<script>` を順に読む素のスクリプトで、どのファイルも IIFE で閉じ、
 * 外へ出す物は `WL.<名前> = …`（名前空間）か `window.<名前> = …`（土台の短い名前）で
 * 名乗る（§9.359）。TypeScript はこの形を「公開」と読めないので、そのままでは
 * 9,666件のうち 9,072件が「名前が無い」「その型に無い」になる。
 *
 * そこで**公開の型は手で書かず、名乗っている式そのものから起こす**（答えは実装の1箇所）:
 *  1. 第1周: `WL` と土台の名前を any として全ファイルを読み、
 *     `WL.x = 式` `WL.x.y = 式` `Object.assign(WL.x, {...})` `window.x = 式` の式の型を集める。
 *  2. 集めた型から宣言（`interface WLShape`・`declare var`）を書く。宣言の中で解けない名前
 *     （IIFE の中の型名など）は、その項目だけ any に倒して数える（黙って捨てない）。
 *  3. 第2周: 宣言を添えて全ファイルを検査する。
 * 宣言はファイルに残さない（実装と食い違う写しを作らない）。毎回ここで起こし直す。
 *
 * 使い方:
 *   node tests/lib/js_types.js                 → 診断を JSON で標準出力へ
 *   node tests/lib/js_types.js --decl          → 起こした宣言を標準出力へ（調べる用）
 *   node tests/lib/js_types.js --contract c.json → サーバーの応答の鍵を api() の型にする（§9.567）
 *   node tests/lib/js_types.js --override a.js=/tmp/x.js …
 *                                              → a.js を /tmp/x.js の中身に差し替えて調べる
 *                                                （網が欠陥を注ぐとき。本物の置き場へ書かない・§9.504）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const JS_DIR = path.join(ROOT, 'static', 'js');

function loadTs() {
  /* `npm i -g` で入れた物は `require` の探す先に無い（CI で踏んだ）。動いている node の置き場の
     `lib/node_modules` と、`npm root -g` の答えも探す。 */
  const globalRoot = () => {
    try { return require('child_process').execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch (e) { return null; }   // npm が無い——ほかの候補で探す
  };
  const cands = [process.env.WAVELOG_TYPESCRIPT, 'typescript',
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'typescript'),
    () => { const g = globalRoot(); return g && path.join(g, 'typescript'); }];
  for (const c of cands) {
    const p = typeof c === 'function' ? c() : c;
    if (!p) continue;
    try { return require(p); } catch (e) { /* 次の候補へ（見つからなければ最後に断る） */ }
  }
  /* 7 系は Go で書き直され、`require` で読める検査器の API を持たない（ES モジュールだけ・CI で踏んだ）。 */
  throw new Error('typescript 6 系が見つかりません（npm i -g typescript@6・または WAVELOG_TYPESCRIPT。7 系は JS の API を持たない）');
}
const ts = loadTs();

/* 検査の決まり。strict は入れない——いまの書き方（null を値として渡す・暗黙の any）を
   全部書き直すことになり、検査より先に書き換えの危険が来る。止めたいのは
   「無い物を呼ぶ・綴り違い・引数の数や形の取り違え」（§9.563 の型・形の不具合）。 */
const OPTIONS = {
  allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true, strict: false,   // TS 6 から strict が既定で真
  target: ts.ScriptTarget.ES2022,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  types: [],
};
const DECL = path.join(ROOT, 'tests', '__wl_contract__.d.ts');   // 仮の名前（書き出さない）
const FMT = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias
  | ts.TypeFormatFlags.UseFullyQualifiedType | ts.TypeFormatFlags.WriteArrowStyleSignature;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out.sort();
}

/* 中身を差し替えられるホスト（網の欠陥注入・宣言は記憶の中だけ）。 */
function makeHost(overrides, decl) {
  const host = ts.createCompilerHost(OPTIONS, true);
  const read = host.readFile.bind(host);
  host.readFile = f => (f === DECL ? decl : overrides[f] !== undefined ? overrides[f] : read(f));
  host.fileExists = (f => (x => x === DECL || overrides[x] !== undefined || f(x)))(host.fileExists.bind(host));
  const get = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lang, onErr) => {
    const text = host.readFile(f);
    return text === undefined ? get(f, lang, onErr) : ts.createSourceFile(f, text, lang, true);
  };
  return host;
}

function program(files, overrides, decl) {
  return ts.createProgram([...files, DECL], OPTIONS, makeHost(overrides, decl));
}

/* ---- 第1周: 名乗っている式の型を集める ---- */
const isId = (n, name) => ts.isIdentifier(n) && n.text === name;
/** `WL` か `window.WL` か */
const isWL = n => isId(n, 'WL') || (ts.isPropertyAccessExpression(n) && n.name.text === 'WL' && isId(n.expression, 'window'));
/** `WL.x` なら 'x' */
const wlMember = n => (ts.isPropertyAccessExpression(n) && isWL(n.expression) ? n.name.text : null);

function collect(prog, files) {
  const ck = prog.getTypeChecker();
  const wl = new Map();     // 名前 → [{node, type}]
  const glob = new Map();   // 土台の短い名前 → [{node, type}]
  const add = (m, k, node, type) => (m.get(k) || m.set(k, []).get(k)).push({ node, type });
  /* `Object.assign(X||{}, a, b)` の右の a, b を部品として返す。それ以外は式そのもの。 */
  const parts = e => {
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)
        && isId(e.expression.expression, 'Object') && e.expression.name.text === 'assign') {
      return e.arguments.slice(1);
    }
    return [e];
  };
  const want = new Set(files);
  for (const sf of prog.getSourceFiles()) {
    if (!want.has(sf.fileName)) continue;
    const visit = n => {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
          && ts.isPropertyAccessExpression(n.left)) {
        const L = n.left;
        const top = wlMember(L);
        if (top) {
          for (const p of parts(n.right)) add(wl, top, p, ck.getTypeAtLocation(p));
        } else if (ts.isPropertyAccessExpression(L.expression) && wlMember(L.expression)) {
          /* `WL.x.y = 式` は x の1項目 */
          add(wl, wlMember(L.expression), n.right, { member: L.name.text, type: ck.getTypeAtLocation(n.right) });
        } else if (isId(L.expression, 'window') && L.name.text !== 'WL') {
          add(glob, L.name.text, n.right, ck.getTypeAtLocation(n.right));
        }
      } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
          && isId(n.expression.expression, 'Object') && n.expression.name.text === 'assign'
          && n.arguments.length > 1 && (wlMember(n.arguments[0]) || isWL(n.arguments[0]))) {
        const into = wlMember(n.arguments[0]);
        for (const p of n.arguments.slice(1)) {
          const t = ck.getTypeAtLocation(p);
          if (into) add(wl, into, p, t);
          /* `Object.assign(WL, {a, b})` は a・b がそれぞれ WL の1項目 */
          else for (const m of ck.getPropertiesOfType(t)) add(wl, m.name, p, ck.getTypeOfSymbolAtLocation(m, p));
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { ck, wl, glob };
}

const isAny = t => !!(t.flags & ts.TypeFlags.Any);
const isPlainObject = (ck, t) => !!(t.flags & ts.TypeFlags.Object) && !ck.getSignaturesOfType(t, ts.SignatureKind.Call).length
  && !ck.getSignaturesOfType(t, ts.SignatureKind.Construct).length;

/** 型の字。関数は引数を全部「省略可」で書く——JS の関数は引数を省いて呼べる（検査器も JS の
    ファイルの中ではそう読む）が、型を字へ起こすと既定値の無い引数が「必須」になり、
    `toleranceDetail(kind)` のような正しい呼び出しが数の誤りに見える。多すぎる引数は止まる。 */
function typeStr(ck, t, node) {
  const sigs = ck.getSignaturesOfType(t, ts.SignatureKind.Call);
  if (!sigs.length || ck.getPropertiesOfType(t).length) return ck.typeToString(t, node, FMT);
  const one = sig => '(' + sig.parameters.map(p => {
    const d = p.valueDeclaration;
    const rest = d && ts.isParameter(d) && d.dotDotDotToken;
    const pt = ck.typeToString(ck.getTypeOfSymbolAtLocation(p, node), node, FMT);
    return rest ? `...${p.name}: ${pt}` : `${p.name}?: ${pt}`;
  }).join(', ') + ') => ' + ck.typeToString(sig.getReturnType(), node, FMT);
  return sigs.length === 1 ? one(sigs[0]) : '{ ' + sigs.map(x => one(x).replace(/\) => /, '): ')).join('; ') + ' }';
}

/** 1つの名前の部品を「項目の表」か「1つの型」へまとめた宣言の字。 */
function typeText(ck, sites) {
  const members = new Map();
  let whole = null;
  for (const s of sites) {
    if (s.type && s.type.member) {                     // WL.x.y = 式
      members.set(s.type.member, typeStr(ck, s.type.type, s.node));
      continue;
    }
    const t = s.type;
    if (isAny(t)) continue;                             // `WL.x||{}` などの初期化
    if (isPlainObject(ck, t) && !ck.isArrayType(t)) {
      for (const p of ck.getPropertiesOfType(t)) {
        members.set(p.name, typeStr(ck, ck.getTypeOfSymbolAtLocation(p, s.node), s.node));
      }
    } else if (!whole) {
      whole = typeStr(ck, t, s.node);
    }
  }
  if (whole && !members.size) return whole;
  if (!members.size) return 'any';
  /* 中の項目も省略可: 名前空間は何本ものファイルが少しずつ足して育てる（`Object.assign(WL.split||{}, …)`）。 */
  const body = [...members].map(([k, v]) => `  ${JSON.stringify(k)}?: ${v};`).join('\n');
  return `{\n${body}\n}`;
}

/* ---- 宣言を書く（解けない項目は any に倒して数える） ---- */
function declText(entries, anyNames) {
  /* 項目は省略可（`?:`）——`window.WL = window.WL || {}` で空から育てるので。strict を入れて
     いないので、読む側にとって省略可は無いのと同じ（`T | undefined` は `T` に畳まれる）。 */
  const wl = entries.wl.map(([k, v]) => `  ${JSON.stringify(k)}?: ${anyNames.has('WL.' + k) ? 'any' : v};`).join('\n');
  const glob = entries.glob.map(([k, v]) => `declare var ${k}: ${anyNames.has(k) ? 'any' : v};`).join('\n');
  return `/* 起こした宣言（js_types.js・ファイルには残さない） */\n`
    + `interface WLShape {\n${wl}\n}\ndeclare var WL: WLShape;\n${glob}\n`
    + externalNames().map(n => `declare var ${n}: any;`).join('\n') + '\n'
    + `interface Window { WL: WLShape }\n`;
}

/* 画面のJSの外で名乗られる名前（型は分からないので any）。
   - 画面の HTML（templates/*.html）の`<script>`が`window.x = …`で置く物（サーバーが埋める値）
   - 押したときだけ読み込む第三者の部品（three.js・§9.377） */
const THIRD_PARTY = ['THREE'];
function externalNames() {
  const names = new Set(THIRD_PARTY);
  const dir = path.join(ROOT, 'templates');
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!f.endsWith('.html')) continue;
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) names.add(m[1]);
  }
  return [...names].sort();
}

/* ---- 境界の約束（§9.567）: サーバーの応答の鍵を `api('/api/…')` の戻りの型にする ----
   約束はサーバーのコード（`tests/lib/api_contract.py` が読み出す）。道が字面だけの呼び出しは、
   その道の応答の鍵を持つ型を返す——画面がサーバーの返さない鍵を読むと 2339 で止まる。
   応答が読めない道（`unknown`）と、`{*}` を含む道は any のまま（推して埋めない）。
   同じ道の GET と POST は鍵を合わせる（`api()` の型は道でしか分けられない）。 */
const API_OPTS = 'RequestInit & {quiet?: boolean}';
function apiType(contract) {
  const by = new Map();
  for (const r of contract) {
    if (r.pattern.includes('{*}')) continue;
    const cur = by.get(r.rule) || { keys: new Set(), kind: 'closed' };
    if (r.reply.kind === 'unknown') cur.kind = 'unknown';
    else if (r.reply.kind === 'open' && cur.kind === 'closed') cur.kind = 'open';
    for (const k of r.reply.keys) cur.keys.add(k);
    by.set(r.rule, cur);
  }
  const sigs = [];
  for (const [rule, v] of [...by].sort(([a], [b2]) => (a < b2 ? -1 : 1))) {
    if (v.kind === 'unknown') continue;
    const body = [...v.keys].sort().map(k => `${JSON.stringify(k)}?: any`)
      .concat(v.kind === 'open' ? ['[k: string]: any'] : []).join('; ');
    sigs.push(`(u: ${JSON.stringify(rule)}, o?: ${API_OPTS}): Promise<{ ${body} }>`);
  }
  sigs.push(`(u: string, o?: ${API_OPTS}): Promise<any>`);
  return { text: '{\n  ' + sigs.join(';\n  ') + ';\n}', typed: sigs.length - 1 };
}

function build(files, overrides, contract) {
  const firstDecl = 'declare var WL: any;\ninterface Window { [k: string]: any }\n'
    + baseNames(files, overrides).map(n => `declare var ${n}: any;`).join('\n') + '\n';
  const p1 = program(files, overrides, firstDecl);
  const { ck, wl, glob } = collect(p1, files);
  const entries = {
    wl: [...wl].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, typeText(ck, v)]),
    glob: [...glob].sort(([a], [b]) => (a < b ? -1 : 1)).filter(([k]) => /^[A-Za-z_$][\w$]*$/.test(k))
      .map(([k, v]) => [k, typeText(ck, v)]),
  };
  let apiTyped = 0;
  if (contract) {
    const t = apiType(contract);
    apiTyped = t.typed;
    entries.glob = entries.glob.map(([k, v]) => (k === 'api' ? [k, t.text] : [k, v]));
  }
  /* 宣言の中で解けない項目を any に倒す（最大3周）。倒した名前は報告に載せる。 */
  const anyNames = new Set();
  for (let i = 0; i < 3; i++) {
    const text = declText(entries, anyNames);
    const p = program([], {}, text);
    const bad = ts.getPreEmitDiagnostics(p).filter(d => d.file && d.file.fileName === DECL);
    if (!bad.length) break;
    for (const d of bad) {
      const line = d.file.getLineAndCharacterOfPosition(d.start).line;
      const src = text.split('\n');
      /* その行が属する項目の名前を上へたどって探す */
      for (let j = line; j >= 0; j--) {
        const m = /^ {2}"([^"]+)"\??: /.exec(src[j]) || /^declare var ([\w$]+):/.exec(src[j]);
        if (m) { anyNames.add(src[j].startsWith('declare') ? m[1] : 'WL.' + m[1]); break; }
      }
    }
  }
  return { decl: declText(entries, anyNames), anyNames: [...anyNames].sort(), wlCount: entries.wl.length,
    globCount: entries.glob.length, apiTyped };
}

/* 第1周で any として置く土台の短い名前（`window.x = …` で名乗っている物）。
   第2周は実物の式から起こした型に置き換わる。 */
function baseNames(files, overrides) {
  const names = new Set();
  for (const f of files) {
    const src = overrides[f] !== undefined ? overrides[f] : fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) if (m[1] !== 'WL') names.add(m[1]);
  }
  return [...names].sort();
}

/* ---- 第2周: 検査 ---- */
/* DOM の取り違えは数えない: `querySelector` の戻りは Element で、`.value`・`.dataset` を
   読むたびに 2339 が出る（692件）。ブラウザは実行時に許し、型の注記で黙らせるだけの手間になる。
   数えるのは**自分たちの物**（WL の項目・土台の名前・関数の引数）の取り違え。 */
const DOM_TYPES = /on type '(Element|HTMLElement|HTML\w*Element|SVG\w*Element|EventTarget|Event|\w*Event|Node|ChildNode|ParentNode|Document|CSSStyleDeclaration|DOMStringMap|Error)'/;

/* 空の字面（`{}`・`[]`）から推し量った型の上の「無い」も数えない: `function f(o = {})` の
   `o.quiet`、`const a = []` の `a[0].x` は、TS が中身を知らないだけで取り違えではない（555件）。 */
const EMPTY_TYPES = /on type '(\{\}|\{\} \| \{\}|never)'/;

/* ---- 画面が呼ぶ API（境界の突き合わせに渡す） ----
   `api(…)`・`fetch(…)` の第1引数が `/api` で始まるもの。道は字面（`{*}`＝式で決まる所・`?`より後は外す）、
   メソッド、本文の鍵と字面の値の種類（`JSON.stringify({…})` のときだけ）。 */
function urlOf(a) {
  if (!a) return null;
  if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) return a.text;
  if (ts.isTemplateExpression(a)) return a.head.text + a.templateSpans.map(x => '{*}' + x.literal.text).join('');
  if (ts.isBinaryExpression(a) && a.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = urlOf(a.left);
    return l == null ? null : l + '{*}';
  }
  return null;
}
function valueKind(v) {
  if (!v) return 'other';
  if (ts.isStringLiteral(v) || ts.isTemplateExpression(v) || ts.isNoSubstitutionTemplateLiteral(v)) return 'string';
  if (ts.isNumericLiteral(v)) return 'number';
  if (v.kind === ts.SyntaxKind.TrueKeyword || v.kind === ts.SyntaxKind.FalseKeyword) return 'bool';
  if (ts.isArrayLiteralExpression(v)) return 'array';
  if (ts.isObjectLiteralExpression(v)) return 'object';
  return 'other';
}
function apiCalls(prog, files) {
  const want = new Set(files), out = [];
  for (const sf of prog.getSourceFiles()) {
    if (!want.has(sf.fileName)) continue;
    const visit = n => {
      if (ts.isCallExpression(n)) {
        const c = n.expression;
        const name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : '';
        const raw = (name === 'api' || name === 'fetch') ? urlOf(n.arguments[0]) : null;
        if (raw && raw.startsWith('/api')) {
          const call = { file: path.relative(ROOT, sf.fileName).split(path.sep).join('/'),
            line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, url: raw.split('?')[0],
            method: 'GET', body: 'none', keys: [] };
          const o = n.arguments[1];
          if (o && !ts.isObjectLiteralExpression(o)) call.method = '?';
          for (const p of (o && ts.isObjectLiteralExpression(o)) ? o.properties : []) {
            const k = p.name && (p.name.text || p.name.getText());
            const init = ts.isPropertyAssignment(p) ? p.initializer : null;
            if (k === 'method') call.method = init && ts.isStringLiteral(init) ? init.text.toUpperCase() : '?';
            if (k !== 'body') continue;
            call.body = 'expr';
            const arg = init && ts.isCallExpression(init) && /stringify$/.test(init.expression.getText()) ? init.arguments[0] : null;
            if (!arg || !ts.isObjectLiteralExpression(arg)) continue;
            call.body = 'literal';
            for (const q of arg.properties) {
              if (ts.isSpreadAssignment(q) || (q.name && ts.isComputedPropertyName(q.name))) { call.body = 'partial'; continue; }
              call.keys.push([q.name.text || q.name.getText(), valueKind(ts.isPropertyAssignment(q) ? q.initializer : null)]);
            }
          }
          out.push(call);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/* `(await api(…)) || {}`・`.catch(e => ({error}))` は「応答の型 | 別の形」になり、応答に在る鍵でも
   2339 が出る（どれか1つの形に無いだけで出る）。**どれかの形がその鍵を持つ（または何でも持てる）なら**
   数えない。どの形も持たないなら本物——サーバーが返さない鍵を読んでいる。 */
function unionParts(t) {
  const parts = [];
  let depth = 0, cur = '';
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if ('{([<'.includes(ch)) depth++;
    if ('})]>'.includes(ch)) depth--;
    if (depth === 0 && t.startsWith(' | ', i)) { parts.push(cur); cur = ''; i += 2; continue; }
    cur += ch;
  }
  return parts.concat(cur);
}
function orEmpty(msg) {
  const m = /^Property '([^']+)' does not exist on type '(.*)'\.$/.exec(msg);
  if (!m) return false;
  const parts = unionParts(m[2]);
  if (parts.length < 2) return false;
  const key = new RegExp(`(^\\{ |; |, )"?${m[1].replace(/[$]/g, '\\$')}"?\\??:`);
  return parts.some(p => p.includes('[k: string]: any') || key.test(p));
}

function diagnose(overrides = {}, contract = null) {
  const files = walk(JS_DIR);
  const ov = {};
  for (const [k, v] of Object.entries(overrides)) ov[path.resolve(ROOT, k)] = v;
  const b = build(files, ov, contract);
  const p2 = program(files, ov, b.decl);
  const out = [];
  for (const d of ts.getPreEmitDiagnostics(p2)) {
    if (!d.file || !d.file.fileName.startsWith(JS_DIR)) continue;
    const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n').split('\n')[0];
    if (d.code === 2339 && (DOM_TYPES.test(msg) || EMPTY_TYPES.test(msg) || orEmpty(msg))) continue;
    const { line } = d.file.getLineAndCharacterOfPosition(d.start);
    out.push({ file: path.relative(ROOT, d.file.fileName).split(path.sep).join('/'), line: line + 1, code: d.code, msg });
  }
  return { diagnostics: out, anyNames: b.anyNames, wlCount: b.wlCount, globCount: b.globCount, files: files.length,
    apiTyped: b.apiTyped, calls: apiCalls(p2, files) };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const overrides = {};
  let contract = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--override') {
      const [rel, src] = args[++i].split('=');
      overrides[rel] = fs.readFileSync(src, 'utf8');
    } else if (args[i] === '--contract') {
      contract = JSON.parse(fs.readFileSync(args[++i], 'utf8'));
    }
  }
  if (args.includes('--decl')) {
    process.stdout.write(build(walk(JS_DIR), {}, contract).decl);
  } else {
    process.stdout.write(JSON.stringify(diagnose(overrides, contract)));
  }
}

module.exports = { diagnose, build };
