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
     original … 元幅(実績)。両耳の屑を含んだ幅。条1のOS端は**OS側の屑幅**
                だけ内側にある。
     product  … 製品幅合計(条幅の総和)。屑を含まない。条1のOS端が0。
   どちらで測ったかで答えがOS側の屑幅ぶんずれるため、必ず選んでもらう。

   ■ 座標系
   内部では「製品座標」= 条1のOS端を0とし、DS方向を正とする1本の軸へ
   すべて直してから条を当てる。センター基準(③④)も、基準幅の中央を
   経由して同じ軸へ落とす。**屑幅の割り付け(均等か片寄せか)は条の設計が
   決めた値をそのまま使う**——`WL.split.scrapInfo()`が答える1箇所で、
   図(lot-split.js renderScrapAndRuler)と同じ材料。ここで「左右均等」と
   決め打ちにすると、片寄せしたロットで条の番号が寄せたぶんずれる(§9.160)。

   ■ 一時データと「保存」の違い（§9.70）
   入力は開いている間ずっと settings.defectLocation へ書き戻す(閉じて
   開き直しても続きから使えるようにするため)。ただしこれは**一時データ**で、
   帳票には出さない——オペレータが「もし◯mmの位置なら何条目か」を
   試算しただけ、という解釈。**保存ボタンを押したときだけ** その時点の
   判定を settings.defectLocation.saved へ凍結し、帳票へ載せる対象にする。
   保存後に入力を変えた場合は「保存し直すまで帳票は古いまま」を明示する。

   公開は WL.defect 名前空間（素の window.* を増やさない）。
   ============================================================ */
