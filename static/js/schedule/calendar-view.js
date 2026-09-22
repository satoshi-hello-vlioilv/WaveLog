"use strict";
/* calendar-view.js: 実績カレンダー（日ごとの作業実績をカレンダー形式で確認）
   ============================================================
   方針（IA / 認知心理学 / 色彩調和論）:
   - Shneidermanの「概観 → 絞り込み → 詳細」に沿い、月間カレンダーで
     全体像（作業重量／ロット数の強調表示）を一望させ、日をクリックすると
     右側にその日のロット明細（詳細）を表示する。3つの確認軸（重量・件数・
     明細）を別画面へ切り替えさせず、同一画面内で同時に扱えるようにする。
   - 強調表示は本アプリの基調色(--teal)を単一色相でグラデーション濃淡化した
     連続尺度とし、数値も必ず併記する（色だけに依存しない＝色覚多様性への配慮）。
   - 既存のダッシュボード／帳票パネルと同じ視覚語彙（.rp-head, .rp-btn-*,
     .db-card 相当）を踏襲し、新しい学習コストを増やさない。
   ============================================================
   作業重量の算出（作業重量＝当工程の算出重量）:
   - 作業重量(kg) = 測定板厚平均(mm) × 測定板幅平均(mm) × 正味全長(m)
     × 条数 × 比重(2.7=アルミニウム) ÷ 1000
   - 正味全長 = 母材入力の全長 − 前オフ − 後オフ
   - 母材入力(全長)・実測値のいずれかが無いロットは、重量計算の対象外として
     明示的に除外する（0円で誤魔化さない）。
   ============================================================ */
