"use strict";
/* report-dashboard.js: 測定帳票・生産管理ダッシュボード */
/* ============================================================
2026-07-21 ロット別測定帳票
--------------------------------------------------------------
方針（IA / 認知心理学）:
- モーダルではなく、品質データ分析(qa-v7)と同じ「メイン画面の
  表示切り替え」とする。表示エリアを最大限確保するため、#grid の
  兄弟要素としてパネルを差し込み、body.rp-mode で他の要素を隠す。
- 左に端末保存済みロットの一覧（再認）、右にプレビュー（詳細）。
  帳票本体はセクション見出しでチャンク化し、1画面で読み切れる粒度にする。
- 画面プレビューは印刷と同じ密度のCSSでA4実寸(210mm×297mm)のまま
  組み、既定では「ページ全体」表示（縮小フィット）にして帳票の
  全体像を一目で把握できるようにする。100%表示にも切り替え可能。
- 「records.sqlite3」への保存内容と同一のローカル保存レコード
  （reliableAll）を対象データとする。印刷・PDF保存はブラウザーの
  印刷機能を使い、追加ライブラリなしで完結させる。
============================================================ */
(function(){
 let rpState={items:[],query:'',sort:'updated-desc',selectedId:''},rpZoom='fit',rpCurrentScale=1;
 // 条ごとのロット№/公差ラベルを、連続する行でも毎回表示するか、変化した
 // 行だけに表示するか(見た目上のグルーピング)を切り替えられるようにする。
 let rpRepeatLabels=true;
 const $id=id=>document.getElementById(id);
 function fmtDT(v){if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?'-':d.toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
 function fmtDimSafe(v,d){const raw=String(v??'').trim();if(raw==='')return '';const n=Number(raw);return Number.isFinite(n)?n.toFixed(d):raw}
 function statusLabel(s){return s||'編集中'}
 function statusClass(s){return s==='完了'?'done':s==='測定値NG'?'ng':''}

 /* 2026-07-22: 帳票へはメニューから直接遷移させず、編集中/完了データ一覧の
    各行からのみ開けるようにする(一覧側が起点になる運用のため、サイドバー
    の直接導線は廃止)。 */
 function exitReportView(){
  if(!document.body.classList.contains('rp-mode'))return;
  document.body.classList.remove('rp-mode');
  const panel=$id('reportPanel');if(panel)panel.hidden=true;
 }
 if(typeof selectDb==='function'){const old=selectDb;selectDb=async function(k,b){exitReportView();return old(k,b)}}

 function ensurePanel(){
  let panel=$id('reportPanel');if(panel)return panel;
  panel=document.createElement('section');panel.className='rp-panel';panel.id='reportPanel';panel.hidden=true;
  panel.innerHTML=`
   <header class="rp-head">
    <button type="button" id="reportBack" class="rp-back-btn" title="元の一覧に戻ります"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>戻る</button>
    <div class="rp-head-title"><h2>測定帳票</h2><span class="rp-sub">端末に保存済みのロットから帳票を作成します。一覧から選ぶとプレビューが表示されます。</span></div>
   </header>
   <div class="rp-body">
    <nav class="rp-nav" aria-label="ロット一覧">
     <div class="rp-nav-toolbar">
      <label class="rp-search"><span class="rp-search-icon" aria-hidden="true">検索</span><input id="reportSearch" type="search" placeholder="ロット・検査番号・設備など" autocomplete="off"></label>
      <select id="reportSort" aria-label="並び順">
       <option value="updated-desc">更新日時の新しい順</option>
       <option value="updated-asc">更新日時の古い順</option>
       <option value="lot-asc">ロット番号順</option>
      </select>
     </div>
     <div class="rp-lot-list" id="reportLotList"></div>
    </nav>
    <section class="rp-main">
     <div class="rp-toolbar">
      <div class="rp-toolbar-title" id="reportSelectedTitle">ロットを選択してください</div>
      <div class="rp-toolbar-actions">
       <div class="rp-zoom-seg" data-seg="rpZoomSeg" role="group" aria-label="表示倍率">
        <button type="button" data-val="fit" class="active">ページ全体</button>
        <button type="button" data-val="width">幅に合わせる</button>
        <button type="button" data-val="100">100%</button>
       </div>
       <span class="rp-zoom-readout" id="rpZoomReadout" title="Ctrlを押しながらホイールで拡大・縮小できます">100%</span>
       <button type="button" id="reportLabelToggle" class="rp-btn-secondary" title="条ごとのロット№・板幅公差のラベルを、連続する行でも毎回表示するか、変化した行だけに表示するかを切り替えます">ラベル: 毎行表示</button>
       <button type="button" id="reportPrint" class="rp-btn-primary" disabled>印刷</button>
       <button type="button" id="reportPdf" class="rp-btn-secondary" disabled>PDFで保存</button>
      </div>
     </div>
     <div class="rp-pdf-hint">「PDFで保存」は印刷ダイアログを開きます。出力先（プリンター）で「PDFに保存」を選択してください。</div>
     <div class="rp-scroll" id="rpScroll">
      <div class="rp-page-box" id="rpPageBox">
       <div class="rp-report rp-page" id="reportContent"><div class="rp-empty">左の一覧からロットを選ぶと、帳票プレビューがここに表示されます。</div></div>
      </div>
     </div>
    </section>
   </div>`;
  const grid=$id('grid');grid?.parentNode?.insertBefore(panel,grid);
  const search=$id('reportSearch');if(search)search.oninput=()=>{rpState.query=search.value;renderLotList()};
  const sort=$id('reportSort');if(sort)sort.onchange=()=>{rpState.sort=sort.value;renderLotList()};
  $id('reportPrint').onclick=printReport;$id('reportPdf').onclick=printReport;
  $id('reportBack').onclick=backToRecordList;
  $id('reportLabelToggle').onclick=()=>{rpRepeatLabels=!rpRepeatLabels;updateLabelToggle();const cur=rpState.items.find(i=>i.id===rpState.selectedId);if(cur)renderReport(cur)};
  panel.querySelectorAll('[data-seg="rpZoomSeg"] button').forEach(b=>b.onclick=()=>setZoom(b.dataset.val));
  window.addEventListener('resize',()=>{if(rpZoom==='fit')fitPage();else if(rpZoom==='width')fitWidth()});
  // Ctrl(⌘)+ホイールで拡大縮小。通常のホイールは一覧のスクロールを妨げないよう素通しする。
  $id('rpScroll').addEventListener('wheel',e=>{
   if(!e.ctrlKey&&!e.metaKey)return;
   e.preventDefault();
   rpZoom='custom';
   document.querySelectorAll('[data-seg="rpZoomSeg"] button').forEach(b=>b.classList.remove('active'));
   applyScale(rpCurrentScale*(e.deltaY<0?1.1:1/1.1));
  },{passive:false});
  updateLabelToggle();
  return panel;
 }

 /* ---------- A4ページの表示倍率 ----------
    'fit'=ページ全体(縦横ともに収まるよう縮小)、'width'=表示エリアの幅に
    最大化(高さは超えてよく、縦スクロールで閲覧)、'100'=実寸、
    'custom'=Ctrl+ホイールによる任意倍率。印刷/PDF出力時はCSS側で
    transformを強制解除するため、画面上の倍率は出力に影響しない。 ---------- */
 function updateLabelToggle(){
  const b=$id('reportLabelToggle');if(!b)return;
  b.textContent=rpRepeatLabels?'ラベル: 毎行表示':'ラベル: 変化時のみ表示';
  b.classList.toggle('active',!rpRepeatLabels);
 }
 function setZoom(v){
  rpZoom=v;
  document.querySelectorAll('[data-seg="rpZoomSeg"] button').forEach(b=>b.classList.toggle('active',b.dataset.val===v));
  if(v==='fit')fitPage();else if(v==='width')fitWidth();else applyScale(1);
 }
 function applyScale(scale){
  const box=$id('rpPageBox'),page=$id('reportContent');if(!box||!page)return;
  scale=Math.max(.25,Math.min(3,scale));
  rpCurrentScale=scale;
  const pw=page.offsetWidth,ph=page.offsetHeight;
  page.style.transform=`scale(${scale})`;
  if(pw&&ph){box.style.width=`${pw*scale}px`;box.style.height=`${ph*scale}px`}
  const readout=$id('rpZoomReadout');if(readout)readout.textContent=`${Math.round(scale*100)}%`;
 }
 function resetPageScale(){
  const box=$id('rpPageBox'),page=$id('reportContent');if(!box||!page)return;
  page.style.transform='';box.style.width='';box.style.height='';
 }
 function fitPage(){
  if(rpZoom!=='fit')return;
  const scroll=$id('rpScroll'),box=$id('rpPageBox'),page=$id('reportContent');
  if(!scroll||!box||!page)return;
  resetPageScale();
  requestAnimationFrame(()=>{
   if(rpZoom!=='fit')return;
   const pw=page.offsetWidth,ph=page.offsetHeight;if(!pw||!ph)return;
   const availW=Math.max(60,scroll.clientWidth-44),availH=Math.max(60,scroll.clientHeight-44);
   const scale=Math.max(.1,Math.min(availW/pw,availH/ph,1));
   applyScale(scale);
  });
 }
 function fitWidth(){
  if(rpZoom!=='width')return;
  const scroll=$id('rpScroll'),box=$id('rpPageBox'),page=$id('reportContent');
  if(!scroll||!box||!page)return;
  resetPageScale();
  requestAnimationFrame(()=>{
   if(rpZoom!=='width')return;
   const pw=page.offsetWidth;if(!pw)return;
   const availW=Math.max(60,scroll.clientWidth-44);
   const scale=Math.max(.1,availW/pw);
   applyScale(scale);
  });
 }

 function searchText(x){return [x.basic?.lotNo,x.basic?.inspectionNo,x.basic?.castingNo,x.basic?.orderNo,x.settings?.registeredEquipment,x.registeredEquipment,x.status].map(v=>String(v||'').normalize('NFKC').toLowerCase()).join(' ')}
 function sortedFiltered(){
  const q=String(rpState.query||'').normalize('NFKC').toLowerCase();
  let items=rpState.items.filter(x=>!q||searchText(x).includes(q));items=[...items];
  if(rpState.sort==='updated-asc')items.sort((a,b)=>String(a.updatedAt||'').localeCompare(String(b.updatedAt||'')));
  else if(rpState.sort==='lot-asc')items.sort((a,b)=>String(a.basic?.lotNo||'').localeCompare(String(b.basic?.lotNo||''),'ja'));
  else items.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
  return items;
 }

 function renderLotList(){
  const list=$id('reportLotList');if(!list)return;
  const items=sortedFiltered();
  if(!items.length){list.innerHTML=`<div class="rp-empty">${rpState.items.length?'検索条件に一致するロットがありません。':'端末に保存されたロットがありません。測定画面で保存すると一覧に表示されます。'}</div>`;return}
  const frag=document.createDocumentFragment();
  items.forEach(x=>{
   const equipment=x.settings?.registeredEquipment||x.registeredEquipment||x.snapshot?.registeredEquipment||'-';
   const row=document.createElement('button');row.type='button';row.className='rp-lot-row'+(x.id===rpState.selectedId?' active':'');
   row.innerHTML=`<span class="rp-lot-main"><b title="${esc(x.basic?.lotNo||x.id)}">${esc(x.basic?.lotNo||x.id)}</b><em class="rp-status-badge ${statusClass(x.status)}">${esc(statusLabel(x.status))}</em></span><span class="rp-lot-sub" title="${esc(equipment)}">${esc(equipment)}・${esc(x.basic?.inspectionNo||'-')}</span><span class="rp-lot-date">${esc(fmtDT(x.updatedAt))}</span>`;
   row.onclick=()=>selectLot(x.id);
   row.ondblclick=e=>{e.preventDefault();e.stopPropagation();if(typeof resumeRecordFromList==='function')resumeRecordFromList(x)()};
   frag.append(row);
  });
  list.innerHTML='';list.append(frag);
 }

 function reportSection(title,rows,cols){
  const body=rows.map(([label,value])=>`<div class="rp-field"><span class="rp-field-label">${esc(label)}</span><span class="rp-field-value" title="${esc(value||'-')}">${esc(value||'-')}</span></div>`).join('');
  return `<section class="rp-section"><h3>${esc(title)}</h3><div class="rp-grid${cols?' rp-grid-'+cols:''}">${body}</div></section>`;
 }
 function dimensionSection(b){
  const row=(label,mat,temper,thick,width,length)=>`<tr><th>${esc(label)}</th><td>${esc(mat||'-')}</td><td>${esc(temper||'-')}</td><td>${esc(fmtDimSafe(thick,3)||'-')}</td><td>${esc(fmtDimSafe(width,1)||'-')}</td><td>${esc(fmtDimSafe(length,1)||'-')}</td></tr>`;
  return `<section class="rp-section"><h3>寸法（オーダー／製造）</h3><table class="rp-dim-table"><thead><tr><th></th><th>材質</th><th>調質</th><th>板厚</th><th>板幅</th><th>板丈</th></tr></thead><tbody>${row('オーダー',b.orderMaterial,b.orderTemper,b.orderThickness,b.orderWidth,b.orderLength)}${row('製造',b.mfgMaterial,b.mfgTemper,b.mfgThickness,b.mfgWidth,b.mfgLength)}</tbody></table></section>`;
 }

 /* ---------- 複数丈（N分割）対応: 1(頭) と N(尾) のみを帳票に載せる ----------
    旧VBA帳票（B5帳票モジュール）と同じ考え方。丈位置は 0=1(頭) 、
    末尾(=縦割数)=N(尾) に固定して読む。巻ずれ・テレスコープはN(尾)のみ対象。 */
 function lengthLabels(s){
  const n=Math.max(1,Math.min(9,+s?.verticalCount||1));
  return {headIdx:0,tailIdx:n,headLabel:'1(頭)',tailLabel:`${n}(尾)`};
 }
 function measAt(x,key,li,col){const v=x.measurements?.[key]?.[li]?.[col];return (v===undefined||v===null||v==='')?'':String(v)}
 function fieldNum(row,names){for(const n of names){if(row[n]!==undefined&&row[n]!==null&&row[n]!==''){const v=Number(row[n]);if(Number.isFinite(v))return v}}return null}
 /* 公差範囲: レコード保存時点の仕掛スナップショット(source)から製造/オーダー公差を読む。
    フィールド名は toleranceDataForSource（測定画面側）と同じ候補を使う。 */
 function toleranceRangeLocal(x,kind){
  const row=x.source||x.snapshot?.source||{};
  const base=Number(kind==='thickness'?x.basic?.mfgThickness:x.basic?.mfgWidth);
  if(!Number.isFinite(base))return null;
  const isT=kind==='thickness',dim=isT?'板厚':'板幅';
  const fieldsFor=order=>({
   plus:[`${dim}公差_${order?'オーダー':'製造'}_プラス`,`${dim}公差_${order?'ｵｰﾀﾞｰ':'製造'}_ﾌﾟﾗｽ`,isT?(order?'KOSAXSOP':'KOSAXSMP'):(order?'KOSAYSOP':'KOSAYSMP')],
   minus:[`${dim}公差_${order?'オーダー':'製造'}_マイナス`,`${dim}公差_${order?'ｵｰﾀﾞｰ':'製造'}_ﾏｲﾅｽ`,isT?(order?'KOSAXSOM':'KOSAXSMM'):(order?'KOSAYSOM':'KOSAYSMM')],
  });
  const wantOrder=x.settings?.toleranceSource==='order';
  let f=fieldsFor(wantOrder),plus=fieldNum(row,f.plus),minus=fieldNum(row,f.minus);
  if((plus===null||minus===null)&&wantOrder){f=fieldsFor(false);plus=fieldNum(row,f.plus);minus=fieldNum(row,f.minus)}
  if(plus===null||minus===null)return null;
  return [base-minus,base+plus];
 }
 function qualityGradeSection(x){
  const g=x.qualityGrades||{};
  const rows=[['生地外観','アルマイト','表面処理','付着油'],['方向性','強度','ラテラルボー','直角度'],['切断面','板厚公差','幅丈公差','フラットネス']];
  const body=rows.map(group=>`<tr>${group.map(l=>`<th>${esc(l)}</th><td>${esc(g[l]||'-')}</td>`).join('')}</tr>`).join('');
  return `<section class="rp-section"><h3>品質等級</h3><table class="rp-dim-table rp-grade-table"><tbody>${body}</tbody></table></section>`;
 }
 /* 仕掛データ取込時に別ファイル（品質情報テーブル）から取得し保存している
    異常/保留情報。旧帳票では品質等級欄の上（右上ブロック）に表示されていた。 */
 function qualityInfoSection(x){
  const text=String(x.qualityInfo||'異常情報なし');
  return `<section class="rp-section"><h3>品質情報（仕掛）</h3><div class="rp-info-box">${esc(text).replace(/\n/g,'<br>')}</div></section>`;
 }
 function motherSection(x){
  const m=x.mother||{},originalWidth=fmtDim(x.basic?.originalWidth,1);
  return `<section class="rp-section"><h3>母材実績／カード指示</h3><table class="rp-dim-table"><thead><tr><th></th><th>元幅</th><th>手計算</th><th>全長</th><th>前オフ</th><th>後オフ</th></tr></thead><tbody><tr><th>実績</th><td rowspan="2">${esc(originalWidth||'-')}</td><td>${esc(m.manual||'-')}</td><td>${esc(m.fullLength||'-')}</td><td>${esc(m.front||'-')}</td><td>${esc(m.rear||'-')}</td></tr><tr><th>カード指示</th><td>${esc(m.minCard||'-')}</td><td>${esc(m.maxCard||'-')}</td><td>${esc(m.frontCard||'-')}</td><td>${esc(m.rearCard||'-')}</td></tr></tbody></table></section>`;
 }
 /* 条割(分割)が設定されている場合、条(col, 0始まり)がどのロット・どの
    目標幅(公差)に属するかを求める。以前は「条割 分割公差」として別表に
    していたが、条ごとのロット№・範囲上下限として板幅の実測データ表へ
    直接統合し、判定に使った公差の根拠をその場で確認できるようにする。
    分割されていない(またはグループが1つ以下)場合は、レコード自身の
    ロット№と全体の板幅公差(fallbackTol)をそのまま返す。 */
 function widthRowContext(x,col,fallbackTol){
  const groups=x.settings?.splitGroups;
  if(Array.isArray(groups)&&groups.length>=2){
   let start=0;
   for(const g of groups){
    const count=g.count||0,end=start+count;
    if(col>=start&&col<end){
     const w=g.tol?.width?.manufacturing||g.tol?.width?.order;
     const range=(w&&Number.isFinite(g.base?.width))?[g.base.width-w.minus,g.base.width+w.plus]:null;
     return {lot:g.lot||'-',range};
    }
    start=end;
   }
  }
  return {lot:x.basic?.lotNo||'-',range:fallbackTol};
 }
 function thicknessMeasurementSection(x){
  const s=x.settings||{},{headIdx,tailIdx,headLabel,tailLabel}=lengthLabels(s),tol=toleranceRangeLocal(x,'thickness');
  const rows=['OS','CL','DS'].map((label,col)=>`<tr><th>${label}</th><td>${tol?fmtDimSafe(tol[0],3):'-'}</td><td>${esc(measAt(x,'thickness',headIdx,col)||'-')}</td><td>${esc(measAt(x,'thickness',tailIdx,col)||'-')}</td><td>${tol?fmtDimSafe(tol[1],3):'-'}</td></tr>`).join('');
  return `<section class="rp-section"><h3>測定データ（板厚）</h3><table class="rp-dim-table"><thead><tr><th>測定位置</th><th>範囲下限</th><th>${esc(headLabel)}</th><th>${esc(tailLabel)}</th><th>範囲上限</th></tr></thead><tbody>${rows}</tbody></table></section>`;
 }
 /* コイル№は実際の横割数に関わらず常に最大40行を確保する。旧帳票（B5帳票）は
    条数に関わらず固定グリッドを印刷しており、余白も注記・手書き用の必要領域
    のため、実データがない行も空欄のまま枠だけ残す（"-"を書かず空欄にする）。 */
 function widthMeasurementSection(x){
  const s=x.settings||{},actual=Math.max(1,Math.min(40,+s.horizontalCount||1)),{headIdx,tailIdx,headLabel,tailLabel}=lengthLabels(s),tol=toleranceRangeLocal(x,'width');
  let rows='',prevKey=null;
  for(let col=0;col<40;col++){
   const real=col<actual,cell=v=>real?esc(v||'-'):'';
   let lotText='',lowText='',highText='';
   if(real){
    const ctx=widthRowContext(x,col,tol),key=`${ctx.lot}|${ctx.range?ctx.range.join(','):''}`;
    const show=rpRepeatLabels||key!==prevKey;prevKey=key;
    lotText=show?esc(ctx.lot):'';
    lowText=ctx.range?fmtDimSafe(ctx.range[0],2):(tol?fmtDimSafe(tol[0],2):'');
    highText=ctx.range?fmtDimSafe(ctx.range[1],2):(tol?fmtDimSafe(tol[1],2):'');
   }
   rows+=`<tr><th class="rp-colno">${col+1}</th><td class="rp-collot">${lotText}</td><td>${lowText}</td><td>${cell(measAt(x,'width',headIdx,col))}</td><td>${cell(measAt(x,'width',tailIdx,col))}</td><td>${highText}</td><td>${cell(measAt(x,'lateral',headIdx,col))}</td><td>${cell(measAt(x,'lateral',tailIdx,col))}</td><td>${cell(measAt(x,'burr',headIdx,col))}</td><td>${cell(measAt(x,'burr',tailIdx,col))}</td><td>${cell(measAt(x,'offset',tailIdx,col))}</td><td>${cell(measAt(x,'telescope',tailIdx,col))}</td><td>${cell(measAt(x,'flatness',headIdx,col))}</td><td>${cell(measAt(x,'flatness',tailIdx,col))}</td><td>${cell(measAt(x,'comments',tailIdx,col))}</td></tr>`;
  }
  return `<section class="rp-section"><h3>測定データ（板幅・ラテラルボー・バリ・巻ずれ・テレスコープ）</h3><p class="rp-note">巻ずれ・テレスコープは ${esc(tailLabel)} のデータのみ対象です。横割数（${actual}条）を超える行は控え欄として空欄にしています。幅ロット分割時は条ごとのロット№・目標幅(公差)を条番号の右に表示します。</p><div class="rp-wide-wrap"><table class="rp-dim-table rp-wide-table"><thead><tr><th rowspan="2">条番号</th><th rowspan="2">ロット№</th><th colspan="4">板幅</th><th colspan="2">ラテラルボー</th><th colspan="2">バリ</th><th>巻ずれ</th><th>テレスコープ</th><th colspan="2">フラットネス</th><th rowspan="2">備考</th></tr><tr><th>範囲下限</th><th>${esc(headLabel)}</th><th>${esc(tailLabel)}</th><th>範囲上限</th><th>${esc(headLabel)}</th><th>${esc(tailLabel)}</th><th>${esc(headLabel)}</th><th>${esc(tailLabel)}</th><th>${esc(tailLabel)}</th><th>${esc(tailLabel)}</th><th>${esc(headLabel)}</th><th>${esc(tailLabel)}</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
 }
 /* 丈(1..N)別の長さ・肉厚・揃い判定。旧帳票の「丈」テーブル（長さ/肉厚/揃い/外観/備考）に対応。
    「外観」列は旧帳票でも実データが書き込まれない控え欄のため、空欄のまま残す。
    旧B5帳票と同じ「丈を行に、指標を列に」持つ構成に統一する。以前は丈数
    (最大9)ぶんを列に転置していたが、丈数が多いと列がセルの表示幅に収まらず、
    テキストが隣接セル(この帳票では板厚/板幅の実測値テーブル)の領域まで
    はみ出して表示されてしまう不具合があったため、丈ごとに行を積む
    シンプルな構成に戻した(丈は最大9のため縦方向の圧迫も小さい)。 */
 function productRowsSection(x){
  const rows=x.product?.rows||[],actual=Math.max(1,Math.min(9,+x.settings?.verticalCount||1));
  const body=Array.from({length:actual},(_,i)=>{
   const r=rows[i]||{},j=judgeAlignmentCode(r.alignmentCode);
   return `<tr><th>${i+1}</th><td>${esc(r.productLength||'-')}</td><td>${esc(r.wallThickness||'-')}</td><td>${j?`<span class="product-judge${j==='OK'?' ok':' ng'}">${esc(j)}</span>`:''}</td><td></td><td>${esc(r.note||'-')}</td></tr>`;
  }).join('');
  return `<section class="rp-section"><h3>丈別データ（長さ・肉厚・揃い）</h3><table class="rp-dim-table rp-product-table"><thead><tr><th>丈</th><th>長さ</th><th>肉厚</th><th>揃い</th><th>外観</th><th>備考</th></tr></thead><tbody>${body}</tbody></table></section>`;
 }
 /* 作業班構成: オペレータ・検査員は既存データから、梱包員は現状データ未実装
    のため常に「-」表示。旧帳票の梱包員欄に相当する表示エリアだけ先に確保する。 */
 function crewSection(x){
  const s=x.settings||{};
  return reportSection('作業班構成',[['オペレータ',s.operator],['検査員',s.inspector],['梱包員',s.packer],['作業人数',(s.crewSize&&s.crewSize!=='-')?`${s.crewSize}名班`:'-']]);
 }

 /* ある測定項目(measurements[key])にひとつでも実測値が入っているか。
    「入力内容」セレクトは1レコード内の作業タブ切替に過ぎず、保存時点の
    選択値ではないため、帳票にどのセクションを載せるかは実際にデータが
    あるかどうかで判定する(現在の選択値だけで判定すると、板幅を測定した
    後にラテラルボー等の別タブに切り替えたまま保存した場合、板厚/板幅の
    実測データが帳票から消えてしまう不具合があった)。 */
 function hasMeasurementValues(x,keys){
  return keys.some(key=>(x.measurements?.[key]||[]).some(row=>(row||[]).some(v=>String(v??'').trim()!=='')));
 }
 function renderReport(x){
  const b=x.basic||{},s=x.settings||{},w=x.workTime||{};
  const equipment=s.registeredEquipment||x.registeredEquipment||x.snapshot?.registeredEquipment||'-';
  const dur=w.startAt&&w.endAt?formatDuration(new Date(w.endAt)-new Date(w.startAt)):(w.startAt?'作業中':'未計測');
  const isDimensional=s.measureType==='板厚/板幅'||hasMeasurementValues(x,['thickness']);
  const hasWidthTableData=hasMeasurementValues(x,['width','lateral','burr','offset','telescope','flatness']);
  const showWidthTable=['板厚/板幅','ラテラルボー','バリ','テレスコープ','巻ずれ','フラットネス'].includes(s.measureType)||hasWidthTableData;
  const hasProductData=(x.product?.rows||[]).some(r=>r&&['productLength','wallThickness','alignmentCode'].some(k=>String(r[k]||'').trim()!==''));
  const showProduct=s.measureType==='揃い/肉厚/長さ'||hasProductData;
  /* 1ページ(A4)に収める配置: 情報量に応じてゾーンごとに列数と列幅比を変え、
     再認しやすい単位（ラベル欄+基本情報、公差付き実測値など）でまとめる。
     文字量が少ないブロック（品質等級・母材実績など）は幅を絞り、
     文字量が多い/列数が可変なブロック（測定条件・丈別データ）に幅を回す
     ことで、列の高さがそろい不要な余白が生まれないようにする。
     品質情報は長文になりうるため、狭い列に押し込めず全幅の専用行として
     常時確保する。大きな表（板幅ほかの40行）も同様に全幅を割り当てる。 */
  $id('reportContent').innerHTML=`
   <div class="rp-report-head">
    <div><small>MEASUREMENT REPORT</small><h2>${esc(b.lotNo||x.id)}</h2></div>
    <div class="rp-report-head-meta"><span class="rp-status-badge ${statusClass(x.status)}">${esc(statusLabel(x.status))}</span><span>帳票作成: ${esc(fmtDT(new Date().toISOString()))}</span></div>
   </div>
   <div class="rp-zone rp-zone-3">
    <div class="rp-label-area" aria-hidden="true"><span class="rp-label-caption">ラベル貼付スペース</span></div>
    ${reportSection('基本情報',[['ロット番号',b.lotNo],['検査番号',b.inspectionNo],['鋳造番号',b.castingNo],['オーダー番号',b.orderNo],['引当番号',b.allocationNo],['用途コード',b.purposeCode],['用途名',b.purposeName],['取引先',b.customer],['納入先',b.delivery]])}
    <div class="rp-stack">${reportSection('コース情報',[['設計コース',b.designCourse],['実績コース',b.course],['残コース',b.residualCourse]],1)}${dimensionSection(b)}</div>
   </div>
   ${qualityInfoSection(x)}
   <div class="rp-zone rp-zone-quality">
    ${qualityGradeSection(x)}
    ${reportSection('測定条件',[['登録設備',equipment],['入力内容',s.measureType],['丈位置',s.lengthPos],['縦割数',s.verticalCount],['横割数',s.horizontalCount],['巻出方向',s.unwind],['内径',s.innerDiameter],['スプール',s.spool],['板厚測定器',s.thicknessGauge],['板幅測定器',s.widthGauge],['条入力順',s.widthOrder],['方向',s.widthDirection],['バリ揃え',s.burr],['内巻両面テープ',s.innerTape?'あり':'なし']],4)}
    ${crewSection(x)}
   </div>
   <div class="rp-zone rp-zone-length">
    ${motherSection(x)}
    ${showProduct?productRowsSection(x):'<div></div>'}
    ${isDimensional?thicknessMeasurementSection(x):'<div></div>'}
   </div>
   ${showWidthTable?widthMeasurementSection(x):''}
   <div class="rp-zone rp-zone-2">
    ${reportSection('作業時間',[['開始時刻',formatWorkTime(w.startAt)],['終了時刻',formatWorkTime(w.endAt)],['実働時間',dur]])}
    ${reportSection('登録状態',[['状態',statusLabel(x.status)],['更新日時',fmtDT(x.updatedAt)],['NG回数',s.ngCount||0]])}
   </div>
  `;
 }

 function selectLot(id){
  rpState.selectedId=id;renderLotList();
  const x=rpState.items.find(i=>i.id===id);if(!x)return;
  $id('reportSelectedTitle').textContent=`${x.basic?.lotNo||x.id} の帳票プレビュー`;
  $id('reportPrint').disabled=false;$id('reportPdf').disabled=false;
  renderReport(x);
  fitPage();fitWidth();
 }

 function printReport(){
  if(!rpState.selectedId)return;
  const x=rpState.items.find(i=>i.id===rpState.selectedId),prevTitle=document.title;
  document.title=`測定帳票_${x?.basic?.lotNo||x?.id||'lot'}`;
  window.print();
  setTimeout(()=>{document.title=prevTitle},500);
 }

 async function openReportView(){
  window.exitCalendarView?.();
  document.body.classList.remove('qa-mode','qa-view-raw');
  document.getElementById('dashboardPanel')?.setAttribute('hidden','');
  document.body.classList.remove('db-mode');
  document.getElementById('recordModal')?.setAttribute('hidden','');
  /* 測定画面から開く場合もあるため、重なって残らないよう閉じる
     (測定内容は呼び出し側で保存済み。戻る操作で開き直す)。 */
  document.getElementById('measureModal')?.setAttribute('hidden','');
  document.getElementById('openDashboard')?.classList.remove('active');
  document.body.classList.add('rp-mode');
  document.querySelectorAll('#nav button.db').forEach(b=>b.classList.remove('active'));
  ensurePanel().hidden=false;
  setZoom(rpZoom);
  $id('reportSelectedTitle').textContent='ロットを選択してください';
  $id('reportPrint').disabled=true;$id('reportPdf').disabled=true;
  $id('reportContent').innerHTML='<div class="rp-empty">左の一覧からロットを選ぶと、帳票プレビューがここに表示されます。</div>';
  const listEl=$id('reportLotList');listEl.innerHTML='<div class="rp-empty">読み込んでいます…</div>';
  try{
   const all=await reliableAll();
   rpState={items:all,query:'',sort:$id('reportSort')?.value||'updated-desc',selectedId:''};
   const search=$id('reportSearch');if(search)search.value='';
   renderLotList();
  }catch(e){listEl.innerHTML=`<div class="rp-empty">一覧を読み込めませんでした: ${esc(e.message)}</div>`}
 }

 /* 帳票を開いた起点。「戻る」の行き先をここで覚えておく。
    'records' = 編集中/完了データ一覧(従来) / 'measure' = 測定画面。 */
 let rpReturnTo='records';

 /* 編集中/完了データ一覧は統合された1つの一覧のため、帳票から戻る際は
    現在のトグル状態(編集中/完了それぞれのON/OFF)をそのまま維持して
    再度開く(openRecordsSafe(null)はopenRecords()側でプリセットを
    上書きせず現在のrecordListState.statusesを引き継ぐ)。 */
 window.openReportForRecord=async function(id,options){
  const opt=options||{};
  rpReturnTo=opt.returnTo==='measure'?'measure':'records';
  await openReportView();           // ここで初めてパネル(戻るボタン)が作られる
  updateBackButton();
  selectLot(id);
  /* 印刷は描画後でないと白紙になるため、1フレーム置いてから開く。 */
  if(opt.print)requestAnimationFrame(()=>requestAnimationFrame(printReport));
 };
 function updateBackButton(){
  const btn=$id('reportBack');if(!btn)return;
  const toMeasure=rpReturnTo==='measure';
  /* ボタンの中身は <svg>アイコン</svg> + 文字列。アイコンは残して文字だけ差し替える。 */
  const label=[...btn.childNodes].find(n=>n.nodeType===Node.TEXT_NODE);
  if(label)label.textContent=toMeasure?'測定へ戻る':'戻る';
  btn.title=toMeasure?'測定画面へ戻ります':'元の一覧に戻ります';
 }
 function backToRecordList(){
  exitReportView();
  if(rpReturnTo==='measure'){
   rpReturnTo='records';updateBackButton();
   const modal=document.getElementById('measureModal');
   if(modal){
    modal.hidden=false;
    /* 帳票へ出ている間に描画が止まっているため、戻った時点の内容で
       検証表示と測定進捗を作り直す(古い件数が残るのを防ぐ)。 */
    if(typeof updateValidationVisuals==='function')updateValidationVisuals();
    requestAnimationFrame(()=>$id('deviceInput')?.focus());
   }
   return;
  }
  if(typeof openRecordsSafe==='function')openRecordsSafe(null);
 }

 /* 測定画面(操作レール)から帳票を開く。帳票は端末に保存済みのレコードを
    読んで描画するため、画面上の入力内容をそのまま出せるよう先に保存する。
    saveLocal()の既定値は'編集中'なので、完了済みのデータを開いていた場合に
    状態を巻き戻さないよう、現在の状態を明示して渡す。 */
 async function openReportFromMeasure(print){
  if(!S.measure){showToast?.('測定データがありません','測定画面を開いてから実行してください。',4000);return}
  try{
   await saveLocal(S.measure.status||'編集中');
  }catch(e){
   showToast?.('帳票を開けませんでした','入力内容を端末へ保存できませんでした: '+e.message,6000);return;
  }
  await window.openReportForRecord(S.measure.id,{returnTo:'measure',print:!!print});
 }
 document.addEventListener('click',e=>{
  const btn=e.target.closest?.('#openReport,#printReport');if(!btn)return;
  e.preventDefault();
  openReportFromMeasure(btn.id==='printReport');
 });
 window.openReportFromMeasure=openReportFromMeasure;
})();

/* ============================================================
2026-07-21 生産管理ダッシュボード（KPI集計）
--------------------------------------------------------------
方針:
- 端末保存済みの測定データ(reliableAll)を対象とする。品質データ分析
  (qa-v7)はAccess側のテーブルをサーバー集計するのに対し、こちらは
  ローカルのみのデータのためクライアント側で集計する。
- 「設備別効率」「人数別内訳」「品種別作業時間」を個別画面にせず、
  軸(X)×系列×指標×期間/集計単位を自由に組み合わせる汎用集計に
  统一する（品質データ分析と同じ設計思想）。プリセットボタンは
  この汎用設定に対する「よく使う組み合わせのショートカット」。
============================================================ */
(function(){
 const $id=id=>document.getElementById(id);
 const val=id=>{const el=$id(id);return el?el.value:''};
 const fmt=n=>Number(n||0).toLocaleString(undefined,{maximumFractionDigits:1});
 const ell=(s,n)=>{s=String(s??'');return s.length>n?s.slice(0,n-1)+'…':s};
 function niceMax(m){if(!(m>0))return 1;const p=Math.pow(10,Math.floor(Math.log10(m)));const n=m/p;const f=n<=1?1:n<=2?2:n<=5?5:10;return f*p}
 function bandGap(slot,factor){return Math.max(2,Math.min(slot*(1-factor),34))}
 function bandWidth(slot,factor,min){return Math.max(min||4,slot-bandGap(slot,factor))}
 const stackPalette=['#087c89','#2563eb','#16a34a','#f59e0b','#dc2626','#7c3aed','#0f766e','#e11d48','#64748b','#84cc16'];

 function legendLayout(keys,maxW){
  const rowH=17,chipW=10,padX=10;
  let cx=0,rows=1;const placements=[];
  keys.forEach((k,i)=>{
   const label=ell(String(k),14);
   const textW=Math.max(20,[...label].reduce((w,ch)=>w+(/[\x00-\xff]/.test(ch)?6.4:11.5),0));
   const itemW=chipW+4+textW+padX;
   if(cx+itemW>maxW&&cx>0){cx=0;rows++}
   placements.push({label,row:rows-1,x:cx,col:stackPalette[i%stackPalette.length]});
   cx+=itemW;
  });
  return {placements,rows,rowH};
 }
 function legendSvg(info,x0,y0){
  if(!info)return '';
  return info.placements.map(p=>`<rect x="${x0+p.x}" y="${y0+p.row*info.rowH-9}" width="10" height="10" rx="2" fill="${p.col}"></rect><text class="db-svg-legend-label" x="${x0+p.x+14}" y="${y0+p.row*info.rowH}">${esc(p.label)}</text>`).join('');
 }

 /* ---------- ローカル測定データ → KPI用フラット行 ---------- */
 function crewLabel(size){return(size&&size!=='-')?`${size}名班`:'人数未設定'}
 function toKpiRow(x){
  const b=x.basic||{},s=x.settings||{},w=x.workTime||{};
  const start=w.startAt?new Date(w.startAt):null,end=w.endAt?new Date(w.endAt):null;
  const validRange=start&&end&&!isNaN(start)&&!isNaN(end)&&end>start;
  const durationMin=validRange?(end-start)/60000:null;
  const vertical=Math.max(1,+s.verticalCount||1),horizontal=Math.max(1,+s.horizontalCount||1);
  const dateBase=start&&!isNaN(start)?start:(x.updatedAt?new Date(x.updatedAt):null);
  return {
   id:x.id,status:x.status||'編集中',
   equipment:s.registeredEquipment||x.registeredEquipment||b.equipment||'-',
   crewSize:(s.crewSize&&s.crewSize!=='-')?String(s.crewSize):'',
   operator:s.operator||'-',
   measureType:s.measureType||'-',
   purposeName:b.purposeName||'用途未設定',
   productType:`${b.purposeName||'用途未設定'} / ${vertical}丈×${horizontal}条`,
   durationMin,
   date:(dateBase&&!isNaN(dateBase))?dateBase:null,
  };
 }

 const DIMENSIONS={
  equipment:{label:'設備',get:r=>r.equipment},
  crewSize:{label:'作業人数',get:r=>crewLabel(r.crewSize)},
  productType:{label:'品種（用途名・丈数×条数）',get:r=>r.productType},
  purposeName:{label:'用途名',get:r=>r.purposeName},
  operator:{label:'オペレータ',get:r=>r.operator},
  measureType:{label:'入力内容',get:r=>r.measureType},
 };
 const METRICS={
  count:{label:'件数',compute:c=>c.count},
  avgMin:{label:'平均作業時間（分/件）',compute:c=>c.durCount?c.durSum/c.durCount:null},
  sumHour:{label:'合計作業時間（時間）',compute:c=>c.durSum/60},
  perHour:{label:'時間あたり処理数（件/時）',compute:c=>c.durSum>0?c.count/(c.durSum/60):null},
 };
 function bucketKey(date,bucket){
  if(!date)return null;
  const y=date.getFullYear(),m=date.getMonth()+1,d=date.getDate(),p2=n=>String(n).padStart(2,'0');
  if(bucket==='year')return `${y}年`;
  if(bucket==='month')return `${y}-${p2(m)}`;
  return `${y}-${p2(m)}-${p2(d)}`;
 }

 /* ---------- 汎用集計: 軸(分類/時系列)×系列×指標 ---------- */
 function aggregate(rows,{axis,bucket,series,metricKey}){
  const metric=METRICS[metricKey]||METRICS.count;
  const groups=new Map(),seriesKeys=new Set();
  rows.forEach(r=>{
   const key=axis==='time'?bucketKey(r.date,bucket):(DIMENSIONS[axis]?DIMENSIONS[axis].get(r):'-');
   if(key==null||key==='')return;
   if(!groups.has(key))groups.set(key,{label:key,cells:new Map()});
   const g=groups.get(key);
   const sk=series&&DIMENSIONS[series]?DIMENSIONS[series].get(r):'__all__';
   seriesKeys.add(sk);
   if(!g.cells.has(sk))g.cells.set(sk,{count:0,durSum:0,durCount:0});
   const c=g.cells.get(sk);
   c.count++;if(r.durationMin!=null){c.durSum+=r.durationMin;c.durCount++}
  });
  let items=[...groups.values()].map(g=>{
   const totalCell={count:0,durSum:0,durCount:0};const stacks={};
   g.cells.forEach((c,k)=>{stacks[k]=metric.compute(c);totalCell.count+=c.count;totalCell.durSum+=c.durSum;totalCell.durCount+=c.durCount});
   return {label:g.label,value:metric.compute(totalCell),stacks,count:totalCell.count};
  });
  if(axis==='time')items.sort((a,b)=>String(a.label).localeCompare(String(b.label)));
  else items.sort((a,b)=>(Number(b.value)||0)-(Number(a.value)||0));
  const keys=series?[...seriesKeys].filter(k=>k!=='__all__').sort((a,b)=>String(a).localeCompare(String(b),'ja')):[];
  return {items,keys,metricLabel:metric.label,total:rows.length};
 }

 /* ---------- グラフ描画（縦棒/集合棒。品質データ分析のSVG設計を踏襲） ---------- */
 function stage(){const el=$id('dashboardChart');if(!el)return{w:900,h:460};const w=el.clientWidth,h=el.clientHeight;if(w<80||h<80)return{w:Math.max(760,w||900),h:Math.max(400,h||460)};return{w:Math.max(320,w-20),h:Math.max(240,h-20)}}
 function svgBar(items,cfg){
  const {W,H,keys,hasSeries,showVal,color,title,subtitle,xTitle,yTitle}=cfg;
  if(!items.length)return '';
  const labels=items.map(it=>String(it.label));
  const maxLen=Math.max(...labels.map(s=>ell(s,18).length),1);
  const rotate=items.length>6||maxLen>5;
  const R=16,L0=60+(yTitle?18:0);
  const legendKeys=hasSeries?keys:[];
  const legendInfo=legendKeys.length?legendLayout(legendKeys,Math.max(140,W-L0-R)):null;
  const titleH=title?21:0,subtitleH=subtitle?15:0,legendH=legendInfo?legendInfo.rows*17+6:0;
  const B=(rotate?Math.min(150,Math.max(46,34+maxLen*7)):40)+(xTitle?20:0);
  const T=12+titleH+subtitleH+legendH,L=L0;
  const plotH=Math.max(90,H-T-B),plotW=Math.max(140,W-L-R);
  const n=items.length,slot=plotW/n,x=i=>L+slot*i+slot/2;
  const primVals=hasSeries?items.map(it=>Math.max(...keys.map(k=>Number(it.stacks?.[k])||0),0)):items.map(it=>Number(it.value)||0);
  const pmax=niceMax(Math.max(...primVals,1));
  const yB=v=>T+plotH-(Number(v||0)/pmax)*plotH;
  let grid='';for(let r=0;r<=4;r++){const gy=T+plotH*r/4,gv=pmax*(4-r)/4;grid+=`<line class="db-gridline" x1="${L}" y1="${gy}" x2="${W-R}" y2="${gy}"></line><text class="db-label" x="${L-8}" y="${gy+4}" text-anchor="end">${fmt(gv)}</text>`}
  const bw=bandWidth(slot,.62,3);
  let body='';
  if(hasSeries){
   const clusterW=bandWidth(slot,.62,10),innerGap=Math.min(4,clusterW/keys.length*0.15);
   const gw=Math.max(3,clusterW/keys.length-innerGap),groupW=gw*keys.length+innerGap*(keys.length-1);
   body=items.map((it,i)=>{const x0=x(i)-groupW/2;return keys.map((k,si)=>{const v=it.stacks?.[k];if(v==null||Number.isNaN(v))return '';return `<rect x="${x0+si*(gw+innerGap)}" y="${yB(v)}" width="${gw}" height="${Math.max(1,T+plotH-yB(v))}" rx="2" fill="${stackPalette[si%stackPalette.length]}"><title>${esc(it.label)} / ${esc(k)}: ${fmt(v)}</title></rect>`}).join('')}).join('');
  }else{
   body=items.map((it,i)=>{const v=it.value;if(v==null||Number.isNaN(v))return '';return `<rect x="${x(i)-bw/2}" y="${yB(v)}" width="${bw}" height="${Math.max(1,T+plotH-yB(v))}" rx="4" fill="${color}" opacity=".9"><title>${esc(it.label)}: ${fmt(v)}</title></rect>`}).join('');
   if(showVal){const st=Math.ceil(items.length/22||1);body+=items.map((it,i)=>{const v=it.value;if(v==null||Number.isNaN(v)||i%st!==0)return '';return `<text class="db-value" x="${x(i)}" y="${yB(v)-6}" text-anchor="middle">${fmt(v)}</text>`}).join('')}
  }
  const xlabels=items.map((it,i)=>rotate?`<text class="db-label" x="${x(i)}" y="${T+plotH+14}" text-anchor="end" transform="rotate(-40 ${x(i)} ${T+plotH+14})">${esc(ell(it.label,18))}<title>${esc(it.label)}</title></text>`:`<text class="db-label" x="${x(i)}" y="${T+plotH+18}" text-anchor="middle">${esc(ell(it.label,10))}<title>${esc(it.label)}</title></text>`).join('');
  const head=(title?`<text class="db-chart-title" x="${W/2}" y="16" text-anchor="middle">${esc(title)}</text>`:'')+(subtitle?`<text class="db-chart-subtitle" x="${W/2}" y="${16+titleH}" text-anchor="middle">${esc(subtitle)}</text>`:'')+legendSvg(legendInfo,L,16+titleH+subtitleH+10);
  const axisTitles=(xTitle?`<text class="db-axis-title" x="${L+plotW/2}" y="${T+plotH+B-6}" text-anchor="middle">${esc(xTitle)}</text>`:'')+(yTitle?`<text class="db-axis-title" x="14" y="${T+plotH/2}" text-anchor="middle" transform="rotate(-90 14 ${T+plotH/2})">${esc(yTitle)}</text>`:'');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title||'ダッシュボードグラフ')}">${head}${axisTitles}${grid}<line class="db-axis" x1="${L}" y1="${T}" x2="${L}" y2="${T+plotH}"></line><line class="db-axis" x1="${L}" y1="${T+plotH}" x2="${W-R}" y2="${T+plotH}"></line>${body}${xlabels}</svg>`;
 }

 /* ---------- モーダル/コントロール ---------- */
 let dbCache=null,dbLast=null;
 async function ensureData(force){if(dbCache&&!force)return dbCache;dbCache=(await reliableAll()).map(toKpiRow);return dbCache}

 function ensureNavButton(){
  const nav=document.querySelector('.view-nav');if(!nav||$id('openDashboard'))return;
  const b=document.createElement('button');b.type='button';b.id='openDashboard';b.className='db nav-item nav-item--view';
  b.innerHTML='<svg class="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg><span>ダッシュボード</span>';
  b.title='端末保存済みの測定データからKPI（設備別効率・人数別内訳・品種別作業時間など）を集計します';
  b.onclick=openDashboardView;nav.append(b);
 }

 function exitDashboardView(){
  if(!document.body.classList.contains('db-mode'))return;
  document.body.classList.remove('db-mode');
  $id('openDashboard')?.classList.remove('active');
  const panel=$id('dashboardPanel');if(panel)panel.hidden=true;
 }
 if(typeof selectDb==='function'){const old=selectDb;selectDb=async function(k,b){exitDashboardView();return old(k,b)}}

 const AXIS_OPTS=[['time','時系列'],['equipment','設備'],['crewSize','作業人数'],['productType','品種（用途名・丈数×条数）'],['purposeName','用途名'],['operator','オペレータ'],['measureType','入力内容']];
 const SERIES_OPTS=[['','なし'],['equipment','設備'],['crewSize','作業人数'],['productType','品種'],['operator','オペレータ']];
 const METRIC_OPTS=[['avgMin','平均作業時間（分/件）'],['count','件数'],['sumHour','合計作業時間（時間）'],['perHour','時間あたり処理数（件/時）']];
 const PRESETS={
  equipEfficiency:{axis:'equipment',series:'crewSize',metric:'avgMin'},
  crewBreakdown:{axis:'crewSize',series:'equipment',metric:'count'},
  productType:{axis:'productType',series:'',metric:'avgMin'},
  trend:{axis:'time',bucket:'month',series:'equipment',metric:'count'},
 };

 function ensurePanel(){
  let panel=$id('dashboardPanel');if(panel)return panel;
  panel=document.createElement('section');panel.className='db-panel';panel.id='dashboardPanel';panel.hidden=true;
  panel.innerHTML=`
    <header class="rp-head">
     <div class="rp-head-title"><h2>ダッシュボード</h2><span class="rp-sub">端末保存済みの測定データから、設備・作業人数・品種ごとの作業効率をKPIとして集計します。</span></div>
    </header>
    <div class="db-layout">
     <aside class="db-controls">
      <div class="db-presets">
       <button type="button" data-preset="equipEfficiency" class="active">設備別効率</button>
       <button type="button" data-preset="crewBreakdown">人数別内訳</button>
       <button type="button" data-preset="productType">品種別作業時間</button>
       <button type="button" data-preset="trend">月次推移</button>
      </div>
      <div class="db-ctl-group">
       <span class="db-ctl-label">期間</span>
       <div class="db-seg" data-seg="dbPeriodSeg">
        <button type="button" data-val="7d">直近7日</button><button type="button" data-val="30d">直近30日</button><button type="button" data-val="90d">直近90日</button>
        <button type="button" data-val="thisMonth" class="active">今月</button><button type="button" data-val="lastMonth">先月</button><button type="button" data-val="ytd">今年</button><button type="button" data-val="all">全期間</button>
       </div>
       <div class="db-field-grid"><label>開始<input id="dbStart" type="date"></label><label>終了<input id="dbEnd" type="date"></label></div>
      </div>
      <div class="db-ctl-group">
       <span class="db-ctl-label">軸（X）</span>
       <select id="dbAxis">${AXIS_OPTS.map(([v,l])=>`<option value="${v}">${esc(l)}</option>`).join('')}</select>
       <div class="db-sub" id="dbBucketWrap" hidden>
        <span>集計単位</span>
        <div class="db-seg db-seg-sm" data-seg="dbBucketSeg"><button type="button" data-val="day" class="active">日</button><button type="button" data-val="month">月</button><button type="button" data-val="year">年</button></div>
       </div>
      </div>
      <div class="db-ctl-group"><span class="db-ctl-label">内訳（系列）</span><select id="dbSeries">${SERIES_OPTS.map(([v,l])=>`<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
      <div class="db-ctl-group"><span class="db-ctl-label">指標（Y）</span><select id="dbMetric">${METRIC_OPTS.map(([v,l])=>`<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
      <div class="db-ctl-group"><span class="db-ctl-label">対象ステータス</span><select id="dbStatus"><option value="done">完了のみ</option><option value="all">すべて（編集中含む）</option></select></div>
      <button type="button" id="dbRefresh" class="rp-btn-primary">この条件で集計</button>
     </aside>
     <main class="db-main">
      <div class="db-summary" id="dashboardSummary"></div>
      <div class="db-chart-wrap"><div class="db-chart" id="dashboardChart"><div class="db-empty">左の設定で集計条件を選び、「この条件で集計」を押してください。</div></div></div>
      <div class="db-table-wrap"><table class="db-table" id="dashboardTable"></table></div>
     </main>
    </div>`;
  const grid=$id('grid');grid?.parentNode?.insertBefore(panel,grid);
  panel.querySelectorAll('[data-seg="dbPeriodSeg"] button').forEach(b=>b.onclick=()=>applyPeriod(b.dataset.val));
  panel.querySelectorAll('[data-seg="dbBucketSeg"] button').forEach(b=>b.onclick=()=>{setSeg('dbBucketSeg',b.dataset.val);runDashboard()});
  $id('dbStart').addEventListener('change',()=>{setSeg('dbPeriodSeg','');runDashboard()});
  $id('dbEnd').addEventListener('change',()=>{setSeg('dbPeriodSeg','');runDashboard()});
  $id('dbAxis').addEventListener('change',()=>{toggleBucket();runDashboard()});
  ['dbSeries','dbMetric','dbStatus'].forEach(id=>$id(id).addEventListener('change',runDashboard));
  $id('dbRefresh').onclick=()=>runDashboard(true);
  panel.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>applyPreset(b.dataset.preset));
  return panel;
 }

 function setSeg(group,value){document.querySelectorAll(`[data-seg="${group}"] button`).forEach(b=>b.classList.toggle('active',b.dataset.val===value))}
 function toggleBucket(){const el=$id('dbBucketWrap');if(el)el.hidden=val('dbAxis')!=='time'}

 function periodRange(kind){
  const now=new Date();let a=null,b=null;
  if(kind==='7d'){a=new Date(now);a.setDate(now.getDate()-6);b=now}
  else if(kind==='30d'){a=new Date(now);a.setDate(now.getDate()-29);b=now}
  else if(kind==='90d'){a=new Date(now);a.setDate(now.getDate()-89);b=now}
  else if(kind==='thisMonth'){a=new Date(now.getFullYear(),now.getMonth(),1);b=now}
  else if(kind==='lastMonth'){a=new Date(now.getFullYear(),now.getMonth()-1,1);b=new Date(now.getFullYear(),now.getMonth(),0)}
  else if(kind==='ytd'){a=new Date(now.getFullYear(),0,1);b=now}
  return {a,b};
 }
 function applyPeriod(kind){
  const {a,b}=periodRange(kind),pad=n=>String(n).padStart(2,'0'),d=dt=>dt?`${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`:'';
  $id('dbStart').value=d(a);$id('dbEnd').value=d(b);setSeg('dbPeriodSeg',kind);runDashboard();
 }
 function applyPreset(name){
  const p=PRESETS[name];if(!p)return;
  document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active',b.dataset.preset===name));
  $id('dbAxis').value=p.axis;$id('dbSeries').value=p.series||'';$id('dbMetric').value=p.metric;
  if(p.bucket)setSeg('dbBucketSeg',p.bucket);
  toggleBucket();runDashboard();
 }

 function summaryCards(rows){
  const n=rows.length,withDur=rows.filter(r=>r.durationMin!=null);
  const avg=withDur.length?withDur.reduce((s,r)=>s+r.durationMin,0)/withDur.length:null;
  const equipCount=new Set(rows.map(r=>r.equipment)).size;
  const crewCount=new Set(rows.map(r=>r.crewSize).filter(Boolean)).size;
  return `<div class="db-card"><span class="db-card-label">対象ロット数</span><b class="db-card-value">${fmt(n)}</b></div>
   <div class="db-card"><span class="db-card-label">平均作業時間</span><b class="db-card-value">${avg!=null?fmt(avg)+' 分':'-'}</b></div>
   <div class="db-card"><span class="db-card-label">稼働設備数</span><b class="db-card-value">${fmt(equipCount)}</b></div>
   <div class="db-card"><span class="db-card-label">記録済み人数区分</span><b class="db-card-value">${fmt(crewCount)}</b></div>`;
 }
 function axisLabelOf(axis){return axis==='time'?'期間':(DIMENSIONS[axis]?DIMENSIONS[axis].label:axis)}
 function tableHtml(data,ctx){
  if(!data.items.length)return '<tbody><tr><td class="db-empty-cell">対象データがありません</td></tr></tbody>';
  const hasSeries=!!ctx.series&&data.keys.length>0;
  const showCount=ctx.metricKey!=='count';
  const countCol=showCount?'<th>件数</th>':'';
  const head=hasSeries?`<tr><th>${esc(axisLabelOf(ctx.axis))}</th>${data.keys.map(k=>`<th>${esc(k)}</th>`).join('')}<th>${esc(data.metricLabel)}</th>${countCol}</tr>`:`<tr><th>${esc(axisLabelOf(ctx.axis))}</th><th>${esc(data.metricLabel)}</th>${countCol}</tr>`;
  const body=data.items.map(it=>{
   const cells=hasSeries?data.keys.map(k=>`<td>${it.stacks[k]!=null?fmt(it.stacks[k]):'-'}</td>`).join(''):'';
   const countCell=showCount?`<td>${fmt(it.count)}</td>`:'';
   return `<tr><th>${esc(it.label)}</th>${cells}<td>${it.value!=null?fmt(it.value):'-'}</td>${countCell}</tr>`;
  }).join('');
  return `<thead>${head}</thead><tbody>${body}</tbody>`;
 }

 function renderDashboard(data,ctx,scopeRows){
  dbLast={data,ctx};
  const hasSeries=!!ctx.series&&data.keys.length>0;
  const axisLabel=axisLabelOf(ctx.axis);
  const title=hasSeries?`${axisLabel} × ${DIMENSIONS[ctx.series].label} 別 ${data.metricLabel}`:`${axisLabel} 別 ${data.metricLabel}`;
  const subtitle=`対象 ${fmt(scopeRows.length)}件・表示 ${data.items.length}項目`;
  const {w,h}=stage();
  const svg=svgBar(data.items,{W:w,H:h,keys:data.keys,hasSeries,showVal:!hasSeries,color:'#087c89',title,subtitle,xTitle:axisLabel,yTitle:data.metricLabel});
  $id('dashboardChart').innerHTML=svg||'<div class="db-empty">対象データがありません。条件を見直してください。</div>';
  $id('dashboardSummary').innerHTML=summaryCards(scopeRows);
  $id('dashboardTable').innerHTML=tableHtml(data,ctx);
 }

 async function runDashboard(force){
  const panel=$id('dashboardPanel');if(!panel||panel.hidden)return;
  const all=await ensureData(force);
  const statusFilter=val('dbStatus')||'done';
  const startStr=val('dbStart'),endStr=val('dbEnd');
  const startD=startStr?new Date(startStr+'T00:00:00'):null;
  const endD=endStr?new Date(endStr+'T23:59:59'):null;
  let rows=all.filter(r=>statusFilter==='all'||r.status==='完了');
  rows=rows.filter(r=>{
   if(!r.date)return !startD&&!endD;
   if(startD&&r.date<startD)return false;
   if(endD&&r.date>endD)return false;
   return true;
  });
  const axis=val('dbAxis')||'equipment',bucket=(document.querySelector('[data-seg="dbBucketSeg"] button.active')||{}).dataset?.val||'day',series=val('dbSeries')||'',metricKey=val('dbMetric')||'avgMin';
  const data=aggregate(rows,{axis,bucket,series,metricKey});
  renderDashboard(data,{axis,bucket,series,metricKey},rows);
 }

 async function openDashboardView(){
  window.exitCalendarView?.();
  document.body.classList.remove('qa-mode','qa-view-raw');
  document.getElementById('reportPanel')?.setAttribute('hidden','');
  document.body.classList.remove('rp-mode');
  document.getElementById('openReportList')?.classList.remove('active');
  document.getElementById('recordModal')?.setAttribute('hidden','');
  document.body.classList.add('db-mode');
  document.querySelectorAll('#nav button.db').forEach(b=>b.classList.remove('active'));
  $id('openDashboard')?.classList.add('active');
  const panel=ensurePanel();panel.hidden=false;
  if(!panel.dataset.inited){panel.dataset.inited='1';applyPreset('equipEfficiency');applyPeriod('thisMonth')}
  else{toggleBucket();runDashboard()}
 }

 queueMicrotask(ensureNavButton);
})();

/* v36: 検査員・作業人数・内径・スプール・板厚測定器・板幅測定器は必須ではないが、
   「-」のまま未選択の間は背景色で目立たせ、何か選んだら白背景に戻す。 */
const SOFT_CHOICE_IDS=['inspector','crewSize','innerDiameter','spool','thicknessGauge','widthGauge'];
function updateSoftChoiceVisuals(){
 SOFT_CHOICE_IDS.forEach(id=>{
  const el=$('#'+id);if(!el)return;
  const chosen=el.value!==''&&el.value!=='-';
  el.classList.toggle('choice-pending',!chosen);
  el.classList.toggle('choice-made',chosen);
 });
}
SOFT_CHOICE_IDS.forEach(id=>{const el=$('#'+id);if(el)el.addEventListener('change',updateSoftChoiceVisuals)});
const renderMeasurementSoftChoiceBase=renderMeasurement;
renderMeasurement=function(){renderMeasurementSoftChoiceBase();updateSoftChoiceVisuals();if(typeof syncInputModeLock==='function')syncInputModeLock()};
const optionFillSoftChoiceBase=optionFill;
optionFill=function(id,items,current){optionFillSoftChoiceBase(id,items,current);updateSoftChoiceVisuals()};
