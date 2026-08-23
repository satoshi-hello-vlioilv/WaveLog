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
     material = 母材(ロットに1つ) ＋ 丈ごと(縦割りした丈 … m.product.rows)。
                **1つの項目**にまとめてある(§9.160、利用者の指示)。どちらも
                測定器を使わない手入力で、同じ1枚のパネルに並ぶ。
     length   = 丈位置(頭/尾)ごと × 条ごと (m.measurements[key][丈位置][条]) */
const ITEM_DEFS=[
 {name:WL.measureItem.MATERIAL, scope:'material'},
 /* 板厚と板幅は**枠の数がまるで違う**ので別々の項目にした(§9.138)。
    板厚は丈ごとに3点(エッジOS・中央CL・エッジDS)、板幅は条ごと。
    1つの項目のままだと進捗が「3+条数」の合算になり、板幅だけ終わって
    いるのか板厚だけ終わっているのかが数字から読めなかった。 */
 {name:'板厚',          scope:'length',keys:['thickness']},
 {name:'板幅',          scope:'length',keys:['width']},
 {name:'ラテラルボー',   scope:'length',keys:['lateral']},
 {name:'バリ',          scope:'length',keys:['burr']},
 {name:'テレスコープ',   scope:'length',keys:['telescope']},
 {name:'巻ずれ',        scope:'length',keys:['offset']},
 {name:'フラットネス',   scope:'length',keys:['flatness']},
];
/* 母材パネルの入力欄(data-mother)。**マスタで外した欄は数えない**（§9.232）
   ——数えると「どう頑張っても埋まらない1件」が残る（§9.227 ③と同じ罠）。
   ここに並べてあるのは**まだマスタが読めていないとき**の受け皿で、
   §9.232より前の8欄と同じ（黙って0件にすると進捗が消える）。 */
const MOTHER_FIELDS_FALLBACK=['manual','fullLength','minCard','maxCard','front','rear','frontCard','rearCard'];
const motherFields=()=>((window.WL&&WL.opData&&WL.opData.motherKeys&&WL.opData.motherKeys())
                        ||MOTHER_FIELDS_FALLBACK);
/* 揃い/肉厚/長さ で1丈を「入力済み」とみなす項目。**定義は1箇所**
   （`measurement-view.js`の`PRODUCT_FILLED_KEYS`）——2つ持つと、項目を
   足したときに片方だけ直った状態が作れる。§9.203で4桁の揃いコードを
   廃止したので、`alignmentCode`だけを見ると新しく入力した行が1件も
   数えられない（旧データのために残してある）。
   **読むのは呼ばれたとき**——読み込み順に依存しないようにする。 */
const productFilledKeys=()=>PRODUCT_FILLED_KEYS;

const filled=v=>String(v??'').trim()!=='';