(function(){
 if(typeof $!=='function')return;
 const $id=id=>document.getElementById(id);
 const DENSITY=2.7;

 function recordDate(x){
  const raw=x.workTime?.startAt||x.updatedAt;
  if(!raw)return null;
  const d=new Date(raw);
  return Number.isNaN(d.getTime())?null:d;
 }
 function dateKeyOf(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
 function monthKeyOf(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}

 function avgMeasured(grid,rowLimit,colLimit){
  let sum=0,n=0;const rows=Math.min((grid||[]).length,Math.max(1,rowLimit||0));
  for(let i=0;i<rows;i++){
   const row=grid[i]||[];const cols=Math.min(row.length,Math.max(1,colLimit||0));
   for(let j=0;j<cols;j++){
    const raw=row[j];if(raw===''||raw==null)continue;
    const v=Number(raw);if(Number.isFinite(v)){sum+=v;n++}
   }
  }
  return n>0?sum/n:null;
 }
 function computeLotWeight(x){
  const vc=Math.max(1,+x.settings?.verticalCount||1),hc=Math.max(1,+x.settings?.horizontalCount||1);
  const avgThk=avgMeasured(x.measurements?.thickness,vc,3),avgWid=avgMeasured(x.measurements?.width,vc,hc);
  const full=Number(x.mother?.fullLength),front=Number(x.mother?.front)||0,rear=Number(x.mother?.rear)||0;
  if(avgThk==null||avgWid==null||!Number.isFinite(full))return null;
  const netLength=full-front-rear;if(!(netLength>0))return null;
  const workKg=avgWid*avgThk*netLength*hc*DENSITY/1000;
  return {workKg,avgThk,avgWid,netLength};
 }

 function crewLabel(size){return (size&&size!=='-')?`${size}名班`:'人数未設定'}
 // statusClass/statusLabelはbase.jsの共通定義を使う(以前はここに同一内容を重複定義していた)。
 function fmtKg(v){return Number.isFinite(v)?Math.round(v).toLocaleString('ja-JP'):'-'}
 function fmtT(v){return Number.isFinite(v)?(v/1000).toLocaleString('ja-JP',{minimumFractionDigits:2,maximumFractionDigits:2}):'-'}
 function fmtDT(v){if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?'-':d.toLocaleString('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
 const WEEKDAY_LABELS=['日','月','火','水','木','金','土'];

 /* ---------- 状態 ---------- */
 let calState={cursor:new Date(),status:'done',metric:'weight',selectedKey:'',items:[],loaded:false};

 // 端末内(IndexedDB)の測定データを全件走査するため、件数が増えると数秒
 // かかる。読み込み中と分かるようWAITING表示で包む(withWaitingは速いときは
 // 出さないので、件数が少ない端末では今までどおり)。
 async function ensureData(force){
  if(calState.loaded&&!force)return calState.items;
  if(typeof WL.records.withWaiting!=='function')return ensureDataInner();
  return WL.records.withWaiting({title:'測定実績カレンダーを読み込んでいます',detail:'この端末の測定データを集計しています',
   progress:'保存済みのロットを日付ごとに集計しています'},()=>ensureDataInner());
 }
 async function ensureDataInner(){
  const all=await WL.records.reliableAll();
  calState.items=all.map(x=>{
   const date=recordDate(x);if(!date)return null;
   return {
    id:x.id,date,dateKey:dateKeyOf(date),status:x.status||'編集中',
    lotNo:x.basic?.lotNo||x.id,purposeName:x.basic?.purposeName||'-',
    equipment:x.settings?.registeredEquipment||x.registeredEquipment||x.basic?.equipment||'-',
    operator:x.settings?.operator||'-',crewSize:x.settings?.crewSize||'-',
    weight:computeLotWeight(x)
   };
  }).filter(Boolean);
  calState.loaded=true;
  return calState.items;
 }
 function filteredItems(){return calState.items.filter(x=>calState.status==='all'?true:x.status==='完了')}
 function monthItems(){const mk=monthKeyOf(calState.cursor);return filteredItems().filter(x=>x.dateKey.startsWith(mk))}
 function dayBuckets(){
  const map=new Map();
  monthItems().forEach(x=>{
   if(!map.has(x.dateKey))map.set(x.dateKey,{count:0,weightSum:0,weightCount:0,items:[]});
   const b=map.get(x.dateKey);b.count++;b.items.push(x);
   if(x.weight){b.weightSum+=x.weight.workKg;b.weightCount++}
  });
  return map;
 }
 function metricValue(bucket){return calState.metric==='weight'?bucket.weightSum:bucket.count}

 /* ---------- ナビ・ビュー排他制御 ---------- */
 function ensureNavButton(){
  const nav=document.querySelector('#analysisNav');if(!nav||$id('openCalendar'))return;
  const b=document.createElement('button');b.type='button';b.id='openCalendar';b.className='db nav-item nav-item--view';
  b.innerHTML='<svg class="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg><span>測定実績カレンダー</span>';
  b.title='この端末に保存された測定データを、日ごとの作業実績として集計します。'
  +'元データの「実績」（前工程）とは別のものです';
  b.onclick=openCalendarView;nav.append(b);
 }
 function exitCalendarView(){
  if(!document.body.classList.contains('cal-mode'))return;
  document.body.classList.remove('cal-mode');
  $id('openCalendar')?.classList.remove('active');
  const panel=$id('calendarPanel');if(panel)panel.hidden=true;
 }
 window.exitCalendarView=exitCalendarView;

 /* 月送り・指標・対象ステータスの操作列はヘッダーの#headerViewBarへ移す
    (WL.enterViewのmountViewToolbar参照)。カレンダーのマスは縦に詰まりやすく、
    バー1本ぶんでも本文へ回したいため。 */
 WL.registerView({key:'calendar',bodyClass:'cal-mode',nav:'openCalendar',toolbar:'#calToolbar',
  header:['測定実績カレンダー','この端末に保存された測定データの日ごとの集計'],exit:exitCalendarView});

 async function openCalendarView(){
  WL.enterView('calendar');
  const panel=ensurePanel();panel.hidden=false;
  WL.syncViewToolbar('calendar');   // 操作列(#calToolbar)はパネル生成後にヘッダーへ載せる
  calState.selectedKey='';
  await ensureData(true);
  renderAll();
 }

 /* ---------- パネル構築 ---------- */
 function ensurePanel(){
  let panel=$id('calendarPanel');if(panel)return panel;
  panel=document.createElement('section');panel.className='cal-panel';panel.id='calendarPanel';panel.hidden=true;
  panel.innerHTML=`
   <div class="cal-layout">
    <section class="cal-main">
     <div class="cal-toolbar" id="calToolbar">
      <div class="cal-nav">
       <button type="button" id="calPrev" class="rp-btn-secondary rp-btn-icon" aria-label="前の月へ" title="前の月へ">‹</button>
       <b id="calMonthLabel" class="cal-month-label"></b>
       <button type="button" id="calNext" class="rp-btn-secondary rp-btn-icon" aria-label="次の月へ" title="次の月へ">›</button>
       <button type="button" id="calToday" class="rp-btn-secondary" title="今月へ戻ります">今月</button>
      </div>
      <div class="cal-toolbar-right">
       <div class="db-seg" data-seg="calMetricSeg" role="group" aria-label="表示指標">
        <button type="button" data-val="weight" class="active" title="各日のマスの濃さを作業重量で表します">作業重量</button>
        <button type="button" data-val="count" title="各日のマスの濃さをロット数で表します">ロット数</button>
       </div>
       <div class="db-seg" data-seg="calStatusSeg" role="group" aria-label="対象ステータス">
        <button type="button" data-val="done" class="active" title="完了したデータだけを集計します">完了のみ</button>
        <button type="button" data-val="all" title="編集中のデータも含めて集計します">すべて（編集中含む）</button>
       </div>
      </div>
     </div>
     <div class="cal-summary" id="calSummary"></div>
     <div class="cal-weekday-row">${WEEKDAY_LABELS.map((w,i)=>`<span class="${i===0?'sun':i===6?'sat':''}">${w}</span>`).join('')}</div>
     <div class="cal-grid" id="calGrid"></div>
     <div class="cal-legend"><span>少ない</span><span class="cal-legend-swatch lvl-0"></span><span class="cal-legend-swatch lvl-1"></span><span class="cal-legend-swatch lvl-2"></span><span class="cal-legend-swatch lvl-3"></span><span class="cal-legend-swatch lvl-4"></span><span>多い</span></div>
    </section>
    <aside class="cal-detail" id="calDetail"><div class="cal-detail-empty">日付を選択すると、その日のロット明細を表示します。</div></aside>
   </div>`;
  const grid=$id('grid');grid?.parentNode?.insertBefore(panel,grid);
  $id('calPrev').onclick=()=>{calState.cursor=new Date(calState.cursor.getFullYear(),calState.cursor.getMonth()-1,1);renderAll()};
  $id('calNext').onclick=()=>{calState.cursor=new Date(calState.cursor.getFullYear(),calState.cursor.getMonth()+1,1);renderAll()};
  $id('calToday').onclick=()=>{calState.cursor=new Date();renderAll()};
  panel.querySelectorAll('[data-seg="calMetricSeg"] button').forEach(b=>b.onclick=()=>{calState.metric=b.dataset.val;renderAll()});
  panel.querySelectorAll('[data-seg="calStatusSeg"] button').forEach(b=>b.onclick=()=>{calState.status=b.dataset.val;renderAll()});
  return panel;
 }

 function setSeg(name,val){document.querySelectorAll(`[data-seg="${name}"] button`).forEach(b=>b.classList.toggle('active',b.dataset.val===val))}

 /* ---------- 描画 ---------- */
 function renderAll(){
  setSeg('calMetricSeg',calState.metric);setSeg('calStatusSeg',calState.status);
  $id('calMonthLabel').textContent=`${calState.cursor.getFullYear()}年${calState.cursor.getMonth()+1}月`;
  renderSummary();renderGrid();renderDetail();
 }
 function renderSummary(){
  const items=monthItems();
  const totalCount=items.length;
  const withWeight=items.filter(x=>x.weight);
  const totalWorkKg=withWeight.reduce((s,x)=>s+x.weight.workKg,0);
  const activeDays=new Set(items.map(x=>x.dateKey)).size;
  const missing=totalCount-withWeight.length;
  $id('calSummary').innerHTML=`
   <div class="db-card"><span class="db-card-label">対象ロット数</span><span class="db-card-value">${totalCount.toLocaleString()}件</span></div>
   <div class="db-card"><span class="db-card-label">作業重量合計</span><span class="db-card-value">${fmtKg(totalWorkKg)}kg<small class="cal-card-sub"> / ${fmtT(totalWorkKg)}t</small></span></div>
   <div class="db-card"><span class="db-card-label">稼働日数</span><span class="db-card-value">${activeDays.toLocaleString()}日</span></div>
   <div class="db-card${missing?' cal-card-warn':''}"><span class="db-card-label">重量算出対象外</span><span class="db-card-value">${missing.toLocaleString()}件${missing?'<small class="cal-card-sub">母材入力等が未完了</small>':''}</span></div>`;
 }
 function renderGrid(){
  const wrap=$id('calGrid');if(!wrap)return;
  const buckets=dayBuckets();
  const maxVal=Math.max(0,...[...buckets.values()].map(metricValue));
  const year=calState.cursor.getFullYear(),month=calState.cursor.getMonth();
  const first=new Date(year,month,1),startOffset=first.getDay(),daysInMonth=new Date(year,month+1,0).getDate();
  const todayKey=dateKeyOf(new Date());
  const cells=[];
  for(let i=0;i<startOffset;i++)cells.push(null);
  for(let d=1;d<=daysInMonth;d++)cells.push(new Date(year,month,d));
  while(cells.length%7!==0)cells.push(null);
  wrap.innerHTML=cells.map((d,idx)=>{
   if(!d)return '<div class="cal-day cal-day-blank" aria-hidden="true"></div>';
   const key=dateKeyOf(d),bucket=buckets.get(key),val=bucket?metricValue(bucket):0;
   const level=(!bucket||val<=0)?0:Math.min(4,Math.max(1,Math.ceil((val/(maxVal||1))*4)));
   const wd=idx%7,weekendClass=wd===0?' sun':wd===6?' sat':'';
   const isToday=key===todayKey,isSelected=key===calState.selectedKey;
   const metricText=bucket?(calState.metric==='weight'?(bucket.weightCount?`${fmtKg(bucket.weightSum)}kg`:'—'):`${bucket.count}件`):'';
   const countBadge=bucket&&calState.metric==='weight'?`<span class="cal-day-sub">${bucket.count}件</span>`:'';
   const isNegative=calState.metric==='weight'&&bucket&&bucket.weightCount&&bucket.weightSum<0;
   return `<button type="button" class="cal-day lvl-${level}${weekendClass}${isToday?' today':''}${isSelected?' selected':''}" data-date-key="${key}" title="${esc(d.toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short'}))}${isNegative?'（測定値の入力に誤りがある可能性があります。要確認）':''}">
    <span class="cal-day-num">${d.getDate()}</span>
    ${bucket?`<span class="cal-day-metric${isNegative?' cal-day-negative':''}">${esc(metricText)}</span>${countBadge}`:''}
   </button>`;
  }).join('');
  wrap.querySelectorAll('[data-date-key]').forEach(b=>b.onclick=()=>{calState.selectedKey=calState.selectedKey===b.dataset.dateKey?'':b.dataset.dateKey;renderGrid();renderDetail()});
 }
 function renderDetail(){
  const box=$id('calDetail');if(!box)return;
  if(!calState.selectedKey){box.innerHTML='<div class="cal-detail-empty">日付を選択すると、その日のロット明細を表示します。</div>';return}
  const buckets=dayBuckets(),bucket=buckets.get(calState.selectedKey);
  const d=new Date(calState.selectedKey+'T00:00:00');
  const dateLabel=d.toLocaleDateString('ja-JP',{month:'long',day:'numeric',weekday:'short'});
  if(!bucket||!bucket.items.length){box.innerHTML=`<div class="cal-detail-head"><b>${esc(dateLabel)}</b></div><div class="cal-detail-empty">この日の実績はありません。</div>`;return}
  const items=[...bucket.items].sort((a,b)=>a.lotNo.localeCompare(b.lotNo,'ja'));
  const rows=items.map(x=>{
   const w=x.weight;
   const weightText=w?`${fmtKg(w.workKg)}kg`:'<span class="cal-blank">計算対象外</span>';
   return `<div class="cal-lot-row">
    <div class="cal-lot-main"><span class="rp-status-badge ${WL.base.statusClass(x.status)}">${esc(WL.base.statusLabel(x.status))}</span><b class="cal-lot-no" data-lot-id="${esc(x.id)}" title="クリックで帳票プレビューを開きます">${esc(x.lotNo)}</b></div>
    <div class="cal-lot-sub"><span>${esc(x.purposeName)}</span><span>${esc(x.equipment)}</span><span>${esc(crewLabel(x.crewSize))} / ${esc(x.operator)}</span></div>
    <div class="cal-lot-weight">${weightText}</div>
   </div>`;
  }).join('');
  box.innerHTML=`<div class="cal-detail-head"><b>${esc(dateLabel)}</b><span>${bucket.count}件 / ${bucket.weightCount?fmtKg(bucket.weightSum)+'kg':'重量算出対象外のみ'}</span></div><div class="cal-lot-list">${rows}</div>`;
  box.querySelectorAll('[data-lot-id]').forEach(el=>el.onclick=()=>{if(typeof openReportForRecord==='function')openReportForRecord(el.dataset.lotId)});
 }

 queueMicrotask(()=>{ensureNavButton()});
})();
