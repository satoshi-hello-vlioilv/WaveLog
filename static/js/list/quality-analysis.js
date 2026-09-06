"use strict";
/* quality-analysis.js: 品質データ分析(QA v7) */
/* ============================================================
2026-07-21 Quality analysis V7 : Power BI流フィールドウェル / SPA一画面
--------------------------------------------------------------
方針（IA / 認知心理学 + Power BIのメンタルモデル）:
- タブは「元データ / グラフ / 対象データ一覧」の3つ。品質データ選択時は
  元データ（元テーブル #grid）をデフォルト表示する。
- 左レシピは Power BI の「フィールド」に相当。軸(X)・値(Y)・凡例(系列) を
  サマリー付きアコーディオンで指定（折りたたみ時も内容が分かる=再認優先）。
- 右ツールバーは Power BI の「書式」に相当。グラフ種類・棒の太さ・並び順・
  件数・カラー・数値ラベル、コンボ時は棒の値/線の値を個別指定。
- グラフは常にコンテナ実寸へフィット（横スクロール無し・サイズ不変）。設定
  変更時も同じ大きさで再描画。ResizeObserverでエリア変化にも追従。
- 上部フィルタ（汎用フィルタバー）は元データビューでのみ表示し、潰れを解消。
- 対象データ一覧は残り領域いっぱいに表示。
============================================================ */
(function(){
 const baseColors={teal:'#05a1b2',blue:'#2563eb',green:'#16a34a',orange:'#f59e0b',red:'#dc2626',purple:'#7c3aed',slate:'#334155',pink:'#db2777'};
 // ブランド基調色(teal)を起点に、dataviz手法の8色categorical検証(色覚シミュレーションCVD分離・
 // 明度/彩度帯・コントラスト)を通した固定順の8色。順序を変えると検証結果が変わるため変更不可。
 // 検証: node scripts/validate_palette.js "<このカンマ区切り>" --mode light --surface "#ffffff"
 const stackPalette=['#05a1b2','#dc2626','#f59e0b','#db2777','#2563eb','#16a34a','#7c3aed','#039580'];
 // stack_keysが8件を超えるとbackend側で超過分を「その他」へ集約するが(quality.py)、
 // 8色循環にそのまま巻き込むと9件目の色が1件目と衝突するため、専用の中立色で固定する。
 const OTHER_COLOR='#94a3b8';
 function seriesColor(key,i){return String(key)==='その他'?OTHER_COLOR:stackPalette[i%stackPalette.length]}
 /* type: [value,label,{flags}]  orient:v/h, bar, line, area, stack, pct, pie, donut, combo */
 const CHART_TYPES=[
  ['col','縦棒（集合）',{orient:'v',bar:1}],
  ['scol','縦棒（積み上げ）',{orient:'v',bar:1,stack:1}],
  ['scol100','縦棒（100%積み上げ）',{orient:'v',bar:1,stack:1,pct:1}],
  ['bar','横棒（集合）',{orient:'h',bar:1}],
  ['hsbar','横棒（積み上げ）',{orient:'h',bar:1,stack:1}],
  ['hsbar100','横棒（100%積み上げ）',{orient:'h',bar:1,stack:1,pct:1}],
  ['line','折れ線',{orient:'v',line:1}],
  ['area','面',{orient:'v',area:1}],
  ['pie','円',{pie:1}],
  ['donut','ドーナツ',{pie:1,donut:1}],
  ['combo','折れ線＋縦棒（集合）',{orient:'v',bar:1,combo:1}],
  ['scombo','折れ線＋縦棒（積み上げ）',{orient:'v',bar:1,combo:1,stack:1}],
 ];
 const PERIOD_LABELS={'7d':'直近7日','30d':'直近30日','90d':'直近90日','thisMonth':'今月','lastMonth':'先月','ytd':'今年'};
 const BUCKET_LABELS={day:'日別',month:'月別',year:'年別'};
 const METRIC_LABEL={count:'件数',sum:'合計'};
 let last=null,ro=null,prevQa=false;
 const $id=id=>document.getElementById(id);
 const val=id=>{const el=$id(id);return el?el.value:''};
 const checked=id=>{const el=$id(id);return !!(el&&el.checked)};
 const html=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
 const preferred=(cols,names)=>(names||[]).find(n=>(cols||[]).includes(n))||'';
 const fmt=n=>Number(n||0).toLocaleString(undefined,{maximumFractionDigits:1});
 const ell=(s,n)=>{s=String(s??'');return s.length>n?s.slice(0,n-1)+'…':s};
 function baseColor(){return baseColors[val('qaColor')||'teal']||baseColors.teal}
 function chartDef(){return CHART_TYPES.find(t=>t[0]===val('qaChartType'))||CHART_TYPES[0]}
 function barFactor(){return {narrow:.4,normal:.62,wide:.86}[val('qaBarWidth')||'normal']||.62}
 function niceMax(m){if(!(m>0))return 1;const p=Math.pow(10,Math.floor(Math.log10(m)));const n=m/p;const f=n<=1?1:n<=2?2:n<=5?5:10;return f*p}

 function ensurePrintButton(){const actions=document.querySelector('.global-actions');if(!actions||$id('printCurrentView'))return;const b=document.createElement('button');b.id='printCurrentView';b.type='button';b.className='print-button';b.textContent='画面を印刷';b.title='いま表示している画面をそのまま印刷します。帳票を印刷する場合は測定画面の「帳票」から開いてください';b.onclick=()=>window.print();actions.append(b)}

 function setPeriod(kind){const s=$id('qaStart'),e=$id('qaEnd');if(!s||!e)return;const now=new Date(),pad=n=>String(n).padStart(2,'0'),d0=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T00:00`,d1=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T23:59`;let a=new Date(now),b=new Date(now);if(kind==='7d')a.setDate(now.getDate()-6);else if(kind==='30d')a.setDate(now.getDate()-29);else if(kind==='90d')a.setDate(now.getDate()-89);else if(kind==='thisMonth'){a=new Date(now.getFullYear(),now.getMonth(),1);b=new Date(now.getFullYear(),now.getMonth()+1,0)}else if(kind==='lastMonth'){a=new Date(now.getFullYear(),now.getMonth()-1,1);b=new Date(now.getFullYear(),now.getMonth(),0)}else if(kind==='ytd')a=new Date(now.getFullYear(),0,1);s.value=d0(a);e.value=d1(b);const seg=$id('qaPeriodKind');if(seg)seg.value=kind;setSeg('qaPeriodSeg',kind);updateSummaries()}

 /* ---------- 畳む（§9.296 ②、利用者の指示「折りたためるようにしてください」）
   ----------
   置き場は**この端末**（読み方の好み。§9.199）。**いまどちらかはボタンの
   文字が言う**（§3。畳んだあと帯だけが残るので、開き直す入口は消えない）。 */
 const FOLD_KEY='QualityAnalysisFoldV1';
 function foldGet(){try{return localStorage.getItem(FOLD_KEY)==='1'}catch(_){return false}}
 function applyFold(on){
  const p=$id('qualityAnalysisPanel');if(!p)return;
  p.dataset.fold=on?'1':'0';
  const b=$id('qaFold');
  if(b){b.textContent=on?'▼ 開く':'▲ 畳む';
        b.title=on?'このカードを開いて、グラフの設定を出します':'このカードを畳んで、下の一覧を広く使います'}
  try{localStorage.setItem(FOLD_KEY,on?'1':'0')}catch(_){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',_)}
 }
/* ---------- パネル生成 ---------- */
 function ensurePanel(){
  let p=$id('qualityAnalysisPanel');
  if(!p){p=document.createElement('section');p.id='qualityAnalysisPanel';document.getElementById('grid')?.parentNode?.insertBefore(p,document.getElementById('grid'))}
  if(p.dataset.v7==='1')return p;
  p.dataset.v7='1';p.className='qa-v7';p.dataset.view='raw';
  const colorOpts=[['teal','標準'],['blue','ブルー'],['green','グリーン'],['orange','オレンジ'],['red','レッド'],['purple','パープル'],['pink','ピンク'],['slate','スレート']].map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
  const typeOpts=CHART_TYPES.map(([v,l])=>`<option value="${v}">${html(l)}</option>`).join('');
  p.innerHTML=`
   <div class="qa-head">
    <div class="qa-tab-title"><b>品質データ分析</b><small>元データを確認し、グラフタブで 軸・値・凡例 を指定してグラフ化できます。</small></div>
    <div class="qa-actions"><button type="button" id="qaRefresh" class="qa-primary">グラフを作成／更新</button><button type="button" id="qaPrint" class="qa-secondary">印刷</button><button type="button" id="qaFold" class="qa-secondary" title="このカードを畳んで、下の一覧を広く使います">▲ 畳む</button></div>
   </div>
   <div class="qa-step-tabs">
    <button type="button" class="active" data-qa-tab="raw">元データ</button>
    <button type="button" data-qa-tab="graph">グラフ</button>
    <button type="button" data-qa-tab="list">対象データ一覧</button>
   </div>
   <div class="qa-body">
    <section class="qa-step-pane" data-qa-pane="graph" hidden>
     <div class="qa-design-pane">
      <aside class="qa-recipe">
       <div class="qa-acc-list">

        <div class="qa-acc open" data-acc="period">
         <button type="button" class="qa-acc-head"><span class="qa-step-num">期</span><span class="qa-acc-title">期間</span><span class="qa-acc-sum" id="sumPeriod">今月</span><span class="qa-acc-chev"></span></button>
         <div class="qa-acc-body">
          <input type="hidden" id="qaPeriodKind" value="thisMonth">
          <div class="qa-seg qa-seg-wrap" data-seg="qaPeriodSeg">
           <button type="button" data-val="7d">直近7日</button><button type="button" data-val="30d">直近30日</button><button type="button" data-val="90d">直近90日</button>
           <button type="button" data-val="thisMonth" class="active">今月</button><button type="button" data-val="lastMonth">先月</button><button type="button" data-val="ytd">今年</button>
          </div>
          <div class="qa-field-grid" style="margin-top:8px"><label>開始<input id="qaStart" type="datetime-local"></label><label>終了<input id="qaEnd" type="datetime-local"></label></div>
         </div>
        </div>

        <div class="qa-acc" data-acc="axis">
         <button type="button" class="qa-acc-head"><span class="qa-step-num">軸</span><span class="qa-acc-title">軸（X）</span><span class="qa-acc-sum" id="sumX">分類別</span><span class="qa-acc-chev"></span></button>
         <div class="qa-acc-body">
          <div class="qa-seg" data-seg="qaXseg"><button type="button" data-val="category" class="active">分類別</button><button type="button" data-val="time">時系列</button></div>
          <input type="hidden" id="qaDimension" value="category">
          <label id="qaGroupWrap" class="qa-sub">分類する列<select id="qaGroupCol"></select></label>
          <div id="qaTimeWrap" class="qa-sub" hidden>
           <label>日付の列<select id="qaDateCol"></select></label>
           <div class="qa-sub-inline">集計単位<div class="qa-seg qa-seg-sm" data-seg="qaBucketSeg"><button type="button" data-val="day" class="active">日</button><button type="button" data-val="month">月</button><button type="button" data-val="year">年</button></div></div>
           <input type="hidden" id="qaBucket" value="day">
          </div>
         </div>
        </div>

        <div class="qa-acc" data-acc="value">
         <button type="button" class="qa-acc-head"><span class="qa-step-num">値</span><span class="qa-acc-title">値（Y）</span><span class="qa-acc-sum" id="sumY">件数</span><span class="qa-acc-chev"></span></button>
         <div class="qa-acc-body">
          <div class="qa-seg" data-seg="qaYseg"><button type="button" data-val="count" class="active">件数をかぞえる</button><button type="button" data-val="sum">数量を合計する</button></div>
          <input type="hidden" id="qaMetric" value="count">
          <label id="qaValueWrap" class="qa-sub" hidden>合計する列（廃棄重量など）<select id="qaValueCol"></select></label>
         </div>
        </div>

        <div class="qa-acc" data-acc="series">
         <button type="button" class="qa-acc-head"><span class="qa-step-num">凡</span><span class="qa-acc-title">凡例（系列）</span><span class="qa-acc-sum" id="sumSeries">なし</span><span class="qa-acc-chev"></span></button>
         <div class="qa-acc-body">
          <label>系列で分ける列（積み上げ・集合・多系列で使用）<select id="qaSeriesCol"></select></label>
          <p class="qa-hint">例: 軸「発生設備」×凡例「異常内容」で、設備ごとの異常内容の内訳を表現します。凡例なしでも棒・折れ線は作成できます。</p>
         </div>
        </div>

       </div>

       <div class="qa-recipe-foot">
        <label class="qa-search-field">絞り込み検索<input id="qaSearch" type="search" placeholder="設備・異常内容・コメントなど"></label>
        <div class="qa-result-summary" id="qaSummary"><span class="qa-chip">未集計</span></div>
        <button type="button" id="qaRunLarge" class="qa-primary-large">この条件でグラフを作成</button>
       </div>
      </aside>

      <main class="qa-chart-main">
       <div class="qa-chart-toolbar">
        <div class="qa-chart-options">
         <label class="qa-opt"><span>種類</span><select id="qaChartType">${typeOpts}</select></label>
         <label class="qa-opt" id="qaBarWidthOpt"><span>棒の太さ</span><select id="qaBarWidth"><option value="narrow">細い</option><option value="normal" selected>標準</option><option value="wide">太い</option></select></label>
         <label class="qa-opt qa-combo-opt" id="qaBarMetricOpt" hidden><span>棒の値</span><select id="qaBarMetric"><option value="count">件数</option><option value="sum">合計</option></select></label>
         <label class="qa-opt qa-combo-opt" id="qaLineMetricOpt" hidden><span>折れ線の値</span><select id="qaLineMetric"><option value="count">件数</option><option value="sum" selected>合計</option></select></label>
         <label class="qa-opt"><span>並び順</span><select id="qaSort"><option value="value-desc">値の多い順</option><option value="value-asc">値の少ない順</option><option value="label-asc">項目名の順</option></select></label>
         <label class="qa-opt"><span>表示件数</span><select id="qaLimit"><option value="10">上位10</option><option value="15">上位15</option><option value="20" selected>上位20</option><option value="30">上位30</option><option value="50">上位50</option><option value="all">すべて</option></select></label>
         <label class="qa-opt"><span>カラー</span><span class="qa-color-inline"><select id="qaColor">${colorOpts}</select><span class="qa-color-dot" id="qaColorDot"></span></span></label>
         <label class="qa-opt qa-check"><input type="checkbox" id="qaShowValues" checked><span>数値ラベル</span></label>
        </div>
        <div class="qa-legend" id="qaLegend">グラフ未作成</div>
       </div>
       <div class="qa-graph-stage" id="qaChart"><div class="qa-empty">軸・値を選び、「この条件でグラフを作成」を押してください。</div></div>
      </main>
     </div>
    </section>
    <section class="qa-step-pane" data-qa-pane="list" hidden>
     <div class="qa-list" id="qaList"><div class="qa-empty">グラフ作成後、対象データの一覧を表示します。</div></div>
     <div class="qa-list-status" id="qaListStatus"></div>
    </section>
   </div>`;

  p.querySelectorAll('[data-qa-tab]').forEach(b=>b.onclick=()=>setView(b.dataset.qaTab));
  p.querySelectorAll('[data-seg="qaPeriodSeg"] button').forEach(b=>b.onclick=e=>{e.stopPropagation();setPeriod(b.dataset.val)});
  p.querySelectorAll('[data-seg="qaXseg"] button').forEach(b=>b.onclick=e=>{e.stopPropagation();$id('qaDimension').value=b.dataset.val;applyDisclosure()});
  p.querySelectorAll('[data-seg="qaYseg"] button').forEach(b=>b.onclick=e=>{e.stopPropagation();$id('qaMetric').value=b.dataset.val;applyDisclosure()});
  p.querySelectorAll('[data-seg="qaBucketSeg"] button').forEach(b=>b.onclick=e=>{e.stopPropagation();$id('qaBucket').value=b.dataset.val;setSeg('qaBucketSeg',b.dataset.val);updateSummaries();if(last)run()});
  p.querySelectorAll('.qa-acc-head').forEach(h=>h.onclick=()=>{const acc=h.parentElement;const willOpen=!acc.classList.contains('open');p.querySelectorAll('.qa-acc').forEach(a=>a.classList.remove('open'));if(willOpen)acc.classList.add('open')});
  ['qaGroupCol','qaDateCol','qaValueCol','qaSeriesCol'].forEach(id=>{const el=p.querySelector('#'+id);if(el)el.addEventListener('change',()=>{updateSummaries();if(last)run()})});
  $id('qaStart').addEventListener('change',()=>{$id('qaPeriodKind').value='';setSeg('qaPeriodSeg','');updateSummaries()});
  $id('qaEnd').addEventListener('change',()=>{$id('qaPeriodKind').value='';setSeg('qaPeriodSeg','');updateSummaries()});
  p.querySelector('#qaRefresh').onclick=()=>{setView('graph');run()};
  p.querySelector('#qaRunLarge').onclick=run;
  p.querySelector('#qaPrint').onclick=()=>window.print();
  /* 畳む（§9.296 ②）。**開いていた形を覚える**——毎回畳み直させない。 */
  p.querySelector('#qaFold').onclick=()=>applyFold(p.dataset.fold!=='1');
  applyFold(foldGet());
  /* 見た目の変更はクライアント側で即時再描画（同サイズ） */
  ['qaChartType','qaBarWidth','qaBarMetric','qaLineMetric','qaSort','qaLimit','qaColor','qaShowValues'].forEach(id=>{const el=p.querySelector('#'+id);if(el)el.addEventListener('change',()=>{updateColor();updateToolbarDisclosure();if(last)render(last)})});
  applyDisclosure();updateColor();
  return p;
 }

 /* 色は値だけを渡す(background を直接書くとCSS側から打ち消せなくなる)。 */
 function updateColor(){const dot=$id('qaColorDot');if(dot)dot.style.setProperty('--qa-dot-color',baseColor())}
 function setSeg(group,value){document.querySelectorAll(`[data-seg="${group}"] button`).forEach(b=>b.classList.toggle('active',b.dataset.val===value))}
 function toggle(id,show){const el=$id(id);if(el)el.hidden=!show}
 function setText(id,t){const el=$id(id);if(el)el.textContent=t}

 /* ---------- ビュー切替（元データ / グラフ / 一覧） ---------- */
 function setView(v){
  const p=ensurePanel();p.dataset.view=v;
  p.querySelectorAll('[data-qa-tab]').forEach(b=>b.classList.toggle('active',b.dataset.qaTab===v));
  p.querySelectorAll('[data-qa-pane]').forEach(x=>x.hidden=x.dataset.qaPane!==v);
  document.body.classList.toggle('qa-view-raw',v==='raw');
  if(v==='graph'){requestAnimationFrame(()=>{observeStage();if(last)render(last)})}
 }

 /* ---------- 描画エリア実寸（フィット描画の要） ---------- */
 function stage(){const el=$id('qaChart');if(!el)return{w:900,h:520};const w=el.clientWidth,h=el.clientHeight;if(w<80||h<80)return{w:Math.max(760,w||900),h:Math.max(460,h||520)};return{w:Math.max(320,w-20),h:Math.max(260,h-20)}}
 function observeStage(){const el=$id('qaChart');if(!el||ro)return;if(typeof ResizeObserver==='undefined')return;ro=new ResizeObserver(()=>{clearTimeout(ro._t);ro._t=setTimeout(()=>{const p=$id('qualityAnalysisPanel');if(last&&p&&!p.hidden&&p.dataset.view==='graph')render(last)},120)});ro.observe(el)}

 /* ---------- サマリー（折りたたみ時の内容表示） ---------- */
 function updateSummaries(){
  const kind=val('qaPeriodKind');
  if(kind&&PERIOD_LABELS[kind])setText('sumPeriod',PERIOD_LABELS[kind]);
  else{const s=val('qaStart'),e=val('qaEnd');const short=v=>v?v.replace('T',' ').slice(5,16):'';setText('sumPeriod',(s||e)?`${short(s)} 〜 ${short(e)}`:'未指定')}
  const dim=val('qaDimension')||'category';
  setText('sumX',dim==='time'?`時系列・${BUCKET_LABELS[val('qaBucket')||'day']}`:`分類別（${ell(val('qaGroupCol')||'未選択',12)}）`);
  const metric=val('qaMetric')||'count';
  setText('sumY',metric==='sum'?`合計（${ell(val('qaValueCol')||'未選択',12)}）`:'件数');
  setText('sumSeries',val('qaSeriesCol')?ell(val('qaSeriesCol'),14):'なし');
 }

 /* ---------- 段階的開示 ---------- */
 function applyDisclosure(){
  const dim=val('qaDimension')||'category',metric=val('qaMetric')||'count';
  setSeg('qaXseg',dim);setSeg('qaYseg',metric);setSeg('qaBucketSeg',val('qaBucket')||'day');
  toggle('qaGroupWrap',dim==='category');toggle('qaTimeWrap',dim==='time');
  toggle('qaValueWrap',metric==='sum');
  updateToolbarDisclosure();updateSummaries();
 }
 function updateToolbarDisclosure(){
  const f=chartDef()[2]||{};const combo=!!f.combo,hasBar=!!f.bar;
  toggle('qaBarWidthOpt',hasBar);toggle('qaBarMetricOpt',combo);toggle('qaLineMetricOpt',combo);
 }

 function fillSelect(id,cols,blankLabel,pref){const el=$id(id);if(!el)return;const prev=el.value;const blank=blankLabel!=null?`<option value="">${html(blankLabel)}</option>`:'';el.innerHTML=blank+cols.map(c=>`<option value="${html(c)}">${html(c)}</option>`).join('');el.value=(prev&&cols.includes(prev))?prev:(pref||'')}

 function prepareItems(data,metric){
  let items=(data.items||[]).slice();
  const sort=val('qaSort')||'value-desc';
  if((data.dimension||'category')==='time')items.sort((a,b)=>String(a.label).localeCompare(String(b.label)));
  else if(sort==='value-asc')items.sort((a,b)=>Number(a[metric]||0)-Number(b[metric]||0));
  else if(sort==='label-asc')items.sort((a,b)=>String(a.label).localeCompare(String(b.label),'ja'));
  else items.sort((a,b)=>Number(b[metric]||0)-Number(a[metric]||0));
  const lim=val('qaLimit')||'20';const n=lim==='all'?items.length:(parseInt(lim,10)||20);
  return items.slice(0,n);
 }

 /* ---------- 面積最大化の共通ヘルパー ----------
    棒/クラスタの間隔を「スロット比率」ではなく「最大px」で頭打ちにすることで、
    項目数が少ない（スロットが広い）場合でも棒が細く中央に寄らず、
    エリア全体を均等に使い切るようにする。 */
 function bandGap(slot,factor){return Math.max(2,Math.min(slot*(1-factor),34))}
 function bandWidth(slot,factor,min){return Math.max(min||4,slot-bandGap(slot,factor))}
 /* 凡例（系列名/円グラフ項目）をSVG内に折り返し配置する。印刷時もHTMLツールバーの
    凡例が非表示になるため、グラフ本体に埋め込んで基本情報として常に見えるようにする。 */
 function legendLayout(keys,maxW){
  const rowH=17,chipW=10,padX=10;
  let cx=0,rows=1;const placements=[];
  keys.forEach((k,i)=>{
   const label=ell(String(k),14);
   /* 日本語（全角）は1文字がほぼ1em幅なので、半角基準の推定だと重なる。
      全角/半角を判定して幅を積算し、凡例チップが本文と衝突しないようにする。 */
   // eslint-disable-next-line no-control-regex -- \x00〜\xff＝半角1文字ぶんの幅と見なす（意図した範囲）
   const textW=Math.max(20,[...label].reduce((w,ch)=>w+(/[\x00-\xff]/.test(ch)?6.4:11.5),0));
   const itemW=chipW+4+textW+padX;
   if(cx+itemW>maxW&&cx>0){cx=0;rows++}
   placements.push({label,row:rows-1,x:cx,col:seriesColor(k,i)});
   cx+=itemW;
  });
  return {placements,rows,rowH};
 }
 function legendSvg(info,x0,y0){
  if(!info)return '';
  return info.placements.map(p=>`<rect x="${x0+p.x}" y="${y0+p.row*info.rowH-9}" width="10" height="10" rx="2" fill="${p.col}"></rect><text class="qa-svg-legend-label" x="${x0+p.x+14}" y="${y0+p.row*info.rowH}">${html(p.label)}</text>`).join('');
 }

 /* ---------- 縦系（棒/積み上げ/集合/折れ線/面/コンボ） ---------- */
 function svgVertical(items,cfg){
  const {W,H,metric,keys,hasSeries,flags,showVal,color,title,subtitle,xTitle,yTitle}=cfg;
  const combo=!!flags.combo,stack=!!flags.stack,pct=!!flags.pct,line=!!flags.line,area=!!flags.area;
  const barMetric=combo?(val('qaBarMetric')||'count'):metric;
  const lineMetric=combo?(val('qaLineMetric')||'sum'):metric;
  const labels=items.map(it=>String(it.label));
  const maxLen=Math.max(...labels.map(s=>ell(s,18).length),1);
  const rotate=items.length>6||maxLen>5;
  const R=combo?60:16,L0=60+(yTitle?18:0);
  /* 凡例は実際の描画（本体側の分岐）と一致させる。combo かつ 積み上げ でない場合は
     系列色を使わず単色棒+折れ線で描くため、系列名ではなく棒/折れ線の凡例を出す。 */
  const legendKeys=combo?(stack&&hasSeries?keys:[`棒: ${METRIC_LABEL[barMetric]}`,`折れ線: ${METRIC_LABEL[lineMetric]}`]):(hasSeries?keys:[]);
  const legendInfo=legendKeys.length?legendLayout(legendKeys,Math.max(140,W-L0-R)):null;
  const titleH=title?21:0,subtitleH=subtitle?15:0,legendH=legendInfo?legendInfo.rows*17+6:0;
  const B=(rotate?Math.min(150,Math.max(46,34+maxLen*7)):40)+(xTitle?20:0);
  const T=12+titleH+subtitleH+legendH,L=L0;
  const plotH=Math.max(90,H-T-B),plotW=Math.max(140,W-L-R);
  const n=items.length,slot=plotW/n,x=i=>L+slot*i+slot/2;
  const stackTotal=it=>keys.reduce((s,k)=>s+Number(it.stacks?.[k]?.[metric]||0),0);
  let primVals;
  if(combo)primVals=items.map(it=>Number(it[barMetric]||0));
  else if(hasSeries&&stack)primVals=items.map(it=>pct?100:stackTotal(it));
  else if(hasSeries)primVals=items.map(it=>Math.max(...keys.map(k=>Number(it.stacks?.[k]?.[metric]||0)),0));
  else primVals=items.map(it=>Number(it[metric]||0));
  const pmax=niceMax(Math.max(...primVals,1));
  const yB=v=>T+plotH-(Number(v||0)/pmax)*plotH;
  const lineVals=items.map(it=>Number(it[lineMetric]||0)),lmax=niceMax(Math.max(...lineVals,1));
  const yL=v=>T+plotH-(Number(v||0)/lmax)*plotH;
  let grid='';for(let r=0;r<=4;r++){const gy=T+plotH*r/4,gv=pmax*(4-r)/4;grid+=`<line class="qa-gridline" x1="${L}" y1="${gy}" x2="${W-R}" y2="${gy}"></line><text class="qa-label" x="${L-8}" y="${gy+4}" text-anchor="end">${pct&&!combo?Math.round(gv)+'%':fmt(gv)}</text>`}
  let raxis='';if(combo){for(let r=0;r<=4;r++){const gy=T+plotH*r/4,gv=lmax*(4-r)/4;raxis+=`<text class="qa-label qa-raxis" x="${W-R+8}" y="${gy+4}" text-anchor="start">${fmt(gv)}</text>`}}
  const bw=bandWidth(slot,barFactor(),3);
  let body='';
  if(combo){
   if(stack&&hasSeries){body+=items.map((it,i)=>{const cx=x(i);let acc=0;return keys.map((k,si)=>{const v=Number(it.stacks?.[k]?.[metric]||0);if(!v)return '';const yy=yB(acc+v),hh=yB(acc)-yy;acc+=v;return `<rect x="${cx-bw/2}" y="${yy}" width="${bw}" height="${Math.max(1,hh)}" fill="${seriesColor(k,si)}" opacity=".85"><title>${html(it.label)} / ${html(k)}: ${fmt(v)}</title></rect>`}).join('')}).join('')}
   else{body+=items.map((it,i)=>{const v=Number(it[barMetric]||0);return `<rect x="${x(i)-bw/2}" y="${yB(v)}" width="${bw}" height="${Math.max(1,T+plotH-yB(v))}" rx="3" fill="${color}" opacity=".5"><title>${html(it.label)} 棒(${METRIC_LABEL[barMetric]}): ${fmt(v)}</title></rect>`}).join('')}
   const pts=items.map((it,i)=>`${x(i)},${yL(Number(it[lineMetric]||0))}`).join(' ');
   body+=`<polyline class="qa-line" points="${pts}" stroke="${color}"></polyline>`+items.map((it,i)=>`<circle class="qa-point" cx="${x(i)}" cy="${yL(Number(it[lineMetric]||0))}" r="4" fill="${color}"><title>${html(it.label)} 線(${METRIC_LABEL[lineMetric]}): ${fmt(Number(it[lineMetric]||0))}</title></circle>`).join('');
   if(showVal)body+=items.map((it,i)=>`<text class="qa-value" x="${x(i)}" y="${yL(Number(it[lineMetric]||0))-7}" text-anchor="middle">${fmt(Number(it[lineMetric]||0))}</text>`).join('');
  }else if(hasSeries&&stack){
   body=items.map((it,i)=>{const total=stackTotal(it)||1;let acc=0;const cx=x(i);const segs=keys.map((k,si)=>{let v=Number(it.stacks?.[k]?.[metric]||0);if(!v)return '';let disp=pct?v/total*100:v;const yy=yB(acc+disp),hh=yB(acc)-yy;acc+=disp;return `<rect x="${cx-bw/2}" y="${yy}" width="${bw}" height="${Math.max(1,hh)}" fill="${seriesColor(k,si)}"><title>${html(it.label)} / ${html(k)}: ${fmt(v)}</title></rect>`}).join('');const lab=showVal&&!pct?`<text class="qa-value" x="${cx}" y="${yB(stackTotal(it))-6}" text-anchor="middle">${fmt(stackTotal(it))}</text>`:'';return segs+lab}).join('');
  }else if(hasSeries){
   const clusterW=bandWidth(slot,barFactor(),10),innerGap=Math.min(4,clusterW/keys.length*0.15);
   const gw=Math.max(3,clusterW/keys.length-innerGap),groupW=gw*keys.length+innerGap*(keys.length-1);
   body=items.map((it,i)=>{const x0=x(i)-groupW/2;return keys.map((k,si)=>{const v=Number(it.stacks?.[k]?.[metric]||0);return `<rect x="${x0+si*(gw+innerGap)}" y="${yB(v)}" width="${gw}" height="${Math.max(1,T+plotH-yB(v))}" rx="2" fill="${seriesColor(k,si)}"><title>${html(it.label)} / ${html(k)}: ${fmt(v)}</title></rect>`}).join('')}).join('');
  }else if(line){
   const pts=items.map((it,i)=>`${x(i)},${yB(Number(it[metric]||0))}`).join(' ');body=`<polyline class="qa-line" points="${pts}" stroke="${color}"></polyline>`+items.map((it,i)=>`<circle class="qa-point" cx="${x(i)}" cy="${yB(Number(it[metric]||0))}" r="4" fill="${color}"><title>${html(it.label)}: ${fmt(Number(it[metric]||0))}</title></circle>`).join('');
   if(showVal){const st=Math.ceil(items.length/18||1);body+=items.map((it,i)=>i%st===0?`<text class="qa-value" x="${x(i)}" y="${yB(Number(it[metric]||0))-7}" text-anchor="middle">${fmt(Number(it[metric]||0))}</text>`:'').join('')}
  }else if(area){
   const pts=items.map((it,i)=>`${x(i)},${yB(Number(it[metric]||0))}`).join(' ');body=`<polygon points="${x(0)},${T+plotH} ${pts} ${x(items.length-1)},${T+plotH}" fill="${color}" opacity=".18"></polygon><polyline class="qa-line" points="${pts}" stroke="${color}"></polyline>`;
   if(showVal){const st=Math.ceil(items.length/18||1);body+=items.map((it,i)=>i%st===0?`<text class="qa-value" x="${x(i)}" y="${yB(Number(it[metric]||0))-7}" text-anchor="middle">${fmt(Number(it[metric]||0))}</text>`:'').join('')}
  }else{
   body=items.map((it,i)=>{const v=Number(it[metric]||0);return `<rect x="${x(i)-bw/2}" y="${yB(v)}" width="${bw}" height="${Math.max(1,T+plotH-yB(v))}" rx="4" fill="${color}" opacity=".9"><title>${html(it.label)}: ${fmt(v)}</title></rect>`}).join('');
   if(showVal){const st=Math.ceil(items.length/22||1);body+=items.map((it,i)=>i%st===0?`<text class="qa-value" x="${x(i)}" y="${yB(Number(it[metric]||0))-6}" text-anchor="middle">${fmt(Number(it[metric]||0))}</text>`:'').join('')}
  }
  const xlabels=items.map((it,i)=>rotate?`<text class="qa-label" x="${x(i)}" y="${T+plotH+14}" text-anchor="end" transform="rotate(-40 ${x(i)} ${T+plotH+14})">${html(ell(it.label,18))}<title>${html(it.label)}</title></text>`:`<text class="qa-label" x="${x(i)}" y="${T+plotH+18}" text-anchor="middle">${html(ell(it.label,10))}<title>${html(it.label)}</title></text>`).join('');
  const head=(title?`<text class="qa-chart-title" x="${W/2}" y="16" text-anchor="middle">${html(title)}</text>`:'')+(subtitle?`<text class="qa-chart-subtitle" x="${W/2}" y="${16+titleH}" text-anchor="middle">${html(subtitle)}</text>`:'')+legendSvg(legendInfo,L,16+titleH+subtitleH+10);
  const axisTitles=(xTitle?`<text class="qa-axis-title" x="${L+plotW/2}" y="${T+plotH+B-6}" text-anchor="middle">${html(xTitle)}</text>`:'')+(yTitle?`<text class="qa-axis-title" x="14" y="${T+plotH/2}" text-anchor="middle" transform="rotate(-90 14 ${T+plotH/2})">${html(yTitle)}</text>`:'');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${html(title||'品質データ分析グラフ')}">${head}${axisTitles}${grid}${raxis}<line class="qa-axis" x1="${L}" y1="${T}" x2="${L}" y2="${T+plotH}"></line>${combo?`<line class="qa-axis" x1="${W-R}" y1="${T}" x2="${W-R}" y2="${T+plotH}"></line>`:''}<line class="qa-axis" x1="${L}" y1="${T+plotH}" x2="${W-R}" y2="${T+plotH}"></line>${body}${xlabels}</svg>`;
 }

 /* ---------- 横系（横棒/横積み上げ/横集合） ---------- */
 function svgHorizontal(items,cfg){
  const {W,H,metric,keys,hasSeries,flags,showVal,color,title,subtitle,xTitle,yTitle}=cfg;
  const stack=!!flags.stack,pct=!!flags.pct;
  const stackTotal=it=>keys.reduce((s,k)=>s+Number(it.stacks?.[k]?.[metric]||0),0);
  const labels=items.map(it=>ell(String(it.label),22));
  const L=Math.min(230,Math.max(90,20+Math.max(...labels.map(s=>s.length),3)*11)),R=16;
  const legendKeys=hasSeries?keys:[];
  const legendInfo=legendKeys.length?legendLayout(legendKeys,Math.max(140,W-L-R)):null;
  const titleH=title?21:0,subtitleH=subtitle?15:0,legendH=legendInfo?legendInfo.rows*17+6:0,catCapH=yTitle?16:0;
  const T=12+titleH+subtitleH+legendH+catCapH,B=30+(xTitle?20:0);
  const n=items.length,avail=Math.max(60,H-T-B);
  let stride=avail/n,scroll=false;if(stride<26){stride=26;scroll=true}
  const H2=scroll?T+B+n*stride:H;
  const plotW=Math.max(120,W-L-R);
  const rowH=bandWidth(stride,barFactor(),8);
  const yrow=(i,h)=>T+i*stride+(stride-(h==null?rowH:h))/2;
  let primVals;
  if(hasSeries&&stack)primVals=items.map(it=>pct?100:stackTotal(it));
  else if(hasSeries)primVals=items.map(it=>Math.max(...keys.map(k=>Number(it.stacks?.[k]?.[metric]||0)),0));
  else primVals=items.map(it=>Number(it[metric]||0));
  const max=niceMax(Math.max(...primVals,1)),xv=v=>L+(Number(v||0)/max)*plotW;
  let grid='';for(let r=0;r<=4;r++){const gx=L+plotW*r/4,gv=(pct&&hasSeries&&stack?100:max)*r/4;grid+=`<line class="qa-gridline" x1="${gx}" y1="${T}" x2="${gx}" y2="${H2-B}"></line><text class="qa-label" x="${gx}" y="${H2-B+16}" text-anchor="middle">${pct&&hasSeries&&stack?Math.round(gv)+'%':fmt(gv)}</text>`}
  let body='';
  if(hasSeries&&stack){
   body=items.map((it,i)=>{const total=stackTotal(it)||1;let acc=0;const yy=yrow(i);const segs=keys.map((k,si)=>{let v=Number(it.stacks?.[k]?.[metric]||0);if(!v)return '';let disp=pct?v/total*100:v;const x0=xv(acc),w=xv(acc+disp)-x0;acc+=disp;return `<rect x="${x0}" y="${yy}" width="${Math.max(1,w)}" height="${rowH}" fill="${seriesColor(k,si)}"><title>${html(it.label)} / ${html(k)}: ${fmt(v)}</title></rect>`}).join('');const lab=showVal&&!pct?`<text class="qa-value" x="${xv(stackTotal(it))+6}" y="${yy+rowH/2+4}">${fmt(stackTotal(it))}</text>`:'';return segs+lab}).join('');
  }else if(hasSeries){
   const clusterH=bandWidth(stride,barFactor(),10),innerGap=Math.min(3,clusterH/keys.length*0.15);
   const gh=Math.max(2,clusterH/keys.length-innerGap);
   body=items.map((it,i)=>{const y0=yrow(i,clusterH);return keys.map((k,si)=>{const v=Number(it.stacks?.[k]?.[metric]||0);return `<rect x="${L}" y="${y0+si*(gh+innerGap)}" width="${Math.max(1,xv(v)-L)}" height="${gh}" fill="${seriesColor(k,si)}"><title>${html(it.label)} / ${html(k)}: ${fmt(v)}</title></rect>`}).join('')}).join('');
  }else{
   body=items.map((it,i)=>{const v=Number(it[metric]||0),yy=yrow(i);const lab=showVal?`<text class="qa-value" x="${xv(v)+6}" y="${yy+rowH/2+4}">${fmt(v)}</text>`:'';return `<rect x="${L}" y="${yy}" width="${Math.max(1,xv(v)-L)}" height="${rowH}" rx="3" fill="${color}" opacity=".9"><title>${html(it.label)}: ${fmt(v)}</title></rect>${lab}`}).join('');
  }
  const ylabels=items.map((it,i)=>`<text class="qa-label" x="${L-8}" y="${yrow(i)+rowH/2+4}" text-anchor="end">${html(ell(it.label,22))}<title>${html(it.label)}</title></text>`).join('');
  const head=(title?`<text class="qa-chart-title" x="${W/2}" y="16" text-anchor="middle">${html(title)}</text>`:'')+(subtitle?`<text class="qa-chart-subtitle" x="${W/2}" y="${16+titleH}" text-anchor="middle">${html(subtitle)}</text>`:'')+legendSvg(legendInfo,L,16+titleH+subtitleH+10)+(yTitle?`<text class="qa-axis-title" x="${L}" y="${T-catCapH+11}" text-anchor="start">${html(yTitle)}</text>`:'');
  const axisTitle=xTitle?`<text class="qa-axis-title" x="${L+plotW/2}" y="${H2-8}" text-anchor="middle">${html(xTitle)}</text>`:'';
  return `<svg viewBox="0 0 ${W} ${H2}" width="${W}" height="${H2}" role="img" aria-label="${html(title||'品質データ分析グラフ（横棒）')}">${head}${axisTitle}${grid}<line class="qa-axis" x1="${L}" y1="${T}" x2="${L}" y2="${H2-B}"></line>${body}${ylabels}</svg>`;
 }

 /* ---------- 円 / ドーナツ ---------- */
 function polar(cx,cy,r,a){return [cx+r*Math.cos(a),cy+r*Math.sin(a)]}
 function arcPath(cx,cy,r,ir,a0,a1){const large=(a1-a0)>Math.PI?1:0;const [x0,y0]=polar(cx,cy,r,a0),[x1,y1]=polar(cx,cy,r,a1);if(ir<=0)return `M${cx} ${cy} L${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;const [x2,y2]=polar(cx,cy,ir,a1),[x3,y3]=polar(cx,cy,ir,a0);return `M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${ir} ${ir} 0 ${large} 0 ${x3} ${y3} Z`}
 function svgPie(items,cfg){
  const {W,H,metric,flags,showVal,title,subtitle}=cfg,donut=!!flags.donut;
  const total=items.reduce((s,it)=>s+Number(it[metric]||0),0)||1;
  const legendInfo=legendLayout(items.map(it=>it.label),Math.max(140,W-32));
  const titleH=title?21:0,subtitleH=subtitle?15:0,legendH=legendInfo.rows*17+8;
  const topH=12+titleH+subtitleH,bottomH=legendH+10;
  const cx=W/2,cy=topH+(H-topH-bottomH)/2,r=Math.max(40,Math.min(W-32,H-topH-bottomH)/2-14),ir=donut?r*0.56:0;
  let a0=-Math.PI/2,arcs='';
  items.forEach((it,i)=>{const v=Number(it[metric]||0),frac=v/total,a1=a0+frac*2*Math.PI,col=seriesColor(it.label,i);arcs+=`<path d="${arcPath(cx,cy,r,ir,a0,a1)}" fill="${col}" stroke="#fff" stroke-width="2"><title>${html(it.label)}: ${fmt(v)} (${(frac*100).toFixed(1)}%)</title></path>`;if(showVal&&frac>=0.04){const mid=(a0+a1)/2,lr=ir>0?(r+ir)/2:r*0.62,[lx,ly]=polar(cx,cy,lr,mid);arcs+=`<text class="qa-pie-label" x="${lx}" y="${ly}" text-anchor="middle">${Math.round(frac*100)}%</text>`}a0=a1});
  const center=donut?`<text x="${cx}" y="${cy-4}" text-anchor="middle" class="qa-donut-total">${fmt(total)}</text><text x="${cx}" y="${cy+16}" text-anchor="middle" class="qa-donut-sub">${METRIC_LABEL[metric]||''}</text>`:'';
  const head=(title?`<text class="qa-chart-title" x="${W/2}" y="16" text-anchor="middle">${html(title)}</text>`:'')+(subtitle?`<text class="qa-chart-subtitle" x="${W/2}" y="${16+titleH}" text-anchor="middle">${html(subtitle)}</text>`:'');
  const legendRow=legendSvg(legendInfo,Math.max(8,(W-Math.max(...legendInfo.placements.map(p=>p.x),0))/2-70),H-legendH+8);
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${html(title||'品質データ分析グラフ（円）')}">${head}${arcs}${center}${legendRow}</svg>`;
 }

 function legend(data,items,metric,flags,hasSeries){
  if(flags.combo){const bm=val('qaBarMetric')||'count',lm=val('qaLineMetric')||'sum';return `<span class="qa-lg"><i class="sw" style="background:${baseColor()};opacity:.5"></i>棒: ${METRIC_LABEL[bm]}</span><span class="qa-lg"><i class="ln" style="background:${baseColor()}"></i>折れ線: ${METRIC_LABEL[lm]}</span>`}
  if(flags.pie){return `<div class="qa-stack-legend">${items.map((it,i)=>`<span><i style="background:${seriesColor(it.label,i)}"></i>${html(ell(it.label,16))}</span>`).join('')}</div>`}
  if(hasSeries)return `<div class="qa-stack-legend">${(data.stack_keys||[]).map((k,i)=>`<span><i style="background:${seriesColor(k,i)}"></i>${html(k)}</span>`).join('')}</div>`;
  return `<span class="qa-color-dot" style="--qa-dot-color:${baseColor()}"></span>${METRIC_LABEL[metric]||''}`;
 }

 function listHtml(data){const cols=data.list_columns||[],rows=data.rows||[];if(!rows.length)return '<div class="qa-empty">対象データがありません。</div>';return `<table><thead><tr>${cols.map(c=>`<th>${html(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${html(r[c]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table>`}

 function render(data){
  last=data;
  const def=chartDef(),flags=def[2]||{};
  const metric=data.metric==='sum'?'sum':'count';
  const keys=data.stack_keys||[];
  const hasSeries=!!data.stack_col&&keys.length>0;
  const sortMetric=flags.combo?(val('qaBarMetric')||'count'):metric;
  const items=prepareItems(data,sortMetric);
  const {w,h}=stage();
  const axisLabel=data.dimension==='time'?('時系列・'+(BUCKET_LABELS[data.bucket]||'日別')):(data.group_col||'項目');
  const metricLabel=METRIC_LABEL[metric]+(metric==='sum'&&data.value_col?`（${data.value_col}）`:'');
  /* グラフの基本情報（タイトル・軸ラベル・凡例）はSVG内に直接描画する。
     ツールバー側の凡例/サマリーは印刷時に非表示になるため、印刷しても
     「何のグラフか」が常にわかるよう図そのものに埋め込む。 */
  const title=flags.pie?`${axisLabel} 別 ${metricLabel}の内訳`:(hasSeries?`${axisLabel} × ${data.stack_col} 別 ${metricLabel}`:`${axisLabel} 別 ${metricLabel}`);
  const periodTxt=($id('sumPeriod')&&$id('sumPeriod').textContent)||'';
  const subtitle=`対象 ${fmt(data.total||0)}件・${periodTxt}・表示 ${items.length}項目`;
  const xTitle=flags.pie?'':(flags.orient==='h'?metricLabel:axisLabel);
  const yTitle=flags.pie?'':(flags.orient==='h'?axisLabel:metricLabel);
  const cfg={W:w,H:h,metric,keys,hasSeries,flags,showVal:checked('qaShowValues'),color:baseColor(),title,subtitle,xTitle,yTitle};
  let svg;
  if(!items.length)svg='<div class="qa-empty">対象データがありません。条件を見直してください。</div>';
  else if(flags.pie)svg=svgPie(items,cfg);
  else if(flags.orient==='h')svg=svgHorizontal(items,cfg);
  else svg=svgVertical(items,cfg);
  $id('qaChart').innerHTML=svg;
  $id('qaList').innerHTML=listHtml(data);
  $id('qaLegend').innerHTML=legend(data,items,metric,flags,hasSeries);
  const axis=axisLabel;
  const stackChip=hasSeries?`<span class="qa-chip">凡例: ${html(data.stack_col)}</span>`:'';
  $id('qaSummary').innerHTML=`<span class="qa-chip">対象 ${Number(data.total||0).toLocaleString()}件</span><span class="qa-chip">${html(metricLabel)}</span><span class="qa-chip">軸: ${html(axis)}</span><span class="qa-chip">表示 ${items.length}項目</span>${stackChip}`;
  const listStatus=$id('qaListStatus');
  if(listStatus){
   const rowsShown=(data.rows||[]).length,total=Number(data.total||0);
   listStatus.innerHTML=rowsShown?`<span>表示 ${rowsShown.toLocaleString()}件${rowsShown<total?` / 対象 ${total.toLocaleString()}件中`:''}</span>`:'';
  }
 }

 // 品質データ(SIKALOTDEF)は最大2万行を集計するため待たされることがある。
 async function run(){
  if(typeof withWaiting!=='function')return runInner();
  return withWaiting({title:'品質データを集計しています',detail:'テーブル: '+((typeof S!=='undefined'&&S.table)||'-'),
   progress:'条件に合う行を集計してグラフを作成しています'},()=>runInner());
 }
 async function runInner(){
  const panel=ensurePanel();if(panel.hidden)return;
  $id('qaChart').innerHTML='<div class="qa-empty">グラフを作成しています…</div>';
  const q=new URLSearchParams({table:S.table||'',group_col:val('qaGroupCol'),metric:val('qaMetric')||'count',value_col:val('qaValueCol'),stack_col:val('qaSeriesCol'),date_col:val('qaDateCol'),search:val('qaSearch'),bucket:val('qaBucket')||'day',dimension:val('qaDimension')||'category',max_rows:'20000'});
  const st=val('qaStart'),en=val('qaEnd');if(st)q.set('start',st);if(en)q.set('end',en);
  try{const data=await api('/api/quality/analysis?'+q.toString());requestAnimationFrame(()=>render(data))}catch(err){$id('qaChart').innerHTML=`<div class="qa-empty">グラフ作成に失敗しました: ${html(err.message)}</div>`}
 }

 function sync(){
  ensurePrintButton();const panel=ensurePanel();
  const isQ=typeof S!=='undefined'&&!!window.WL&&WL.dataSource.isQuality(S.db);
  panel.hidden=!isQ;document.body.classList.toggle('qa-mode',!!isQ);
  if(!isQ){prevQa=false;return}
  /* パネルを汎用フィルタバーの前に置き、元データビューで両者を上から順に表示 */
  const fb=$id('genericFilterBar');if(fb&&panel.parentNode&&fb.parentNode===panel.parentNode)panel.parentNode.insertBefore(panel,fb);
  const cols=S.columns||[];
  fillSelect('qaGroupCol',cols,null,preferred(cols,['発生設備','異常内容','登録日時'])||cols[0]||'');
  fillSelect('qaValueCol',cols,'選択なし',preferred(cols,['廃棄重量','廃却重量','ｽｸﾗｯﾌﾟ重量','スクラップ重量']));
  fillSelect('qaDateCol',cols,'日付なし',preferred(cols,['登録日時','発生日','発生日時','保留設定日']));
  fillSelect('qaSeriesCol',cols,'なし',preferred(cols,['異常内容','発生設備','最終処置']));
  updateColor();applyDisclosure();observeStage();
  if(!prevQa)setView('raw');
  prevQa=true;
 }

 /* 表を描いたあと・接続先や表を選んだあとに足す（被せない・§9.352）。 */
 WL.listHooks.onGrid(sync);
 WL.listHooks.onSelect(sync);
 window.addEventListener('resize',()=>{clearTimeout(window._qaRz);window._qaRz=setTimeout(()=>{const p=$id('qualityAnalysisPanel');if(last&&p&&!p.hidden&&p.dataset.view==='graph')render(last)},150)});
 WL.onReady(sync);queueMicrotask(sync);
})();


