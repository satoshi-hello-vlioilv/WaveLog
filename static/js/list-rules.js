"use strict";
/* list-rules.js: 表示ルール(読み替え)の編集(§9.88 段4)
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
   下の「試してみる」に実データでの結果を出すので、保存前に必ず結果が見える。
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

 const blankCond=()=>({left:{kind:'self'},op:'eq',right:{kind:'value',value:''}});
 const blankRow=()=>({conditions:[blankCond()],text:'',color:''});

 function ensurePanel(){
  let el=document.getElementById(PANEL_ID);
  if(el)return el;
  el=document.createElement('div');
  el.className='sc-float-win';el.id=PANEL_ID;el.hidden=true;
  el.innerHTML=`
   <div class="sc-float-header"><div><h2 id="lrTitle">表示ルール</h2></div>
    <button type="button" id="lrClose" title="閉じる">×</button></div>
   <div class="sc-float-body lr-body">
    <p class="lr-lead">上から順に見て、<b>最初に当てはまったもの</b>を表示します。</p>
    <div class="lr-rows" id="lrRows"></div>
    <button type="button" id="lrAddRow" class="lr-add">＋ 行を追加</button>
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
  el.querySelector('#lrAddRow').onclick=()=>{draft.push(blankRow());render()};
  if(typeof WL.makeFloatingWindow==='function')
   WL.makeFloatingWindow(el,{storageKey:'listRulePanelRectV1',defaultWidth:820,defaultHeight:660,
                             defaultTop:80,minWidth:560,minHeight:360});
  else console.error('表示ルールの編集: WL.makeFloatingWindow が見つかりません');
  return el;
 }

 /* 条件の片側。左辺は「この列 / 他の列」、右辺は「固定値 / 他の列」。
    左辺に固定値を置けても使い道が無いので選択肢に出さない(評価側は
    受け付けるので、将来必要になっても壊れない)。 */
 function operandHtml(side,which,ri,ci){
  const kind=side?.kind||(which==='left'?'self':'value');
  const cols=(S.columns||[]);
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
  const t=typeof listLayoutTarget==='function'?listLayoutTarget():'';
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
    title="この条件を消す"${first&&(draft[ri].conditions||[]).length<2?' disabled':''}>×</button>
  </div>`;
 }

 function rowHtml(row,ri){
  const conds=row.conditions||[];
  return `<div class="lr-row" data-row="${ri}">
   <div class="lr-row-conds">${
    conds.length?conds.map((c,ci)=>condHtml(c,ri,ci)).join('')
     :'<div class="lr-cond lr-cond-any"><span class="lr-conj">どれにも当てはまらないとき</span></div>'
   }</div>
   <div class="lr-row-then">
    <span class="lr-conj">→ 表示</span>
    <input type="text" class="lr-text" data-row="${ri}" value="${esc(row.text||'')}"
     placeholder="元の値のまま" autocomplete="off">
    <select class="lr-color" data-row="${ri}">${
     COLORS.map(([v,t])=>`<option value="${v}"${(row.color||'')===v?' selected':''}>${t}</option>`).join('')
    }</select>
    ${conds.length?`<button type="button" class="lr-cond-add" data-row="${ri}">＋条件</button>`:''}
    <button type="button" class="lr-row-del" data-row="${ri}" title="この行を消す">×</button>
   </div>
  </div>`;
 }

 function render(){
  const box=document.getElementById('lrRows');if(!box)return;
  box.innerHTML=draft.map(rowHtml).join('')||'<div class="sc-empty-note">「＋ 行を追加」から作ります。</div>';
  bind(box);
  renderTry();
 }

 function bind(box){
  const n=e=>Number(e.target.dataset.row);
  const ci=e=>Number(e.target.dataset.cond);
  const condOf=e=>draft[n(e)].conditions[ci(e)];
  box.querySelectorAll('.lr-kind').forEach(el=>el.onchange=e=>{
   const c=condOf(e),side=e.target.dataset.side,kind=e.target.value;
   c[side]=kind==='column'?{kind:'column',column:(S.columns||[])[0]||''}
          :kind==='value'?{kind:'value',value:''}:{kind:'self'};
   render();
  });
  box.querySelectorAll('.lr-col').forEach(el=>el.onchange=e=>{
   condOf(e)[e.target.dataset.side].column=e.target.value;renderTry();
  });
  box.querySelectorAll('.lr-val').forEach(el=>el.oninput=e=>{
   condOf(e)[e.target.dataset.side].value=e.target.value;renderTry();
  });
  box.querySelectorAll('.lr-op').forEach(el=>el.onchange=e=>{
   const c=condOf(e);c.op=e.target.value;
   // 右辺を持たない演算子へ変えたら右辺を落とす(保存されて残らないように)
   if(NO_RIGHT.has(c.op)){delete c.right;delete c.right2}
   else if(!c.right)c.right={kind:'value',value:''};
   if(c.op==='between'&&!c.right2)c.right2={kind:'value',value:''};
   if(c.op!=='between')delete c.right2;
   render();
  });
  box.querySelectorAll('.lr-cond-del').forEach(el=>el.onclick=e=>{
   const row=draft[n(e)];row.conditions.splice(ci(e),1);render();
  });
  box.querySelectorAll('.lr-cond-add').forEach(el=>el.onclick=e=>{
   draft[n(e)].conditions.push(blankCond());render();
  });
  box.querySelectorAll('.lr-row-del').forEach(el=>el.onclick=e=>{
   draft.splice(n(e),1);render();
  });
  box.querySelectorAll('.lr-text').forEach(el=>el.oninput=e=>{draft[n(e)].text=e.target.value;renderTry()});
  box.querySelectorAll('.lr-color').forEach(el=>el.onchange=e=>{draft[n(e)].color=e.target.value;renderTry()});
 }

 /* 「試してみる」。**保存前に実データでの結果が見える**ことがこの画面の要。
    条件式は書いた本人にも当たるかどうか分からないのが普通で、当たらない
    ことに一覧を見て気づくのでは遅い。 */
 function renderTry(){
  const box=document.getElementById('lrTry');if(!box)return;
  const rows=(S.rows||[]).slice(0,6);
  // 下書きをそのまま評価に使う(保存しないと試せない、では意味が無い)
  WL.displayRules.put('__draft__',draft);
  const out=rows.map(r=>{
   const raw=String(r[selfColumn]??'');
   const hit=WL.displayRules.match('__draft__',r,selfColumn);
   const shown=hit?(hit.text!==''?hit.text:raw):raw;
   return `<li><code>${esc(raw||'（空欄）')}</code> → <b class="${hit&&hit.color?'cell-'+hit.color:''}">${esc(shown)}</b>${
    hit?'':'<span class="lr-nohit">（当てはまらず）</span>'}</li>`;
  }).join('');
  WL.displayRules.put('__draft__',null);
  box.innerHTML=`<div class="lr-try-label">試してみる（${esc(labelOf(selfColumn))} の実データ先頭${rows.length}件）</div>
   <ul class="lr-try-list">${out||'<li>データがありません</li>'}</ul>`;
 }

 async function save(){
  try{
   const r=await api('/api/display-rule-master',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({name:ruleName,rows:draft}))});
   WL.displayRules.forget();await WL.displayRules.load(true);
   showToast&&showToast(`表示ルール「${ruleName}」を保存しました`,`${r.rows||0}行`,2600);
   close();
   if(typeof onDone==='function')onDone(ruleName);
   if(typeof renderGrid==='function')renderGrid();
  }catch(e){showToast&&showToast('保存に失敗しました',e.message,5000)}
 }
 async function remove(){
  if(!confirm(`表示ルール「${ruleName}」を削除します。よろしいですか？\n（このルールを使っている列は、元の値のまま表示されます）`))return;
  try{
   const r=await api('/api/display-rule-master/delete',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({name:ruleName}))});
   WL.displayRules.forget();await WL.displayRules.load(true);
   const used=(r.used_by||[]).length;
   showToast&&showToast(`表示ルール「${ruleName}」を削除しました`,
    used?`${used}件の列で使われていました（元の値のまま表示します）`:'',3600);
   close();
   if(typeof onDone==='function')onDone('');
   if(typeof renderGrid==='function')renderGrid();
  }catch(e){showToast&&showToast('削除に失敗しました',e.message,5000)}
 }

 /* 開く。name が空なら新規、column はプレビューに使う「この列」。 */
 function open(opt){
  const o=opt||{};
  ruleName=String(o.name||'').trim();
  selfColumn=String(o.column||'')||(S.columns||[])[0]||'';
  onDone=o.onDone||null;
  if(!ruleName){
   const input=prompt('新しい表示ルールの名前（例: 有無フラグ、合否）','');
   if(input===null)return;
   ruleName=String(input).trim().slice(0,60);
   if(!ruleName){showToast&&showToast('ルール名を入れてください','複数の列から使い回すための名前です',3200);return}
  }
  const saved=WL.displayRules.get(ruleName);
  draft=saved.length?JSON.parse(JSON.stringify(saved)):[blankRow()];
  ensurePanel();
  document.getElementById('lrTitle').textContent=`表示ルール「${ruleName}」`;
  document.getElementById('lrDelete').hidden=!saved.length;
  render();
  document.getElementById(PANEL_ID).hidden=false;
 }
 function close(){const el=document.getElementById(PANEL_ID);if(el)el.hidden=true}

 window.WL=window.WL||{};
 WL.listRules={open,close};
})();
