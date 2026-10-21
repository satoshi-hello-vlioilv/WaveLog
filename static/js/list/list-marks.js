/* ============================================================
   list-marks.js: 一覧の「色付け」（§9.591、利用者の指示・LotScope の色付けと同じ作り）

   利用者の指示（足す機能は利用者に選んでもらった）:
   「仕掛情報や品質情報…上部メニューの構成の不満やUIサイズのバラバラ感が残っており…LotScopeのメニューなどの
    UIの内容構成や配置が非常に優秀で参考になると思うので不足している機能は実装し」

   決めごと:
    ・決まり＝「条件（列・比べ方・値、かつ）→ 色・塗る所（行／条件の列のセル）」。上から順に強い（同じ所に当たったら上）。
    ・**行は落とさない**（絞り込みではない）。当たりはサーバーが一覧の絞り込みと**同じSQL**で引く（`/api/table`の`marks`）
      ——比べ方の語彙も絞り込みと同じ（`WL.filterOps`）。表に無い列の決まりは当てない（サーバーが null）。
    ・凡例は状態の帯（2段目）の札。札を押すと入切。数は絞り込んだ全件で当たる数。
    ・覚えるのはこの端末（一覧ごと・`wl.listMarks.v1`）。表示の設定の書き出しに載る（`setupOf`／`setSetup`）。
   ============================================================ */
