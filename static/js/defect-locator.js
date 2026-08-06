"use strict";
/* defect-locator.js: 異常位置判定（欠陥がOSから何条目・どの子ロットか）。
   ============================================================
   現場で見つかった欠陥は「基準位置から◯mm」という形でしか分からない。
   そこから、条割(lot-split.js が確定した splitGroups / splitPositionGroup)を
   使って「OSから何条目か」「その条はどの子ロットか」を求める。

   ■ 追加で入力するのは基準位置からの距離だけ
   条の幅・並び・子ロット番号・元幅(実績)・屑幅は、すでに測定画面が
   持っているデータから組み立てる。利用者に入れてもらうのは
     ・基準位置の取り方(4通り)
     ・そこからの距離(mm)
     ・欠陥の幅(既定5mm。この幅ぶんに掛かる条をすべて該当とする)
     ・基準幅の取り方(2通り)
   だけ。

   ■ 基準位置の4通り
     os        … OSから何mm
     ds        … DSから何mm
     center-os … センターからOSへ何mm
     center-ds … センターからDSへ何mm

   ■ 基準幅の2通り（①②のエッジ基準で効いてくる）
     original … 元幅(実績)。両耳の屑を含んだ幅。屑は左右均等に付くので、
                条1のOS端は屑幅の半分だけ内側にある。
     product  … 製品幅合計(条幅の総和)。屑を含まない。条1のOS端が0。
   どちらで測ったかで答えが屑幅の半分ぶんずれるため、必ず選んでもらう。

   ■ 座標系
   内部では「製品座標」= 条1のOS端を0とし、DS方向を正とする1本の軸へ
   すべて直してから条を当てる。センター基準(③④)も、基準幅の中央を
   経由して同じ軸へ落とす。屑を左右均等に振る前提は条割の視覚図
   (lot-split.js renderScrapAndRuler)と同じ。

   公開は WL.defect 名前空間（素の window.* を増やさない）。
   ============================================================ */
