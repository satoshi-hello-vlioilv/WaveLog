/* ============================================================
   list-tools.js: 一覧の「ファイル」（Excel に出力・表示の設定の書き出し／読み込み）と「一覧の拡大」（§9.591）

   利用者の指示（足す機能は利用者に選んでもらった）: LotScope の一覧にある「Excel に出力」「一覧の拡大」
   「表示の設定の書き出し／読み込み」を WaveLog の一覧（仕掛・品質・作業スケジュールの仕掛一覧）にも。

   置き場（7案→組合せ7案から M1）:
    ・帯の1段目の右端に「ファイル ▾」1つ（表示列・表の見せ方の右）。中身は「Excel に出力」と「表示の設定」の書き出し・
      読み込み——1536×864 でも帯を1行に収めるため、持ち出す・持ち込むを1つにまとめた。
    ・2段目の右端に一覧の拡大（−・つまみ・＋・%）とページめくり（LotScope と同じ並び）。

   決めごと:
    ・Excel は**画面の一覧と同じ並び・同じ見え方**（`WL.list.exportTable()`）。行は**絞り込んだ全件**（ページを順に取る）。
      書くのはサーバーの`xlsx_io.write_sheet()`の1箇所（`/api/table/export-xlsx`）。
    ・表示の設定は1つのファイル（`kind: wavelog-list-display`）: 列の設定・スライサーの列・色付け・行間・表示件数・
      いまの絞り込み条件。読み込むと**この一覧へ**当てる（列の設定は保存する＝列の設定パネルの「取り込む」と同じ道）。
    ・拡大は表（`#grid > table`）の`zoom`。60〜200%・10%刻み。この窓のあいだだけ覚える（閉じると100%）。
   ============================================================ */
