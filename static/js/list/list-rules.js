"use strict";
/* list-rules.js: 表示ルール(読み替え)の編集(§9.88 段4 / §9.117)
   ============================================================
   「00」を「なし」と見せる類の置き換えを、利用者自身が登録できるように
   する画面。ルールは列に属さないので、名前を付けて登録し、複数の列から
   使い回す(「00→なし」を列の数だけ書かせない)。

   考え方は1文で言える形にしてある:
     **上から順に見て、最初に当てはまったものを表示する。**
   Excelの条件付き書式と同じで、これ以上の説明が要らないことが大事。

   1行が1つの読み替えで、「もし〜ならば〜と表示」の日本語の順に並べる。
   条件を足すと「かつ」でぶら下がる(AND)。**「または」(OR)で行の中に別の組も作れる**
   （利用者の指示「OR条件も追加で組み込めるように」）。以前は「行=OR、行の中=AND」と決め、
   ORは行を分けていた——同じ表示を出すのに同じ行を2つ書かせることになる。読めなくなる心配
   （組み合わせの爆発）は**括弧を持たない**ことで抑える: 組は「かつ」を先にまとめた1段だけで、
   組の頭に区切りの線を引く（どこまでが1つの組かを並びが言う）。

   左辺には**他の列**を選べる(「区分が3のときだけ○○と出す」が書ける)。

   §9.117で入れ直したところ（どれも「作った本人が確かめられない」を潰す）:
    ・**評価順を画面から変えられる。** 「上から順に最初に当たったもの」が
      決まりなのに並べ替えができず、順番を直すには消して作り直すしか
      なかった。
    ・**既定の行（どれにも当てはまらないとき）を作れる。** 評価側は
      「条件が空の行＝既定」として前から動いていたが、条件を1つ未満に
      できないため**画面からは決して作れなかった**。
    ・**行ごとに「何件当たったか」を出す。** 条件式は書いた本人にも
      当たるか分からないのが普通で、当たらないことに一覧を見て気づくのでは
      遅い。1件も当たらない行・**上の既定に遮られて決して来ない行**は
      その場で言う。
    ・**どの列で使っているかを出す。** 使い回す前提の仕組みなので、
      直すと他の列にも効く。それを知らずに直せる状態にしない。
    ・prompt()/confirm() をやめ、アプリの確認モーダルへ揃える
      （見た目だけでなく、ブラウザの素のダイアログは浮きウィンドウの
      裏に隠れることがある）。
   ============================================================ */