(function(){
 if(typeof $!=='function'||typeof S==='undefined')return;
 const $id=id=>document.getElementById(id);
 const num=v=>{const n=Number(String(v??'').trim());return Number.isFinite(n)?n:NaN};
 const fmt=(v,d=1)=>Number.isFinite(v)?v.toFixed(d):'－';
 const BASIS_LABEL={os:'OSから',ds:'DSから','center-os':'センターからOSへ','center-ds':'センターからDSへ'};
 const WIDTH_BASIS_LABEL={original:'元幅（屑幅を含む）',product:'製品幅合計（屑幅を含まない）'};
 const DEFAULT_DEFECT_WIDTH=5;

 /* ---------- 条の並びを組み立てる ----------
    条割が確定していれば子ロットごとの実幅で、未確定なら製造板幅×横割数で
    等分する。等分の場合はロット番号を親ロットのものにする(子が分からない)。 */
 function lanes(){
  const st=S.measure?.settings||{},groups=st.splitGroups,posMap=st.splitPositionGroup;
  const out=[];
  if(Array.isArray(groups)&&groups.length&&Array.isArray(posMap)&&posMap.length){
   posMap.forEach((gi,i)=>{
    const g=groups[gi]||{};
    out.push({index:i,lot:g.lot||'',width:num(g.base?.width),missing:!!g.missing});
   });
  }else{
   const count=Math.max(1,Math.min(40,num($('#horizontalCount')?.value)||num(st.horizontalCount)||1));
   const w=num(S.measure?.basic?.mfgWidth);
   for(let i=0;i<count;i++)out.push({index:i,lot:S.measure?.basic?.lotNo||'',width:w,missing:false,uniform:true});
  }
  let acc=0;
  out.forEach(l=>{l.start=acc;l.end=acc+(Number.isFinite(l.width)?l.width:0);acc=l.end});
  return {list:out,slit:acc,complete:out.length>0&&out.every(l=>Number.isFinite(l.width)&&l.width>0),
          split:Array.isArray(groups)&&groups.length>0};
 }

 /* ---------- 判定 ---------- */
 function compute(input){
  const L=lanes();
  if(!L.complete)return{error:'条ごとの幅が分かりません。「条割変更」で子ロットを確定するか、製造板幅を確認してください。',lanes:L};
  const original=num(S.measure?.basic?.originalWidth);
  const scrap=Number.isFinite(original)?original-L.slit:NaN;
  const d=num(input.distance);
  if(!Number.isFinite(d))return{error:'基準位置からの距離を入力してください。',lanes:L,original,scrap};
  let baseWidth,toProduct;
  if(input.widthBasis==='original'){
   if(!Number.isFinite(original))return{error:'元幅（実績）が取得できないため、屑幅を含む基準では計算できません。基準幅を「製品幅合計」にしてください。',lanes:L,original,scrap};
   baseWidth=original;toProduct=scrap/2;      // 屑は左右均等
  }else{baseWidth=L.slit;toProduct=0}
  let posBase;
  if(input.basis==='os')posBase=d;
  else if(input.basis==='ds')posBase=baseWidth-d;
  else if(input.basis==='center-os')posBase=baseWidth/2-d;
  else posBase=baseWidth/2+d;
  const pos=posBase-toProduct;                // 製品座標(条1のOS端=0)
  const w=Math.max(0,num(input.defectWidth)||0);
  const lo=pos-w/2,hi=pos+w/2;
  /* 幅0の欠陥は「点」なので、境界にちょうど乗った場合は手前の条に含める。
     幅がある場合は重なりで判定する(端に少しでも掛かれば該当)。 */
  const hits=L.list.filter(l=>w>0?(l.end>lo&&l.start<hi):(pos>=l.start&&pos<l.end))
   .map(l=>({...l,fromLaneOs:Math.max(0,Math.min(l.width,pos-l.start))}));
  let outside='';
  if(hi<=0)outside='os';else if(lo>=L.slit)outside='ds';
  return{lanes:L,original,scrap,baseWidth,toProduct,posBase,pos,lo,hi,defectWidth:w,hits,outside,
         basis:input.basis,widthBasis:input.widthBasis,memo:input.memo||''};
 }

 /* ---------- 色 ----------
    子ロットごとに安定した色。条割の視覚図と同系統の色数で揃える。 */
 const PALETTE=['#3f7f78','#7a6bb0','#b0783f','#4d7fb0','#a05070','#5f8f45','#8a6a3f','#556d7a'];
 function colorFor(list){
  const map={},lots=[...new Set(list.map(l=>l.lot).filter(Boolean))];
  lots.forEach((lot,i)=>{map[lot]=PALETTE[i%PALETTE.length]});
  return map;
 }
 const lot3=lot=>{const s=String(lot||'');return s.length>3?s.slice(-3):s};

 /* ---------- 視覚化 ----------
    条割の視覚図と同じ見せ方(左OS・右DS・屑帯・センターライン)に、
    欠陥の帯と位置ラベルを重ねる。 */
 function visualHtml(r){
  const L=r.lanes,list=L.list;
  const showScrap=Number.isFinite(r.scrap)&&r.scrap>0;
  const total=showScrap?r.original:L.slit;
  const off=showScrap?r.scrap/2:0;
  if(!(total>0))return '<div class="split-visual-empty">幅の情報が足りないため図示できません。</div>';
  const colors=colorFor(list);
  const pct=v=>(v/total*100);
  let html='';
  if(showScrap){
   html+=`<div class="defect-scrap" style="left:0;width:${pct(off).toFixed(3)}%" title="屑幅(OS側) ${esc(fmt(off))}"><span>屑</span></div>`;
   html+=`<div class="defect-scrap" style="left:${pct(off+L.slit).toFixed(3)}%;width:${pct(off).toFixed(3)}%" title="屑幅(DS側) ${esc(fmt(off))}"><span>屑</span></div>`;
  }
  list.forEach(l=>{
   const left=pct(off+l.start),width=pct(l.width),hit=r.hits?.some(h=>h.index===l.index);
   html+=`<div class="defect-lane${hit?' is-hit':''}" data-idx="${l.index}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%;background-color:${colors[l.lot]||'#8a9a97'}" `
       +`title="${esc(l.index+1)}条目 ／ ${esc(l.lot||'ロット不明')} ／ 幅${esc(fmt(l.width))}">`
       +`${width>4?`<span class="defect-lane-label"><b>${esc(l.index+1)}</b><small>${esc(lot3(l.lot))}</small></span>`:''}</div>`;
  });
  html+='<div class="defect-centerline" title="センターライン"></div>';
  if(Number.isFinite(r.pos)){
   const dl=Math.max(0,Math.min(100,pct(off+r.lo))),dw=Math.max(.6,pct(Math.max(r.defectWidth,total*.004)));
   html+=`<div class="defect-mark" style="left:${dl.toFixed(3)}%;width:${dw.toFixed(3)}%" title="欠陥位置 ${esc(fmt(r.pos))}（製品座標）"></div>`;
   const lp=Math.max(0,Math.min(100,pct(off+r.pos)));
   html+=`<div class="defect-mark-flag" style="left:${lp.toFixed(3)}%"><b>${esc(fmt(r.pos))}</b></div>`;
  }
  return html;
 }
 function rulerHtml(r){
  const L=r.lanes,showScrap=Number.isFinite(r.scrap)&&r.scrap>0;
  const total=showScrap?r.original:L.slit;
  if(!(total>0))return '';
  let html='';
  [0,.25,.5,.75,1].forEach(f=>{
   html+=`<div class="split-visual-tick" style="left:${(f*100).toFixed(3)}%"><span class="split-visual-tick-label">${fmt(total*f,0)}</span></div>`;
  });
  return html;
 }

 /* ---------- 結果表 ---------- */
 function resultHtml(r){
  if(r.error)return `<div class="defect-error">${esc(r.error)}</div>`;
  const rows=r.hits.map(h=>`<tr><th>${h.index+1}条目</th><td>${esc(h.lot||'－')}</td><td>${esc(fmt(h.width))}</td><td>${esc(fmt(h.fromLaneOs))}</td></tr>`).join('');
  const lots=[...new Set(r.hits.map(h=>h.lot).filter(Boolean))];
  const head=r.hits.length
   ? `<div class="defect-answer"><b>OSから ${r.hits.map(h=>h.index+1).join('・')} 条目</b>`
     +`<span>${lots.length?`対象ロット ${esc(lots.join(' / '))}`:'ロット番号は取得できていません'}</span></div>`
   : `<div class="defect-answer defect-answer-none"><b>製品に掛かる条はありません</b><span>${
       r.outside==='os'?'OS側の屑幅の中です':r.outside==='ds'?'DS側の屑幅の中です':'条の範囲から外れています'}</span></div>`;
  const warn=Number.isFinite(r.scrap)&&r.scrap<0
   ? '<div class="defect-warn">元幅（実績）より条幅合計のほうが大きく、屑幅がマイナスです。元幅か条割を確認してください。</div>':'';
  return head+warn
   +`<div class="defect-calc">`
   +`<span>基準幅 <b>${esc(fmt(r.baseWidth))}</b>（${esc(WIDTH_BASIS_LABEL[r.widthBasis]||'')}）</span>`
   +`<span>${esc(BASIS_LABEL[r.basis]||'')}の位置 <b>${esc(fmt(r.posBase))}</b></span>`
   +`<span>製品座標（条1のOS端＝0） <b>${esc(fmt(r.pos))}</b></span>`
   +`<span>欠陥の幅 <b>${esc(fmt(r.defectWidth))}</b>（${esc(fmt(r.lo))}〜${esc(fmt(r.hi))}）</span>`
   +(Number.isFinite(r.scrap)?`<span>屑幅（両耳合計） <b>${esc(fmt(r.scrap))}</b>／片側 ${esc(fmt(r.scrap/2))}</span>`:'')
   +`</div>`
   +(rows?`<table class="defect-table"><thead><tr><th>条</th><th>ロット№</th><th>条幅</th><th>条のOS端から</th></tr></thead><tbody>${rows}</tbody></table>`:'');
 }

 /* ---------- 入力の読み書き ---------- */
 function readInput(){
  return{basis:$id('defectBasis')?.value||'os',
         distance:$id('defectDistance')?.value??'',
         widthBasis:$id('defectWidthBasis')?.value||'original',
         defectWidth:$id('defectWidth')?.value??DEFAULT_DEFECT_WIDTH,
         memo:$id('defectMemo')?.value||''};
 }
 function saveInput(r){
  if(!S.measure)return;
  const i=readInput();
  S.measure.settings=S.measure.settings||{};
  /* 中身が変わっていないなら書かない。開いて眺めただけで「未保存の変更あり」に
     なると、閉じるときに毎回破棄の確認が出る。 */
  const prev=S.measure.settings.defectLocation;
  if(prev&&['basis','distance','widthBasis','defectWidth','memo']
     .every(k=>String(prev[k]??'')===String(i[k]??'')))return;
  S.measure.settings.defectLocation={...i,
   // 判定の答えも一緒に保存する。帳票と一覧で再計算しなくても出せるように。
   lanes:r&&!r.error?r.hits.map(h=>({index:h.index,lot:h.lot,width:h.width})):[],
   position:r&&!r.error?r.pos:null,updatedAt:new Date().toISOString()};
  if(typeof markDirty==='function')markDirty();
 }
 function restoreInput(){
  const saved=S.measure?.settings?.defectLocation;
  if(!saved)return;
  if($id('defectBasis')&&saved.basis)$id('defectBasis').value=saved.basis;
  if($id('defectWidthBasis')&&saved.widthBasis)$id('defectWidthBasis').value=saved.widthBasis;
  if($id('defectDistance'))$id('defectDistance').value=saved.distance??'';
  if($id('defectWidth'))$id('defectWidth').value=saved.defectWidth??DEFAULT_DEFECT_WIDTH;
  if($id('defectMemo'))$id('defectMemo').value=saved.memo||'';
 }

 let lastResult=null;
 function refresh(){
  if(!S.measure)return;
  const input=readInput(),r=compute(input);
  lastResult=r;
  const strip=$id('defectStrip'),ruler=$id('defectRuler'),res=$id('defectResult');
  if(strip)strip.innerHTML=r.error&&!r.lanes?.complete?'':visualHtml(r);
  if(ruler)ruler.innerHTML=r.error&&!r.lanes?.complete?'':rulerHtml(r);
  if(res)res.innerHTML=resultHtml(r);
  const note=$id('defectBasisNote');
  if(note){
   const L=r.lanes;
   note.innerHTML=`<span>条数 <b>${L?L.list.length:0}</b></span>`
    +`<span>条幅合計 <b>${esc(fmt(L?L.slit:NaN))}</b></span>`
    +`<span>元幅（実績） <b>${esc(fmt(r.original))}</b></span>`
    +(L&&!L.split?'<span class="defect-note-warn">条割が未確定のため、製造板幅で等分して計算しています。</span>':'');
  }
  const scaleNote=$id('defectScaleNote');
  if(scaleNote)scaleNote.textContent=Number.isFinite(r.scrap)&&r.scrap>0?'両端の薄い帯は屑幅（左右均等）':'屑幅は元幅（実績）が分かると表示されます';
  const printBtn=$id('defectPrint');
  if(printBtn)printBtn.disabled=!!r.error;
  if(!r.error)saveInput(r);
 }

 /* ---------- 帳票 ---------- */
 function ensurePrintArea(){
  let el=$id('defectPrintArea');if(el)return el;
  el=document.createElement('div');el.id='defectPrintArea';el.className='df-print-area';
  document.body.appendChild(el);return el;
 }
 function printReport(){
  const r=lastResult;if(!r||r.error)return;
  const b=S.measure?.basic||{},s=S.measure?.settings||{};
  const field=(label,value)=>`<div class="df-field"><span>${esc(label)}</span><b>${esc(value||'－')}</b></div>`;
  const rows=r.hits.map(h=>`<tr><td>${h.index+1}</td><td>${esc(h.lot||'－')}</td><td>${esc(fmt(h.width))}</td><td>${esc(fmt(h.fromLaneOs))}</td></tr>`).join('');
  const area=ensurePrintArea();
  area.innerHTML=`<div class="df-page">
   <div class="df-head"><h2>異常位置判定書</h2><span>${esc(b.lotNo||'')} ／ 作成 ${esc(new Date().toLocaleString('ja-JP'))}</span></div>
   <section class="df-section"><h3>ロット基本情報</h3><div class="df-grid">
    ${field('ロット番号',b.lotNo)}${field('検査番号',b.inspectionNo)}${field('鋳造番号',b.castingNo)}
    ${field('オーダー番号',b.orderNo)}${field('用途名',b.purposeName)}${field('取引先',b.customer)}
    ${field('製造材質',b.mfgMaterial)}${field('製造板厚',fmt(num(b.mfgThickness),3))}${field('製造板幅',fmt(num(b.mfgWidth)))}
    ${field('元幅（実績）',fmt(r.original))}${field('登録設備',s.registeredEquipment)}${field('オペレータ',s.operator)}
   </div></section>
   <section class="df-section"><h3>判定条件</h3><div class="df-grid">
    ${field('基準位置',BASIS_LABEL[r.basis])}${field('基準位置からの距離',fmt(num(readInput().distance)))}
    ${field('基準幅の取り方',WIDTH_BASIS_LABEL[r.widthBasis])}${field('基準幅',fmt(r.baseWidth))}
    ${field('欠陥の幅',fmt(r.defectWidth))}${field('欠陥の内容',r.memo)}
    ${field('条幅合計',fmt(r.lanes.slit))}${field('屑幅（両耳合計）',fmt(r.scrap))}
    ${field('製品座標での位置',fmt(r.pos))}
   </div></section>
   <section class="df-section"><h3>欠陥位置</h3>
    <div class="df-strip-row"><span>OS</span><div class="df-strip">${visualHtml(r)}</div><span>DS</span></div>
   </section>
   <section class="df-section"><h3>該当条</h3>
    <p class="df-answer">${r.hits.length?`OSから <b>${r.hits.map(h=>h.index+1).join('・')}</b> 条目`:'製品に掛かる条はありません'}</p>
    ${rows?`<table class="df-table"><thead><tr><th>条</th><th>ロット№</th><th>条幅</th><th>条のOS端から</th></tr></thead><tbody>${rows}</tbody></table>`:''}
   </section>
   <div class="df-foot">この判定は、条割で確定した子ロットの幅と、屑幅を左右均等とする前提で算出しています。</div>
  </div>`;
  document.body.classList.add('df-print');
  const prevTitle=document.title;
  document.title=`異常位置判定_${b.lotNo||''}`;
  const cleanup=()=>{document.body.classList.remove('df-print');document.title=prevTitle;area.innerHTML='';
   window.removeEventListener('afterprint',cleanup)};
  window.addEventListener('afterprint',cleanup);
  // 描画が反映されてから印刷ダイアログを開く(同期的に呼ぶと白紙になる)。
  requestAnimationFrame(()=>requestAnimationFrame(()=>window.print()));
 }

 /* ---------- 開閉と結線 ---------- */
 function open(){
  if(!S.measure){showToast?.('測定データがありません','ロットを開いてから実行してください');return}
  const modal=$id('defectModal');if(!modal)return;
  const cap=$id('defectLotCaption');
  if(cap)cap.textContent=[S.measure.basic?.lotNo,S.measure.basic?.purposeName].filter(Boolean).join(' ／ ');
  restoreInput();
  modal.hidden=false;
  refresh();
  $id('defectDistance')?.focus();
 }
 function close(){const m=$id('defectModal');if(m)m.hidden=true}

 $id('openDefect')?.addEventListener('click',open);
 $id('closeDefect')?.addEventListener('click',close);
 $id('defectPrint')?.addEventListener('click',printReport);
 $id('defectReset')?.addEventListener('click',()=>{
  if($id('defectDistance'))$id('defectDistance').value='';
  if($id('defectMemo'))$id('defectMemo').value='';
  if($id('defectWidth'))$id('defectWidth').value=DEFAULT_DEFECT_WIDTH;
  refresh();
 });
 ['defectBasis','defectDistance','defectWidthBasis','defectWidth','defectMemo'].forEach(id=>{
  const el=$id(id);if(!el)return;
  el.addEventListener('input',refresh);el.addEventListener('change',refresh);
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$id('defectModal')?.hidden)close()},true);

 window.WL=window.WL||{};
 window.WL.defect={open,close,compute,lanes,refresh};
})();