(function(){
 'use strict';
 const WL=(window.WL=window.WL||{});
 const KIND='wavelog-list-display',ZMIN=60,ZMAX=200,ZSTEP=10,ZKEY='wl.listZoom.v1';
 const ss={get(){try{return sessionStorage.getItem(ZKEY)}catch(e){WL.quiet.note('拡大の覚えを読めない（100%で始める）',e);return null}},
  set(v){try{sessionStorage.setItem(ZKEY,String(v))}catch(e){WL.quiet.note('拡大の覚えを書けない（この画面のあいだだけ効く）',e)}}};
 /* ---------- 一覧の拡大 ---------- */
 let zoom=Math.min(ZMAX,Math.max(ZMIN,+ss.get()||100));
 function applyZoom(){
  const g=document.getElementById('grid');
  if(g){g.style.setProperty('--list-zoom',String(zoom/100));g.classList.toggle('is-zoomed',zoom!==100)}
  const out=document.getElementById('listZoomValue');if(out){out.textContent=zoom+'%';out.classList.toggle('is-zoomed',zoom!==100)}
  const r=document.getElementById('listZoomRange');if(r&&+r.value!==zoom)r.value=String(zoom);
  const back=document.getElementById('listZoomReset');if(back)back.hidden=zoom===100;
 }
 function setZoom(z){
  const nz=Math.min(ZMAX,Math.max(ZMIN,Math.round(z/ZSTEP)*ZSTEP));
  if(nz===zoom)return false;
  zoom=nz;ss.set(zoom);applyZoom();
  /* 画面に入る行の数が変わる（行の窓・§9.95）。描き直して数え直す。 */
  WL.columnResize&&WL.columnResize.defer?WL.columnResize.defer('grid:zoom',()=>WL.list.renderGrid()):WL.list.renderGrid();
  return true;
 }
 function placeZoom(){
  const slot=document.getElementById('listZoomSlot');if(!slot)return;
  if(!slot.querySelector('#listZoomRange')){
   slot.innerHTML=`<span class="lt-zoom" role="group" aria-label="一覧の拡大" title="一覧の表だけを拡大・縮小します（この窓のあいだだけ・閉じると100%）">
    <span class="lt-zoom-k">拡大</span>
    <button type="button" class="lt-zoom-btn" data-zoom="-1" aria-label="縮小">−</button>
    <input type="range" id="listZoomRange" min="${ZMIN}" max="${ZMAX}" step="${ZSTEP}" value="${zoom}" aria-label="一覧の拡大（%）">
    <button type="button" class="lt-zoom-btn" data-zoom="1" aria-label="拡大">＋</button>
    <output id="listZoomValue" for="listZoomRange">${zoom}%</output>
    <button type="button" class="lt-zoom-reset" id="listZoomReset" hidden>100%に戻す</button></span>`;
   slot.querySelectorAll('[data-zoom]').forEach(b=>WL.base.holdRepeat(b,()=>setZoom(zoom+ZSTEP*(+b.dataset.zoom))));
   const r=slot.querySelector('#listZoomRange');r.oninput=()=>setZoom(+r.value);
   slot.querySelector('#listZoomReset').onclick=()=>setZoom(100);
  }
  applyZoom();
 }
 /* ---------- ファイル ▾ ---------- */
 function placeFile(){
  if(document.getElementById('listFileBtn'))return;
  const bar=document.getElementById('listToolbar');if(!bar)return;
  const b=document.createElement('button');b.type='button';b.id='listFileBtn';b.className='list-toolbar-btn lt-file-btn';
  b.setAttribute('aria-haspopup','menu');b.setAttribute('aria-expanded','false');
  b.title='この一覧を Excel に出力する・表示の設定をファイルへ書き出す／読み込む';
  b.innerHTML='<i class="fa-solid fa-file-export" aria-hidden="true"></i><span class="lt-tool-t">ファイル</span><i class="hd-caret" aria-hidden="true">▾</i>';
  b.onclick=()=>openFile(b);
  /* 置き場は「表の見せ方」のすぐ右（1段目の右端）。以後の並べ直しは list-view.js の placeViewButton() が持つ。 */
  const view=document.getElementById('listViewBtn');
  if(view)view.after(b);else bar.insertBefore(b,bar.firstChild);
 }
 function openFile(btn){
  let m=document.getElementById('listFileMenu');
  if(m&&!m.hidden){WL.popMenu.close();return}
  if(!m){m=document.createElement('div');m.id='listFileMenu';m.className='wl-menu lt-file-menu';m.setAttribute('role','menu');m.setAttribute('aria-label','ファイル');m.hidden=true;document.body.appendChild(m)}
  const n=S.count|0;
  m.innerHTML=`<button type="button" role="menuitem" data-file="xlsx"><b>Excel に出力</b><small>いまの絞り込み・並び・表示列・書式のまま、${n?`全 ${n.toLocaleString()}件`:'全件'}を .xlsx に</small></button>
   <div class="lt-file-sep" role="separator"></div>
   <button type="button" role="menuitem" data-file="save"><b>表示の設定を書き出す…</b><small>列の設定・スライサー・色付け・行間・表示件数・絞り込み条件を1つのファイルへ</small></button>
   <button type="button" role="menuitem" data-file="load"><b>表示の設定を読み込む…</b><small>書き出したファイルをこの一覧へ当てます（列の設定は保存されます）</small></button>`;
  m.querySelectorAll('[data-file]').forEach(x=>{x.onclick=()=>{WL.popMenu.close();({xlsx:exportXlsx,save:saveDisplay,load:loadDisplay})[x.dataset.file]()}});
  m.hidden=false;btn.setAttribute('aria-expanded','true');
  WL.popMenu.open(m,{anchor:btn,owner:btn,onClose:()=>{m.hidden=true;btn.setAttribute('aria-expanded','false')}});
 }
 const stem=()=>{const t=WL.base.databaseLabel(S.db)||'一覧';return `${t}_${S.table||''}`.replace(/[\\/:*?"<>|]/g,'_')};
 /* 絞り込んだ全件を集める（一覧と同じ問い合わせを1ページ5000件ずつ）。 */
 async function gather(onStep){
  const q=WL.listQuery();q.delete('all');q.set('page_size','5000');
  const rows=[];let total=Infinity;
  for(let page=1;rows.length<total;page++){
   q.set('page',String(page));
   const d=await api('/api/table?'+q);
   total=+d.count||0;rows.push(...(d.rows||[]));onStep&&onStep(rows.length,total);
   if(!(d.rows||[]).length)break;
  }
  return rows;
 }
 let busy=false;
 async function exportXlsx(){
  if(busy||!S.db||!S.table)return;
  const n=S.count|0;
  if(n>100000&&!await confirmModal({title:`${n.toLocaleString()}件を出力しますか？`,eyebrow:'Excel に出力',
    message:'件数が多いので、出来上がりまで時間がかかります。絞り込んでから出すと速くなります。',confirmLabel:'出力する'}))return;
  busy=true;
  const btn=document.getElementById('listFileBtn');if(btn)btn.disabled=true;
  showToast&&showToast('Excel に出力しています…',`${n?n.toLocaleString()+'件':''}を集めています`,2400);
  try{
   const rows=await gather();
   const t=WL.list.exportTable(rows);
   const widths=t.header.map((h,i)=>Math.min(60,Math.max(8,...[h].concat(t.rows.slice(0,200).map(r=>r[i])).map(v=>[...String(v??'')].reduce((a,ch)=>a+(ch.charCodeAt(0)>255?2:1),0)+1))));
   const res=await fetch('/api/table/export-xlsx',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:stem(),sheet:S.table||'一覧',header:t.header,rows:t.rows,widths})});
   if(!res.ok){let msg='';try{msg=(await res.json()).error||''}catch(e){msg=`状態 ${res.status}`}throw new Error(msg||`状態 ${res.status}`)}
   const cd=res.headers.get('Content-Disposition')||'';
   const m=/filename\*=UTF-8''([^;]+)/i.exec(cd);
   const name=m?decodeURIComponent(m[1]):`${stem()}.xlsx`;
   await WL.base.saveBlob(await res.blob(),name);
   showToast&&showToast('Excel に出力しました',`${t.rows.length.toLocaleString()}件・${t.header.length}列（${name}）`,3600);
  }catch(e){showToast&&showToast('Excel に出力できませんでした',e.message||String(e),6000)}
  finally{busy=false;if(btn)btn.disabled=false}
 }
 /* ---------- 表示の設定 ---------- */
 const valueOf=id=>{const el=/** @type {HTMLInputElement|HTMLSelectElement|null} */(document.getElementById(id));return el?el.value:''};
 function current(){
  const target=WL.list.listLayoutTarget();
  return {target,columns:target?WL.columnLayout.get(target):null,slicer:WL.listSlicer?WL.listSlicer.setupOf():null,
   marks:WL.listMarks?WL.listMarks.setupOf():null,filters:(S.genericFilters||[]).filter(f=>!f.locked).map(({locked:_l,...f})=>f),
   pageSize:valueOf('pageSize'),rowGap:valueOf('listRowGap')};
 }
 function saveDisplay(){
  if(!S.db||!S.table)return;
  const body={kind:KIND,version:1,savedAt:new Date().toISOString(),list:`${S.db}:${S.table}`,items:current()};
  WL.base.saveBlob(new Blob([JSON.stringify(body,null,1)],{type:'application/json'}),`${stem()}_表示の設定.json`);
 }
 function loadDisplay(){
  const inp=document.createElement('input');inp.type='file';inp.accept='.json,application/json';
  inp.onchange=async()=>{
   const f=inp.files&&inp.files[0];if(!f)return;
   let x=null;
   try{x=JSON.parse(await f.text())}catch(e){showToast&&showToast('読み込めませんでした','JSONとして読めません。書き出したファイルをそのまま選んでください。',6000);return}
   if(!x||x.kind!==KIND||!x.items){showToast&&showToast('読み込めませんでした','一覧の「表示の設定」のファイルではありません（別のファイルを選んでいませんか）。',6000);return}
   const it=x.items,done=[],skip=[];
   const target=WL.list.listLayoutTarget();
   if(it.columns&&target){
    try{await WL.columnLayout.save(target,it.columns);done.push('列の設定')}
    catch(e){skip.push(`列の設定（${e.message||e}）`)}
   }
   if(it.slicer&&WL.listSlicer){WL.listSlicer.setSetup(it.slicer);done.push('スライサー')}
   if(it.marks&&WL.listMarks){WL.listMarks.setSetup(it.marks);done.push('色付け')}
   /* いつも適用の条件は残す（§9.614。前は丸ごと置き換えて、鍵付きの条件が黙って外れていた）。 */
   if(Array.isArray(it.filters)){WL.filters.replace(it.filters);done.push('絞り込み条件')}
   const ps=document.getElementById('pageSize');if(ps&&it.pageSize&&[...ps.options].some(o=>o.value===it.pageSize)){ps.value=it.pageSize;done.push('表示件数')}
   const rg=document.getElementById('listRowGap');if(rg&&it.rowGap){rg.value=it.rowGap;rg.dispatchEvent(new Event('input'));rg.dispatchEvent(new Event('change'));done.push('行間')}
   S.page=1;await WL.list.load();
   showToast&&showToast(`表示の設定を読み込みました（${x.list===`${S.db}:${S.table}`?'同じ一覧':'別の一覧のファイル'}）`,
    done.join('・')+(skip.length?`／当てられなかったもの: ${skip.join('、')}`:''),6000);
  };
  inp.click();
 }
 /* ---------- 狭い器の帯（§9.612 の畳んだ入口を §9.617 で2段に組み直した） ----------
    作業スケジュールに並べた狭い器（分割・ポップアップ）では、帯を**2段まで**にする（利用者の指示「ボタン類の機能は２段までの範囲で
    納める…階層化表示を上手に使って」）。1段目＝検索｜フィルタ ▾（保存したフィルタ・効いている条件・＋ 条件）｜道具・見せ方 ▾、
    2段目＝件数の札 ▾（件数・伏せ・結合・色）｜元データ（遅い）｜ページ。**機能は削らない**——面の項目は本物の入口そのもの
    （畳んだ入口は本物を押す・件数の面は本物の札を貸し出す）。本物の面は畳んだ入口の下に出る（`WL.popMenu.proxy`）。
    どこで畳むかは CSS の1箇所（45-tolerance.css の`.lt-fold`）。E の手順で5回作り直して決めた（S2・84点）。 */
 const NARROW='.sc-split-wrap,.sc-float-body';
 const FOLDS=[
  {key:'all',label:'道具・見せ方',short:'道具',icon:'fa-sliders',head:'道具・見せ方',groups:[
    {head:'道具（目印・集計）',ids:['listSlicerBtn','listMarkBtn']},
    {head:'見せ方',ids:['listColumnBtn','listViewBtn','listFileBtn']}],
   put:b=>{const s=document.getElementById('filterSavedBtn');if(s&&s.nextElementSibling!==b)s.after(b)}},
 ];
 const isOn=b=>!!b&&(b.classList.contains('active')||b.classList.contains('is-active')||b.classList.contains('is-on'));
 const nameOf=b=>((b.querySelector('.lt-tool-t,.lt-cols-t')||b).textContent||'').replace(/[▾\s]+$/,'').trim()||b.getAttribute('aria-label')||'';
 const realOf=g=>g.ids.map(id=>document.getElementById(id)).filter(Boolean);
 function placeFolds(){
  if(!document.querySelector('#genericFilterBar .filter-search-row'))return;
  FOLDS.forEach(f=>{
   let b=document.getElementById('listFold-'+f.key);
   if(!b){b=document.createElement('button');b.type='button';b.id='listFold-'+f.key;b.className='lt-tool-btn lt-fold';b.dataset.fold=f.key;
    b.setAttribute('aria-haspopup','menu');b.setAttribute('aria-expanded','false');b.onclick=()=>openFold(f,b)}
   f.put(b);
   const real=f.groups.flatMap(realOf);
   real.forEach(r=>WL.popMenu.proxy(r,b));
   const on=real.filter(isOn).length;
   b.classList.toggle('is-active',on>0);
   b.title=`${f.head}（${real.map(nameOf).join('・')}）${on?`・${on}つ使っています`:''}`;
   b.innerHTML=`<i class="fa-solid ${f.icon}" aria-hidden="true"></i><span class="lt-tool-t" data-short="${esc(f.short)}">${esc(f.label)}</span>${on?`<b class="lt-n">${on}</b>`:''}<i class="hd-caret" aria-hidden="true">▾</i>`;
  });
 }
 function openFold(f,btn){
  let m=document.getElementById('listFoldMenu');
  if(m&&!m.hidden&&m.dataset.fold===f.key){WL.popMenu.close();return}
  if(!m){m=document.createElement('div');m.id='listFoldMenu';m.className='wl-menu lt-fold-menu';m.hidden=true;document.body.appendChild(m)}
  m.dataset.fold=f.key;m.setAttribute('aria-label',f.head);
  m.innerHTML=f.groups.map(g=>`<p class="lt-fold-head">${esc(g.head)}</p>`+realOf(g).map(r=>`<button type="button" data-fold-to="${esc(r.id)}" class="${isOn(r)?'is-on':''}">${esc(nameOf(r))}${isOn(r)?'<small>使っています</small>':''}</button>`).join('')).join('');
  m.querySelectorAll('[data-fold-to]').forEach(x=>{x.onclick=()=>{const r=document.getElementById(x.dataset.foldTo);WL.popMenu.close();
   /* 次の巡回で押す——同じクリックの中で開くと、本物の面がこのクリックを「外を押した」と読んで閉じる。 */
   if(r)setTimeout(()=>r.click(),0)}});
  m.hidden=false;btn.setAttribute('aria-expanded','true');
  WL.popMenu.open(m,{anchor:btn,owner:btn,onClose:()=>{m.hidden=true;btn.setAttribute('aria-expanded','false')}});
 }
 /* ---------- 件数の札（狭い器の2段目の先頭）: 「件数 · 伏せ N ▾」 ----------
    押すと面に**本物の札を貸し出す**（伏せる・スライサーと色付けの選択・結合・色）。閉じたら元の席へ返す。
    帯に出す字は件数と伏せの数だけ（どの場面でも同じ場所・§9.397）。 */
 const LEND=['listToolSums','listJoinChip','listTintChip'];
 const LEND_NAME={listToolSums:'絞り込み',listJoinChip:'足した列',listTintChip:'列の色'};   // 札の字（「結合 …」「色 …」）と重ねない
 const countShort=t=>{const m=/^([\d,]+)件 \/ 全 ([\d,]+)件$/.exec(t);return m?`${m[1]}/${m[2]}件`:t};
 function placeState(){
  const st=document.querySelector('#listToolbar .lt-state');if(!st)return;
  let b=document.getElementById('listStateBtn');
  if(!b){b=document.createElement('button');b.type='button';b.id='listStateBtn';b.className='lt-tool-btn lt-state-btn';
   b.setAttribute('aria-haspopup','dialog');b.setAttribute('aria-expanded','false');b.onclick=()=>openState(b)}
  if(st.firstElementChild!==b)st.prepend(b);
  paintState();
 }
 function paintState(){
  const b=document.getElementById('listStateBtn');if(!b||b.getAttribute('aria-expanded')==='true')return;
  const count=((document.getElementById('count')||{}).textContent||'').trim();
  const hide=document.getElementById('lotHideChip'),n=hide&&!hide.hidden?((hide.querySelector('.lt-n')||{}).textContent||''):'';
  const html=`<span class="lt-cnt" data-short="${esc(countShort(count))}">${esc(count)}</span>`
   +(n!==''?`<span class="lt-cnt-hide"><i class="lt-dot" aria-hidden="true">·</i>伏せ <b>${esc(n)}</b></span>`:'')+'<i class="hd-caret" aria-hidden="true">▾</i>';
  if(b.innerHTML!==html)b.innerHTML=html;
  const lent=LEND.map(id=>document.getElementById(id)).filter(x=>x&&!x.hidden&&x.textContent.trim());
  b.title=`件数${n!==''?`・予定と同じロットを伏せる（${n}件）`:''}${lent.some(x=>x.id==='listJoinChip')?'・結合':''}（押すと内訳と、それぞれの設定）`;
 }
 function openState(btn){
  if(btn.getAttribute('aria-expanded')==='true'){WL.popMenu.close();return}
  const m=document.createElement('div');m.id='listStateMenu';m.className='wl-menu lt-state-menu';m.setAttribute('role','dialog');m.setAttribute('aria-label','いま見ている一覧');
  /* 件数は札と同じ字（札が短い名乗りのときは面も同じ）。行は「名前｜中身」で、名前の列は固定幅。 */
  const cnt=btn.querySelector('.lt-cnt'),short=!!btn.closest('.fit-cnt');
  const count=cnt?(short?cnt.dataset.short:cnt.textContent):'';
  m.innerHTML=`<p class="lt-fold-head">いま見ている一覧</p><div class="lt-state-row"><span class="lt-state-k">件数</span><b>${esc(count||'')}</b></div>`;
  /* 本物を貸す（席には目印を残し、閉じたら同じ席へ返す）。押した本物の面はこの札の下に出す。 */
  const back=[];
  LEND.map(id=>document.getElementById(id)).filter(x=>x&&!x.hidden&&x.textContent.trim()).forEach(x=>{
   const mark=document.createComment('lend:'+x.id);x.before(mark);back.push([x,mark]);
   const row=document.createElement('div');row.className='lt-state-row lt-state-lend';
   row.innerHTML=`<span class="lt-state-k">${esc(LEND_NAME[x.id]||'')}</span>`;row.append(x);m.append(row);
   x.querySelectorAll('button').forEach(r=>WL.popMenu.proxy(r,btn));
  });
  document.body.append(m);btn.setAttribute('aria-expanded','true');
  WL.popMenu.open(m,{anchor:btn,owner:btn,align:'start',onClose:()=>{back.forEach(([x,mark])=>{mark.replaceWith(x)});m.remove();
   btn.setAttribute('aria-expanded','false');paintState();fitBars()}});
 }
 /* ---------- 入らないときは「詰める順」で詰める（畳まない・場所を動かさない） ----------
    段ごとに詰め方の並びを持ち、入るまで1つずつ当てる（CSS が名乗りの class で効く）。1段目は2段目の出入りで変わらない。
    最後の手（伏せを件数の面へ）は、どの段も入らなかったときだけ。 */
 const FIT={
  row1:{sel:'#genericFilterBar .filter-search-row',steps:['fit-short']},
  row2:{sel:'#listToolbar .lt-state',steps:['fit-cnt','fit-tight','fit-page','fit-day','fit-sec','fit-key','fit-caret','fit-hide']},
 };
 const allSteps=Object.values(FIT).flatMap(x=>x.steps);
 function fitRow(row,steps){
  row.classList.remove(...allSteps);
  if(!row.closest(NARROW))return;
  const over=()=>row.scrollWidth>row.clientWidth+1;
  for(const c of steps){if(!over())return;row.classList.add(c)}
 }
 let fitting=false;
 function fitBars(){
  if(fitting)return;fitting=true;
  try{Object.values(FIT).forEach(f=>{const row=document.querySelector(f.sel);if(row)fitRow(row,f.steps)})}finally{fitting=false}
 }
 /* 帯の中身は別の本（件数・伏せる・元データ・読み込みの秒）が描くので、変わったら札と詰め方を描き直す（描いた後の1回）。 */
 let watched=null,queued=0;
 const later=()=>{if(queued)return;queued=requestAnimationFrame(()=>{queued=0;paintState();fitBars()})};
 const mo=new MutationObserver(later),ro=new ResizeObserver(later);
 function watchBars(){
  const st=document.querySelector('#listToolbar .lt-state');if(!st||st===watched)return;
  mo.disconnect();ro.disconnect();watched=st;
  mo.observe(st,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden']});
  ro.observe(st);const r1=document.querySelector(FIT.row1.sel);if(r1)ro.observe(r1);
 }
 /* 狭い器の検索欄は「検索」（「一覧を検索」は欄の幅で切れる。何の一覧かは器が言う）。 */
 function placeSearchWord(){const i=document.getElementById('search');if(i)i.placeholder=i.closest(NARROW)?'検索':'一覧を検索'}
 function placeNarrow(){placeFolds();placeState();placeSearchWord();watchBars();fitBars()}
 WL.listHooks.onAfter(()=>{placeFile();placeZoom();placeNarrow()});
 WL.listHooks.onGrid(()=>{placeFile();placeZoom();placeNarrow()});
 WL.listTools={setZoom,zoom:()=>zoom,exportXlsx,current,gather,fitBars};
})();
