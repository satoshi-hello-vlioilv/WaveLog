"use strict";
/* list-columns.js: 列の設定パネル(§9.88 段2)
   ============================================================
   1つの列の設定は1箇所に集める。名前・幅・並び・表示を別々の画面へ
   散らすと、利用者は毎回「これはどこで設定するんだったか」を思い出す
   ことになる——認知コストの最大の発生源はそこ。

   画面は3面:
     左  この一覧の全列(D&Dで並べ替え・チェックで表示/非表示)
     右  選んだ1列の設定だけ(一度に見せる情報を絞る)
     下  実データのプレビュー ← **この画面の主役**

   下のプレビューが主役なのは、書式や読み替えが「仕様を読んで想像する
   もの」ではなく「結果を見て決めるもの」だから。段3(書式)・段4(読み替え)
   はここへ項目が増えるだけで済む。

   計算列・ボタン列(#・分割・測定・予定)も同じ一覧に並べる。利用者から
   見れば同じ「列」で、別扱いする理由が無い。ただし値を持たないので、
   右ペインは幅と表示名だけになる。
   ============================================================ */
(function(){
 const PANEL_ID='listColumnPanel';
 let target='',draft=null,picked='';

 /* 値を持たない列(行番号・ボタン)。並びと幅と名前は変えられるが、
    書式や読み替えは持たない。 */
 const VIRTUAL={
  '#':{label:'#（行番号）',note:'行の番号'},
  '__split__':{label:'分割',note:'分割の有無'},
  '__measure__':{label:'測定',note:'測定画面を開くボタン'},
  '__plan__':{label:'予定',note:'スケジュールへ追加するボタン'},
 };
 const isVirtual=k=>Object.prototype.hasOwnProperty.call(VIRTUAL,k);
 const labelOf=k=>isVirtual(k)?VIRTUAL[k].label:(draft.names[k]||k);

 function ensurePanel(){
  let el=document.getElementById(PANEL_ID);
  if(el)return el;
  el=document.createElement('div');
  el.className='sc-float-win';el.id=PANEL_ID;el.hidden=true;
  el.innerHTML=`
   <div class="sc-float-header"><div><h2>列の設定</h2></div>
    <button type="button" id="lcClose" title="閉じる">×</button></div>
   <div class="sc-float-body lc-body">
    <div class="lc-side">
     <input type="search" id="lcFilter" class="lc-filter" placeholder="列名で絞り込み" autocomplete="off">
     <div class="lc-list" id="lcList"></div>
    </div>
    <div class="lc-detail" id="lcDetail"></div>
   </div>
   <div class="lc-preview" id="lcPreview"></div>
   <div class="sc-float-foot">
    <span class="lc-count" id="lcCount"></span>
    <div class="sc-content-foot-actions">
     <button type="button" id="lcReset">既定に戻す</button>
     <button type="button" id="lcSave" class="sc-column-save">保存</button>
    </div>
   </div>
   <div class="sc-float-resize" title="ドラッグで大きさを変えられます"></div>`;
  document.body.appendChild(el);
  el.querySelector('#lcClose').onclick=close;
  el.querySelector('#lcSave').onclick=save;
  el.querySelector('#lcReset').onclick=reset;
  el.querySelector('#lcFilter').addEventListener('input',renderList);
  if(typeof makeFloatingWindow==='function')
   makeFloatingWindow(el,{storageKey:'listColumnPanelRectV1',defaultWidth:760,defaultHeight:560,
                          defaultTop:70,minWidth:560,minHeight:400});
  return el;
 }

 /* 今の一覧の全列(仮想列を含む)。表示中かどうかに関わらず並べる。 */
 function allKeys(){
  const out=[];
  const isWork=WL.dataSource.isWork(S.db);
  const canPlan=isWork&&window.accessMode?.mode==='schedule';
  if(canPlan)out.push('__plan__');
  out.push('#');
  if(isWork)out.push('__split__');
  out.push(...(S.columns||[]));
  if(isWork)out.push('__measure__');
  return out;
 }

 function loadDraft(){
  const l=WL.columnLayout.get(target);
  const keys=allKeys();
  const known=(l.order||[]).filter(k=>keys.includes(k));
  draft={
   order:[...known,...keys.filter(k=>!known.includes(k))],
   hidden:new Set((l.hidden||[]).filter(k=>keys.includes(k))),
   widths:{...(l.widths||{})},
   names:{...(l.names||{})},
  };
  if(!picked||!draft.order.includes(picked))picked=draft.order.find(k=>!isVirtual(k))||draft.order[0]||'';
 }

 function renderList(){
  const box=document.getElementById('lcList');if(!box)return;
  const q=String(document.getElementById('lcFilter')?.value||'').trim().toLowerCase();
  const rows=draft.order.filter(k=>!q||labelOf(k).toLowerCase().includes(q)||k.toLowerCase().includes(q));
  box.innerHTML=rows.map(k=>`
   <div class="lc-item${k===picked?' is-picked':''}" data-key="${esc(k)}" draggable="true">
    <input type="checkbox" ${draft.hidden.has(k)?'':'checked'} title="一覧に出すかどうか">
    <span class="lc-grip" title="ドラッグで並べ替え">⠿</span>
    <span class="lc-name" title="${esc(k)}">${esc(labelOf(k))}</span>
    ${draft.names[k]?'<i class="lc-renamed" title="表示名を変えています">名</i>':''}
   </div>`).join('')||'<div class="sc-empty-note">該当する列がありません</div>';
  box.querySelectorAll('.lc-item').forEach(el=>{
   const k=el.dataset.key;
   el.querySelector('input').onchange=e=>{
    e.stopPropagation();
    if(e.target.checked)draft.hidden.delete(k);else draft.hidden.add(k);
    renderCount();renderPreview();
   };
   el.onclick=()=>{picked=k;renderList();renderDetail();};
   el.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',k);el.classList.add('lc-dragging')});
   el.addEventListener('dragend',()=>el.classList.remove('lc-dragging'));
   el.addEventListener('dragover',e=>e.preventDefault());
   el.addEventListener('drop',e=>{
    e.preventDefault();
    const from=e.dataTransfer.getData('text/plain');if(!from||from===k)return;
    const o=draft.order,i=o.indexOf(from);if(i<0)return;
    o.splice(i,1);o.splice(o.indexOf(k),0,from);
    renderList();renderPreview();
   });
  });
  renderCount();
 }

 function renderCount(){
  const el=document.getElementById('lcCount');if(!el)return;
  const shown=draft.order.filter(k=>!draft.hidden.has(k)).length;
  el.textContent=`${shown} / ${draft.order.length} 列を表示`;
 }

 function renderDetail(){
  const box=document.getElementById('lcDetail');if(!box)return;
  if(!picked){box.innerHTML='<div class="sc-empty-note">左の一覧から列を選んでください。</div>';return}
  const virt=isVirtual(picked);
  box.innerHTML=`
   <div class="lc-detail-head">${esc(labelOf(picked))}
    <small>${virt?esc(VIRTUAL[picked].note):'元の項目名: '+esc(picked)}</small></div>
   <label class="lc-field"><span>表示名</span>
    <input type="text" id="lcName" value="${esc(draft.names[picked]||'')}"
     placeholder="${esc(virt?VIRTUAL[picked].label:picked)}" autocomplete="off"></label>
   <label class="lc-field"><span>幅</span>
    <span class="lc-width"><input type="number" id="lcWidth" min="40" max="900" step="10"
     value="${draft.widths[picked]||''}" placeholder="内容に合わせる"> px</span></label>
   <p class="lc-hint">${virt
     ?'この列は値を持たないため、書式や読み替えはありません。'
     :'書式（小数桁・日付の形）と読み替え（00→なし 等）は、次の段でここへ増えます。'}</p>`;
  box.querySelector('#lcName').addEventListener('input',e=>{
   const v=e.target.value.trim();
   if(v)draft.names[picked]=v;else delete draft.names[picked];
   renderList();renderPreview();
  });
  box.querySelector('#lcWidth').addEventListener('input',e=>{
   const n=Number(e.target.value);
   if(n>=40)draft.widths[picked]=Math.min(900,n);else delete draft.widths[picked];
   renderPreview();
  });
 }

 /* 実データのプレビュー。**設定を変えるたびに更新する。** */
 function renderPreview(){
  const box=document.getElementById('lcPreview');if(!box)return;
  const shown=draft.order.filter(k=>!draft.hidden.has(k));
  const rows=(S.rows||[]).slice(0,3);
  const cell=(r,k)=>isVirtual(k)?'—':esc(String(r[k]??''));
  box.innerHTML=`<div class="lc-preview-label">プレビュー（実データの先頭${rows.length}件）</div>
   <div class="lc-preview-scroll"><table><thead><tr>${
    shown.map(k=>`<th${draft.widths[k]?` style="width:${draft.widths[k]}px"`:''}>${esc(labelOf(k))}</th>`).join('')
   }</tr></thead><tbody>${
    rows.map(r=>`<tr>${shown.map(k=>`<td>${cell(r,k)}</td>`).join('')}</tr>`).join('')
    ||'<tr><td>データがありません</td></tr>'
   }</tbody></table></div>`;
 }

 async function save(){
  try{
   await WL.columnLayout.save(target,{order:draft.order,widths:draft.widths,
                                      hidden:[...draft.hidden],names:draft.names});
   showToast&&showToast('列の設定を保存しました','この一覧を次に開いたときも同じ形で出ます',2600);
   if(typeof renderGrid==='function')renderGrid();
  }catch(e){showToast&&showToast('保存に失敗しました',e.message,5000)}
 }
 async function reset(){
  draft={order:allKeys(),hidden:new Set(),widths:{},names:{}};
  renderList();renderDetail();renderPreview();
 }

 function open(){
  target=typeof listLayoutTarget==='function'?listLayoutTarget():'';
  if(!target){showToast&&showToast('一覧を先に開いてください','列の設定はその一覧ごとに保存します',3200);return}
  ensurePanel();loadDraft();
  renderList();renderDetail();renderPreview();
  document.getElementById(PANEL_ID).hidden=false;
 }
 function close(){const el=document.getElementById(PANEL_ID);if(el)el.hidden=true}
 function toggle(){
  const el=document.getElementById(PANEL_ID);
  if(el&&!el.hidden)close();else open();
 }

 window.WL=window.WL||{};
 WL.listColumns={open,close,toggle};
})();