(function(){
 const PANEL_ID='listRulePanel';
 let ruleName='',draft=null,onDone=null,selfColumn='',selfMode='raw',cellOf=null,toFormulaCb=null,fxSelf='';

 /* 演算子。**日本語のラベルがそのまま説明**になるように書く
    (「≧」だけだと、文字列と数値のどちらで比べるのかが伝わらない)。 */
 const OPS=[
  ['eq','＝ と等しい'],['ne','≠ と違う'],
  ['contains','を含む'],['startsWith','で始まる'],['endsWith','で終わる'],
  ['empty','が空欄'],['notEmpty','が空欄でない'],
  ['gt','＞ より大きい'],['ge','≧ 以上'],['lt','＜ より小さい'],['le','≦ 以下'],
  ['between','～ の範囲内'],['regex','正規表現に一致'],['formula','（式が真なら）'],
 ];
 /* `formula`＝**式そのものが真なら**（§9.474）。左辺を「式」にしたときはこれに決まり、符号も右辺も出さない。 */
 const NO_RIGHT=new Set(['empty','notEmpty','formula']);
 const COLORS=[['','色なし'],['ok','● 良い'],['ng','● 悪い'],['warn','● 注意'],['muted','● 目立たせない']];
 /* 「試してみる」で見る件数。**1〜2件では「たまたま」と区別が付かない**ので
    多めに取る(表の先頭から。全件を舐めると重い)。 */
 const TRY_ROWS=12;

 const blankCond=()=>({left:{kind:'self'},op:'eq',right:{kind:'value',value:''}});
 const blankRow=()=>({conditions:[blankCond()],text:'',color:''});
 /* 条件が空の行＝どれにも当てはまらなかったときの既定(評価側の約束)。 */
 const defaultRow=()=>({conditions:[],text:'',color:''});
 const isDefaultRow=r=>!((r&&r.conditions)||[]).length;

 function ensurePanel(){
  let el=document.getElementById(PANEL_ID);
  if(el)return el;
  el=document.createElement('div');
  el.className='sc-float-win';el.id=PANEL_ID;el.hidden=true;
  el.replaceChildren(WL.template('rule-panel'));
  document.body.appendChild(el);
  el.querySelector('#lrClose').onclick=close;
  el.querySelector('#lrCancel').onclick=close;
  el.querySelector('#lrSave').onclick=save;
  el.querySelector('#lrDelete').onclick=remove;
  el.querySelector('#lrAddRow').onclick=()=>{addRow(blankRow())};
  el.querySelector('#lrAddDefault').onclick=()=>{addRow(defaultRow())};
  el.querySelectorAll('.lr-mode [data-mode]').forEach(b=>b.onclick=()=>{selfMode=b.dataset.mode;paintMode();refreshCounts()});
  el.querySelector('#lrToFormula').onclick=()=>{
   const box=document.getElementById('lrFx'),btn=document.getElementById('lrToFormula');
   box.hidden=!box.hidden;btn.setAttribute('aria-expanded',box.hidden?'false':'true');
   btn.classList.toggle('is-on',!box.hidden);
   if(!box.hidden)renderFx();
  };
  if(typeof WL.makeFloatingWindow==='function')
   /* 2ペインにしたので既定の大きさを広げ、控えの鍵も改める（前の 900px の控えを引きずらない）。 */
   WL.makeFloatingWindow(el,{storageKey:'listRulePanelRectV3',defaultWidth:1180,defaultHeight:760,
                             defaultTop:60,minWidth:820,minHeight:460});
  else console.error('表示ルールの編集: WL.makeFloatingWindow が見つかりません');
  return el;
 }

 /* 既定の行は**必ず末尾へ足す**。途中に置くと、それより下の行へは決して
    来ない(死んだ行になる)。作った直後にそうなるのは避ける
    ——並べ替えで意図して上へ動かすことはできるが、そのときは警告が出る。 */
 function addRow(row){
  if(isDefaultRow(row)&&draft.some(isDefaultRow)){
   showToast&&showToast('「どれにも当てはまらないとき」は1つだけです',
    '2つ目は上のものに遮られて、決して使われません',3600);
   return;
  }
  draft.push(row);render();
 }

 /* 条件の片側。左辺は「この列 / 他の列」、右辺は「固定値 / 他の列」。
    左辺に固定値を置けても使い道が無いので選択肢に出さない(評価側は
    受け付けるので、将来必要になっても壊れない)。 */
 /* ---------- どの一覧のルールを書いているか（§9.234 ⑥） ----------
    「他の列」の候補・「試してみる」の行・当たり件数は、以前は**常に
    仕掛一覧**（`S.columns`／`S.rows`）から作っていた。スケジュール表の
    ルールを書くと、候補に出る名前はスケジュールの行に存在しないキーなので
    **条件は永久に偽**になり、しかも件数は仕掛一覧で数えるので
    「N件当たりました」と出ることがある——**画面では当たるのに実表示は空**。
    §9.117「書いた本人が確かめられる」が成立していなかった。
    口（`source`）は列の設定パネルが渡す。**答えない口は今までどおり
    仕掛一覧**（§9.120／§9.162の作法）。 */
 let panelSrc=null;
 const srcColumns=()=>{
  if(!panelSrc||typeof panelSrc.keys!=='function')return (S.columns||[]);
  const virt=(panelSrc.virtual&&panelSrc.virtual())||{};
  return panelSrc.keys().filter(k=>!virt[k]);
 };
 const srcRows=n=>{
  const rows=(panelSrc&&typeof panelSrc.rows==='function')?panelSrc.rows():(S.rows||[]);
  const out=rows.slice(0,n);
  return (panelSrc&&panelSrc.ruleRowOf)?out.map(r=>panelSrc.ruleRowOf(r)):out;
 };
 /* 条件の片側を**2つの器**で返す: 種類（この列／他の列／式／固定値）と中身。器の幅は CSS の格子が
    決める（§9.474、利用者の指示「入力欄は…整列した感じや統一感」）——どの行でも同じ列が同じ左端に並ぶ。 */
 function operandParts(side,which,ri,ci){
  const kind=side?.kind||(which==='left'?'self':'value');
  const cols=srcColumns();
  const at=`data-row="${ri}" data-cond="${ci}" data-side="${which}"`;
  /* **式**（§9.464）: 抜き出し・変換してから比べる。左辺の式は**それだけで真偽を決める**（§9.474）。 */
  const kinds=which==='left'?[['self','この列'],['column','他の列'],['calc','式']]
                            :[['value','固定値'],['column','他の列'],['calc','式']];
  const kindSel=`<select class="lr-kind" ${at}>${
    kinds.map(([v,t])=>`<option value="${v}"${kind===v?' selected':''}>${t}</option>`).join('')}</select>`;
  let detail='';
  if(kind==='column')detail=`<select class="lr-col" ${at}>${
       cols.map(c=>`<option value="${esc(c)}"${side?.column===c?' selected':''}>${esc(labelOf(c))}</option>`).join('')}</select>`;
  else if(kind==='value')detail=`<input type="text" class="lr-val" ${at} value="${esc(side?.value||'')}" placeholder="値" autocomplete="off">`;
  else if(kind==='calc')detail=`<div class="lr-exprbox"><textarea class="lr-val lr-expr" ${at} rows="1" spellcheck="false"
       placeholder="${which==='left'?"例: extract([この列],'[0-9]+') > 100 and [区分] <> 'X'":"extract([この列],'[0-9]+')"}"
       title="${esc(calcHint(side?.expr))}">${esc(side?.expr||'')}</textarea>
       <small class="lr-expr-why${calcWhy(side?.expr)?' is-ng':''}">${esc(calcWhy(side?.expr)||exprOk(which))}</small></div>`;
  else detail=`<span class="lr-self">${esc(labelOf(selfColumn))}</span>`;
  return {kindSel,detail,kind};
 }
 const exprOk=which=>which==='left'?'使える式です（真なら当てはまる）':'使える式です';
 /* 式が読めるか（§9.464）。**書いている最中に理由を字で言う**——読めない式の条件は
    当たらないので、黙っていると「当たらない理由」を探すことになる。 */
 function calcWhy(expr){
  if(!String(expr||'').trim())return '式を入れてください';
  const c=WL.formula?WL.formula.check(expr):{ok:false,error:'式の部品を読めません'};
  return c.ok?'':c.error;
 }
 function calcHint(expr){
  const why=calcWhy(expr);
  return (why?why+'\n':'')+'[この列]＝この列の値、[列名]＝他の列の値。'
   +'mid・find・replace・extract・split・hankaku などで抜き出し・変換してから比べます';
 }
 const labelOf=c=>{
  /* **口が呼び名を持っていればそちらが先**（§9.234 ⑥）——スケジュール表の
     内容欄のキーは`lotNo`のようなalias名で、そのまま並べると選んだ本人にも
     何の項目か分からない（§9.120と同じ話）。 */
  if(panelSrc&&typeof panelSrc.labelOf==='function'){
   const lb=panelSrc.labelOf(c);
   /* 表示名を付けた列は**元の見出しの言葉も添える**（§9.464）——元の名前で書いた
      条件・式も当たるので、どの列のことかを両方の名前で読めるようにする。 */
   const base=typeof panelSrc.baseLabelOf==='function'?panelSrc.baseLabelOf(c):'';
   if(lb&&base&&lb!==base)return `${lb}（元: ${base}）`;
   if(lb&&lb!==c)return `${lb}（${c}）`;
  }
  const t=(panelSrc&&typeof panelSrc.target==='function')?panelSrc.target()
    :(typeof WL.list.listLayoutTarget==='function'?WL.list.listLayoutTarget():'');
  const n=t?WL.columnLayout.label(t,c):c;
  return n===c?c:`${n}（${c}）`;
 };

 /* 接続詞。先頭は「もし」、2つ目からは**選べる**（かつ／または・利用者の指示「OR条件も追加で組み込める
    ように」）。「または」から新しい組が始まり、組の頭に区切りの線を引く——「かつ」を先にまとめることを
    並びそのものが言う（どこまでが1つの組かを読ませない）。条件とかっこの組で同じ1つを使う。 */
 function conjHtml(cond,ri,path,first,inGroup){
  /* かっこの中の1つ目は「もし」ではなく**開き括弧**——式のように「かつ（ … または … ）」と読める。 */
  if(first)return inGroup?'<span class="lr-conj lr-paren">（</span>':'<span class="lr-conj">もし</span>';
  const isOr=cond.join==='or';
  return `<span class="lr-conj"><select class="lr-join" data-row="${ri}" data-cond="${path}" aria-label="前の条件とのつなぎ方"
      title="かつ＝前の条件と両方当たるとき／または＝ここから別の組（どれかの組が全部当たれば、この行を表示）">
      <option value="and"${isOr?'':' selected'}>かつ</option><option value="or"${isOr?' selected':''}>または</option></select></span>`;
 }
 /* 条件を足すボタン。`data-parent`＝足す先（行そのものは''・かっこの中はその組の道）。
    かっこは`GROUP_DEPTH`段まで（それより深い組は読めなくなる。サーバーの上限と同じ）。 */
 const GROUP_DEPTH=2;
 function addsHtml(ri,parent,depth){
  const b=(kind,join,label,title)=>`<button type="button" class="lr-cond-add" data-row="${ri}" data-parent="${parent}"
    data-kind="${kind}" data-join="${join}" title="${title}">${label}</button>`;
  return `<span class="lr-cond-adds">${b('cond','and','＋ かつ','条件を足します（前の条件と両方当たるとき）')}${
   b('cond','or','＋ または','別の組の条件を足します（どれかの組が全部当たれば当てはまる）')}${
   depth<GROUP_DEPTH?b('group','and','＋ （ ）','かっこを足します。かっこの中を先にまとめてから、前の条件とつなぎます'):''}</span>`;
 }
 /* 条件の並び（行、またはかっこの中）。道（`data-cond`）は「2」「2.0」のように組の中の番号を点でつなぐ。 */
 function condsHtml(list,ri,prefix,depth){
  return (list||[]).map((c,i)=>{
   const path=prefix===''?String(i):`${prefix}.${i}`;
   return WL.displayRules.isGroup(c)?groupHtml(c,ri,path,i===0,depth+1):condHtml(c,ri,path,i===0,depth>0);
  }).join('');
 }
 /* かっこの組（利用者の指示「かっこも入れられるようにしたい。使いやすいUIで」）。**左の太い線が括弧**
    ——中の条件がどこまでかを線の長さが言う。見出しは前とのつなぎ方と「かっこ」、中の1つ目の接続詞が「（」、
    足元が「）」と中へ足すボタン。外す（中身を1段上へ）と消す（中身ごと）の2つを見出しに置く。 */
 function groupHtml(g,ri,path,first,depth){
  const isOr=!first&&g.join==='or';
  return `<div class="lr-group${isOr?' is-or':''}" data-depth="${depth}">
   <div class="lr-group-head">${conjHtml(g,ri,path,first,depth>1)}
    <span class="lr-group-cap">かっこ（中を先にまとめてから、前とつなぎます）</span>
    <button type="button" class="lr-group-unwrap" data-row="${ri}" data-cond="${path}" title="かっこを外します（中の条件は残ります）">かっこを外す</button>
    <button type="button" class="lr-cond-del" data-row="${ri}" data-cond="${path}" title="このかっこを中の条件ごと消す" aria-label="このかっこを中の条件ごと消す">×</button></div>
   <div class="lr-group-body">${condsHtml(g.conditions,ri,path,depth)}</div>
   <div class="lr-group-foot"><span class="lr-paren">）</span>${addsHtml(ri,path,depth)}</div>
  </div>`;
 }

 /* 1つの条件＝格子の1行（接続詞｜左の種類｜左の中身｜比べ方｜右辺｜×）。**左辺が式なら比べ方と右辺は
    出さず、式の欄がその場所まで伸びる**（§9.474、利用者の指示「式を選んだら、条件式の符号など選ばずに、
    列の作り方にあるような自由度の高い内容で組めるように」）。 */
 function condHtml(cond,ri,ci,first,inGroup){
  const L=operandParts(cond.left,'left',ri,ci);
  const fx=cond.op==='formula'&&L.kind==='calc';
  const right=NO_RIGHT.has(cond.op)?'':(()=>{
   const R=operandParts(cond.right,'right',ri,ci);
   const R2=cond.op==='between'?operandParts(cond.right2,'right2',ri,ci):null;
   return `${R.kindSel}${R.detail}${R2?`<span class="lr-conj lr-conj-in">〜</span>${R2.kindSel}${R2.detail}`:''}`;
  })();
  /* 2つ目からの接続詞は**選べる**（かつ／または・利用者の指示「OR条件も追加で組み込めるように」）。
     「または」から新しい群が始まり、群の頭に区切りの線を引く——「かつ」を先にまとめることを
     並びそのものが言う（どこまでが1つの群かを読ませない）。 */
  const isOr=!first&&cond.join==='or';
  return `<div class="lr-cond${fx?' is-fx':''}${isOr?' is-or':''}">
   ${conjHtml(cond,ri,ci,first,inGroup)}
   <span class="lr-c lr-c-kind">${L.kindSel}</span>
   <span class="lr-c lr-c-left">${L.detail}</span>
   ${fx?'':`<span class="lr-c lr-c-op"><select class="lr-op" data-row="${ri}" data-cond="${ci}">${
    OPS.filter(([v])=>v!=='formula'||L.kind==='calc')
     .map(([v,t])=>`<option value="${v}"${cond.op===v?' selected':''}>${t}</option>`).join('')
   }</select></span>
   <span class="lr-c lr-c-right">${right}</span>`}
   <button type="button" class="lr-cond-del" data-row="${ri}" data-cond="${ci}"
    title="この条件を消す" aria-label="この条件を消す">×</button>
  </div>`;
 }

 /* 行1つ。左端に「何番目か」と上下の矢印を出す——**評価順がこの並びそのもの**
    なので、順番が目に入る位置に無いと、当たらない理由に気づけない。 */
 function rowHtml(row,ri){
  const conds=row.conditions||[];
  const def=isDefaultRow(row);
  const stat=hitStat(ri);
  return `<div class="lr-row${def?' lr-row-default':''}${stat.dead?' lr-row-dead':''}" data-row="${ri}">
   <div class="lr-row-rank">
    <span class="lr-rank-no">${ri+1}</span>
    <button type="button" class="lr-up" data-row="${ri}" title="1つ上へ"${ri===0?' disabled':''}>▲</button>
    <button type="button" class="lr-down" data-row="${ri}" title="1つ下へ"${ri===draft.length-1?' disabled':''}>▼</button>
   </div>
   <div class="lr-row-main">
    <div class="lr-row-conds">${
     def?'<div class="lr-cond lr-cond-any"><span class="lr-conj">どれにも当てはまらないとき</span></div>'
        :condsHtml(conds,ri,'',0)
    }</div>
    <div class="lr-row-then">
     <span class="lr-conj">→ 表示</span>
     <input type="text" class="lr-text" data-row="${ri}" value="${esc(row.text||'')}"
      placeholder="元の値のまま（=で始めると式）" autocomplete="off" spellcheck="false"
      title="空欄なら元の値のまま。=で始めると式で作ります（例: =extract([この列],'[0-9]+') で数字の部分だけを出す）">
     <select class="lr-color" data-row="${ri}" aria-label="色">${
      COLORS.map(([v,t])=>`<option value="${v}"${(row.color||'')===v?' selected':''}>${t}</option>`).join('')
     }</select>
     ${def?'<span></span>':addsHtml(ri,'',0)}
     <button type="button" class="lr-row-del" data-row="${ri}" title="この行を消す" aria-label="この行を消す">×</button>
    </div>
    ${stat.note?`<div class="lr-row-stat${stat.dead?' is-dead':''}">${esc(stat.note)}</div>`:''}
   </div>
  </div>`;
 }

 /* ---------- 当たり具合 ----------
    実データの先頭TRY_ROWS件を、**この下書きのまま**評価して数える。
    「保存しないと試せない」では、直した結果を確かめずに保存することになる。 */
 let hits=[];                       // hits[ri] = その行が採用された件数
 /* **一覧のセルと同じ道で**数える（§9.474）——列の値（元のデータ／表示の値）も、他の列の見え方も、
    呼び出し側が渡す`cellOf(row)`（この列の生の値・書式・列の見え方）で決まる。渡されなければ行の値のまま。 */
 function recount(){
  const rows=srcRows(TRY_ROWS);
  hits=draft.map(()=>0);
  WL.displayRules.put('__draft__',draft,{self:selfMode});
  const picked=rows.map(r=>{
   const c=cellOf?cellOf(r):{raw:r?r[selfColumn]:''};
   const opt={raw:c.raw,format:c.format||null,view:c.view||null,row:r,column:selfColumn};
   const vr=WL.cellFormat.ruleRow('__draft__',opt);
   const hit=WL.displayRules.match('__draft__',vr,selfColumn);
   const i=hit?draft.indexOf(hit):-1;
   if(i>=0)hits[i]++;
   const out=WL.cellFormat.cell(Object.assign({rule:'__draft__'},opt));
   return {row:r,hit,index:i,seen:vr[selfColumn],out};
  });
  WL.displayRules.put('__draft__',null);
  return picked;
 }
 /* 「決して来ない行」= 自分より上に既定の行がある。**これは条件の書き方に
    関係なく確実に死ぬ**ので、件数が0なだけの行とは分けて言う。 */
 function hitStat(ri){
  const above=draft.slice(0,ri).some(isDefaultRow);
  if(above)return {dead:true,note:'この上に「どれにも当てはまらないとき」があるため、ここへは決して来ません'};
  const n=hits[ri];
  if(n==null)return {dead:false,note:''};
  if(n>0)return {dead:false,note:`試したデータのうち ${n}件がこの行になりました`};
  return {dead:false,note:'試したデータでは1件も当たりませんでした（データ側に無いだけかもしれません）'};
 }

 function render(){
  const box=document.getElementById('lrRows');if(!box)return;
  const picked=recount();
  box.innerHTML=draft.map(rowHtml).join('')||'<div class="sc-empty-note">「＋ 行を追加」から作ります。</div>';
  bind(box);
  renderTry(picked);
  const add=document.getElementById('lrAddDefault');
  if(add)add.disabled=draft.some(isDefaultRow);
 }

 function bind(box){
  const n=e=>Number(e.currentTarget.dataset.row);
  const condOf=e=>{const a=slotOf(draft[n(e)],e.currentTarget.dataset.cond);return a.list[a.i]};
  box.querySelectorAll('.lr-kind').forEach(el=>el.onchange=e=>{
   const c=condOf(e),side=e.currentTarget.dataset.side,kind=e.currentTarget.value;
   const at=`[data-row="${e.currentTarget.dataset.row}"][data-cond="${e.currentTarget.dataset.cond}"]`;
   /* 「他の列」の既定は**この窓が並べている列**の先頭（§9.464）。仕掛一覧の列
      （`S.columns`）を入れていたので、スケジュール表では選択肢に無い列が保存されていた。 */
   c[side]=kind==='column'?{kind:'column',column:srcColumns()[0]||''}
          :kind==='value'?{kind:'value',value:''}
          :kind==='calc'?{kind:'calc',expr:''}:{kind:'self'};
   /* 左辺を式にしたら**式だけで真偽を決める**（§9.474）。式から戻したら普通の比べ方へ。 */
   if(side==='left'&&kind==='calc'){c.op='formula';delete c.right;delete c.right2}
   else if(side==='left'&&c.op==='formula'){c.op='eq';c.right={kind:'value',value:''}}
   render();
   /* 描き直すと`e.currentTarget`は消えるので、どの欄かは描く前に控えた`at`で引く。 */
   if(side==='left'&&kind==='calc')requestAnimationFrame(()=>
    document.querySelector(`#lrRows .lr-expr${at}[data-side="left"]`)?.focus());
  });
  box.querySelectorAll('.lr-col').forEach(el=>el.onchange=e=>{
   condOf(e)[e.currentTarget.dataset.side].column=e.currentTarget.value;render();
  });
  box.querySelectorAll('.lr-val').forEach(el=>el.oninput=e=>{
   const sd=condOf(e)[e.currentTarget.dataset.side];
   if(el.classList.contains('lr-expr')){
    sd.expr=e.currentTarget.value;
    const why=el.nextElementSibling,bad=calcWhy(sd.expr);
    if(why&&why.classList.contains('lr-expr-why')){
     why.textContent=bad||exprOk(e.currentTarget.dataset.side);why.classList.toggle('is-ng',!!bad);
    }
    el.title=calcHint(sd.expr);
    grow(el);
    refreshCounts();return;
   }
   sd.value=e.currentTarget.value;
   /* **入力中は組み直さない。** 1文字ごとに作り直すと入力欄が作り替わって
      カーソルが飛ぶ。数え直しと「試してみる」だけを更新する。 */
   refreshCounts();
  });
  /* 式の欄: 中身なりに伸ばし、関数と列名の候補を付ける（§9.474）。候補の列名は**この表の列**。 */
  box.querySelectorAll('.lr-expr').forEach(el=>{grow(el);WL.formula.suggest(el,{columns:()=>srcColumns()})});
  box.querySelectorAll('.lr-text').forEach(el=>WL.formula.suggest(el,{columns:()=>srcColumns()}));
  box.querySelectorAll('.lr-op').forEach(el=>el.onchange=e=>{
   const c=condOf(e);c.op=e.currentTarget.value;
   // 右辺を持たない演算子へ変えたら右辺を落とす(保存されて残らないように)
   if(NO_RIGHT.has(c.op)){delete c.right;delete c.right2}
   else if(!c.right)c.right={kind:'value',value:''};
   if(c.op==='between'&&!c.right2)c.right2={kind:'value',value:''};
   if(c.op!=='between')delete c.right2;
   render();
  });
  bindCondEdits(box,n,condOf);
  box.querySelectorAll('.lr-row-del').forEach(el=>el.onclick=e=>{
   draft.splice(n(e),1);render();
  });
  box.querySelectorAll('.lr-up').forEach(el=>el.onclick=e=>move(n(e),-1));
  box.querySelectorAll('.lr-down').forEach(el=>el.onclick=e=>move(n(e),1));
  box.querySelectorAll('.lr-text').forEach(el=>el.oninput=e=>{
   draft[n(e)].text=e.currentTarget.value;refreshCounts();
  });
  box.querySelectorAll('.lr-color').forEach(el=>el.onchange=e=>{
   draft[n(e)].color=e.currentTarget.value;refreshCounts();
  });
 }

 /* 道（「2.0」）から、その条件が入っている並びと番号を引く。''は行の並びそのもの（番号なし）。 */
 function slotOf(row,path){
  const ps=String(path).split('.').filter(x=>x!=='').map(Number);
  let list=row.conditions;
  for(let k=0;k<ps.length-1;k++)list=list[ps[k]].conditions;
  return {list,i:ps.length?ps[ps.length-1]:-1};
 }
 /* 並びから1つ抜く。**組の頭（「または」）を抜いたら、同じ組の次が頭を継ぐ**——継がないと、残った
    条件が前の組へ「かつ」でつながり、当たる行が黙って変わる。先頭を抜いたら次が「もし」になる。 */
 function takeOut(list,i){
  const gone=list.splice(i,1)[0],next=list[i];
  if(next&&i===0)delete next.join;
  else if(next&&gone&&gone.join==='or')next.join='or';
  return gone;
 }
 /* 条件の増減・つなぎ方（かつ／または）・かっこ。行の中の組の形を変えるのはここだけ。 */
 function bindCondEdits(box,n,condOf){
  /* **最後の1つも消せる。** 消すと条件が空＝「どれにも当てはまらないとき」に
     なる。以前はここを disabled にしていたため、既定の行を画面から作る
     手立てが1つも無かった。かっこの中の最後の1つを消したら、かっこごと消す（空のかっこは当たらない）。 */
  box.querySelectorAll('.lr-cond-del').forEach(el=>el.onclick=e=>{
   const row=draft[n(e)];let path=e.currentTarget.dataset.cond;
   for(;;){
    const a=slotOf(row,path);takeOut(a.list,a.i);
    if(a.list.length||!path.includes('.'))break;
    path=path.slice(0,path.lastIndexOf('.'));
   }
   render();
  });
  box.querySelectorAll('.lr-cond-add').forEach(el=>el.onclick=e=>{
   const d=e.currentTarget.dataset,row=draft[n(e)];
   const c=d.kind==='group'?{kind:'group',conditions:[blankCond()]}:blankCond();
   if(d.join==='or')c.join='or';
   const list=d.parent===''?row.conditions:(a=>a.list[a.i].conditions)(slotOf(row,d.parent));
   list.push(c);render();
  });
  box.querySelectorAll('.lr-join').forEach(el=>el.onchange=e=>{
   const c=condOf(e);if(e.currentTarget.value==='or')c.join='or';else delete c.join;render();
  });
  /* かっこを外す: 中の条件をその場へ並べ直す。かっこの前とのつなぎ方は中の1つ目が継ぐ。 */
  box.querySelectorAll('.lr-group-unwrap').forEach(el=>el.onclick=e=>{
   const a=slotOf(draft[n(e)],e.currentTarget.dataset.cond),g=a.list[a.i];
   const inner=(g.conditions||[]).slice();
   if(inner.length){if(g.join==='or'&&a.i>0)inner[0].join='or';else delete inner[0].join}
   a.list.splice(a.i,1,...inner);
   render();
  });
 }

 /* 式の欄は1行から始めて、中身が折り返したぶんだけ伸ばす（入れ物は中身の長さから・§CLAUDE 11）。 */
 function grow(el){el.style.height='auto';el.style.height=`${Math.min(el.scrollHeight+2,160)}px`}
 function move(ri,d){
  const to=ri+d;
  if(to<0||to>=draft.length)return;
  const [row]=draft.splice(ri,1);
  draft.splice(to,0,row);
  render();
 }

 /* 入力中の更新。**組み直さない**(カーソルが飛ぶ)ので、行の状態表示と
    「試してみる」だけを差し替える。 */
 function refreshCounts(){
  const picked=recount();
  draft.forEach((_,ri)=>{
   const el=document.querySelector(`#lrRows .lr-row[data-row="${ri}"]`);
   if(!el)return;
   const stat=hitStat(ri);
   el.classList.toggle('lr-row-dead',!!stat.dead);
   let note=el.querySelector('.lr-row-stat');
   if(!stat.note){if(note)note.remove();return}
   if(!note){note=document.createElement('div');note.className='lr-row-stat';
             el.querySelector('.lr-row-main').appendChild(note)}
   note.textContent=stat.note;
   note.classList.toggle('is-dead',!!stat.dead);
  });
  renderTry(picked);
  renderFx();
 }

 /* 「試してみる」。**保存前に実データでの結果が見える**ことがこの画面の要。
    **どの行が採用されたか**も出す——結果だけ見せても、思ったのと違うときに
    どこを直せばよいか分からない。 */
 /* 左の枠（§9.474）。1件＝「列の値（いまの見方）→ 表示」と、**どの行に当たったか**。上に件数の要約。 */
 function renderTry(picked){
  const box=document.getElementById('lrTry');if(!box)return;
  const list=picked||[];
  const hit=list.filter(p=>p.index>=0).length;
  const out=list.map(p=>{
   const seen=String(p.seen??'');
   return `<li class="${p.index>=0?'is-hit':'is-miss'}"><code title="条件が見た値">${esc(seen||'（空欄）')}</code>`
    +`<span class="lr-try-arrow" aria-hidden="true">→</span>`
    +`<b class="${p.out&&p.out.color?'cell-'+p.out.color:''}">${esc(p.out?p.out.text:seen)||'（空欄）'}</b>`
    +(p.index>=0?`<span class="lr-which">${p.index+1}行目</span>`:'<span class="lr-nohit">当てはまらず</span>')+'</li>';
  }).join('');
  box.innerHTML=`<div class="lr-try-head"><b>試した結果</b>
    <small>${esc(labelOf(selfColumn))} の先頭${list.length}件・${selfMode==='shown'?'表示の値':'元のデータ'}で比べています</small>
    <span class="lr-try-sum"><i class="is-hit">当てはまった ${hit}件</i><i class="is-miss">当てはまらない ${list.length-hit}件</i></span></div>
   <ul class="lr-try-list">${out||'<li>データがありません</li>'}</ul>`;
 }
 /* 列の値の札（§9.474）。いまの見方を濃くし、何を比べるのかを1行で言う（推測させない）。 */
 function paintMode(){
  document.querySelectorAll('#listRulePanel .lr-mode [data-mode]').forEach(b=>{
   const on=b.dataset.mode===selfMode;
   b.classList.toggle('is-on',on);b.setAttribute('aria-checked',on?'true':'false');
  });
  const n=document.getElementById('lrModeNote');
  if(n)n.textContent=selfMode==='shown'
   ?'この列も他の列も、作り方の式→読み替え→値の整え方の後の値で比べます'
   :'この列も他の列も、処理する前のデータで比べます（式の列は式の結果）';
 }
 /* 「式にする」（§9.474、利用者の指示「条件設定のUIを使って作ったルールを、『この列の作り方』の条件式の
    入力欄に直接入れられるように式変換」）。変換そのものは`WL.displayRules.toFormula()`の1箇所。 */
 function renderFx(){
  const box=document.getElementById('lrFx');if(!box||box.hidden)return;
  const r=WL.displayRules.toFormula(draft,{column:selfColumn,self:fxSelf?`(${fxSelf})`:'',mode:selfMode});
  const chk=WL.formula.check(r.expr);
  box.innerHTML=`<div class="lr-fx-head"><b>このルールと同じ意味の式</b>
    <small>行＝if の入れ子（上から順）・かつ＝and・または＝or（かつを先にまとめる）・（ ）＝かっこ・どれにも当てはまらないとき＝最後の値</small></div>
   <textarea class="lr-fx-out" readonly rows="3" spellcheck="false">${esc(r.expr)}</textarea>
   <div class="lr-fx-state ${chk.ok?'is-ok':'is-ng'}">${chk.ok?`使える式です（${r.expr.length}字）`:esc(chk.error)}</div>
   ${r.notes.length?`<ul class="lr-fx-notes">${r.notes.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`:''}
   <div class="lr-fx-acts">
    <button type="button" id="lrFxCopy">コピー</button>
    ${toFormulaCb?`<button type="button" id="lrFxPut" class="sc-column-save"${chk.ok?'':' disabled'}>「この列の作り方」へ入れる</button>`
      :'<small>列の設定から開くと「この列の作り方」へそのまま入れられます</small>'}
   </div>`;
  const ta=box.querySelector('.lr-fx-out');grow(ta);
  box.querySelector('#lrFxCopy').onclick=async()=>{
   try{await navigator.clipboard.writeText(r.expr);showToast&&showToast('式をコピーしました','',2200)}
   catch(e){ta.select();showToast&&showToast('コピーできませんでした','選んだ状態にしたので Ctrl+C でコピーしてください',4000)}
  };
  const put=box.querySelector('#lrFxPut');
  if(put)put.onclick=()=>{toFormulaCb(r.expr);showToast&&showToast('「この列の作り方」へ入れました','列の設定で「保存」すると一覧に効きます',3600)};
 }

 /* このルールを使っている列。**分からないとき(null)は黙る**
    ——「どこにも使われていません」と言い切ると、消してよいと読まれる。 */
 function renderUsage(){
  const el=document.getElementById('lrUsage');if(!el)return;
  const used=WL.displayRules.usage(ruleName);
  if(!used){el.textContent='';return}
  if(!used.length){el.textContent='まだどの列でも使っていません';return}
  const names=used.slice(0,4).map(u=>labelOf(u.column)).join('、');
  el.textContent=`使っている列: ${names}${used.length>4?` ほか${used.length-4}件`:''}（直すと全部に効きます）`;
 }

 /* 保存・削除のあと、**いま見ている表**を描き直す（§9.234 ⑥）。
    `renderGrid()`は仕掛一覧専用なので、口が答えるならそちらも呼ぶ
    ——呼ばないと、スケジュール表ではルールを直しても画面が変わらない。 */
 function applyToView(){
  if(panelSrc&&typeof panelSrc.afterApply==='function'){try{panelSrc.afterApply()}catch(e){WL.quiet.note('呼び出し側の後始末に失敗（読み替えの当て込みは済んでいる）',e)}}
  else if(typeof WL.list.renderGrid==='function')WL.list.renderGrid();
 }
 async function save(){
  try{
   const r=await api('/api/display-rule-master',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({name:ruleName,rows:draft,self:selfMode}))});
   WL.displayRules.forget();await WL.displayRules.load(true);
   showToast&&showToast(`表示ルール「${ruleName}」を保存しました`,`${r.rows||0}行`,2600);
   close();
   if(typeof onDone==='function')onDone(ruleName);
   applyToView();
  }catch(e){showToast&&showToast('保存に失敗しました',e.message,5000)}
 }

 async function remove(){
  const used=WL.displayRules.usage(ruleName);
  const where=used&&used.length
   ? `<p class="confirm-modal-message">いま <b>${used.length}件</b>の列で使っています（${
       esc(used.slice(0,4).map(u=>u.column).join('、'))}${used.length>4?' ほか':''}）。
      消すと、その列は<b>元の値のまま</b>表示されます。</p>`
   : '<p class="confirm-modal-message">このルールを使っている列は、元の値のまま表示されます。</p>';
  const ok=await confirmModal({eyebrow:'DELETE',title:`表示ルール「${ruleName}」を削除`,
                              bodyHtml:where,confirmLabel:'削除する',cancelLabel:'やめる'});
  if(!ok)return;
  try{
   const r=await api('/api/display-rule-master/delete',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({name:ruleName}))});
   WL.displayRules.forget();await WL.displayRules.load(true);
   const n=(r.used_by||[]).length;
   showToast&&showToast(`表示ルール「${ruleName}」を削除しました`,
    n?`${n}件の列で使われていました（元の値のまま表示します）`:'',3600);
   close();
   if(typeof onDone==='function')onDone('');
   applyToView();
  }catch(e){showToast&&showToast('削除に失敗しました',e.message,5000)}
 }

 /* 名前を聞く。**窓そのものは`promptModal`の1箇所**（§9.342）——
    以前はここに自前の小窓があり、同じ「名前を聞く」窓が画面ごとに
    3つの見た目を持っていた。 */
 function askName(){
  return promptModal({eyebrow:'NEW',title:'新しい表示ルール',
   message:'複数の列から使い回すための名前を付けます。',
   label:'表示ルールの名前',placeholder:'例: 有無フラグ、合否',
   maxLength:60,confirmLabel:'作る'});
 }

 /* 開く。name が空なら新規、column はプレビューに使う「この列」。 */
 async function open(opt){
  const o=opt||{};
  ruleName=String(o.name||'').trim();
  panelSrc=o.source||null;
  selfColumn=String(o.column||'')||srcColumns()[0]||'';
  onDone=o.onDone||null;
  /* 一覧のセルと同じ見え方で試すための口（§9.474）と、「式にする」を入れる先（列の設定が渡す）。 */
  cellOf=typeof o.cellOf==='function'?o.cellOf:(o.source?null:listCellOf);
  toFormulaCb=typeof o.toFormula==='function'?o.toFormula:null;
  fxSelf=String(o.selfFormula||'');
  if(!ruleName){
   ruleName=String((await askName())||'').slice(0,60);
   if(!ruleName)return;
  }
  const saved=WL.displayRules.get(ruleName);
  draft=saved.length?JSON.parse(JSON.stringify(saved)):[blankRow()];
  selfMode=WL.displayRules.selfMode(ruleName);
  ensurePanel();
  paintMode();
  const fx=document.getElementById('lrFx');if(fx)fx.hidden=true;
  const fb=document.getElementById('lrToFormula');if(fb){fb.classList.remove('is-on');fb.setAttribute('aria-expanded','false')}
  document.getElementById('lrTitle').textContent=`表示ルール「${ruleName}」`;
  document.getElementById('lrDelete').hidden=!saved.length;
  renderUsage();
  render();
  document.getElementById(PANEL_ID).hidden=false;
 }
 /* 口を渡されずに開いたとき（仕掛一覧から直に）の「この列の見え方」——**いま保存されている**列の設定
    （作り方の式・値の整え方・読み替え）で作る。一覧のセル（`list-view.js`の`ruleView`）と同じ答え。 */
 const fxCache=new Map();
 const compiled=src=>{
  if(!src)return null;
  if(!fxCache.has(src)){let c;try{c=WL.formula.compile(src)}catch(e){c={run:()=>'',columns:[]}}fxCache.set(src,c)}
  return fxCache.get(src);
 };
 function listCellOf(r){
  const t=typeof WL.list.listLayoutTarget==='function'?WL.list.listLayoutTarget():'';
  const calc=k=>compiled(t?WL.columnLayout.formula(t,k):'');
  const c=calc(selfColumn);
  return {raw:c?c.run(r):(r?r[selfColumn]:''),format:t?WL.columnLayout.format(t,selfColumn):null,
          view:{key:n=>(t&&WL.columnLayout.keyByName(t,S.columns||[],n))||n,calc,
                format:k=>(t?WL.columnLayout.format(t,k):null),rule:k=>(t?WL.columnLayout.rule(t,k):'')}};
 }
 function close(){
  const el=document.getElementById(PANEL_ID);if(el)el.hidden=true;
 }

 window.WL=window.WL||{};
 WL.listRules={open,close};
})();
