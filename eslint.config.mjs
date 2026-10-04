// WaveLog の JS の静的検査（§9.326、REVIEW 3-1）。
//
// 実行は `tests/test_eslint.py`（`tests/run_all.sh` が常に回す）。手元では
//   eslint static/js tests
// で同じ結果になる。設定はここの1箇所——網とエディタが別の規則を持つと
// 「エディタでは赤いのに網は通る」が作れる。
//
// 規則の選び方:
//  * 'error' ＝ 0件に固定する（1件でも網が落ちる）。どれも「書いた本人の
//    意図と違うことが黙って起きる」形——同じ関数の二重定義は先の側が
//    一度も実行されない（`fmtMin` が実際にそうだった・§9.326）。
//  * 'warn'  ＝ いまの件数を上限に固定する（増えたら落ちる・減ったら上限を
//    下げる）。`tests/test_eslint.py` の BASELINE が持つ。
//  * 'off'   ＝ この構成では意味を持たない規則。JSは `<script>` を順に読む
//    素のグローバル（§CLAUDE「`window.*`への新規公開」）なので、`no-undef`
//    と「最上位で定義した関数が使われていない」は別ファイルから使われて
//    いるだけ。`no-func-assign` は拡張ファイルのラップ
//    （`fn=function(){...base()...}`・`tests/test_patchlint.py` が守る）
//    の形そのもの。
// 画面のJSは `<script>` を順に読む素のグローバル（§CLAUDE「`window.*`への新規公開」）。
// そこで **globals は「どのファイルのトップレベルに何があるか」から作る**（§9.354・REVIEW 3-17）。
// 手で並べた一覧は腐るし、**ファイルを IIFE で閉じた瞬間に globals から自然に外れる**ので、
// 「閉じたのに外から呼んでいる」を `no-undef` が漏れなく教える——3-17（5本を閉じる）の土台。
import fs from 'fs';
import path from 'path';

const JS_DIR = path.join(import.meta.dirname, 'static', 'js');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/* そのファイルが IIFE（`(function(){…})()` / `(()=>{…})()`）で丸ごと閉じているか。
   **閉じたファイルの中身は外から見えない**ので globals に出さない——だから
   「閉じたのに外から呼んでいる」が `no-undef` で出る（3-17 を機械が守る仕組み）。
   字下げの有無では見分けない（包んでも元の行の字下げは変わらないので、
   包んだのに globals へ出続けて**網が黙る**。実際にそうなった・§9.354）。 */
