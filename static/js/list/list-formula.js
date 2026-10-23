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
  + - * / %  ( )      四則(+は数どうしなら足し算、片方が字なら連結・§9.581)
  = <> < <= > >=      比較(真なら1、偽なら0。数どうしは数で・空欄は大小に当たらない)
  and / or / not      論理
  if(条件, 真, 偽)    条件分岐
  num(x) text(x) round(x,n) abs(x) len(x) left(x,n) right(x,n)
  concat(...) trim(x) upper(x) lower(x) coalesce(...)
*/
(function(){
 /* 長すぎる式は読めないので入口で断る。**2000字**（§9.474）——表示ルールを式へ変換すると
    （行＝if の入れ子）実際のルール（4条件×6行）で 400字を超えた。 */
 const MAX_LEN=2000;
 /* 式の中に書く数（`12`・`12.5`・`.5`）。3桁区切りは書けない（`,`は引数の区切り）。 */
 const NUM=/^(\d+(\.\d+)?|\.\d+)/;

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
    const rng=ARITY_RANGE[x.v];
    if(rng&&(args.length<rng[0]||args.length>rng[1]))
     throw Error(`${x.v} は引数が${rng[0]}〜${rng[1]}個です（${args.length}個でした）`);
    /* 正規表現を字で書いたときは**書いている最中に**確かめる（壊れた書き方を
       実データの行が全部空になってから知らせない）。 */
    if(REGEX_FUNCS.has(x.v)&&args[1]&&args[1].k==='str'){
     try{reOf(String(args[1].v),'')}
     catch(e){throw Error(`${x.v} の正規表現として読めません: ${e.message}`)}
    }
    return {k:'call',name:x.v,args};
   }
   throw Error('式として読めません');
  }
  const node=orExpr();
  if(p<ts.length)throw Error('式の後ろに余分なものがあります');
  return node;
 }

 /* ---------- 評価 ---------- */
 /* ---------- 数の読み方（§9.581・**画面ではここが1箇所**） ----------
    値は字で届く（'1,200'・'12.50'・'010'・'12A'）。読み方は2つだけ持ち、どこもこのどちらかを呼ぶ:
      looseNum  … **数として読めるか**。字の全体が数のときだけ（前後の空白・3桁区切り・先頭のゼロ・
                  「+」・末尾のゼロを許す）。**部分だけは読まない**（'12A'→12・'2026-10-11'→2026 にしない）。
                  3桁区切りは**正しい位置のときだけ**（'1,2'・'12,00' は字のまま）。
      strictNum … **書いてある通りに数か**（数か字かを決める所＝比較演算子と`+`）。looseNum に加えて
                  **整数の部分が0で始まらない**こと（'010'・'007' はコード＝字。'0'・'0.5' は数）。
    計算（- * / % と関数）は looseNum、比較演算子と`+`は strictNum、表示ルールの比べ方`cmp()`は looseNum
    （§9.477の約束どおり '5' と '05' を同じに見る）。サーバーの並べ替え・絞り込みは`sort_order.num_of()`が
    同じ決まりを持つ（網: test_formula の表と test_sortpipe）。 */
 const LOOSE_NUM=/^[-+]?((\d{1,3}(,\d{3})+|\d+)(\.\d*)?|\.\d+)$/;
 const textOf=v=>v===null||v===undefined?'':String(v);
 const looseNum=v=>{
  if(typeof v==='number')return Number.isFinite(v)?v:null;
  const t=textOf(v).trim();
  if(!t||!LOOSE_NUM.test(t))return null;
  const n=Number(t.replace(/,/g,''));return Number.isFinite(n)?n:null;
 };
 const strictNum=v=>{
  if(typeof v==='number')return Number.isFinite(v)?v:null;
  const n=looseNum(v);
  if(n===null)return null;
  const int=textOf(v).trim().replace(/^[-+]/,'').split('.')[0];
  return int.length>1&&int[0]==='0'?null:n;
 };
 const numOf=looseNum;
 /* 計算の結果は**15桁へ丸める**（0.1+0.2 を 0.30000000000000004 と出さない・= 0.3 を偽にしない）。
    15桁は倍精度で確かに表せる桁数。測定の値（多くて6桁）を落とすことはない。 */
 const tidy=n=>Number.isFinite(n)?Number(n.toPrecision(15)):null;
 /* 四捨五入は**0から遠い側へ**（Excel の ROUND と同じ: -2.5→-3）。桁は10進の字でずらす
    （1.005×100 は 100.4999… なので、掛け算でずらすと 1.00 になる）。 */
 function roundHalfAway(n,d){
  const shift=(x,k)=>{const [m,e]=String(x).split('e');return Number(m+'e'+((Number(e)||0)+k))};
  const r=Math.round(shift(Math.abs(n),d));
  return tidy(Math.sign(n)*shift(r,-d));
 }
 const truthy=v=>{const n=numOf(v);return n===null?textOf(v)!=='':n!==0};
 /* **表示ルールの比べ方**（§9.477）: 両辺が数として読めれば数で、そうでなければ字で比べる（-1/0/1）。
    上の比較演算子（`=`等）は先頭ゼロのコードを取り違えないために strictNum で読むので、2つは別の約束。
    **表示ルールの判定（base.js）もこの1本を呼ぶ**——ルールを式へ変換したとき、同じ比べ方の式
    （`cmp(a,b) = 0`）で同じ答えになる。 */
 /* **大小を比べられるか**（§9.581）: どちらかが空欄なら比べない。字の比べ方だと空欄は「どの数より
    小さい」になり、`[値] < 5`が未入力の行にまで当たる。式の`<`等・表示ルールの大小・サーバーの
    `rule_test`が同じ答えを使う（`=`／`<>`は空欄どうしの一致を見たいので対象外）。 */
 const ordered=(a,b)=>textOf(a).trim()!==''&&textOf(b).trim()!=='';
 function cmp(a,b){
  const x=looseNum(a),y=looseNum(b);
  if(x!==null&&y!==null)return x<y?-1:x>y?1:0;
  const s=textOf(a),t=textOf(b);
  return s<t?-1:s>t?1:0;
 }

 /* ---------- 文字列からの抽出・変換（§9.464、利用者の指示「データの抽出などは対応できて
    いないので、文字列からの抽出や変換処理もできるように」） ----------
    正規表現は利用者が書く。**壊れた書き方はその行を空にする**（列ごと落とさない・
    `compile().run`が受ける）。長すぎる書き方は断り、作った正規表現は使い回す
    （行ごとに作り直すと200行×列で効いてくる）。 */
 const RE_MAX=200;
 const reCache=new Map();
 function reOf(src,flags){
  const k=flags+'\u0000'+src;
  if(reCache.has(k))return reCache.get(k);
  if(src.length>RE_MAX)throw Error(`正規表現は${RE_MAX}文字までです`);
  const re=new RegExp(src,flags);
  if(reCache.size>200)reCache.clear();
  reCache.set(k,re);
  return re;
 }
 /* 位置は**1から数える**（Excelの MID／FIND と同じ・現場の数え方）。 */
 const posOf=v=>{const n=numOf(v);return n===null?1:Math.max(1,Math.floor(n))};
 /* ---------- §9.628 で足した関数（LotScope のダッシュボードの移植。LotScope の list-formula.js と同じ名前・同じ答え。
    数の読み方は上の looseNum／strictNum、計算の結果の丸めは tidy のまま）。サーバーは backend/dashboard/formula.py が
    同じ決まりで計算する（網: test_formulaparity が同じ式・同じ行を両方で突き合わせる）。 ---------- */
 const nums=a=>a.map(numOf).filter(n=>n!==null);
 const digitsOf=v=>Math.trunc(Math.max(0,Math.min(8,numOf(v)||0)));
 /* Excel の ROUNDUP（0 から遠い側）・ROUNDDOWN（0 の側）。x×10^桁 の小さな誤差は 15 桁で丸めてから切る */
 function roundDir(a,up){const n=numOf(a[0]);if(n===null)return null;
  const p=Math.pow(10,a.length>1?digitsOf(a[1]):0),t=parseFloat((Math.abs(n)*p).toPrecision(15));
  return tidy((n<0?-1:1)*(up?Math.ceil(t):Math.floor(t))/p)}
 const REPT_MAX=10000;
 /* 1バイトに数える字（ASCII と半角カナ ｡〜ﾟ） */
 const lenbOne=c=>{const k=c.charCodeAt(0);return k<=0x7f||(k>=0xff61&&k<=0xff9f)};
 /* 日時（年月日・時刻）。数字は半角だけ。区切りは - / . 年月日 と、日と時刻の間の T・空白（全角の空白も） */
 const D_YMD=/^([0-9]{4})[-/.年]([0-9]{1,2})[-/.月]([0-9]{1,2})日?(?:[T 　]+([0-9]{1,2})[:時]([0-9]{1,2})(?:[:分]([0-9]{1,2})(?:\.[0-9]+)?秒?)?)?$/,
       D_YY=/^([0-9]{2})\/([0-9]{1,2})\/([0-9]{1,2})(?:[T 　]+([0-9]{1,2}):([0-9]{1,2})(?::([0-9]{1,2}))?)?$/,
       D_8=/^([0-9]{4})([0-9]{2})([0-9]{2})$/,D_T=/^([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?$/,
       DIM=[31,28,31,30,31,30,31,31,30,31,30,31];
 /* 1970-01-01 からの日数（days_from_civil。整数だけで計算する） */
 function daysOf(y,m,d){y-=m<=2?1:0;const era=Math.floor(y/400),yoe=y-era*400,
  doy=Math.floor((153*(m+(m>2?-3:9))+2)/5)+d-1;return era*146097+yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy-719468}
 /* 値 → [年,月,日,時,分,秒,日付がある]。読めなければ null（時刻だけは 1970-01-01 の時刻） */
 /** @returns {?[number,number,number,number,number,number,boolean]} 年・月・日・時・分・秒・日付を持つか（読めなければ null） */
 function when(v){
  const t=textOf(v).trim();let m=t.match(D_YMD),yy=false,g,y,has=true;
  if(!m){m=t.match(D_YY);yy=!!m}
  if(!m)m=t.match(D_8);
  if(m){g=m.slice(1).map(x=>x?parseInt(x,10):0);while(g.length<6)g.push(0);y=yy?g[0]+2000:g[0]}
  else{m=t.match(D_T);if(!m)return null;g=[1970,1,1].concat(m.slice(1).map(x=>x?parseInt(x,10):0));y=1970;has=false}
  const mo=g[1],d=g[2],h=g[3],mi=g[4],sec=g[5];
  const dim=mo===2&&(y%4===0&&(y%100!==0||y%400===0))?29:(mo>=1&&mo<=12?DIM[mo-1]:0);
  if(!(d>=1&&d<=dim&&h<=23&&mi<=59&&sec<=59))return null;
  return [y,mo,d,h,mi,sec,has];
 }
 const secOf=w=>daysOf(w[0],w[1],w[2])*86400+w[3]*3600+w[4]*60+w[5];
 const DATEDIFF_UNITS={d:86400,'日':86400,h:3600,'時':3600,'時間':3600,m:60,'分':60,s:1,'秒':1};
 const partOf=(i,needDate=true)=>a=>{const w=when(a[0]);return !w||(needDate&&!w[6])?null:w[i]};
 const ymdText=(y,m,d)=>`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
 /* y 年 m 月の第 wk 週・曜日 wd（日＝1〜土＝7）の日（無ければ null）。月初を第 1 週として日曜日で進み、第 6 週は第 1 週に戻す（同じなら早い方） */
 function kamaDay(y,m,wk,wd){const first=daysOf(y,m,1),last=(m===12?daysOf(y+1,1,1):daysOf(y,m+1,1))-first,sw=((first%7)+7+4)%7;let n=0;
  for(let d=1;d<=last;d++){const dw=(sw+d-1)%7+1;if(n===0||dw===1)n=n===5?1:n+1;if(n===wk&&dw===wd)return d}return null}
 /* kamadate(釜番[, 基準日]): 釜番（週・曜日〈日＝1〜土＝7〉・何番目の 3 桁）→ 日付。釜番は月を持たないので、基準日（省くと今日）の
    前の月・その月・次の月のうち、その週・曜日の日付が基準日にいちばん近い物（同じなら前） */
 function kamadate(a){
  const k=textOf(a[0]).trim();if(!/^[0-9]{3}$/.test(k))return null;const wk=+k[0],wd=+k[1];if(wk<1||wk>5||wd<1||wd>7)return null;
  let y,m,d0;if(a.length>1){const w=when(a[1]);if(!w||!w[6])return null;y=w[0];m=w[1];d0=w[2]}else{const t=new Date();y=t.getFullYear();m=t.getMonth()+1;d0=t.getDate()}
  const base=daysOf(y,m,d0);let best=null;
  for(const dm of [-1,0,1]){const yy=m+dm===0?y-1:m+dm===13?y+1:y,mm=m+dm===0?12:m+dm===13?1:m+dm,d=kamaDay(yy,mm,wk,wd);
   if(d!==null){const gap=Math.abs(daysOf(yy,mm,d)-base);if(best===null||gap<best[0])best=[gap,yy,mm,d]}}
  return best===null?null:ymdText(best[1],best[2],best[3]);
 }
 /* = と同じ比べ方（どちらも書いてある通りに数なら数で、ほかは字で・上の cmp ノードと同じ） */
 function eqOf(a,b){const x=strictNum(a),y=strictNum(b);return x!==null&&y!==null?x===y:textOf(a)===textOf(b)}
 const sumOf=x=>x.reduce((s,v)=>s+v,0);
 const FUNCS={
  num:a=>numOf(a[0]),
  text:a=>textOf(a[0]),
  abs:a=>{const n=numOf(a[0]);return n===null?null:Math.abs(n)},
  round:a=>{const n=numOf(a[0]);if(n===null)return null;
            return roundHalfAway(n,Math.max(0,Math.min(8,Math.trunc(numOf(a[1])||0))))},
  len:a=>textOf(a[0]).length,
  left:a=>textOf(a[0]).slice(0,Math.max(0,numOf(a[1])||0)),
  right:a=>{const n=Math.max(0,numOf(a[1])||0);return n?textOf(a[0]).slice(-n):''},
  trim:a=>textOf(a[0]).trim(),
  upper:a=>textOf(a[0]).toUpperCase(),
  lower:a=>textOf(a[0]).toLowerCase(),
  concat:a=>a.map(textOf).join(''),
  coalesce:a=>{for(const v of a){if(v!==null&&v!==undefined&&v!=='')return v}return ''},
  /* mid(x, 何文字目から, 何文字)。文字数を省くと最後まで。 */
  mid:a=>{const t=textOf(a[0]),st=posOf(a[1])-1;
          const n=a.length>2?Math.max(0,numOf(a[2])||0):t.length;return t.slice(st,st+n)},
  /* find(x, 探す字)。見つかった位置（1から）、無ければ0。 */
  find:a=>{const i=textOf(a[0]).indexOf(textOf(a[1]));return i<0?0:i+1},
  /* replace(x, 探す字, 置く字)。**全部**置き換える（1つ目だけにすると、2つ目が残って気づけない）。 */
  replace:a=>textOf(a[0]).split(textOf(a[1])).join(textOf(a[2])),
  /* extract(x, 正規表現[, 組])。合った部分（組を指定すればその組）。合わなければ空。 */
  extract:a=>{const m=textOf(a[0]).match(reOf(textOf(a[1]),''));
              if(!m)return '';const g=a.length>2?Math.max(0,numOf(a[2])||0):0;return m[g]===undefined?'':m[g]},
  /* match(x, 正規表現)。合えば1・合わなければ0（条件にそのまま使える）。 */
  match:a=>reOf(textOf(a[1]),'').test(textOf(a[0]))?1:0,
  /* regreplace(x, 正規表現, 置く字)。$1 などで組を使える。 */
  regreplace:a=>textOf(a[0]).replace(reOf(textOf(a[1]),'g'),textOf(a[2])),
  /* split(x, 区切り, 何番目)。1から数える。無ければ空。 */
  split:a=>{const sep=textOf(a[1]);const parts=sep?textOf(a[0]).split(sep):[textOf(a[0])];
            const v=parts[posOf(a[2])-1];return v===undefined?'':v},
  contains:a=>textOf(a[0]).includes(textOf(a[1]))?1:0,
  /* cmp(a, b): 表示ルールと同じ比べ方（-1/0/1・§9.477）。 */
  cmp:a=>cmp(a[0],a[1]),
  startswith:a=>textOf(a[0]).startsWith(textOf(a[1]))?1:0,
  endswith:a=>textOf(a[0]).endsWith(textOf(a[1]))?1:0,
  /* 全角の英数記号・空白を半角へ（NFKC）。半角カナは全角カナになる（NFKCの決まり）。 */
  hankaku:a=>textOf(a[0]).normalize('NFKC'),
  /* padleft(x, 桁, 埋める字)。埋める字を省くと0。 */
  padleft:a=>textOf(a[0]).padStart(Math.max(0,Math.min(64,numOf(a[1])||0)),a.length>2?(textOf(a[2])||'0'):'0'),
  /* count(x, 字): 字が何回出てくるか（重ならない数え方）。regcount(x, 正規表現): 合う所の数 */
  count:a=>{const t=textOf(a[1]);return t?textOf(a[0]).split(t).length-1:0},
  regcount:a=>(textOf(a[0]).match(reOf(textOf(a[1]),'g'))||[]).length,
  /* lenb(x): 半角の英数記号・半角カナを 1、ほかを 2 と数えた長さ（Excel の LENB） */
  lenb:a=>{const t=textOf(a[0]);let n=0;for(let i=0;i<t.length;i++)n+=lenbOne(t[i])?1:2;return n},
  rept:a=>{const t=textOf(a[0]);let n=Math.trunc(Math.max(0,Math.min(1000,numOf(a[1])||0)));
           if(t&&t.length*n>REPT_MAX)n=Math.floor(REPT_MAX/t.length);return t.repeat(n)},
  min:a=>{const x=nums(a);return x.length?Math.min(...x):null},
  max:a=>{const x=nums(a);return x.length?Math.max(...x):null},
  sum:a=>{const x=nums(a);return x.length?tidy(sumOf(x)):null},
  avg:a=>{const x=nums(a);return x.length?tidy(sumOf(x)/x.length):null},
  int:a=>{const n=numOf(a[0]);return n===null?null:Math.floor(n)},
  ceil:a=>{const n=numOf(a[0]);return n===null?null:Math.ceil(n)},
  roundup:a=>roundDir(a,true),
  rounddown:a=>roundDir(a,false),
  sqrt:a=>{const n=numOf(a[0]);return n===null||n<0?null:tidy(Math.sqrt(n))},
  isnum:a=>strictNum(a[0])===null?0:1,
  isblank:a=>textOf(a[0]).trim()===''?1:0,
  /* ifs(条件1, 答え1, …[, どれでもない時])・switch(x, 値1, 答え1, …[, どれでもない時])（値は = と同じ比べ方） */
  ifs:a=>{for(let i=0;i+1<a.length;i+=2)if(truthy(a[i]))return a[i+1];return a.length%2?a[a.length-1]:''},
  switch:a=>{for(let i=1;i+1<a.length;i+=2)if(eqOf(a[0],a[i]))return a[i+1];return a.length%2===0?a[a.length-1]:''},
  year:partOf(0),month:partOf(1),day:partOf(2),hour:partOf(3,false),minute:partOf(4,false),
  /* weekday(x): 1＝日 〜 7＝土（Excel の WEEKDAY と同じ） */
  weekday:a=>{const w=when(a[0]);return !w||!w[6]?null:((daysOf(w[0],w[1],w[2])%7)+7+4)%7+1},
  date:a=>{const w=when(a[0]);return !w||!w[6]?null:ymdText(w[0],w[1],w[2])},
  /* datediff(始め, 終わり[, 単位])＝終わり−始め（d＝日〈既定〉・h＝時間・m＝分・s＝秒） */
  datediff:a=>{const x=when(a[0]),y=when(a[1]),u=DATEDIFF_UNITS[a.length>2?textOf(a[2]).trim().toLowerCase():'d'];
               return !x||!y||!u?null:tidy((secOf(y)-secOf(x))/u)},
  kamadate,
 };
 const ARITY={cmp:2,num:1,text:1,abs:1,round:2,len:1,left:2,right:2,trim:1,upper:1,lower:1,
              find:2,replace:3,match:2,regreplace:3,split:3,contains:2,startswith:2,endswith:2,
              hankaku:1,
              count:2,regcount:2,lenb:1,rept:2,int:1,ceil:1,sqrt:1,isnum:1,isblank:1,
              year:1,month:1,day:1,hour:1,minute:1,weekday:1,date:1};
 /* 引数の数に幅がある関数（下限〜上限）。 */
 const ARITY_RANGE={mid:[2,3],extract:[2,3],padleft:[2,3],
                    roundup:[1,2],rounddown:[1,2],datediff:[2,3],ifs:[2,40],switch:[3,41],kamadate:[1,2],
                    min:[1,30],max:[1,30],sum:[1,30],avg:[1,30]};
 const REGEX_FUNCS=new Set(['extract','match','regreplace','regcount']);

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
    if(n.op!=='='&&n.op!=='<>'&&!ordered(a,b))return 0;
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
     /* 両方が**書いてある通りに数**のときだけ足し算、そうでなければ**連結**。「品番+枝番」の
        使い方がいちばん多い——'12A'+'3' を 15、'010'+'3' を 13 にしない（§9.581）。 */
     const x=strictNum(a),y=strictNum(b);
     if(x!==null&&y!==null)return tidy(x+y);
     return textOf(a)+textOf(b);
    }
    const x=numOf(a),y=numOf(b);
    if(x===null||y===null)return null;
    if(n.op==='-')return tidy(x-y);
    if(n.op==='*')return tidy(x*y);
    if(n.op==='/')return y===0?null:tidy(x/y);      // 0除算は空にする(エラーにしない)
    return y===0?null:tidy(x%y);
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
 /* **関数の名前と引数の形**（§9.474・候補の表示用）。書く人が選ぶ物なので、書き方の説明（`help`）と
    同じ言葉で1つずつ持つ。`FUNCS`に足したらここにも足す（網: test_formula が両方の名前を突き合わせる）。 */
 const SIGS=[
  ['if','条件, 真のとき, 偽のとき','条件で切り替える'],
  ['and','','論理（a and b）'],['or','','論理（a or b）'],['not','','論理（not a）'],
  ['round','x, 桁','四捨五入'],['abs','x','絶対値'],['num','x','数として読む'],['text','x','文字として読む'],
  ['len','x','文字数'],['left','x, 文字数','左から切り出す'],['right','x, 文字数','右から切り出す'],
  ['mid','x, 何文字目, 文字数','途中を切り出す（位置は1から）'],['find','x, 字','字の位置（無ければ0）'],
  ['split','x, 区切り, 何番目','区切って何番目か'],['trim','x','前後の空白を取る'],
  ['upper','x','大文字へ'],['lower','x','小文字へ'],['concat','a, b','つなぐ'],['coalesce','a, b','空ならb'],
  ['replace','x, 字, 置く字','字を置き換える'],['regreplace','x, 正規表現, 置く字','正規表現で置き換える'],
  ['hankaku','x','全角の英数を半角へ'],['padleft','x, 桁, 字','左を字で埋める'],
  ['extract','x, 正規表現, 組','正規表現で抜き出す'],['match','x, 正規表現','正規表現に合うか'],
  ['contains','x, 字','字を含むか'],['cmp','a, b','比べる（数に読めれば数で・-1／0／1）'],['startswith','x, 字','字で始まるか'],['endswith','x, 字','字で終わるか'],
  ['count','x, 字','字が何回出てくるか'],['regcount','x, 正規表現','正規表現に合う所の数'],['lenb','x','バイト数（全角 2・半角 1）'],
  ['rept','x, 回数','字をくり返す'],['min','a, b, …','いちばん小さい数'],['max','a, b, …','いちばん大きい数'],
  ['sum','a, b, …','数の合計'],['avg','a, b, …','数の平均'],['int','x','小数を切り捨てた整数（小さい側）'],['ceil','x','小数を切り上げた整数'],
  ['roundup','x, 桁','切り上げ（0 から遠い側）'],['rounddown','x, 桁','切り捨て（0 の側）'],['sqrt','x','平方根'],
  ['isnum','x','数か（1／0）'],['isblank','x','空か（1／0）'],
  ['ifs','条件1, 答え1, …, どれでもない時','条件を順に見て、最初に合った答え'],['switch','x, 値1, 答え1, …, どれでもない時','値で切り替える'],
  ['year','日時','年'],['month','日時','月'],['day','日時','日'],['hour','日時','時'],['minute','日時','分'],
  ['weekday','日時','曜日（1＝日 〜 7＝土）'],['date','日時','年月日（2026-10-01 の形）'],
  ['datediff',"始め, 終わり, 'm'",'日時の差（d＝日・h＝時間・m＝分・s＝秒）'],
  ['kamadate','釜番, 基準日','釜番（週・曜日・何番目の 3 桁）→ 基準日にいちばん近い日付（基準日を省くと今日）'],
 ];
 /* ---------- 書いている最中の候補（§9.474、利用者の指示「条件式の部分もさらに使いやすく、関数などは
    特にサジェスト機能なども組み込んで」） ----------
    式の入力欄（表示ルールの条件・この列の作り方）に付ける。**焦点は入力欄のまま**（コンボボックス）
    ——`WL.popMenu`は項目へ焦点を移すメニューの器なので使わず、見た目だけ`.wl-menu`を名乗る。
      ・英字を打つと関数の候補（名前の頭が合う物が先、途中に含む物が後）
      ・[ を打つと列名の候補（`opt.columns()`が答える。表示名でも元の名前でもよい）
      ・↑↓で選び、Enter／Tab で入れる。Esc で閉じる（押下は受けたと名乗る＝窓は閉じない）
    関数は`name(`まで入れて、引数の形を候補の中に言う（例: extract(x, 正規表現, 組)）。 */
 function sgWord(inp){
  const v=inp.value,c=inp.selectionStart||0,head=v.slice(0,c);
  const open=head.lastIndexOf('['),close=head.lastIndexOf(']');
  if(open>close)return {kind:'col',q:head.slice(open+1),from:open+1,to:c};
  const m=head.match(/[A-Za-z_][A-Za-z0-9_]*$/);
  if(m&&!/['"]/.test(head.slice(-m[0].length-1,-m[0].length)))return {kind:'fn',q:m[0].toLowerCase(),from:c-m[0].length,to:c};
  return null;
 }
 /* 何を候補にするかだけをここが答え、器と鍵盤は`WL.popMenu.suggest()`の1箇所（§9.529）。 */
 function suggestItems(inp,opt){
  const w=sgWord(inp);
  if(!w)return null;
  const q=w.q.toLowerCase();
  let items;
  if(w.kind==='fn'){
   const all=SIGS.filter(([n])=>n.includes(q));
   items=[...all.filter(([n])=>n.startsWith(q)),...all.filter(([n])=>!n.startsWith(q))]
    .map(([n,a,note])=>({ins:['and','or','not'].includes(n)?n+' ':n+'(',label:n,args:a,note}));
  }else{
   const cols=((opt.columns&&opt.columns())||[]).map(String);
   items=cols.filter(n=>n.toLowerCase().includes(q)).slice(0,40).map(n=>({ins:n+']',label:n,args:'',note:'列'}));
  }
  if(!items.length||(w.kind==='fn'&&items.length===1&&items[0].label===q))return null;
  return {items:items.slice(0,12),from:w.from,to:w.to};
 }
 function suggest(inp,opt){
  const o=opt||{};
  WL.popMenu.suggest(inp,el=>suggestItems(el,o));
 }
 window.WL.formula={compile,check,parse,sigs:SIGS,truthy,cmp,ordered,looseNum,strictNum,MAX_LEN,suggest,
             /* 説明文をパネルとドキュメントで共用する(2箇所に書かない)。 */
             help:[
              ['[列名]','その行のその列の値'],
              ['+ - * / %','四則。+ は数どうしなら足し算、片方が字（010・12A など）なら連結'],
              ['= <> < <= > >=','比較(真なら1・偽なら0)。1,200・12.50 も数で比べる。010 のようなコードは字のまま。空欄は大小に当たらない'],
              ['and / or / not','論理'],
              ['if(条件, 真, 偽)','条件で切り替える'],
              ['round(x,n) abs(x) num(x)','数の整え'],
              ['concat(a,b) left(x,n) right(x,n) len(x)','文字の整え'],
              ['trim(x) upper(x) lower(x) coalesce(a,b)','その他'],
              ['mid(x,何文字目,文字数) find(x,字) split(x,区切り,何番目)','切り出す（位置は1から）'],
              ['replace(x,字,置く字) regreplace(x,正規表現,置く字) hankaku(x) padleft(x,桁,字)','変換する'],
              ['extract(x,正規表現[,組]) match(x,正規表現) contains(x,字)','抜き出す・合うか'],
              ['count(x,字) regcount(x,正規表現) lenb(x) rept(x,回数)','数える・くり返す'],
              ['min(…) max(…) sum(…) avg(…) int(x) ceil(x) roundup(x,桁) rounddown(x,桁) sqrt(x)','数の計算'],
              ['ifs(条件,答え,…) switch(x,値,答え,…) isnum(x) isblank(x)','切り替える・確かめる'],
              ["year(x) month(x) day(x) hour(x) minute(x) weekday(x) date(x) datediff(始め,終わり,'m')",'日時（作業時間は datediff で分に）'],
             ]};
})();