(function(){
 'use strict';
 const WL=(window.WL=window.WL||{});
 const KEY='wl.listMarks.v1',MAX=8,COND_MAX=6;
 /* 色は6つ（意味を決めておく——色だけで伝えないので、凡例の札に条件の字を添える）。トークンは style の look-* 。 */
 const TONES=[['red','赤（要注意）'],['amber','黄（確かめる）'],['green','緑（良い）'],['blue','青（目印）'],['violet','紫（分類）'],['gray','灰（後回し）']];
 const TARGETS=[['cells','条件の列のセル'],['row','行ぜんたい']];
 const read=()=>{try{const x=JSON.parse(localStorage.getItem(KEY)||'{}');return x&&typeof x==='object'?x:{}}catch(e){WL.quiet.note('色付けの覚えを読めない（色付けなしで続ける）',e);return {}}};
 const write=x=>{try{localStorage.setItem(KEY,JSON.stringify(x))}catch(e){WL.quiet.note('色付けの覚えを書けない（この画面のあいだだけ効く）',e)}};
 const scope=()=>(S.db&&S.table)?`${S.db}:${S.table}`:'';
 function rules(){const s=scope();return s?((read()[s]||[]).filter(r=>r&&Array.isArray(r.conds))):[]}
 function save(list){const s=scope();if(!s)return;const all=read();all[s]=list.slice(0,MAX);write(all)}
 const live=()=>rules().filter(r=>r.on!==false);
 let counts={};      // 決まりID → 絞り込んだ全件で当たる数
 const opText=op=>(WL.filterOps?WL.filterOps.opLabel(op):op);
 const condText=c=>`${c.column} ${opText(c.op)}${WL.filterOps&&WL.filterOps.noValueOp(c.op)?'':' '+c.value}`;
 const text=r=>r.conds.map(condText).join(' かつ ');
 /* ---------- 一覧へつなぐ ---------- */
 WL.listHooks.onQuery(q=>{const l=live();if(l.length)q.set('marks',JSON.stringify(l.map(r=>r.conds)))});
 WL.listHooks.onData(({d,offset})=>{
  if(!d||!Array.isArray(d.marks))return;
  const l=live(),rows=d.rows||[];
  rows.forEach(r=>{if(r&&typeof r==='object')Object.defineProperty(r,'__mk',{value:[],writable:true,configurable:true})});
  l.forEach((rule,k)=>(d.marks[k]||[]).forEach(i=>{const row=rows[i];if(row&&row.__mk)row.__mk.push(rule.id)}));
  if(!offset){counts={};l.forEach((rule,k)=>{counts[rule.id]=(d.markCounts||[])[k]})}
 });
 WL.listHooks.onRow(({tr,row})=>{
  const hit=row&&row.__mk;if(!hit||!hit.length)return;
  const l=live();
  const rowRule=l.find(r=>r.target==='row'&&hit.includes(r.id));
  if(rowRule)tr.classList.add('mk-row','mk-'+rowRule.tone);
  /* セルは**上の決まりが勝つ**（同じセルに2つ当たったら上の色）。 */
  const done=new Set();
  l.forEach(r=>{
   if(r.target==='row'||!hit.includes(r.id))return;
   r.conds.forEach(c=>{
    if(done.has(c.column))return;done.add(c.column);
    const td=tr.querySelector(`td[data-col="${CSS.escape(c.column)}"]`);
    if(td)td.classList.add('mk-cell','mk-'+r.tone);
   });
  });
 });
 WL.listHooks.onAfter(()=>{paintSum();paintBtn()});
 /* ---------- 帯の札と凡例 ---------- */
 function dots(){return live().map(r=>`<i class="mk-dot mk-${r.tone}" aria-hidden="true"></i>`).join('')}
 function paintBtn(){
  const b=document.getElementById('listMarkBtn');if(!b)return;
  const n=live().length;
  b.classList.toggle('is-active',n>0);
  b.innerHTML=`<span class="mk-dots">${dots()||'<i class="mk-dot mk-off" aria-hidden="true"></i>'}</span><span class="lt-tool-t">色付け</span>${n?`<b class="lt-n">${n}</b>`:''}<i class="hd-caret" aria-hidden="true">▾</i>`;
 }
 function paintSum(){
  const box=document.getElementById('listToolSums');if(!box)return;
  let el=box.querySelector('.mk-sum');
  if(!el){el=document.createElement('span');el.className='mk-sum';box.appendChild(el)}
  const list=rules();
  el.innerHTML=list.map(r=>`<button type="button" class="mk-chip mk-${r.tone}${r.on===false?' is-off':''}" data-mk-toggle="${esc(r.id)}"
    title="${esc(text(r))}${r.on===false?'（いまは塗っていません・押すと塗ります）':'（押すと塗るのをやめます）'}"><i class="mk-dot mk-${r.tone}" aria-hidden="true"></i>${esc(text(r))}${
    r.on!==false&&counts[r.id]!=null?`<b>${Number(counts[r.id]).toLocaleString()}</b>`:''}</button>`).join('');
  el.querySelectorAll('[data-mk-toggle]').forEach(b=>{b.onclick=()=>{update(b.dataset.mkToggle,{on:rules().find(x=>x.id===b.dataset.mkToggle).on===false});}});
 }
 /* ---------- 決まりを足す・直す ---------- */
 function changed(){paintBtn();paintSum();WL.list.load()}   // 行は変わらない（ページはそのまま）
 function add(conds,opt){
  const list=rules();if(list.length>=MAX){showToast&&showToast('色付けは8つまでです','使わない決まりを外してから足してください',4000);return null}
  const used=new Set(list.map(r=>r.tone));
  const r={id:'m'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),conds:conds.slice(0,COND_MAX),
   tone:(opt&&opt.tone)||(TONES.find(t=>!used.has(t[0]))||TONES[0])[0],target:(opt&&opt.target)||'cells',on:true};
  list.push(r);save(list);changed();return r;
 }
 function update(id,patch){const list=rules();const r=list.find(x=>x.id===id);if(!r)return;Object.assign(r,patch);save(list);changed()}
 function remove(id){save(rules().filter(x=>x.id!==id));changed()}
 function move(id,d){const list=rules();const i=list.findIndex(x=>x.id===id),j=i+d;if(i<0||j<0||j>=list.length)return;[list[i],list[j]]=[list[j],list[i]];save(list);changed()}
 /* ---------- 面（帯の「色付け」から開く） ---------- */
 let draft=null;
 function colNames(){return (S.columns||[]).slice()}
 function menuHtml(){
  const list=rules(),cols=colNames(),ops=(WL.filterOps?WL.filterOps.OPS:[]);
  const d=draft||(draft={conds:[{column:cols[0]||'',op:'eq',value:''}],tone:(TONES.find(t=>!list.some(r=>r.tone===t[0]))||TONES[0])[0],target:'cells'});
  const sel=(k,i,opts,v)=>`<select data-mk-k="${k}" data-i="${i}">${opts.map(([x,n])=>`<option value="${esc(x)}"${String(v)===String(x)?' selected':''}>${esc(n)}</option>`).join('')}</select>`;
  const tone=(v,attr)=>`<span class="mk-tones" role="radiogroup" aria-label="色">${TONES.map(([t,n])=>`<button type="button" role="radio" aria-checked="${v===t}" class="mk-tone mk-${t}${v===t?' is-on':''}" ${attr}="${t}" title="${esc(n)}"></button>`).join('')}</span>`;
  return `<div class="mk-head"><b>色付け</b><small>条件に当たるセル・行に色を付けます（行は減りません）。上の決まりほど強い。</small></div>
   ${list.length?`<ol class="mk-list">${list.map((r,i)=>`<li class="mk-item${r.on===false?' is-off':''}">
     <label class="mk-on" title="塗る／塗らない"><input type="checkbox" data-mk-on="${esc(r.id)}"${r.on===false?'':' checked'}></label>
     <i class="mk-dot mk-${r.tone}" aria-hidden="true"></i><span class="mk-text">${esc(text(r))}</span>
     <span class="mk-n">${counts[r.id]!=null&&r.on!==false?Number(counts[r.id]).toLocaleString()+'件':''}</span>
     <select data-mk-target="${esc(r.id)}" aria-label="塗る所">${TARGETS.map(([x,n])=>`<option value="${x}"${r.target===x?' selected':''}>${n}</option>`).join('')}</select>
     <button type="button" class="mk-ic" data-mk-up="${esc(r.id)}"${i?'':' disabled'} title="上へ（強くする）">↑</button>
     <button type="button" class="mk-ic danger" data-mk-del="${esc(r.id)}" title="この決まりを外します">×</button></li>`).join('')}</ol>`
    :'<p class="mk-empty">まだ色付けはありません。下で条件を決めて「色を付ける」。</p>'}
   <div class="mk-make"><b>新しい色付け</b>
    ${d.conds.map((c,i)=>`<div class="mk-cond">${i?'<span class="mk-w">かつ</span>':''}${sel('column',i,cols.map(x=>[x,x]),c.column)}${sel('op',i,ops,c.op)}${
      WL.filterOps&&WL.filterOps.noValueOp(c.op)?'':`<input data-mk-k="value" data-i="${i}" value="${esc(c.value)}" placeholder="値">`}${i?`<button type="button" class="mk-ic" data-mk-drop="${i}" title="この条件を外す">×</button>`:''}</div>`).join('')}
    <div class="mk-make-foot">${d.conds.length<COND_MAX?'<button type="button" class="mk-add" data-mk-addcond>＋ 条件を足す</button>':''}
     ${tone(d.tone,'data-mk-tone')}<select data-mk-k="target" data-i="-1" aria-label="塗る所">${TARGETS.map(([x,n])=>`<option value="${x}"${d.target===x?' selected':''}>${n}</option>`).join('')}</select>
     <button type="button" class="mm-btn-primary sm" data-mk-make${list.length>=MAX?' disabled title="8つまでです"':''}>色を付ける</button></div></div>`;
 }
 function openMenu(btn){
  let m=document.getElementById('listMarkMenu');
  if(m&&!m.hidden){WL.popMenu.close();return}
  if(!m){m=document.createElement('div');m.id='listMarkMenu';m.className='wl-menu mk-menu';m.setAttribute('role','dialog');m.setAttribute('aria-label','色付け');m.hidden=true;document.body.appendChild(m)}
  const paint=()=>{m.innerHTML=menuHtml();wire(m,paint)};
  paint();m.hidden=false;btn.setAttribute('aria-expanded','true');
  WL.popMenu.open(m,{anchor:btn,owner:btn,onClose:()=>{m.hidden=true;btn.setAttribute('aria-expanded','false')}});
 }
 function wire(m,paint){
  m.querySelectorAll('[data-mk-on]').forEach(x=>{x.onchange=()=>{update(x.dataset.mkOn,{on:x.checked});paint()}});
  m.querySelectorAll('[data-mk-target]').forEach(x=>{x.onchange=()=>{update(x.dataset.mkTarget,{target:x.value});paint()}});
  m.querySelectorAll('[data-mk-up]').forEach(x=>{x.onclick=()=>{move(x.dataset.mkUp,-1);paint()}});
  m.querySelectorAll('[data-mk-del]').forEach(x=>{x.onclick=()=>{remove(x.dataset.mkDel);paint()}});
  m.querySelectorAll('[data-mk-tone]').forEach(x=>{x.onclick=()=>{draft.tone=x.dataset.mkTone;paint()}});
  m.querySelectorAll('[data-mk-k]').forEach(x=>{
   const ev=x.tagName==='INPUT'?'oninput':'onchange';
   x[ev]=()=>{const i=+x.dataset.i;if(i<0)draft[x.dataset.mkK]=x.value;else draft.conds[i][x.dataset.mkK]=x.value;if(x.tagName!=='INPUT')paint()};
  });
  m.querySelectorAll('[data-mk-drop]').forEach(x=>{x.onclick=()=>{draft.conds.splice(+x.dataset.mkDrop,1);paint()}});
  const ac=m.querySelector('[data-mk-addcond]');if(ac)ac.onclick=()=>{draft.conds.push({column:colNames()[0]||'',op:'eq',value:''});paint()};
  const mk=m.querySelector('[data-mk-make]');
  if(mk)mk.onclick=()=>{
   const conds=draft.conds.filter(c=>c.column);
   if(!conds.length)return;
   if(add(conds,{tone:draft.tone,target:draft.target})){draft=null;paint()}
  };
 }
 /* 帯の入口（絞り込みのバーの「スライサー」の右）。バーは filters.js が作るので、描くたびに在るか確かめて置く。 */
 function placeButton(){
  const row=document.querySelector('#genericFilterBar .filter-search-row');if(!row)return;
  let b=document.getElementById('listMarkBtn');
  if(!b){b=document.createElement('button');b.type='button';b.id='listMarkBtn';b.className='lt-tool-btn mk-entry';
   b.setAttribute('aria-haspopup','dialog');b.setAttribute('aria-expanded','false');
   b.title='色付け: 条件に当たるセル・行に色を付けます（行は減りません）';b.onclick=()=>openMenu(b)}
  const after=document.getElementById('listSlicerBtn')||document.getElementById('filterToolsAt');
  if(after&&b.previousElementSibling!==after)after.after(b);
  paintBtn();
 }
 WL.listHooks.onGrid(placeButton);WL.listHooks.onTabs(placeButton);WL.listHooks.onAfter(placeButton);
 /* 表示の設定の書き出し・読み込み（`list-tools.js`）へ渡す形。 */
 const setupOf=()=>rules();
 function setSetup(list){save(Array.isArray(list)?list.filter(r=>r&&Array.isArray(r.conds)):[]);changed()}
 const paintClass=(row,col)=>{const hit=row&&row.__mk;if(!hit||!hit.length)return null;const l=live();
  const cell=l.find(r=>r.target!=='row'&&hit.includes(r.id)&&r.conds.some(c=>c.column===col));
  if(cell)return {tone:cell.tone,whole:false};const rr=l.find(r=>r.target==='row'&&hit.includes(r.id));return rr?{tone:rr.tone,whole:true}:null};
 WL.listMarks={rules,live,add,update,remove,move,text,setupOf,setSetup,paintClass,TONES,TARGETS,MAX,openMenu};
})();
