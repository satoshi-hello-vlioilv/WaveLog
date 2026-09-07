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
   条件を足すと「かつ」でぶら下がる(AND)。ORは行を分ける
   ——**行=OR、行の中=AND**と決めてある。「ORもANDも1画面で」は
   組み合わせが爆発して、作った本人にも読めなくなる。

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
 let ruleName='',draft=null,onDone=null,selfColumn='';

 /* 演算子。**日本語のラベルがそのまま説明**になるように書く
    (「≧」だけだと、文字列と数値のどちらで比べるのかが伝わらない)。 */
 const OPS=[
  ['eq','＝ と等しい'],['ne','≠ と違う'],
  ['contains','を含む'],['startsWith','で始まる'],['endsWith','で終わる'],
  ['empty','が空欄'],['notEmpty','が空欄でない'],
  ['gt','＞ より大きい'],['ge','≧ 以上'],['lt','＜ より小さい'],['le','≦ 以下'],
  ['between','～ の範囲内'],['regex','正規表現に一致'],
 ];
 const NO_RIGHT=new Set(['empty','notEmpty']);
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
  el.innerHTML=`
   <div class="sc-float-header"><div><h2 id="lrTitle">表示ルール</h2>
     <small class="lr-usage" id="lrUsage"></small></div>
    <button type="button" id="lrClose" title="閉じる">×</button></div>
   <div class="sc-float-body lr-body">
    <p class="lr-lead">上から順に見て、<b>最初に当てはまったもの</b>を表示します。</p>
    <div class="lr-rows" id="lrRows"></div>
    <div class="lr-adds">
     <button type="button" id="lrAddRow" class="lr-add">＋ 行を追加</button>
     <button type="button" id="lrAddDefault" class="lr-add">＋ どれにも当てはまらないとき</button>
    </div>
    <div class="lr-try" id="lrTry"></div>
   </div>
   <div class="sc-float-foot">
    <button type="button" id="lrDelete" class="lr-delete">このルールを削除</button>
    <div class="sc-content-foot-actions">
     <button type="button" id="lrCancel">やめる</button>
     <button type="button" id="lrSave" class="sc-column-save">保存</button>
    </div>
   </div>
   <div class="sc-float-resize" title="ドラッグで大きさを変えられます"></div>`;
  document.body.appendChild(el);
  el.querySelector('#lrClose').onclick=close;
  el.querySelector('#lrCancel').onclick=close;
  el.querySelector('#lrSave').onclick=save;
  el.querySelector('#lrDelete').onclick=remove;
  el.querySelector('#lrAddRow').onclick=()=>{addRow(blankRow())};
  el.querySelector('#lrAddDefault').onclick=()=>{addRow(defaultRow())};
  if(typeof WL.makeFloatingWindow==='function')
   WL.makeFloatingWindow(el,{storageKey:'listRulePanelRectV2',defaultWidth:900,defaultHeight:700,
                             defaultTop:70,minWidth:600,minHeight:400});
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
 function operandHtml(side,which,ri,ci){
  const kind=side?.kind||(which==='left'?'self':'value');
  const cols=srcColumns();
  const kinds=which==='left'?[['self','この列'],['column','他の列']]
                            :[['value','固定値'],['column','他の列']];
  return `<select class="lr-kind" data-row="${ri}" data-cond="${ci}" data-side="${which}">${
    kinds.map(([v,t])=>`<option value="${v}"${kind===v?' selected':''}>${t}</option>`).join('')
   }</select>${kind==='column'
    ?`<select class="lr-col" data-row="${ri}" data-cond="${ci}" data-side="${which}">${
       cols.map(c=>`<option value="${esc(c)}"${side?.column===c?' selected':''}>${esc(labelOf(c))}</option>`).join('')
      }</select>`
    :kind==='value'
     ?`<input type="text" class="lr-val" data-row="${ri}" data-cond="${ci}" data-side="${which}"
        value="${esc(side?.value||'')}" placeholder="00" autocomplete="off">`
     :''}`;
 }
 const labelOf=c=>{
  /* **口が呼び名を持っていればそちらが先**（§9.234 ⑥）——スケジュール表の
     内容欄のキーは`lotNo`のようなalias名で、そのまま並べると選んだ本人にも
     何の項目か分からない（§9.120と同じ話）。 */
  if(panelSrc&&typeof panelSrc.labelOf==='function'){
   const lb=panelSrc.labelOf(c);
   if(lb&&lb!==c)return `${lb}（${c}）`;
  }
  const t=(panelSrc&&typeof panelSrc.target==='function')?panelSrc.target()
    :(typeof WL.list.listLayoutTarget==='function'?WL.list.listLayoutTarget():'');
  const n=t?WL.columnLayout.label(t,c):c;
  return n===c?c:`${n}（${c}）`;
 };

 function condHtml(cond,ri,ci){
  const first=ci===0;
  return `<div class="lr-cond">
   <span class="lr-conj">${first?'もし':'かつ'}</span>
   ${operandHtml(cond.left,'left',ri,ci)}
   <select class="lr-op" data-row="${ri}" data-cond="${ci}">${
    OPS.map(([v,t])=>`<option value="${v}"${cond.op===v?' selected':''}>${t}</option>`).join('')
   }</select>
   ${NO_RIGHT.has(cond.op)?'':operandHtml(cond.right,'right',ri,ci)}
   ${cond.op==='between'?'<span class="lr-conj">〜</span>'+operandHtml(cond.right2,'right2',ri,ci):''}
   <button type="button" class="lr-cond-del" data-row="${ri}" data-cond="${ci}"
    title="この条件を消す">×</button>
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
        :conds.map((c,ci)=>condHtml(c,ri,ci)).join('')
    }</div>
    <div class="lr-row-then">
     <span class="lr-conj">→ 表示</span>
     <input type="text" class="lr-text" data-row="${ri}" value="${esc(row.text||'')}"
      placeholder="元の値のまま" autocomplete="off">
     <select class="lr-color" data-row="${ri}">${
      COLORS.map(([v,t])=>`<option value="${v}"${(row.color||'')===v?' selected':''}>${t}</option>`).join('')
     }</select>
     ${def?'':`<button type="button" class="lr-cond-add" data-row="${ri}">＋条件</button>`}
     <button type="button" class="lr-row-del" data-row="${ri}" title="この行を消す">×</button>
    </div>
    ${stat.note?`<div class="lr-row-stat${stat.dead?' is-dead':''}">${esc(stat.note)}</div>`:''}
   </div>
  </div>`;
 }

 /* ---------- 当たり具合 ----------
    実データの先頭TRY_ROWS件を、**この下書きのまま**評価して数える。
    「保存しないと試せない」では、直した結果を確かめずに保存することになる。 */
 let hits=[];                       // hits[ri] = その行が採用された件数
 function recount(){
  const rows=srcRows(TRY_ROWS);
  hits=draft.map(()=>0);
  WL.displayRules.put('__draft__',draft);
  const picked=rows.map(r=>{
   const hit=WL.displayRules.match('__draft__',r,selfColumn);
   const i=hit?draft.indexOf(hit):-1;
   if(i>=0)hits[i]++;
   return {row:r,hit,index:i};
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
  const ci=e=>Number(e.currentTarget.dataset.cond);
  const condOf=e=>draft[n(e)].conditions[ci(e)];
  box.querySelectorAll('.lr-kind').forEach(el=>el.onchange=e=>{
   const c=condOf(e),side=e.currentTarget.dataset.side,kind=e.currentTarget.value;
   c[side]=kind==='column'?{kind:'column',column:(S.columns||[])[0]||''}
          :kind==='value'?{kind:'value',value:''}:{kind:'self'};
   render();
  });
  box.querySelectorAll('.lr-col').forEach(el=>el.onchange=e=>{
   condOf(e)[e.currentTarget.dataset.side].column=e.currentTarget.value;render();
  });
  box.querySelectorAll('.lr-val').forEach(el=>el.oninput=e=>{
   condOf(e)[e.currentTarget.dataset.side].value=e.currentTarget.value;
   /* **入力中は組み直さない。** 1文字ごとに作り直すと入力欄が作り替わって
      カーソルが飛ぶ。数え直しと「試してみる」だけを更新する。 */
   refreshCounts();
  });
  box.querySelectorAll('.lr-op').forEach(el=>el.onchange=e=>{
   const c=condOf(e);c.op=e.currentTarget.value;
   // 右辺を持たない演算子へ変えたら右辺を落とす(保存されて残らないように)
   if(NO_RIGHT.has(c.op)){delete c.right;delete c.right2}
   else if(!c.right)c.right={kind:'value',value:''};
   if(c.op==='between'&&!c.right2)c.right2={kind:'value',value:''};
   if(c.op!=='between')delete c.right2;
   render();
  });
  /* **最後の1つも消せる。** 消すと条件が空＝「どれにも当てはまらないとき」に
     なる。以前はここを disabled にしていたため、既定の行を画面から作る
     手立てが1つも無かった。 */
  box.querySelectorAll('.lr-cond-del').forEach(el=>el.onclick=e=>{
   const row=draft[n(e)];row.conditions.splice(ci(e),1);render();
  });
  box.querySelectorAll('.lr-cond-add').forEach(el=>el.onclick=e=>{
   draft[n(e)].conditions.push(blankCond());render();
  });
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
 }

 /* 「試してみる」。**保存前に実データでの結果が見える**ことがこの画面の要。
    **どの行が採用されたか**も出す——結果だけ見せても、思ったのと違うときに
    どこを直せばよいか分からない。 */
 function renderTry(picked){
  const box=document.getElementById('lrTry');if(!box)return;
  const out=(picked||[]).map(p=>{
   const raw=String(p.row[selfColumn]??'');
   const shown=p.hit?(p.hit.text!==''?p.hit.text:raw):raw;
   return `<li><code>${esc(raw||'（空欄）')}</code> → <b class="${p.hit&&p.hit.color?'cell-'+p.hit.color:''}">${esc(shown)}</b>${
    p.index>=0?`<span class="lr-which">${p.index+1}行目</span>`
              :'<span class="lr-nohit">（当てはまらず）</span>'}</li>`;
  }).join('');
  box.innerHTML=`<div class="lr-try-label">試してみる（${esc(labelOf(selfColumn))} の実データ先頭${(picked||[]).length}件）</div>
   <ul class="lr-try-list">${out||'<li>データがありません</li>'}</ul>`;
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
    body:JSON.stringify(withUserId({name:ruleName,rows:draft}))});
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
  if(!ruleName){
   ruleName=String((await askName())||'').slice(0,60);
   if(!ruleName)return;
  }
  const saved=WL.displayRules.get(ruleName);
  draft=saved.length?JSON.parse(JSON.stringify(saved)):[blankRow()];
  ensurePanel();
  document.getElementById('lrTitle').textContent=`表示ルール「${ruleName}」`;
  document.getElementById('lrDelete').hidden=!saved.length;
  renderUsage();
  render();
  document.getElementById(PANEL_ID).hidden=false;
 }
 function close(){const el=document.getElementById(PANEL_ID);if(el)el.hidden=true}

 window.WL=window.WL||{};
 WL.listRules={open,close};
})();
