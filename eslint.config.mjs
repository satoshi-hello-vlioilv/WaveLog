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
export default [
  {
    ignores: ['static/vendor/**', 'node_modules/**', 'db/**'],
  },
  {
    files: ['static/js/**/*.js', 'tests/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script' },
    rules: {
      // --- 0件に固定（'error'） -------------------------------------
      'no-redeclare': 'error',
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
      'no-undef': 'off',
      'no-func-assign': 'off',
      'no-prototype-builtins': 'off',
    },
  },
];