function isWrapped(src) {
  const body = src.replace(/^\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)\s*/g, '');
  return /^\(\s*(?:async\s+)?(?:function\s*\w*\s*\(|\(\s*\)\s*=>|\(\s*\)\s*\{)/.test(body);
}

/* 行頭にあるものだけがトップレベル。IIFE の中は字下げされている。 */
function topLevelNames() {
  const names = {};
  for (const file of walk(JS_DIR)) {
    const src = fs.readFileSync(file, 'utf8');
    /* 閉じたファイルからは `window.x=` の公開だけを採る。 */
    if (isWrapped(src)) {
      for (const m of src.matchAll(/(?:window|globalThis)\.([A-Za-z_$][\w$]*)\s*=/g)) names[m[1]] = 'writable';
      continue;
    }
    for (const m of src.matchAll(/^(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/gm)) names[m[1]] = 'writable';
    /* 1行に複数の宣言（`const A=1;const $=…`）があるので、行を `;` で割ってから見る。 */
    for (const line of src.split('\n')) {
      if (/^\s/.test(line)) continue;
      for (const part of line.split(';')) {
        const m = part.match(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/);
        if (m) names[m[1]] = 'writable';
      }
    }
    /* 宣言キーワード無しの代入（暗黙のグローバル。`esc=v=>…`）と `window.x=`。 */
    for (const m of src.matchAll(/^([A-Za-z_$][\w$]*)\s*=[^=]/gm)) names[m[1]] = 'writable';
    for (const m of src.matchAll(/^\s*(?:window|globalThis)\.([A-Za-z_$][\w$]*)\s*=/gm)) names[m[1]] = 'writable';
  }
  return names;
}

/* ブラウザが持っているもの。`window.` を付けずに書いている名前だけ挙げる。 */
const BROWSER = Object.fromEntries([
  'window', 'document', 'console', 'fetch', 'localStorage', 'sessionStorage', 'navigator', 'location',
  'history', 'performance', 'screen', 'visualViewport', 'indexedDB', 'IDBKeyRange', 'crypto',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'requestIdleCallback', 'queueMicrotask', 'structuredClone',
  'Blob', 'URL', 'URLSearchParams', 'FormData', 'FileReader', 'Image', 'Option', 'DataTransfer',
  'Event', 'CustomEvent', 'DragEvent', 'MouseEvent', 'KeyboardEvent', 'HTMLElement', 'Node',
  'AbortController', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver',
  'getComputedStyle', 'matchMedia', 'CSS', 'TextEncoder', 'TextDecoder', 'XMLHttpRequest',
  'WebSocket', 'innerWidth', 'innerHeight', 'print', 'open', 'close', 'top', 'self', 'parent',
  'frames', 'scrollTo', 'scrollBy', 'alert', 'confirm', 'prompt',
].map((k) => [k, 'readonly']));

export default [
  {
    // バイトコードの置き場は歩かない（JS は無い）。片付けを本物で回す網と並列で走ると、
    // 走査の途中でフォルダが消えて eslint ごと止まっていた（§9.549）。
    ignores: ['static/vendor/**', 'node_modules/**', 'db/**', '**/__pycache__/**'],
  },
  {
    files: ['static/js/**/*.js', 'tests/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script' },
    rules: {
      // --- 0件に固定（'error'） -------------------------------------
      // `builtinGlobals:false`——globals は「どのファイルのトップレベルに何があるか」から
      // 作る（下の段）ので、定義した本人が「グローバルと同じ名前だ」と怒られてしまう。
      // 見たいのは**同じファイルの中の二重定義**（`fmtMin` が実際にそうだった・§9.326）。
      'no-redeclare': ['error', { builtinGlobals: false }],
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-class-members': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-unsafe-negation': 'error',
      'no-unsafe-finally': 'error',
      'no-unsafe-optional-chaining': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-const-assign': 'error',
      'no-class-assign': 'error',
      'no-import-assign': 'error',
      'no-global-assign': 'error',
      'no-ex-assign': 'error',
      'no-this-before-super': 'error',
      'no-obj-calls': 'error',
      'no-sparse-arrays': 'error',
      'no-cond-assign': 'error',
      'no-fallthrough': 'error',
      'no-empty-pattern': 'error',
      'no-unused-labels': 'error',
      'no-useless-escape': 'error',
      'no-useless-catch': 'error',
      'no-useless-backreference': 'error',
      'getter-return': 'error',
      'no-setter-return': 'error',
      'no-compare-neg-zero': 'error',
      'no-debugger': 'error',
      'no-loss-of-precision': 'error',
      'no-shadow-restricted-names': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-constant-binary-expression': 'error',
      'no-case-declarations': 'error',
      'no-new-native-nonconstructor': 'error',
      'no-nonoctal-decimal-escape': 'error',
      'no-octal': 'error',
      'no-regex-spaces': 'error',
      'no-control-regex': 'error',
      'no-empty-character-class': 'error',
      'no-invalid-regexp': 'error',
      'no-misleading-character-class': 'error',
      'no-async-promise-executor': 'error',
      'no-delete-var': 'error',
      'no-with': 'error',
      'require-yield': 'error',
      'no-unexpected-multiline': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-inner-declarations': 'error',
      'no-unused-private-class-members': 'error',
      // 日本語の全角空白は文字列・コメント・テンプレート・正規表現の中では
      // 意図したもの。コードの字句として現れたときだけ落とす。
      'no-irregular-whitespace': ['error', {
        skipStrings: true, skipComments: true, skipTemplates: true, skipRegExps: true,
      }],
      // --- 上限つき（'warn'。件数は tests/test_eslint.py の BASELINE） ---
      // 最上位（グローバル）は別ファイルから使われるので数えない（vars:'local'）。
      // 引数と catch の変数は「受けるが使わない」が常なので数えない。
      'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }],
      // 空の catch は「黙る道」（REVIEW 3-4 で理由を必須にする予定）。
      'no-empty': ['warn', { allowEmptyCatch: false }],
      // --- この構成では意味を持たない -------------------------------
      // `no-undef` は下の段（画面のJSだけ）で on にする。テストは Node で動くので
      // `require`/`process` を持ち、ここでは見ない。
      'no-undef': 'off',
      'no-func-assign': 'off',
      'no-prototype-builtins': 'off',
    },
  },
  {
    /* 画面のJSだけ「呼んでいるのに、どのファイルのトップレベルにも無い」を落とす。
       実際に `toast(...)`（正しくは `showToast`）が1件見つかった——`typeof` で
       囲ってあったので**断りの一言が一度も出ていなかった**（§9.354）。 */
    files: ['static/js/**/*.js'],
    languageOptions: { globals: { ...topLevelNames(), ...BROWSER } },
    rules: { 'no-undef': 'error' },
  },
];
