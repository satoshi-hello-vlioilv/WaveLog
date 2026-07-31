/* measure-progress.js —— 測定進捗の集計・表示と、完了時の全項目確認。

   背景: 完了検証(activeRequiredControls)は「いま画面に描かれているグリッド」
   だけを見るため、入力内容(8種)や丈位置を切り替えずに完了すると、未測定の
   ままでも登録できてしまう。作業時間も検証に含まれていない（画面の案内文
   とは食い違っていた）。

   このファイルは DOM ではなく S.measure の中身から全項目・全丈位置を集計し、
     - 中央ペイン「入力内容」を状態付きチップに置換 (常時見える)
     - 操作レールに全体サマリ (完了ボタンの真上)
     - 完了時に未測定項目を提示して確認 (ブロックはしない)
   を行う。必要な測定項目は製品の材質・用途・規格で変わるため機械判定はせず、
   作業者が「対象外」を明示する方式とする。対象外にする操作のときだけ、同じ
   用途コードの過去実績(何件中何件で測定されているか)を確認として提示する。

   既存関数は置き換えず、updateValidationVisuals / persistAndTransition を
   ラップして呼び出す。 */
(function(){

/* 入力内容の並びは #measureType の選択肢と同順にする(画面と対応を取るため)。
   scope はデータの持ち方の違い:
     lot    = ロットに1つ (母材)
     piece  = 縦割りした丈ごと (揃い/肉厚/長さ … m.product.rows)
     length = 丈位置(頭/尾)ごと × 条ごと (m.measurements[key][丈位置][条]) */
const ITEM_DEFS=[
 {name:'母材',          scope:'lot'},
 {name:'揃い/肉厚/長さ', scope:'piece'},
 {name:'板厚/板幅',      scope:'length',keys:['thickness','width']},
 {name:'ラテラルボー',   scope:'length',keys:['lateral']},
 {name:'バリ',          scope:'length',keys:['burr']},
 {name:'テレスコープ',   scope:'length',keys:['telescope']},
 {name:'巻ずれ',        scope:'length',keys:['offset']},
 {name:'フラットネス',   scope:'length',keys:['flatness']},
];
/* 母材パネルの入力欄(data-mother)。activeRequiredControls と同じ8項目。 */
const MOTHER_FIELDS=['manual','fullLength','minCard','maxCard','front','rear','frontCard','rearCard'];
/* 揃い/肉厚/長さ で1丈を「入力済み」とみなす項目(productRowFilled と同基準)。 */
const PRODUCT_FIELDS=['productLength','wallThickness','alignmentCode'];

const filled=v=>String(v??'').trim()!=='';

function measureScopeOf(m){
 if(!m)return{excluded:[]};
 m.settings=m.settings||{};
 const s=m.settings.measureScope;
 if(!s||!Array.isArray(s.excluded))m.settings.measureScope={excluded:[],decidedAt:'',decidedBy:''};
 return m.settings.measureScope;
}
function isExcluded(m,name){return measureScopeOf(m).excluded.includes(name)}

/* 条数・丈数・丈位置数。丈位置は updateLengthOptions と同じく「縦割数+1」
   (1(頭)…N(頭) と N(尾))。保存済みレコードにも同じ計算を使うため、DOMでは
   なく settings から読む。 */
function countsOf(m){
 const st=m.settings||{};
 const vertical=Math.max(1,Math.min(9,Number(st.verticalCount)||1));
 const horizontal=Math.max(1,Math.min(40,Number(st.horizontalCount)||1));
 return{vertical,horizontal,lengthSlots:Math.min(LENGTH_SLOTS,vertical+1)};
}

/* 1項目分の進捗。perLength は丈位置ごとの充足数(length scope のみ)。 */
function itemProgress(m,def){
 const c=countsOf(m),out={name:def.name,filled:0,total:0,perLength:[]};
 if(def.scope==='lot'){
  const mother=m.mother||{};
  out.total=MOTHER_FIELDS.length;
  out.filled=MOTHER_FIELDS.filter(k=>filled(mother[k])).length;
 }else if(def.scope==='piece'){
  const rows=(m.product&&Array.isArray(m.product.rows))?m.product.rows:[];
  out.total=c.vertical;
  out.filled=Array.from({length:c.vertical},(_,i)=>rows[i])
   .filter(r=>PRODUCT_FIELDS.some(k=>filled(r&&r[k]))).length;
 }else{
  const ms=m.measurements||{};
  for(let li=0;li<c.lengthSlots;li++){
   let f=0,t=0;
   def.keys.forEach(key=>{
    const row=(ms[key]&&ms[key][li])||[];
    /* 板厚は条ごとではなく長さごとに3枠(OS/CL/DS)。他は条数分。 */
    const n=key==='thickness'?3:c.horizontal;
    t+=n;
    for(let j=0;j<n;j++)if(filled(row[j]))f++;
   });
   out.perLength.push({filled:f,total:t});
   out.filled+=f;out.total+=t;
  }
 }
 out.state=out.total===0?'done':out.filled===0?'todo':out.filled>=out.total?'done':'part';
 return out;
}

/* 全項目の進捗。excluded は集計から外す。 */
function progressOf(m){
 if(!m)return null;
 const excluded=new Set(measureScopeOf(m).excluded);
 const items=ITEM_DEFS.map(def=>{
  const p=itemProgress(m,def);
  p.excluded=excluded.has(def.name);
  if(p.excluded)p.state='skip';
  return p;
 });
 const active=items.filter(x=>!x.excluded);
 return{
  items,
  doneCount:active.filter(x=>x.state==='done').length,
  activeCount:active.length,
  unmeasured:active.filter(x=>x.state!=='done'),
 };
}
function measureProgress(){return progressOf(S.measure)}

/* ---------- 表示 ---------- */

const STATE_LABEL={done:'済',part:'一部',todo:'未',skip:'対象外'};

function chipsHtml(p){
 const current=$('#measureType')?.value;
 return p.items.map(x=>{
  const cls=['type-chip','type-chip--'+x.state];
  if(x.name===current)cls.push('is-current');
  const detail=x.excluded?'対象外':x.state==='done'?'済':`${x.filled}/${x.total}`;
  const title=x.excluded
   ?`${x.name}: 対象外に設定しています。右クリックで対象に戻します`
   :`${x.name}: ${x.filled}/${x.total} 入力済み。右クリックで対象外にします`;
  return `<button type="button" class="${cls.join(' ')}" data-type-chip="${esc(x.name)}" title="${esc(title)}">`
   +`<span class="type-chip-name">${esc(x.name)}</span><span class="type-chip-state">${esc(detail)}</span></button>`;
 }).join('');
}

/* 操作レールのサマリ。チップと項目を重複させず、全体の充足と丈位置の内訳、
   作業時間の記録有無だけを出す(完了ボタンの直上で最後に確認する用途)。 */
function railHtml(p,m){
 const pct=p.activeCount?Math.round(p.doneCount/p.activeCount*100):0;
 const skipped=p.items.filter(x=>x.excluded).length;
 const c=countsOf(m);
 const perLength=Array.from({length:c.lengthSlots},(_,li)=>{
  let f=0,t=0;
  p.items.forEach(x=>{if(x.excluded||!x.perLength.length)return;const s=x.perLength[li];if(s){f+=s.filled;t+=s.total}});
  return{label:lengthLabel(li),done:t>0&&f>=t,partial:f>0&&f<t};
 });
 const wt=m.workTime||{};
 const wtState=wt.startAt&&wt.endAt?'done':wt.startAt||wt.endAt?'part':'todo';
 return `<div class="rail-progress-bar"><i style="width:${pct}%"></i></div>`
  +`<div class="rail-progress-line"><b>${p.doneCount}/${p.activeCount}</b> 項目`
  +(skipped?`<span class="rail-progress-skip">対象外 ${skipped}</span>`:'')+`</div>`
  +`<div class="rail-progress-lengths">`+perLength.map(x=>
    `<span class="rail-len rail-len--${x.done?'done':x.partial?'part':'todo'}" title="丈位置 ${esc(x.label)}">${esc(x.label)}</span>`).join('')+`</div>`
  +`<div class="rail-progress-line rail-progress-worktime rail-progress-worktime--${wtState}">作業時間 ${wtState==='done'?'記録済み':wtState==='part'?'途中':'未記録'}</div>`;
}

function lengthLabel(li){
 const el=$('#lengthPos');
 if(el&&el.options[li])return el.options[li].value;
 return String(li+1);
}

/* ヘッダー固定のミニ進捗表示。操作レール(#railProgress)は左端の縦長パネル
   内にあり、レールが長くなる・画面を狭くすると視界から外れ得る。ヘッダーは
   常に画面最上部に固定されているため、タブや入力内容を切り替えていても
   進捗(何項目済みか)が常に見える場所として、同じ集計をもう一箇所だけ
   ごく小さく複製する。 */
function headProgressHtml(p){
 const pct=p.activeCount?Math.round(p.doneCount/p.activeCount*100):0;
 const cls=pct>=100?'done':pct>0?'part':'todo';
 return `<span class="measure-head-progress-label">進捗</span>`
  +`<span class="measure-head-progress-bar measure-head-progress-bar--${cls}"><i style="width:${pct}%"></i></span>`
  +`<span class="measure-head-progress-frac">${p.doneCount}/${p.activeCount}</span>`;
}

function refreshMeasureProgress(){
 const m=S.measure;if(!m)return;
 const chipBox=$('#measureTypeChips'),select=$('#measureType');
 const p=progressOf(m);if(!p)return;
 if(chipBox&&select){
  chipBox.innerHTML=chipsHtml(p);
  chipBox.hidden=false;
  /* 元の<select>は display:none にせず、視覚的にだけ隠して操作可能なまま
     残す。キーボード操作・支援技術・既存の自動テストが #measureType を
     そのまま扱えるようにするため(display:none にすると操作できなくなる)。 */
  select.classList.add('visually-hidden-control');
  select.closest('label')?.classList.add('major-list--chips');
 }
 const rail=$('#railProgress');
 if(rail)rail.innerHTML=railHtml(p,m);
 const head=$('#headProgress');
 if(head)head.innerHTML=headProgressHtml(p);
}

/* ---------- 対象外の切替 ---------- */

/* 同じ用途コードで完了済みのデータのうち、その項目が測定されている割合。
   必要な測定項目は材質・用途・規格で変わるため機械判定はしないが、対象外に
   しようとしたときだけ実績を示して確認する。 */
async function pastUsage(itemName){
 const m=S.measure,code=String(m?.basic?.purposeCode||'').trim();
 if(!code||typeof reliableAll!=='function')return null;
 let all;
 try{all=await reliableAll()}catch(e){return null}
 const def=ITEM_DEFS.find(d=>d.name===itemName);if(!def)return null;
 const peers=all.filter(x=>x&&x.status==='完了'&&x.id!==m.id&&String(x.basic?.purposeCode||'').trim()===code);
 if(!peers.length)return null;
 const measured=peers.filter(x=>{
  try{return itemProgress(x,def).filled>0}catch(e){return false}
 }).length;
 return{code,total:peers.length,measured,pct:Math.round(measured/peers.length*100)};
}

async function toggleExcluded(name){
 const m=S.measure;if(!m)return;
 const sc=measureScopeOf(m),at=sc.excluded.indexOf(name);
 if(at>=0){
  sc.excluded.splice(at,1);
 }else{
  const p=itemProgress(m,ITEM_DEFS.find(d=>d.name===name));
  if(p.filled>0){
   showToast?.('対象外にできません',`「${name}」は既に ${p.filled}件 入力されています。入力を消してから対象外にしてください。`,5000);
   return;
  }
  const usage=await pastUsage(name);
  const lines=[`「${name}」を対象外にします。`,''];
  if(usage)lines.push(`用途コード ${usage.code} の完了データ ${usage.total}件のうち、`
   +`${usage.measured}件(${usage.pct}%)でこの項目が測定されています。`,'');
  else lines.push('同じ用途コードの完了データがまだ無いため、過去の実績は表示できません。','');
  lines.push('対象外にすると、完了時の未測定の確認から外れます。','','よろしいですか？');
  if(!confirm(lines.join('\n')))return;
  sc.excluded.push(name);
 }
 sc.decidedAt=new Date().toISOString();sc.decidedBy='manual';
 if(typeof markDirty==='function')markDirty();
 refreshMeasureProgress();
}

/* ---------- 結線 ---------- */

document.addEventListener('click',e=>{
 const chip=e.target.closest?.('[data-type-chip]');if(!chip)return;
 e.preventDefault();
 const select=$('#measureType');if(!select)return;
 select.value=chip.dataset.typeChip;
 select.dispatchEvent(new Event('change',{bubbles:true}));
 refreshMeasureProgress();
});
document.addEventListener('contextmenu',e=>{
 const chip=e.target.closest?.('[data-type-chip]');if(!chip)return;
 e.preventDefault();
 toggleExcluded(chip.dataset.typeChip);
});

/* 入力・描画のたびに呼ばれる updateValidationVisuals に相乗りして更新する。 */
const baseUpdateValidationVisuals=typeof updateValidationVisuals==='function'?updateValidationVisuals:null;
if(baseUpdateValidationVisuals){
 updateValidationVisuals=function(){
  const result=baseUpdateValidationVisuals.apply(this,arguments);
  try{refreshMeasureProgress()}catch(e){console.warn('measure progress refresh failed',e)}
  return result;
 };
 window.updateValidationVisuals=updateValidationVisuals;
}

/* 完了時、全項目・全丈位置と作業時間をまとめて確認する。必要な測定項目は
   製品によって変わるため、ここでブロックはせず「意図的に飛ばすのか」を
   確認して続行できるようにする。 */
function completionReview(){
 const m=S.measure;if(!m)return null;
 const p=progressOf(m);if(!p)return null;
 const notes=[];
 p.unmeasured.forEach(x=>{
  notes.push(`・${x.name}（${x.state==='todo'?'未入力':`${x.filled}/${x.total} 入力`}）`);
 });
 const wt=m.workTime||{};
 if(!wt.startAt||!wt.endAt)notes.push(`・作業時間（${!wt.startAt&&!wt.endAt?'開始・終了とも未記録':!wt.startAt?'開始が未記録':'終了が未記録'}）`);
 return{progress:p,notes};
}
const basePersistAndTransition=typeof persistAndTransition==='function'?persistAndTransition:null;
if(basePersistAndTransition){
 persistAndTransition=function(status){
  if(status==='完了'){
   /* 公差外・オペレータ/検査員の未選択は records-store 側で止まる。確認を
      出してから止めると二度手間になるため、その場合は確認を出さず委ねる。 */
   try{
    const v=updateValidationVisuals();
    const identity=v.missing.filter(x=>x.el&&(x.el.id==='operator'||x.el.id==='inspector'));
    if(v.ng.length||identity.length)return basePersistAndTransition.apply(this,arguments);
   }catch(e){console.warn('completion precheck failed',e)}
   let review=null;
   try{review=completionReview()}catch(e){console.warn('completion review failed',e)}
   if(review&&review.notes.length){
    const skipped=review.progress.items.filter(x=>x.excluded).map(x=>x.name);
    const text=['測定していない項目があります。','',...review.notes,'',
     skipped.length?`対象外に設定した項目: ${skipped.join('、')}`:'',
     'このまま完了として登録しますか？'].filter(x=>x!=='').join('\n');
    if(!confirm(text))return Promise.resolve();
   }
  }
  return basePersistAndTransition.apply(this,arguments);
 };
 window.persistAndTransition=persistAndTransition;
}

window.measureProgress=measureProgress;
window.refreshMeasureProgress=refreshMeasureProgress;
window.measureCompletionReview=completionReview;
window.toggleMeasureExcluded=toggleExcluded;
window.measureItemNames=()=>ITEM_DEFS.map(d=>d.name);

})();