function measureScopeOf(m){
 if(!m)return{excluded:[]};
 m.settings=m.settings||{};
 const s=m.settings.measureScope;
 if(!s||!Array.isArray(s.excluded))m.settings.measureScope={excluded:[],decidedAt:'',decidedBy:''};
 /* 保存済みレコードの「対象外」は旧名(母材／揃い/肉厚/長さ)で入っている。
    項目名で照合するので、**読んだ時点で今の名前へ寄せる**(§9.160)。
    寄せないと、対象外にしたはずの項目が未測定として数え直される。 */
 const list=m.settings.measureScope.excluded;
 const healed=[...new Set(list.map(x=>WL.measureItem.normalize(x)))];
 if(healed.length!==list.length||healed.some((x,i)=>x!==list[i]))
  m.settings.measureScope.excluded=healed;
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
 if(def.scope==='material'){
  /* 母材8欄＋丈N本。**合算して1つの進捗にする**——同じ面に並ぶので、
     片方だけ済みという状態を別々の数で出しても読む側の手数が増える。 */
  const mother=m.mother||{};
  const rows=(m.product&&Array.isArray(m.product.rows))?m.product.rows:[];
  const pieces=Array.from({length:c.vertical},(_,i)=>rows[i])
   .filter(r=>productFilledKeys().some(k=>filled(r&&r[k]))).length;
  const fields=motherFields();
  out.total=fields.length+c.vertical;
  out.filled=fields.filter(k=>filled(mother[k])).length+pieces;
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

/* ---------- 公差外の集計（§9.125） ----------
   **画面ではなくデータから数える。** `updateValidationVisuals()`が見るのは
   いま描かれているグリッドだけなので、別の丈位置・別の項目にある公差外は
   完了を押すまで誰も気づけない（進捗を全項目から数えているのと同じ理由）。
   判定式は`judgeInput`と同じ——値があって数として読めて、公差の外なら1件。
   公差が引けない項目は**判定しない**（「公差が無い＝合格」ではないので、
   合格として数えない）。フラットネスは〇/△/×なので対象外。 */
const NG_DEFS=ITEM_DEFS.filter(d=>d.scope==='length'&&d.name!=='フラットネス');
function outOfToleranceOf(m){
 if(!m||typeof toleranceDetail!=='function')return null;
 const excluded=new Set(measureScopeOf(m).excluded),c=countsOf(m),items=[],unjudged=[];
 let total=0;
 NG_DEFS.forEach(def=>{
  if(excluded.has(def.name))return;
  const hits=[];let judged=false,filledAny=false;
  def.keys.forEach(key=>{
   let range=null;
   /* **項目名を渡す。** 渡さないと画面でいま選ばれている項目の公差が
      全項目に当たる（ラッパーが`#measureType`を見るため）。 */
   try{range=toleranceDetail(key==='thickness'?'thickness':'width',0,def.name)?.range||null}catch(e){}
   if(range)judged=true;
   const rows=(m.measurements||{})[key]||[];
   for(let li=0;li<c.lengthSlots;li++){
    const row=rows[li]||[],n=key==='thickness'?3:c.horizontal;
    for(let j=0;j<n;j++){
     const raw=String(row[j]??'').trim();
     if(raw==='')continue;
     filledAny=true;
     if(!range)continue;
     const num=Number(raw);
     if(!Number.isFinite(num))continue;
     if(num<range[0]||num>range[1])hits.push({key,length:li,index:j,value:raw});
    }
   }
  });
  if(hits.length){items.push({name:def.name,hits});total+=hits.length}
  /* 公差そのものが無い項目（バリ・テレスコープ・巻ずれ等。マスタに
     プラス・マイナスが登録されていない）は**「合格」に混ぜない**。
     値の件数ではなく項目名で言う——件数だと測るたびに増えて読まれなくなる。 */
  if(filledAny&&!judged)unjudged.push(def.name);
 });
 return{total,items,unjudged};
}

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

/* ヘッダーのミニ進捗バーは**廃止した**（§9.147、利用者の指示「役に立って
   いないので削除」）。割合しか言わないバーで、正確な数は段ナビ（`1/9 項目`）
   と③の完了前の確認が持っている——**同じことを別の表現でもう一度言うだけ**
   で、しかも粗い方が上に居た。`headProgressHtml()`も残さない（使われない
   組み立てが残ると、次に読む人が「どこかで使っているはず」と探す）。 */
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
 /* 操作レールの進捗ブロックは廃止した（§9.129）。同じ数字がヘッダー・
    段ナビ・ここの3箇所に出ており、③には完了前の確認表、②には丈位置
    くらべができて、レール側が担っていたものはすべて別の場所にある。
    `railHtml()`は残さない——使われない組み立てが残ると、次に読む人が
    「どこかで使っているはず」と探すことになる。 */
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

/* 新しく公開するものは名前空間へ入れる（素の`window.*`は上限固定）。 */
WL.measureReview={
 progress:()=>progressOf(S.measure),
 outOfTolerance:()=>outOfToleranceOf(S.measure),
 review:completionReview,
};

window.measureProgress=measureProgress;
window.refreshMeasureProgress=refreshMeasureProgress;
window.measureCompletionReview=completionReview;
window.toggleMeasureExcluded=toggleExcluded;
window.measureItemNames=()=>ITEM_DEFS.map(d=>d.name);

})();
