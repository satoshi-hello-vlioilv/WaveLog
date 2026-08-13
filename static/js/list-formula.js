"use strict";
/* list-formula.js: 一覧へ「計算で作る列」を足す(§9.111 ⑦)。

要望は「計算式で様々な条件を追加できるが、元の列がないと使えないので、
純粋に追加したい時に困る」。つまり**データ側に無い列を、既にある列から
作って一覧へ並べたい**。

設計の要点
------------------------------------------------------------
・**表示だけの列**。並べ替え・絞り込みはサーバーがデータ側の列に対して
  行うので、ここで作った列は対象にならない。**できないことは画面にそう
  書く**(できるように見せて効かないのが一番わかりにくい)。
・**`eval`を使わない。** 式は利用者が書くもので、しかもマスタに保存されて
  他のPCでも動く。文字列をそのままJSとして実行する作りにすると、保存した
  式がそのPCで何でもできてしまう。ここでは自前で字句解析→構文解析→評価を
  行い、**書ける物を最初から限る**。
・**壊れた式は列ごと落とさず、その行だけ空にする**(表示ルールと同じ方針)。
  式の誤りはパネル側で書いている最中に伝える。

書ける物
------------------------------------------------------------
  [列名]              その行のその列の値
  数値 / '文字列'     そのまま
  + - * / %  ( )      四則(+は数値どうしなら足し算、片方が文字なら連結)
  = <> < <= > >=      比較(真なら1、偽なら0)
  and / or / not      論理
  if(条件, 真, 偽)    条件分岐
  num(x) text(x) round(x,n) abs(x) len(x) left(x,n) right(x,n)
  concat(...) trim(x) upper(x) lower(x) coalesce(...)
*/
(function(){
 const MAX_LEN=400;          // 長すぎる式は読めないので入口で断る
 const NUM=/^\d+(\.\d+)?/;

 /* ---------- 字句解析 ---------- */
 function lex(src){
  const out=[];let i=0;
  const s=String(src||'');
  while(i<s.length){
   const ch=s[i];
   if(/\s/.test(ch)){i++;continue}
   if(ch==='['){
    const end=s.indexOf(']',i+1);
    if(end<0)throw Error('列名の [ ] が閉じていません');
    out.push({t:'col',v:s.slice(i+1,end)});i=end+1;continue;
   }
   if(ch==="'"||ch==='"'){
    const q=ch;let j=i+1,buf='';
    while(j<s.length&&s[j]!==q){buf+=s[j];j++}
    if(j>=s.length)throw Error('文字列の引用符が閉じていません');
    out.push({t:'str',v:buf});i=j+1;continue;
   }
   const m=s.slice(i).match(NUM);
   if(m){out.push({t:'num',v:parseFloat(m[0])});i+=m[0].length;continue}
   const two=s.slice(i,i+2);
   if(two==='<='||two==='>='||two==='<>'||two==='!='){out.push({t:'op',v:two==='!='?'<>':two});i+=2;continue}
   if('+-*/%(),'.includes(ch)){out.push({t:ch==='('||ch===')'||ch===','?ch:'op',v:ch});i++;continue}
   if(ch==='='||ch==='<'||ch==='>'){out.push({t:'op',v:ch});i++;continue}
   const w=s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
   if(w){out.push({t:'name',v:w[0].toLowerCase()});i+=w[0].length;continue}
   throw Error(`使えない文字です: ${ch}`);
  }
  return out;
 }

 /* ---------- 構文解析(下降型) ---------- */
 function parse(src){
  if(String(src||'').length>MAX_LEN)throw Error(`式が長すぎます(${MAX_LEN}文字まで)`);
  const ts=lex(src);let p=0;
  const peek=()=>ts[p];
  const eat=(t,v)=>{const x=ts[p];if(!x||x.t!==t||(v!==undefined&&x.v!==v))return null;p++;return x};
  const expect=(t,v)=>{const x=eat(t,v);if(!x)throw Error(`${v||t} が必要です`);return x};

  function orExpr(){
   let n=andExpr();
   while(peek()&&peek().t==='name'&&peek().v==='or'){p++;n={k:'or',a:n,b:andExpr()}}
   return n;
  }
  function andExpr(){
   let n=cmpExpr();
   while(peek()&&peek().t==='name'&&peek().v==='and'){p++;n={k:'and',a:n,b:cmpExpr()}}
   return n;
  }
  function cmpExpr(){
   let n=addExpr();
   while(peek()&&peek().t==='op'&&['=','<>','<','<=','>','>='].includes(peek().v)){
    const op=ts[p++].v;n={k:'cmp',op,a:n,b:addExpr()};
   }
   return n;
  }
  function addExpr(){
   let n=mulExpr();
   while(peek()&&peek().t==='op'&&(peek().v==='+'||peek().v==='-')){
    const op=ts[p++].v;n={k:'bin',op,a:n,b:mulExpr()};
   }
   return n;
  }
  function mulExpr(){
   let n=unary();
   while(peek()&&peek().t==='op'&&['*','/','%'].includes(peek().v)){
    const op=ts[p++].v;n={k:'bin',op,a:n,b:unary()};
   }
   return n;
  }
  function unary(){
   if(peek()&&peek().t==='op'&&peek().v==='-'){p++;return {k:'neg',a:unary()}}
   if(peek()&&peek().t==='name'&&peek().v==='not'){p++;return {k:'not',a:unary()}}
   return atom();
  }
  function atom(){
   const x=peek();
   if(!x)throw Error('式が途中で終わっています');
   if(x.t==='num'){p++;return {k:'num',v:x.v}}
   if(x.t==='str'){p++;return {k:'str',v:x.v}}
   if(x.t==='col'){p++;return {k:'col',v:x.v}}
   if(x.t==='('){p++;const n=orExpr();expect(')');return n}
   if(x.t==='name'){
    p++;
    if(!eat('('))throw Error(`関数の ( が必要です: ${x.v}`);
    const args=[];
    if(!eat(')')){
     args.push(orExpr());
     while(eat(','))args.push(orExpr());
     expect(')');
    }
    /* **知らない関数はここで断る。** 評価時まで待つと、書いている最中は
       何も言われず、実データの行が全部空になってから気づくことになる。 */
    if(x.v!=='if'&&!Object.prototype.hasOwnProperty.call(FUNCS,x.v))
     throw Error(`知らない関数です: ${x.v}`);
    if(x.v==='if'&&args.length<2)throw Error('if は if(条件, 真のとき, 偽のとき) です');
    const need=ARITY[x.v];
    if(need!==undefined&&args.length!==need)
     throw Error(`${x.v} は引数が${need}個です（${args.length}個でした）`);
    return {k:'call',name:x.v,args};
   }
   throw Error('式として読めません');
  }
  const node=orExpr();
  if(p<ts.length)throw Error('式の後ろに余分なものがあります');
  return node;
 }

 /* ---------- 評価 ---------- */
 const numOf=v=>{
  if(v===null||v===undefined||v==='')return null;
  if(typeof v==='number')return v;
  const n=parseFloat(String(v).replace(/,/g,''));
  return Number.isFinite(n)?n:null;
 };
 const textOf=v=>v===null||v===undefined?'':String(v);
 const truthy=v=>{const n=numOf(v);return n===null?textOf(v)!=='':n!==0};
 /* 比較のためだけの「本当に数か」。**元の文字へ戻して一致するときだけ数**
    とみなす。`numOf`は緩く読む(計算では '010'×2=20 でよい)が、比較で
    それをやると **`[コード] = 10` が '010' に当たってしまう**——先頭ゼロの
    コードは実データに普通にあるので、照合が黙って壊れる。 */
 const strictNum=v=>{
  if(typeof v==='number')return v;
  const s=textOf(v).trim();
  if(s==='')return null;
  const n=Number(s);
  return Number.isFinite(n)&&String(n)===s?n:null;
 };

 const FUNCS={
  num:a=>numOf(a[0]),
  text:a=>textOf(a[0]),
  abs:a=>{const n=numOf(a[0]);return n===null?null:Math.abs(n)},
  round:a=>{const n=numOf(a[0]);if(n===null)return null;
            const d=Math.max(0,Math.min(8,numOf(a[1])||0));
            const p=Math.pow(10,d);return Math.round(n*p)/p},
  len:a=>textOf(a[0]).length,
  left:a=>textOf(a[0]).slice(0,Math.max(0,numOf(a[1])||0)),
  right:a=>{const n=Math.max(0,numOf(a[1])||0);return n?textOf(a[0]).slice(-n):''},
  trim:a=>textOf(a[0]).trim(),
  upper:a=>textOf(a[0]).toUpperCase(),
  lower:a=>textOf(a[0]).toLowerCase(),
  concat:a=>a.map(textOf).join(''),
  coalesce:a=>{for(const v of a){if(v!==null&&v!==undefined&&v!=='')return v}return ''},
 };
 const ARITY={num:1,text:1,abs:1,round:2,len:1,left:2,right:2,trim:1,upper:1,lower:1};

 function evalNode(n,row){
  switch(n.k){
   case 'num':case 'str':return n.v;
   case 'col':{const v=row?row[n.v]:undefined;return v===undefined?null:v}
   case 'neg':{const a=numOf(evalNode(n.a,row));return a===null?null:-a}
   case 'not':return truthy(evalNode(n.a,row))?0:1;
   case 'and':return (truthy(evalNode(n.a,row))&&truthy(evalNode(n.b,row)))?1:0;
   case 'or':return (truthy(evalNode(n.a,row))||truthy(evalNode(n.b,row)))?1:0;
   case 'cmp':{
    const a=evalNode(n.a,row),b=evalNode(n.b,row);
    const x=strictNum(a),y=strictNum(b);
    /* **どちらも「本当に数」のときだけ数で比べる。** 緩く読むと
       「'010' = 10」が真になり、先頭ゼロのコードの照合が壊れる。 */
    const [l,r]=(x!==null&&y!==null)?[x,y]:[textOf(a),textOf(b)];
    switch(n.op){
     case '=':return l===r?1:0;
     case '<>':return l!==r?1:0;
     case '<':return l<r?1:0;
     case '<=':return l<=r?1:0;
     case '>':return l>r?1:0;
     default:return l>=r?1:0;
    }
   }
   case 'bin':{
    const a=evalNode(n.a,row),b=evalNode(n.b,row);
    if(n.op==='+'){
     const x=numOf(a),y=numOf(b);
     /* 片方でも数でなければ**連結**。「品番+枝番」のような使い方が
        いちばん多いので、そこで0が出ると意図と違う。 */
     if(x!==null&&y!==null)return x+y;
     return textOf(a)+textOf(b);
    }
    const x=numOf(a),y=numOf(b);
    if(x===null||y===null)return null;
    if(n.op==='-')return x-y;
    if(n.op==='*')return x*y;
    if(n.op==='/')return y===0?null:x/y;      // 0除算は空にする(エラーにしない)
    return y===0?null:x%y;
   }
   case 'call':{
    if(n.name==='if'){
     if(n.args.length<2)throw Error('if は if(条件, 真のとき, 偽のとき) です');
     return truthy(evalNode(n.args[0],row))
      ? evalNode(n.args[1],row)
      : (n.args.length>2?evalNode(n.args[2],row):'');
    }
    const f=FUNCS[n.name];
    if(!f)throw Error(`知らない関数です: ${n.name}`);
    return f(n.args.map(a=>evalNode(a,row)));
   }
  }
  return null;
 }

 /* ---------- 外向きのAPI ---------- */
 /* 式に出てくる列名。パネルの説明と、必要な列の取得漏れの確認に使う。 */
 function columnsUsed(node,out){
  out=out||new Set();
  if(!node||typeof node!=='object')return out;
  if(node.k==='col')out.add(node.v);
  ['a','b'].forEach(k=>{if(node[k])columnsUsed(node[k],out)});
  (node.args||[]).forEach(a=>columnsUsed(a,out));
  return out;
 }
 /* 式を1回だけ解いて使い回す(行ごとに解き直すと200行×列で効いてくる)。 */
 function compile(src){
  const node=parse(src);
  return {
   columns:[...columnsUsed(node)],
   run(row){
    try{return evalNode(node,row)}
    catch(e){return null}      // **その行だけ空**にする(列ごと落とさない)
   },
  };
 }
 /* 書いている最中の確認用。{ok:true} か {ok:false,error:'...'}。 */
 function check(src){
  if(!String(src||'').trim())return {ok:false,error:'式を入力してください'};
  try{const c=compile(src);return {ok:true,columns:c.columns}}
  catch(e){return {ok:false,error:e.message}}
 }

 window.WL=window.WL||{};
 window.WL.formula={compile,check,parse,
             /* 説明文をパネルとドキュメントで共用する(2箇所に書かない)。 */
             help:[
              ['[列名]','その行のその列の値'],
              ['+ - * / %','四則。+ は数値どうしなら足し算、片方が文字なら連結'],
              ['= <> < <= > >=','比較(真なら1・偽なら0)'],
              ['and / or / not','論理'],
              ['if(条件, 真, 偽)','条件で切り替える'],
              ['round(x,n) abs(x) num(x)','数の整え'],
              ['concat(a,b) left(x,n) right(x,n) len(x)','文字の整え'],
              ['trim(x) upper(x) lower(x) coalesce(a,b)','その他'],
             ]};
})();
