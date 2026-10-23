/* tests/lib/formula_parity.js: 画面の式（static/js/list/list-formula.js）の答えを出す（§9.628）。
   サーバーの式（backend/dashboard/formula.py）が同じ答えかを tests/test_formulaparity.py が突き合わせる。
     node tests/lib/formula_parity.js 入力.json  … 入力 [{expr,row}] → 標準出力へ [{ok, value|error, text}]
   数でない数（Infinity）は字 "#Infinity" にして返す（JSON に書けないため）。 */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ctx={console};ctx.window=ctx;ctx.WL={};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','..','static','js','list','list-formula.js'),'utf8'),ctx,{filename:'list-formula.js'});
const F=ctx.WL.formula;
const cases=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const out=cases.map(({expr,row})=>{
 const chk=F.check(expr);
 if(!chk.ok)return {ok:false,error:chk.error};
 const v=F.compile(expr).run(row);
 return {ok:true,value:typeof v==='number'&&!Number.isFinite(v)?`#${String(v)}`:v===undefined?null:v,text:v==null?'':String(v)};
});
process.stdout.write(JSON.stringify(out));