(function(){
 if(typeof $!=='function'||typeof S==='undefined')return;
 const $id=id=>document.getElementById(id);
 /* 空欄は「未入力」。Number('')は0なので素直に通すと、距離を1文字も
    入れていない状態が「OS端ちょうど(0mm)」として判定されてしまう。 */
 const num=v=>{const s=String(v??'').trim();if(s==='')return NaN;
  const n=Number(s);return Number.isFinite(n)?n:NaN};
 const fmt=(v,d=1)=>Number.isFinite(v)?v.toFixed(d):'－';
 const BASIS_LABEL={os:'OSから',ds:'DSから','center-os':'センターからOSへ','center-ds':'センターからDSへ'};
 const WIDTH_BASIS_LABEL={original:'元幅（屑幅を含む）',product:'製品幅合計（屑幅を含まない）'};
 const DEFAULT_DEFECT_WIDTH=5;
 const INPUT_KEYS=['basis','distance','widthBasis','defectWidth','memo'];

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
  if(!L.complete)return{error:'条ごとの幅が分かりません。「条割変更」で子ロットを確定するか、製造板幅を確認してください。',
                        errorKind:'lanes',lanes:L};
  const original=num(S.measure?.basic?.originalWidth);
  const scrap=Number.isFinite(original)?original-L.slit:NaN;
  /* 屑の割り付けは条の設計が持つ(§9.160)。取れないときだけ均等へ倒す
     ——**この画面で別の前提を作らない**。 */
  const alloc=(typeof WL!=='undefined'&&WL.split&&WL.split.scrapInfo&&WL.split.scrapInfo())||null;
  const scrapOs=alloc&&Number.isFinite(alloc.os)?alloc.os:(Number.isFinite(scrap)?scrap/2:NaN);
  const scrapDs=Number.isFinite(scrap)&&Number.isFinite(scrapOs)?scrap-scrapOs:NaN;
  const scrapBiased=!!(alloc&&alloc.biased);
  const d=num(input.distance);
  if(!Number.isFinite(d))return{error:'基準位置からの距離を入力してください。',errorKind:'input',lanes:L,original,scrap,scrapOs,scrapDs,scrapBiased};
  let baseWidth,toProduct;
  if(input.widthBasis==='original'){
   if(!Number.isFinite(original))return{error:'元幅（実績）が取得できないため、屑幅を含む基準では計算できません。基準幅を「製品幅合計」にしてください。',
                                        errorKind:'basis',lanes:L,original,scrap,scrapOs,scrapDs,scrapBiased};
   baseWidth=original;toProduct=scrapOs;      // 条1のOS端はOS側の屑幅だけ内側
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
  return{lanes:L,original,scrap,scrapOs,scrapDs,scrapBiased,baseWidth,toProduct,posBase,pos,lo,hi,defectWidth:w,hits,outside,
         distance:d,basis:input.basis,widthBasis:input.widthBasis,memo:input.memo||''};
 }

 /* ---------- 色 ----------
    子ロットごとに安定した色。条割の視覚図と**同じ並び**の色相を使い
    (同じロットの並びを見ているので、別の配色にすると読み替えが要る)、
    彩度だけ一段落とす。**この図で唯一の高彩度は欠陥の赤**にしたい——
    条が原色で塗られていると、赤がその中に埋もれて「どこが欠陥か」を
    面積の大きい方から拾ってしまう(前景/背景の対比が効かない)。
    色だけに意味を持たせないため、該当条は枠線と条番号の反転バッジ、
    図の上の▼マーカーでも示す。 */
 /* 配色そのものは`lot-split.js`が持つ（§9.159）。**同じロットは同じ色**で
    ないと、条の設計で覚えた色をこの図で読み替えることになる。以前は同じ
    並びの色相を各ファイルが**別々に書いていた**ため、条を並べ替えると
    2つの図で違う色になっていた。無ければ困るものなので黙って既定へ
    倒さない（`typeof`で「あれば使う」と書くと、公開漏れが静かに通る）。 */
 if(!window.WL||!WL.lotColors)console.error('defect-locator: WL.lotColors が無い（条の設計と色が食い違う）');
 const NEUTRAL=(window.WL&&WL.lotColors&&WL.lotColors.neutral)||'#8a9a97';
 function colorFor(list){
  return WL.lotColors.map((list||[]).map(l=>l.lot));
 }
 const lot3=lot=>{const s=String(lot||'');return s.length>3?s.slice(-3):s};
 /* 端に寄ったラベルは、中央揃えのままだと図の外へ出て見切れる。
    どちら側に寄っているかだけをクラスで渡し、寄せ方はCSSに持たせる。 */
 const edgeClass=p=>p<8?' at-start':p>92?' at-end':'';
 /* 結論は1行で読み切れる長さに畳む。幅のある欠陥は20条以上に掛かることが
    あり、番号を全部並べると結論欄が2〜3行になって図の位置まで動く。
    連番は「17〜22」にまとめ、ロット名は3件で打ち切って残数を添える。 */
 function rangeLabel(nums){
  const a=[...nums].sort((x,y)=>x-y),out=[];
  let i=0;
  while(i<a.length){
   let j=i;while(j+1<a.length&&a[j+1]===a[j]+1)j++;
   out.push(j-i>=2?`${a[i]}〜${a[j]}`:a.slice(i,j+1).join('・'));
   i=j+1;
  }
  return out.join('・');
 }
 function lotsLabel(lots){
  return lots.length>3?`${lots.slice(0,3).join(' / ')} ほか${lots.length-3}件`:lots.join(' / ');
 }

 /* ---------- 視覚化 ----------
    条割の視覚図と同じ見せ方(左OS・右DS・屑帯・センターライン)に、
    欠陥の帯を重ねる。位置の数値ラベルは帯の外(.defect-flags)へ出す
    ——帯はoverflow:hiddenなので、中に置くと上端で切られて読めない。 */
 function figureScale(r){
  const L=r.lanes,showScrap=Number.isFinite(r.scrap)&&r.scrap>0;
  const total=showScrap?r.original:(L?L.slit:NaN);
  /* off＝条1のOS端が図の左端から何mm内側か。**片寄せなら左右で違う**。 */
  const os=showScrap&&Number.isFinite(r.scrapOs)?r.scrapOs:(showScrap?r.scrap/2:0);
  const ds=showScrap?r.scrap-os:0;
  return {ok:total>0,total,off:os,osScrap:os,dsScrap:ds,showScrap,pct:v=>v/total*100};
 }
 function visualHtml(r,cls){
  const c=cls||'defect';
  const L=r.lanes,list=L?.list||[],sc=figureScale(r);
  if(!sc.ok)return '';
  const colors=colorFor(list),pct=sc.pct;
  let html='';
  if(sc.showScrap){
   if(sc.osScrap>0)html+=`<div class="${c}-scrap" style="left:0;width:${pct(sc.osScrap).toFixed(3)}%" title="屑幅(OS側) ${esc(fmt(sc.osScrap))}"><span>屑</span></div>`;
   if(sc.dsScrap>0)html+=`<div class="${c}-scrap" style="left:${pct(sc.off+L.slit).toFixed(3)}%;width:${pct(sc.dsScrap).toFixed(3)}%" title="屑幅(DS側) ${esc(fmt(sc.dsScrap))}"><span>屑</span></div>`;
  }
  list.forEach(l=>{
   const left=pct(sc.off+l.start),width=pct(l.width),hit=r.hits?.some(h=>h.index===l.index);
   html+=`<div class="${c}-lane${hit?' is-hit':''}" data-idx="${l.index}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%;--defect-lane-bg:${colors[l.lot]||NEUTRAL}" `
       +`title="${esc(l.index+1)}条目 ／ ${esc(l.lot||'ロット不明')} ／ 幅${esc(fmt(l.width))}">`
       +`${width>4?`<span class="${c}-lane-label"><b>${esc(l.index+1)}</b><small>${esc(lot3(l.lot))}</small></span>`:''}</div>`;
  });
  html+=`<div class="${c}-centerline" title="センターライン"></div>`;
  if(Number.isFinite(r.pos)){
   const dl=Math.max(0,Math.min(100,pct(sc.off+r.lo)));
   const dw=Math.max(.6,pct(Math.max(r.defectWidth,sc.total*.004)));
   html+=`<div class="${c}-mark" style="left:${dl.toFixed(3)}%;width:${dw.toFixed(3)}%" title="欠陥位置 ${esc(fmt(r.pos))}（製品座標）"></div>`;
  }
  return html;
 }
 /* 帯の上に置く位置ラベル(▼付き)。 */
 function flagsHtml(r,cls){
  const c=cls||'defect',sc=figureScale(r);
  if(!sc.ok||!Number.isFinite(r.pos))return '';
  const p=Math.max(0,Math.min(100,sc.pct(sc.off+r.pos)));
  return `<div class="${c}-flag${edgeClass(p)}" style="left:${p.toFixed(3)}%"><b>${esc(fmt(r.pos))}</b><i></i></div>`;
 }
 function rulerHtml(r,cls){
  const c=cls||'defect',sc=figureScale(r);
  if(!sc.ok)return '';
  return [0,.25,.5,.75,1].map(f=>{
   const p=f*100;
   return `<div class="${c}-tick" style="left:${p.toFixed(3)}%"></div>`
        +`<div class="${c}-tick-label${edgeClass(p)}" style="left:${p.toFixed(3)}%">${esc(fmt(sc.total*f,0))}</div>`;
  }).join('');
 }
 /* 条が細いとロット番号を帯の中へ書けない。色と番号の対応を1行で添える。 */
 function legendHtml(r,cls){
  const c=cls||'defect',list=r.lanes?.list||r.lanes||[];
  const colors=colorFor(list),lots=[...new Set(list.map(l=>l.lot).filter(Boolean))];
  if(lots.length<2)return '';
  return lots.map(lot=>{
   const idx=list.filter(l=>l.lot===lot).map(l=>l.index+1);
   return `<span style="--defect-lane-bg:${colors[lot]}"><i></i>${esc(lot)}<b>${esc(rangeLabel(idx))}条</b></span>`;
  }).join('');
 }

 /* ---------- 結論 ----------
    「答え」の場所は1つだけ。入力途中でもエラーでも同じ枠に同じ形で出す
    (器の高さが変わらないので、視線と押したいボタンの位置が動かない)。 */
 function answerHtml(r){
  const box=(cls,head,sub)=>`<div class="defect-answer ${cls}"><b>${esc(head)}</b><span>${esc(sub)}</span></div>`;
  if(r.error){
   if(r.errorKind==='input')return box('defect-answer-wait','距離を入力してください','基準位置からの距離（mm）を入れると、該当する条をすぐに判定します');
   return box('defect-answer-error','いまは判定できません',r.error);
  }
  if(!r.hits.length){
   return box('defect-answer-none','製品に掛かる条はありません',
    r.outside==='os'?'OS側の屑幅の中です':r.outside==='ds'?'DS側の屑幅の中です':'条の範囲から外れています');
  }
  const lots=[...new Set(r.hits.map(h=>h.lot).filter(Boolean))];
  return `<div class="defect-answer"><b>OSから ${esc(rangeLabel(r.hits.map(h=>h.index+1)))} 条目</b>`
   +`<span>${lots.length?`対象ロット ${esc(lotsLabel(lots))}`:'ロット番号は取得できていません'}</span>`
   +`<span>該当 ${esc(r.hits.length)} 条</span></div>`;
 }
 /* ---------- 内訳（伸び縮みしてよい唯一の場所） ---------- */
 function detailHtml(r){
  const head=`<div class="defect-detail-head">計算の内訳<span>${r.scrapBiased
   ?`屑幅は片寄せの設定（OS側 ${esc(fmt(r.scrapOs))}／DS側 ${esc(fmt(r.scrapDs))}）で計算しています`
   :'屑幅は左右均等に付く前提で計算しています'}</span></div>`;
  if(r.error&&r.errorKind!=='basis')
   return head+`<div class="defect-detail-empty">${esc(r.error)}</div>`;
  const warn=Number.isFinite(r.scrap)&&r.scrap<0
   ? '<div class="defect-warn">元幅（実績）より条幅合計のほうが大きく、屑幅がマイナスです。元幅か条割を確認してください。</div>':'';
  if(r.error)return head+warn+`<div class="defect-detail-empty">${esc(r.error)}</div>`;
  const rows=r.hits.map(h=>`<tr><th>${h.index+1}条目</th><td>${esc(h.lot||'－')}</td><td>${esc(fmt(h.width))}</td><td>${esc(fmt(h.fromLaneOs))}</td></tr>`).join('');
  return head+warn
   +`<div class="defect-calc">`
   +`<span>基準幅 <b>${esc(fmt(r.baseWidth))}</b>（${esc(WIDTH_BASIS_LABEL[r.widthBasis]||'')}）</span>`
   +`<span>${esc(BASIS_LABEL[r.basis]||'')}の位置 <b>${esc(fmt(r.posBase))}</b></span>`
   +`<span>製品座標（条1のOS端＝0） <b>${esc(fmt(r.pos))}</b></span>`
   +`<span>欠陥の幅 <b>${esc(fmt(r.defectWidth))}</b>（${esc(fmt(r.lo))}〜${esc(fmt(r.hi))}）</span>`
   +(Number.isFinite(r.scrap)?`<span>屑幅（両耳合計） <b>${esc(fmt(r.scrap))}</b>／OS側 ${esc(fmt(r.scrapOs))}・DS側 ${esc(fmt(r.scrapDs))}</span>`:'')
   +`</div>`
   +(rows?`<table class="defect-table"><thead><tr><th>条</th><th>ロット№</th><th>条幅</th><th>条のOS端から</th></tr></thead><tbody>${rows}</tbody></table>`
        :`<div class="defect-detail-empty">該当する条はありません。</div>`);
 }

 /* ---------- 入力の読み書き ---------- */
 function readInput(){
  return{basis:$id('defectBasis')?.value||'os',
         distance:$id('defectDistance')?.value??'',
         widthBasis:$id('defectWidthBasis')?.value||'original',
         defectWidth:$id('defectWidth')?.value??DEFAULT_DEFECT_WIDTH,
         memo:$id('defectMemo')?.value||''};
 }
 const sameInput=(a,b)=>!!a&&!!b&&INPUT_KEYS.every(k=>String(a[k]??'')===String(b[k]??''));
 /* 一時データの書き戻し。開いて眺めただけで「未保存の変更あり」にならない
    よう、中身が変わっていないときは何もしない。**保存済みスナップショット
    (saved)は絶対に落とさない**——ここで作り直すと、入力を1文字触った
    だけで帳票から消える。 */
 function saveInput(r){
  if(!S.measure)return;
  const i=readInput();
  S.measure.settings=S.measure.settings||{};
  const prev=S.measure.settings.defectLocation;
  if(prev&&sameInput(prev,i))return;
  S.measure.settings.defectLocation={...i,saved:prev?.saved,
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

 /* ---------- 保存（帳票へ載せる/載せない を決める唯一の操作） ----------
    帳票側は再計算せずこのスナップショットだけを見る。条の並びも一緒に
    凍結するので、後から条割を変えても「保存した時点の判定」が残る。 */
 function snapshot(r){
  const i=readInput();
  /* input は入力欄の生の文字列(「保存後に入力が変わったか」の比較用)。
     distance/defectWidth は数値(帳票が fmt() で整形するため)。
     文字列と数値を1つのキーに混ぜると「270」と「270.0」で変更扱いになる。 */
  return{savedAt:new Date().toISOString(),input:i,
   basis:r.basis,widthBasis:r.widthBasis,distance:r.distance,
   defectWidth:r.defectWidth,memo:i.memo,
   baseWidth:r.baseWidth,original:r.original,scrap:r.scrap,
   scrapOs:r.scrapOs,scrapDs:r.scrapDs,scrapBiased:r.scrapBiased,slit:r.lanes.slit,
   pos:r.pos,lo:r.lo,hi:r.hi,
   lanes:r.lanes.list.map(l=>({index:l.index,lot:l.lot,width:l.width,start:l.start,end:l.end})),
   hits:r.hits.map(h=>({index:h.index,lot:h.lot,width:h.width,fromLaneOs:h.fromLaneOs}))};
 }
 function savedRecord(){return S.measure?.settings?.defectLocation?.saved||null}
 function renderSaveState(r){
  const el=$id('defectSaveState'),save=$id('defectSave'),unsave=$id('defectUnsave');
  const sv=savedRecord(),cur=readInput();
  const stale=!!sv&&!sameInput(sv.input||sv,cur);
  if(unsave)unsave.hidden=!sv;
  if(save){
   save.disabled=!!r&&!!r.error;
   save.textContent=sv?(stale?'保存を更新':'保存済み'):'この判定を保存';
   save.title=r&&r.error?`判定できていないため保存できません（${r.error}）`
    :stale?'いま画面に出ている判定で、保存内容を上書きします'
    :'この判定を保存します。保存すると測定帳票にも載せられます（正式な測定値ではなく、参考のシミュレーション結果として扱います）';
  }
  if(!el)return;
  el.classList.toggle('is-saved',!!sv&&!stale);
  el.classList.toggle('is-stale',stale);
  if(!sv)el.textContent='未保存（この判定は帳票に出ません）';
  else if(stale)el.textContent='保存後に入力が変わりました。帳票にはまだ保存時の内容が出ます';
  else el.innerHTML=`保存済み <b>${esc(new Date(sv.savedAt).toLocaleString('ja-JP'))}</b> ／ 帳票に表示できます`;
 }
 function doSave(){
  const r=lastResult;
  if(!S.measure||!r||r.error){showToast?.('保存できません','判定できていないため保存しません');return}
  S.measure.settings=S.measure.settings||{};
  const prev=S.measure.settings.defectLocation||{};
  S.measure.settings.defectLocation={...prev,...readInput(),
   lanes:r.hits.map(h=>({index:h.index,lot:h.lot,width:h.width})),position:r.pos,
   updatedAt:new Date().toISOString(),saved:snapshot(r)};
  if(typeof markDirty==='function')markDirty();
  renderSaveState(r);
  syncSplitMarks();
  showToast?.('異常位置判定を保存しました','測定帳票の「異常位置判定（参考）」に表示されます');
 }
 function doUnsave(){
  const d=S.measure?.settings?.defectLocation;
  if(!d?.saved)return;
  delete d.saved;
  if(typeof markDirty==='function')markDirty();
  renderSaveState(lastResult);
  syncSplitMarks();
  showToast?.('保存を取り消しました','測定帳票には表示されなくなります');
 }

 /* ---------- 図をつかんで位置を決める（§9.226 ②、利用者の指示
    「欠陥をつかんで位置調整をできるようにしたい」） ----------
    数字を打ってから図で確かめる、の逆をできるようにする。**掴む対象は
    図そのもの**——欠陥の帯は`refresh()`のたびに`innerHTML`ごと作り直されるので、
    帯を掴む作りにすると動かした拍子に掴んでいた要素が消える（§9.167の
    「つまみは作り直さない」と同じ罠）。器（`#defectStrip`）で受け、追従は
    `document`で拾い、**毎回その場で器の矩形を測り直す**。

    書き戻すのは`#defectDistance`——**いま選んでいる基準のままの距離**へ
    逆算する（基準を勝手に変えない）。逆算は`compute()`の式をそのまま裏返す
    ので、判定の規則が2つに分かれない。 */
 function figureFromEvent(e){
  const strip=$id('defectStrip');
  const r=lastResult;
  if(!strip||!r||!r.lanes)return null;
  const sc=figureScale(r);
  if(!sc.ok)return null;
  const box=strip.getBoundingClientRect();
  if(box.width<1)return null;
  const f=Math.max(0,Math.min(1,(e.clientX-box.left)/box.width));
  /* 図の左端は「母材の左端」。製品座標は条1のOS端が0なので屑幅を引く。 */
  const pos=f*sc.total-sc.off;
  /* 基準幅と`toProduct`は`compute()`が決めたものをそのまま使う（同じ式の裏返し）。 */
  const baseWidth=Number.isFinite(r.baseWidth)?r.baseWidth:sc.total;
  const toProduct=Number.isFinite(r.toProduct)?r.toProduct:0;
  const posBase=pos+toProduct;
  const basis=String(r.basis||'os');
  let d;
  if(basis==='os')d=posBase;
  else if(basis==='ds')d=baseWidth-posBase;
  else if(basis==='center-os')d=baseWidth/2-posBase;
  else d=posBase-baseWidth/2;
  /* **0.1mmで丸める**——現場の指示は0.1mm刻みで、それ以上の桁は読めない。 */
  return Math.round(d*10)/10;
 }
 let dragging=false;
 function beginDrag(e){
  /* **掴んでいる最中は2本目を受けない**——右クリックや2本目の指で
     `beginDrag`がもう一度走ると、`applyDrag`が離す前に別の座標を書く。 */
  if(dragging)return;
  const strip=$id('defectStrip');
  if(!strip||!lastResult||lastResult.errorKind==='lanes')return;
  const d=figureFromEvent(e);
  if(d===null)return;
  e.preventDefault();
  dragging=true;
  strip.classList.add('is-dragging');
  applyDrag(e);
  document.addEventListener('pointermove',applyDrag);
  /* **`pointercancel`も拾うこと**——拾わないと、掴んだまま窓の外へ出て
     取り消されたときに`dragging`が立ったままになり、二度と掴めなくなる
     （`lot-split.js`の並べ替えが両方を拾っているのと同じ理由）。 */
  document.addEventListener('pointerup',endDrag);
  document.addEventListener('pointercancel',endDrag);
 }
 function applyDrag(e){
  const d=figureFromEvent(e);
  if(d===null)return;
  const el=$id('defectDistance');
  if(!el)return;
  el.value=String(d);
  refresh();
 }
 function endDrag(){
  dragging=false;
  document.removeEventListener('pointermove',applyDrag);
  document.removeEventListener('pointerup',endDrag);
  document.removeEventListener('pointercancel',endDrag);
  const strip=$id('defectStrip');
  if(strip)strip.classList.remove('is-dragging');
 }

 let lastResult=null;
 /* 画面の更新は「必ず全部の枠を埋める」。以前はエラー時に図と目盛りを
    空文字で潰していたため、枠ごと消えて印刷ボタンの位置まで動いた。 */
 function refresh(){
  if(!S.measure)return;
  const input=readInput(),r=compute(input);
  lastResult=r;
  const sc=figureScale(r),drawable=sc.ok;
  const set=(id,html)=>{const el=$id(id);if(el)el.innerHTML=html};
  set('defectResult',answerHtml(r));
  set('defectStrip',drawable?visualHtml(r)
   :'<div class="defect-figure-empty">条ごとの幅が分かると、ここに条の並びと欠陥の位置を描きます。</div>');
  set('defectFlags',drawable?flagsHtml(r):'');
  set('defectRuler',drawable?rulerHtml(r):'');
  set('defectLegend',drawable?legendHtml(r):'');
  set('defectDetail',detailHtml(r));
  const note=$id('defectBasisNote');
  if(note){
   const L=r.lanes;
   note.innerHTML=`<span>条数 <b>${L?L.list.length:0}</b></span>`
    +`<span>条幅合計 <b>${esc(fmt(L?L.slit:NaN))}</b></span>`
    +`<span>元幅（実績） <b>${esc(fmt(r.original))}</b></span>`
    +`<span>屑幅（両耳合計） <b>${esc(fmt(r.scrap))}</b>${Number.isFinite(r.scrapOs)?`（OS ${esc(fmt(r.scrapOs))}／DS ${esc(fmt(r.scrapDs))}）`:''}</span>`
    +(L&&!L.split?'<span class="defect-note-warn">条割が未確定のため、製造板幅で等分して計算しています。</span>':'');
  }
  const scaleNote=$id('defectScaleNote');
  if(scaleNote)scaleNote.textContent=(Number.isFinite(r.scrap)&&r.scrap>0
   ?`左OS・右DS／両端の斜線は屑幅（${r.scrapBiased?'片寄せ':'左右均等'}）`
   :'左OS・右DS／屑幅は元幅（実績）が分かると表示されます')
   /* **できることを書く**（§CLAUDE 2）。掴めることは見ただけでは分からない。 */
   +(r.errorKind==='lanes'?'':'／図をつかむ・押すと位置を決められます（0.1mm刻み）');
  /* ボタンは消さない。押せない状態でも、なぜ押せないかをtitleで示す。 */
  const printBtn=$id('defectPrint');
  if(printBtn){
   printBtn.disabled=!!r.error;
   printBtn.title=r.error?`判定できていないため印刷できません（${r.error}）`
    :'ロットの基本情報と判定結果を1枚の帳票として印刷します';
  }
  renderSaveState(r);
  if(!r.error)saveInput(r);
 }

 /* ---------- 帳票（この判定だけの1枚） ---------- */
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
    ${field('基準位置',BASIS_LABEL[r.basis])}${field('基準位置からの距離',fmt(r.distance))}
    ${field('基準幅の取り方',WIDTH_BASIS_LABEL[r.widthBasis])}${field('基準幅',fmt(r.baseWidth))}
    ${field('欠陥の幅',fmt(r.defectWidth))}${field('欠陥の内容',r.memo)}
    ${field('条幅合計',fmt(r.lanes.slit))}${field('屑幅（両耳合計）',
      Number.isFinite(r.scrapOs)?`${fmt(r.scrap)}（OS ${fmt(r.scrapOs)}／DS ${fmt(r.scrapDs)}）`:fmt(r.scrap))}
    ${field('製品座標での位置',fmt(r.pos))}
   </div></section>
   <section class="df-section"><h3>欠陥位置</h3>
    <div class="df-strip-row"><span>OS</span><div class="df-strip">${visualHtml(r)}</div><span>DS</span></div>
   </section>
   <section class="df-section"><h3>該当条</h3>
    <p class="df-answer">${r.hits.length?`OSから <b>${rangeLabel(r.hits.map(h=>h.index+1))}</b> 条目（${r.hits.length}条）`:'製品に掛かる条はありません'}</p>
    ${rows?`<table class="df-table"><thead><tr><th>条</th><th>ロット№</th><th>条幅</th><th>条のOS端から</th></tr></thead><tbody>${rows}</tbody></table>`:''}
   </section>
   <div class="df-foot">この判定は、条割で確定した子ロットの幅と、屑幅の割り付け（${r.scrapBiased?'片寄せ':'左右均等'}）にもとづく参考値です（測定値ではありません）。</div>
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

 /* ---------- 測定帳票への相乗り（保存されたときだけ） ----------
    report-dashboard.js から呼ばれる。保存スナップショットだけを見るので、
    いま開いているロットでなくても(一覧から選んだ過去データでも)描ける。
    A4に載せるため .rp-* 側の px 固定スタイルを使い、高さは条数によらず一定。 */
 function reportSectionHtml(x){
  const sv=x?.settings?.defectLocation?.saved;
  if(!sv||!Array.isArray(sv.lanes)||!sv.lanes.length)return '';
  /* 保存した時点の割り付けで描く（後から条割や割り付けを変えても、
     帳票に載るのは「判定したときの姿」）。古いスナップショットは
     `scrapOs`を持たないので、そのときの前提どおり均等へ倒す。 */
  const r={lanes:{list:sv.lanes,slit:sv.slit},original:sv.original,scrap:sv.scrap,
           scrapOs:Number.isFinite(sv.scrapOs)?sv.scrapOs:(Number.isFinite(sv.scrap)?sv.scrap/2:NaN),
           scrapDs:Number.isFinite(sv.scrapDs)?sv.scrapDs:(Number.isFinite(sv.scrap)?sv.scrap/2:NaN),
           scrapBiased:!!sv.scrapBiased,
           pos:sv.pos,lo:sv.lo,hi:sv.hi,defectWidth:sv.defectWidth,hits:sv.hits||[]};
  const sc=figureScale(r);
  if(!sc.ok)return '';
  const hits=r.hits;
  const lots=[...new Set(hits.map(h=>h.lot).filter(Boolean))];
  const fact=(label,value,cls)=>`<div class="rp-defect-fact${cls?' '+cls:''}"><span>${esc(label)}</span><b>${esc(value||'－')}</b></div>`;
  const answer=hits.length?`OSから ${rangeLabel(hits.map(h=>h.index+1))} 条目（${hits.length}条）`:'製品に掛かる条なし';
  return `<section class="rp-section"><h3>異常位置判定（参考）</h3>
   <div class="rp-defect-body">
    <div class="rp-defect-figure">
     <div class="rp-defect-row"><span class="rp-defect-end">OS</span>
      <div class="rp-defect-measure">
       <div class="rp-defect-flags">${flagsHtml(r,'rp-defect')}</div>
       <div class="rp-defect-strip">${visualHtml(r,'rp-defect')}</div>
       <div class="rp-defect-ruler">${rulerHtml(r,'rp-defect')}</div>
      </div>
      <span class="rp-defect-end">DS</span></div>
     <div class="rp-defect-legend">${legendHtml(r,'rp-defect')}</div>
    </div>
    <div class="rp-defect-facts">
     ${fact('該当条',answer,'rp-defect-fact-hit')}
     ${fact('対象ロット',lotsLabel(lots))}
     ${fact('基準',`${BASIS_LABEL[sv.basis]||''} ${fmt(sv.distance)}mm`)}
     ${fact('基準幅',`${fmt(sv.baseWidth)}（${sv.widthBasis==='original'?'元幅':'製品幅合計'}）`)}
     ${fact('欠陥の幅',`${fmt(sv.defectWidth)}mm`)}
     ${fact('製品座標',`${fmt(sv.pos)}mm`)}
     ${fact('内容',sv.memo)}
    </div>
   </div>
   <div class="rp-defect-foot">オペレータが算出した参考値です（測定値ではありません）。屑幅は${r.scrapBiased?`片寄せ（OS ${fmt(r.scrapOs)}／DS ${fmt(r.scrapDs)}）`:'左右均等'}・条幅は判定時の条割にもとづきます。判定 ${esc(new Date(sv.savedAt).toLocaleString('ja-JP'))}</div>
  </section>`;
 }
 const hasSavedDefect=x=>!!x?.settings?.defectLocation?.saved?.lanes?.length;

 /* ---------- 条の設計へ渡す（§9.226 ②、利用者の指示） ----------
    「条の設計（幅の割り付け）と異常位置判定をより連携させたい。欠陥判定
     したら、条の設計にも表示したい(ONOFF可能)。判定した場合はバッジを
     表示して、欠陥が入っていることを表示する。」

    **判定はここ1箇所**（`compute()`）を通す——条の設計の側で条を数え直すと、
    屑幅の片寄せ・基準幅の取り方といった前提が2つに分かれる（§9.160で
    一度踏んだ形）。**このモーダルを開いていなくても答えられること**が要件
    なので、`lastResult`ではなく保存されている入力から計算し直す。
    戻りは`null`＝出すものが無い（判定できていない・入力が無い）。 */
 function markers(){
  const d=S.measure?.settings?.defectLocation;
  if(!d)return null;
  const input={basis:d.basis||'os',distance:d.distance,
               widthBasis:d.widthBasis||'original',
               defectWidth:d.defectWidth??DEFAULT_DEFECT_WIDTH,memo:d.memo||''};
  if(String(input.distance??'').trim()==='')return null;
  const r=compute(input);
  if(r.error)return null;
  const sv=d.saved;
  const stale=!!sv&&!sameInput(sv.input||sv,readInput());
  return {lanes:r.hits.map(h=>h.index),pos:r.pos,lo:r.lo,hi:r.hi,
          defectWidth:r.defectWidth,memo:String(d.memo||''),
          basis:r.basis,distance:r.distance,
          /* **保存済みかどうかも渡す**（§6「出どころを画面に出す」）——
             帳票に載るのは保存した判定だけなので、同じ印でも意味が違う。 */
          saved:!!sv,stale:!!(sv&&stale),
          outside:r.outside||''};
 }

 /* ================================================================
    ② 長手方向 — ピッチからロールを特定する（§9.239 ⑥、利用者の指示）
    ================================================================
    「欠陥を発見した際にピッチがある場合、ピッチを入力し、当設備の対象
     ロールを判定する機能を実装したいです。（略）使うデータはこのカラムの
     うちロール径MAXを主とし、ロール径MINもデータがあるものはそれも
     計算に用いる。」

    ■ 考え方
    ロールに1箇所の傷があると、材料には**そのロールの周長ごとに**印が付く。
    周長 C = π × 径。径は摩耗で減るので、MAXとMINの両方があれば
    C は [π×MIN, π×MAX] の**範囲**になる。MINが空なら**MAXの1点**
    （0で埋めない。§9.114／§9.231）。

    ■ 「ちょうど1周」以外も見る
      ・ロールの1周にk箇所の傷 → 印の間隔は C/k（＝ C = ピッチ×k）
      ・k回に1回しか印を数えていない → 測ったピッチは C×k（＝ C = ピッチ÷k）
    どちらも実際に起きるので候補には出すが、**直接一致とは必ず言葉で
    分ける**（§3・§6。同じ「候補」でも当たる見込みが違う）。

    ■ 判定はここ1箇所
    `rollMatches()`が答える。画面（`refreshRoll`）は組み立てるだけ。
    **`WL.defect.markers()`（幅方向）には混ぜない**——条の設計のバッジは
    「何条目か」を指しており、意味が2つになる（§9.226 ④）。
    **入力も`settings.defectLocation`へ混ぜない**——あちらは
    `sameInput()`で「保存後に変わったか」を見ているので、ピッチを1文字
    打っただけで幅方向の判定が「保存し直してください」になる。 */
 const ROLL_TOL_DEFAULT=2;              // ±%
 /* 周期の見かたの既定（§9.239 ⑥ の追補、利用者の指示「ちょうど1周分だけ
    見るをデフォルトにしてください」）。**`index.html`の`selected`と
    ここの2箇所が食い違うと、記録の無いロットを開いた瞬間だけ別の値に
    なる**（画面は「ちょうど1周」なのに判定は倍音まで見ている、という
    気づけない状態）。片方を変えたら必ずもう片方も変えること。 */
 const ROLL_HARMONICS_DEFAULT=1;
 const PI=Math.PI;
 const ROLL_INPUT_KEYS=['pitch','tol','face','harmonics','memo'];

 /* この端末が測っている設備。**綴りを書き写さない**（§9.163）——
    `currentConfiguredEquipment()`は`base.js`が持つ1箇所。 */
 function rollEquipment(){
  const s=S.measure?.settings||{};
  const a=String(s.registeredEquipment||S.measure?.registeredEquipment
    ||S.measure?.snapshot?.registeredEquipment||'').trim();
  if(a)return a;
  return (typeof currentConfiguredEquipment==='function')
    ? String(currentConfiguredEquipment()||'').trim() : '';
}
 /* ロールは設備が変わったときだけ引く。**読めなくても窓は開く**
    （fail-open。マスタが無い端末でも幅方向の判定は使える）。 */
 const rollCache=(window.WL&&WL.ttlCache)?WL.ttlCache({ttl:5*60*1000,max:8}):null;
 let rollState={equipment:null,rows:null,error:'',loading:false};
 async function loadRolls(eq){
  if(rollState.equipment===eq&&(rollState.rows||rollState.error))return;
  rollState={equipment:eq,rows:null,error:'',loading:true};
  try{
   const get=()=>api('/api/roll-master?equipment='+encodeURIComponent(eq));
   const r=rollCache?await rollCache.get('roll:'+eq,get):await get();
   if(rollState.equipment!==eq)return;               // 別の設備へ移った
   rollState={equipment:eq,rows:(r&&r.items)||[],faces:(r&&r.contactFaces)||[],
              error:'',loading:false};
  }catch(e){
   if(rollState.equipment!==eq)return;
   rollState={equipment:eq,rows:null,error:e.message||String(e),loading:false};
  }
  refreshRoll();
 }
 function rollInput(){
  return {pitch:num($id('defectPitch')?.value),
          tol:(()=>{const t=num($id('defectPitchTol')?.value);
                    return Number.isFinite(t)&&t>=0?t:ROLL_TOL_DEFAULT})(),
          face:String($id('defectRollFace')?.value||''),
          harmonics:Math.max(1,Math.min(9,num($id('defectHarmonics')?.value)||ROLL_HARMONICS_DEFAULT)),
          memo:String($id('defectRollMemo')?.value||'')};
 }
 /* ロールの周長の範囲。**MAXが無ければ判定できない**（理由を返す）。 */
 function rollBand(roll){
  const dmax=num(roll.diaMax),dmin=num(roll.diaMin);
  if(!Number.isFinite(dmax)||dmax<=0)return null;
  const lo=(Number.isFinite(dmin)&&dmin>0)?Math.min(dmin,dmax):dmax;
  return {dLo:lo,dHi:dmax,cLo:PI*lo,cHi:PI*dmax,worn:Number.isFinite(dmin)&&dmin>0&&dmin<dmax};
 }
 /* 判定の本体。**画面は組み立てるだけ**にするため、ここが理由まで返す。 */
 function rollMatches(input,rolls){
  const p=input.pitch;
  if(!Number.isFinite(p)||p<=0)
   return {error:'欠陥のピッチ（繰り返しの間隔）を入れてください。',errorKind:'input'};
  const tol=(input.tol||0)/100;
  const list=Array.isArray(rolls)?rolls:[];
  const face=String(input.face||'').trim();
  const targets=[];
  targets.push({n:1,kind:'direct',c:p,note:'ちょうど1周ぶん'});
  for(let k=2;k<=input.harmonics;k++){
   targets.push({n:k,kind:'multi',c:p*k,note:`${k}回に1回だけ数えている場合`});
   targets.push({n:k,kind:'divide',c:p/k,note:`1周に${k}箇所ある場合`});
  }
  const hits=[],skipped=[];
  let filteredByFace=0;
  list.forEach(roll=>{
   const band=rollBand(roll);
   if(!band){skipped.push({roll,why:'ロール径MAXが未登録'});return}
   if(face&&roll.contactFace&&roll.contactFace!==face){filteredByFace++;return}
   let best=null;
   targets.forEach(t=>{
    const lo=t.c*(1-tol),hi=t.c*(1+tol);
    /* 帯どうしが重なれば一致。**片方が1点でも同じ式で解ける**。 */
    if(hi<band.cLo||lo>band.cHi)return;
    /* ずれは「狙いの周長」と「帯のいちばん近い点」の相対差。 */
    const near=Math.min(Math.max(t.c,band.cLo),band.cHi);
    const dev=Math.abs(t.c-near)/t.c;
    const cand={...t,dev,band};
    if(!best||cand.kind==='direct'&&best.kind!=='direct'
       ||cand.kind===best.kind&&cand.dev<best.dev)best=cand;
   });
   if(best)hits.push({roll,...best});
  });
  /* 直接一致を先に、そのあとずれの小さい順。 */
  hits.sort((a,b)=>(a.kind==='direct'?0:1)-(b.kind==='direct'?0:1)||a.dev-b.dev);
  return {pitch:p,tolPct:input.tol,needDia:p/PI,face,
          hits,skipped,filteredByFace,total:list.length};
 }

 const ROLL_KIND_LABEL={direct:'直接一致',multi:'倍の間隔',divide:'1周に複数'};
 function rollAnswerHtml(r){
  if(r.error)return `<div class="defect-answer is-empty"><b>${esc(r.error)}</b>
    <span>ロールの周長（π×径）と比べて、当てはまるロールを探します。</span></div>`;
  const dia=fmt(r.needDia,1);
  if(!r.total)
   return `<div class="defect-answer is-empty"><b>この設備のロールが登録されていません</b>
    <span>マスタ管理 &gt; ロール でこの設備のロールを登録すると、ここで候補を出せます。
    いまのピッチに合うロール径は <b>${esc(dia)} mm</b> です。</span></div>`;
  if(!r.hits.length)
   return `<div class="defect-answer is-empty"><b>当てはまるロールが見つかりません</b>
    <span>このピッチ（${esc(fmt(r.pitch,1))} mm）に合うロール径は <b>${esc(dia)} mm</b> です。
    登録 ${r.total}本の中に、この径のロールはありませんでした（許容差 ±${esc(String(r.tolPct))}%）。
    許容差を広げるか、ロールマスタの径を確かめてください。</span></div>`;
  const top=r.hits[0];
  const direct=r.hits.filter(h=>h.kind==='direct').length;
  return `<div class="defect-answer"><b>${esc(top.roll.name||'（名前なし）')}</b>
    <span>${esc(ROLL_KIND_LABEL[top.kind])}（${esc(top.note)}）／ずれ ${esc((top.dev*100).toFixed(2))}%
    ・候補 ${r.hits.length}本（うち直接一致 ${direct}本）／
    このピッチに合うロール径は <b>${esc(dia)} mm</b></span></div>`;
 }
 function rollListHtml(r){
  if(r.error||!r.hits||!r.hits.length)
   return `<div class="defect-roll-empty">候補はまだありません。</div>`;
  const row=h=>{
   const b=h.band;
   const dia=b.worn?`${fmt(b.dHi,1)}〜${fmt(b.dLo,1)}`:fmt(b.dHi,1);
   const cir=b.worn?`${fmt(b.cLo,1)}〜${fmt(b.cHi,1)}`:fmt(b.cHi,1);
   return `<tr class="${h.kind==='direct'?'is-direct':''}">
    <td><b>${esc(h.roll.name||'（名前なし）')}</b></td>
    <td>${esc(h.roll.entryPos||'—')}</td>
    <td>${esc(h.roll.contactFace||'—')}</td>
    <td class="num" title="ロール径MAX${b.worn?'〜MIN':'（MINは未登録）'}">${esc(dia)}</td>
    <td class="num" title="周長＝π×径">${esc(cir)}</td>
    <td><span class="defect-roll-kind${h.kind==='direct'?' is-direct':''}"
      title="${esc(h.note)}">${esc(ROLL_KIND_LABEL[h.kind])}</span></td>
    <td class="num">${esc((h.dev*100).toFixed(2))}%</td>
    <td class="num">${h.roll.count==null?'—':esc(String(h.roll.count))}</td>
    <td>${esc(h.roll.material||'—')}</td>
    <td>${esc(h.roll.refNo||'—')}</td></tr>`;
  };
  return `<table class="defect-roll-table"><thead><tr>
    <th>ロール名</th><th>入出位置</th><th>接触面</th><th>径(mm)</th><th>周長(mm)</th>
    <th>一致の種類</th><th>ずれ</th><th>本数</th><th>材質</th><th>基準番号</th>
   </tr></thead><tbody>${r.hits.map(row).join('')}</tbody></table>`;
 }
 function rollNoteHtml(r){
  const chips=[];
  if(r&&!r.error){
   chips.push(`<span>ピッチ ${esc(fmt(r.pitch,1))} mm</span>`);
   chips.push(`<span>合うロール径 ${esc(fmt(r.needDia,1))} mm（ピッチ÷π）</span>`);
   chips.push(`<span>読んだロール ${r.total}本</span>`);
   if(r.filteredByFace)chips.push(`<span>接触面で除外 ${r.filteredByFace}本</span>`);
   if(r.skipped&&r.skipped.length)
    chips.push(`<span title="${esc(r.skipped.map(x=>x.roll.name||'（名前なし）').join('、'))}">`
     +`径が未登録で判定できない ${r.skipped.length}本</span>`);
  }
  return `<div class="defect-detail-head">判定の前提<span>ロールマスタ（マスタ管理 &gt; ロール）</span></div>`
   +`<div class="defect-calc">${chips.join('')}</div>`
   +`<p class="defect-roll-why">欠陥のピッチ＝ロールの周長（π×径）です。`
   +`ロール径MINも入っていれば、摩耗の範囲として幅を持たせて比べます。`
   +`「倍の間隔」「1周に複数」は<b>直接一致ではありません</b>——`
   +`数え落とし・傷が複数あるときの候補として出しています。`
   +`この判定は記録に残しますが、帳票には出しません（①と同じ扱いの一時データです）。</p>`;
 }
 /* 前提（左下）。**出どころを画面に出す**（§6）。 */
 function rollBasisHtml(){
  const eq=rollEquipment();
  const rows=rollState.rows;
  const state=rollState.loading?'読み込んでいます…'
    :rollState.error?`読めませんでした（${rollState.error}）`
    :rows?`${rows.length}本を読みました`:'まだ読んでいません';
  return `<span>設備 <b>${esc(eq||'（未登録）')}</b></span>`
   +`<span>ロールマスタ <b>${esc(state)}</b></span>`
   +`<span>許容差 <b>±${esc(String(rollInput().tol))}%</b></span>`;
 }
 /* ピッチの入力を記録へ書き戻す。**幅方向とは別の鍵**（`defectRoll`）。 */
 function saveRollInput(){
  if(!S.measure)return;
  const s=S.measure.settings=S.measure.settings||{};
  const cur=s.defectRoll||{};
  const now=rollInput();
  if(ROLL_INPUT_KEYS.every(k=>String(cur[k]??'')===String(now[k]??'')))return;
  s.defectRoll={...now,updatedAt:new Date().toISOString()};
  if(typeof markDirty==='function')markDirty();
 }
 function restoreRollInput(){
  const d=S.measure?.settings?.defectRoll||{};
  const put=(id,v)=>{const el=$id(id);if(el&&v!==undefined&&v!==null&&String(v)!=='')el.value=String(v)};
  put('defectPitch',d.pitch);
  put('defectPitchTol',d.tol??ROLL_TOL_DEFAULT);
  put('defectHarmonics',d.harmonics??ROLL_HARMONICS_DEFAULT);
  put('defectRollMemo',d.memo);
  /* 接触面の候補は**サーバーが答える**（§9.163）。記録済みの値は候補へ
     足してから当てる——候補に無い値を`select.value`へ入れると空文字に
     なり、記録が黙って消える（§9.204と同じ罠）。 */
  const sel=$id('defectRollFace');
  if(sel){
   const want=String(d.face||'');
   const faces=[...new Set([...(rollState.faces||[]),
     ...(rollState.rows||[]).map(x=>x.contactFace).filter(Boolean),
     ...(want?[want]:[])])];
   sel.innerHTML='<option value="">指定しない</option>'
     +faces.map(f=>`<option value="${esc(f)}">${esc(f)}</option>`).join('');
   sel.value=want;
  }
 }
 function refreshRoll(){
  if($id('defectPaneRoll')?.hidden)return;          // 隠れている面は組み立てない
  const set=(id,html)=>{const el=$id(id);if(el)el.innerHTML=html};
  const eq=rollEquipment();
  if(!eq){
   set('defectRollResult','<div class="defect-answer is-empty"><b>使用設備が未登録です</b>'
    +'<span>左メニューの「アプリ使用設備の設定」で設備を登録すると、その設備のロールから探せます。</span></div>');
   set('defectRollList','<div class="defect-roll-empty">設備が決まると候補を出せます。</div>');
   set('defectRollNote','');
   set('defectRollBasis',rollBasisHtml());
   return;
  }
  if(rollState.equipment!==eq||(!rollState.rows&&!rollState.error&&!rollState.loading)){
   loadRolls(eq);
  }
  const r=rollMatches(rollInput(),rollState.rows||[]);
  set('defectRollResult',rollAnswerHtml(r));
  set('defectRollList',rollListHtml(r));
  set('defectRollNote',rollNoteHtml(r));
  set('defectRollBasis',rollBasisHtml());
  if(!r.error)saveRollInput();
 }

 /* ---------- タブ（§9.239 ⑥） ---------- */
 let defectTab='pos';
 function setTab(k){
  defectTab=(k==='roll')?'roll':'pos';
  document.querySelectorAll('#defectModal .defect-tab').forEach(b=>{
   const on=b.dataset.defectTab===defectTab;
   b.classList.toggle('is-on',on);
   b.setAttribute('aria-selected',on?'true':'false');
  });
  document.querySelectorAll('#defectModal [data-defect-pane]').forEach(p=>{
   p.hidden=p.dataset.defectPane!==defectTab;
  });
  /* **押せるのに何も起きないボタンを残さない**（§4）。フッターの操作は
     ①幅方向の判定を指すので、②では押せなくして理由をその場に書く。 */
  [['defectPrint','①幅方向の判定を1枚の帳票として印刷します'],
   ['defectSave','①幅方向の判定を保存します'],
   ['defectReset','①幅方向の入力を消します']].forEach(([id,tip])=>{
   const el=$id(id);if(!el)return;
   el.disabled=defectTab==='roll';
   el.title=defectTab==='roll'
     ? tip+'（いまは「② 長手方向」を開いています。①へ戻ると押せます）' : tip;
  });
  const un=$id('defectUnsave');
  if(un&&defectTab==='roll')un.disabled=true;
  else if(un)un.disabled=false;
  if(defectTab==='roll'){restoreRollInput();refreshRoll();$id('defectPitch')?.focus()}
  else refresh();
 }

 /* ---------- 開閉と結線 ---------- */
 function open(){
  if(!S.measure){showToast?.('測定データがありません','ロットを開いてから実行してください');return}
  const modal=$id('defectModal');if(!modal)return;
  const cap=$id('defectLotCaption');
  if(cap)cap.textContent=[S.measure.basic?.lotNo,S.measure.basic?.purposeName].filter(Boolean).join(' ／ ');
  restoreInput();
  modal.hidden=false;
  /* **開いたときは①へ戻す**（§9.223 ②と同じ作法）。前に②を見ていたことは
     覚えない——「何条目か」を知りたくてここを開く場面のほうが多い。 */
  setTab('pos');
  refresh();
  $id('defectDistance')?.focus();
 }
 /* 条の設計の印を描き直す（§9.226 ②）。**窓を閉じる・保存する・取り消す
    ときだけ**——1文字打つたびに条の図を組み直すと、判定の窓の中で操作が
    重くなる（あちらは開いていないので、閉じるときに1回で足りる）。 */
 function syncSplitMarks(){
  try{if(window.WL&&WL.split&&WL.split.redrawFigure)WL.split.redrawFigure()}catch(e){}
 }
 function close(){const m=$id('defectModal');if(m)m.hidden=true;syncSplitMarks()}

 /* 図の上でのつかみ（§9.226 ②）。**器で受ける**——中身は描き直される。 */
 $id('defectStrip')?.addEventListener('pointerdown',beginDrag);
 $id('openDefect')?.addEventListener('click',open);
 $id('closeDefect')?.addEventListener('click',close);
 $id('defectPrint')?.addEventListener('click',printReport);
 $id('defectSave')?.addEventListener('click',doSave);
 $id('defectUnsave')?.addEventListener('click',doUnsave);
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
 /* ②の欄。**①と同じ形で結ぶ**（打つたびにその面だけ組み直す）。 */
 ['defectPitch','defectPitchTol','defectRollFace','defectHarmonics','defectRollMemo'].forEach(id=>{
  const el=$id(id);if(!el)return;
  el.addEventListener('input',refreshRoll);el.addEventListener('change',refreshRoll);
 });
 document.querySelectorAll('#defectModal .defect-tab').forEach(b=>{
  b.addEventListener('click',()=>{
   /* 掴んでいる最中にタブを切り替えない（図の掴みは`document`で受けて
      いるので、面を隠すと離す合図が届かなくなる）。判定は掴んでいる側の
      印（`.defect-strip.is-dragging`）を見る——別の目印を作らない。 */
   if($id('defectStrip')?.classList.contains('is-dragging'))return;
   setTab(b.dataset.defectTab);
  });
 });
 document.addEventListener('keydown',e=>{if(WL.modal.escCloses(e)&&!$id('defectModal')?.hidden)close()},true);

 window.WL=window.WL||{};
 window.WL.defect={open,close,compute,lanes,refresh,save:doSave,unsave:doUnsave,
                   reportSectionHtml,hasSaved:hasSavedDefect,
                   /* 条の設計との連携（§9.226 ②）。 */
                   markers,
                   /* ② 長手方向（§9.239 ⑥）。**判定は1箇所**なので、
                      画面の外から確かめるときもこの関数を通す。 */
                   setTab,rollMatches,rollEquipment,
                   rollRows:()=>((rollState.rows||[]).slice())};
})();
