"use strict";
/* measurement-view.js: 測定画面の構成 — データ形状(ensureMeasureShape/collect)、
   画面全体の描画(renderMeasurement)、左右パネル、入力検証、作業時間、公差表示の見出し。 */
function blankMeasure(row){return{id:crypto.randomUUID(),status:'編集中',updatedAt:new Date().toISOString(),source:row,basic:Object.fromEntries(Object.keys(aliases).map(k=>[k,pick(row,k)])),settings:{operator:'-',inspector:'-',lengthPos:'1(頭)',measureType:'母材',verticalCount:1,horizontalCount:1,unwind:'上出し',innerDiameter:'-',spool:'-',thicknessGauge:'-',widthGauge:'-',widthOrder:'通常',widthDirection:'昇順',inputMode:'auto',tStep:0,wStep:0,burrFirst:null,ngCount:0,burr:'指定なし',innerTape:false,crewSize:'-'},mother:{},qualityInfo:'異常情報なし',measurements:{thickness:Array.from({length:LENGTH_SLOTS},()=>Array(3).fill('')),width:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),lateral:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),burr:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),telescope:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),offset:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),flatness:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),comments:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill(''))}}}
/* 保存データ/新規データを最新スキーマへ整形する。旧実装は多層ラップ
   (基本形状→製品丈→登録設備→作業時間)だったものを一本化した。 */
function ensureMeasureShape(m){
 if(!m)return m;
 {
m.basic=m.basic||{};m.settings={operator:'-',inspector:'-',lengthPos:'1(頭)',measureType:'母材',verticalCount:1,horizontalCount:1,unwind:'上出し',innerDiameter:'-',spool:'-',thicknessGauge:'-',widthGauge:'-',widthOrder:'通常',widthDirection:'昇順',inputMode:'auto',tStep:0,wStep:0,burrFirst:null,ngCount:0,burr:'指定なし',innerTape:false,...(m.settings||{})};m.mother=m.mother||{};m.qualityInfo=m.qualityInfo||'異常情報なし';m.measurements=m.measurements||{};const shape=(name,width)=>{const src=Array.isArray(m.measurements[name])?m.measurements[name]:[];m.measurements[name]=Array.from({length:LENGTH_SLOTS},(_,i)=>Array.from({length:width},(_,j)=>src[i]?.[j]??''))};shape('thickness',3);['width','lateral','burr','telescope','offset','flatness','comments'].forEach(k=>shape(k,40));
 }
 {
 if(!m.product||!Array.isArray(m.product.rows)){
  const legacy=m.product&&typeof m.product==='object'?m.product:null;
  m.product={rows:Array.from({length:LENGTH_SLOTS},blankProductRow)};
  if(legacy&&(legacy.productLength||legacy.wallThickness||legacy.alignmentCode)){
   Object.assign(m.product.rows[0],{productLength:legacy.productLength||'',wallThickness:legacy.wallThickness||'',alignmentCode:legacy.alignmentCode||'',edgeShape:legacy.edgeShape||'',occurrencePosition:legacy.occurrencePosition||'',regularity:legacy.regularity||'',pitch:legacy.pitch||'',alignmentValue:legacy.alignmentValue||''});
  }
 }else if(m.product.rows.length<LENGTH_SLOTS){
  while(m.product.rows.length<LENGTH_SLOTS)m.product.rows.push(blankProductRow());
 }
 }
 m.settings.registeredEquipment=m.settings.registeredEquipment||m.registeredEquipment||m.snapshot?.registeredEquipment||'';
 m.workTime={startAt:'',endAt:'',...(m.workTime||{})};
 return m;
}
/* 画面の入力値をS.measureへ回収する。設定→母材→製品丈→登録設備→作業時間の順。 */
function collect(){
 const m=S.measure;m.updatedAt=new Date().toISOString();['operator','inspector','lengthPos','measureType','verticalCount','horizontalCount','unwind','innerDiameter','spool','thicknessGauge','widthGauge','widthOrder','widthDirection','crewSize'].forEach(k=>{const el=$('#'+k);if(el)m.settings[k]=el.value});m.settings.burr=document.querySelector('[name=burr]:checked')?.value||'';m.settings.innerTape=$('#innerTape').checked;m.qualityInfo=$('#qualityInfo').value;document.querySelectorAll('[data-mother]').forEach(x=>m.mother[x.dataset.mother]=x.value);saveFlatComment();
 m.product=m.product&&Array.isArray(m.product.rows)?m.product:{rows:Array.from({length:LENGTH_SLOTS},blankProductRow)};
 document.querySelectorAll('#productRowsBody tr').forEach(tr=>{
  const i=+tr.dataset.row,row=m.product.rows[i]=m.product.rows[i]||blankProductRow();
  tr.querySelectorAll('[data-product-field]').forEach(el=>row[el.dataset.productField]=el.value);
 });
 {const equipment=currentConfiguredEquipment();m.settings=m.settings||{};m.settings.registeredEquipment=equipment;m.registeredEquipment=equipment;m.snapshot=m.snapshot||{};m.snapshot.registeredEquipment=equipment}
 m.workTime=m.workTime||{};m.workTime.startAt=$('#workStartAt')?.dataset.iso||m.workTime.startAt||'';m.workTime.endAt=$('#workEndAt')?.dataset.iso||m.workTime.endAt||'';
 return m;
}
function activateWorkspace(name){document.querySelectorAll('[data-worktab]').forEach(b=>b.classList.toggle('active',b.dataset.worktab===name));document.querySelectorAll('[data-workpanel]').forEach(p=>p.hidden=p.dataset.workpanel!==name)}
/* 丈位置・条数のセレクト内容とフラットネス備考の入出力。 */
function updateLengthOptions(count){const el=$('#lengthPos');if(!el)return;const current=el.value||S.measure?.settings?.lengthPos||'1(頭)',n=Math.max(1,Math.min(9,+count||1)),values=[];for(let i=1;i<=n;i++)values.push(`${i}(頭)`);values.push(`${n}(尾)`);el.innerHTML=[...new Set(values)].map(v=>`<option>${v}</option>`).join('');el.value=[...el.options].some(o=>o.value===current)?current:values[0]}
function updateCoilOptions(count){const el=$('#coilNo');if(!el)return;const n=Math.max(1,Math.min(40,+count||1)),current=+el.value||1;el.innerHTML=Array.from({length:n},(_,i)=>`<option value="${i+1}">${i+1}条</option>`).join('');el.value=Math.min(current,n);loadFlatComment()}
/* v35: フラットネスは入力内容(measureType)の一項目として、巻ずれ・テレスコープと
   同じ条グリッドで判定記号(〇/△/×)を入力する形に変更。備考のみ対象条を選んで
   入力するミニパネルとして残す（#coilNo/#coilCommentはフラットネス選択時のみ
   動的に生成されるため、両関数とも要素が無ければ何もしない）。 */
function saveFlatComment(){if(!S.measure||!$('#coilNo'))return;const i=(+$('#coilNo').value||1)-1,j=lengthIndex();S.measure.measurements.comments[j][i]=String($('#coilComment').value||'').replace(/[;|]/g,'')}
function loadFlatComment(){if(!S.measure||!$('#coilNo'))return;const i=(+$('#coilNo').value||1)-1,j=lengthIndex();$('#coilComment').value=S.measure.measurements.comments[j][i]||''}
function rightLayoutFor(type){
 if(type==='母材')return 'mother';
 if(type==='揃い/肉厚/長さ')return 'product';
 return 'measure';
}
function applyRightLayout(){
 if(!S.measure)return;
 const type=$('#measureType').value, layout=rightLayoutFor(type), pane=$('.right-pane');
 pane.classList.remove('layout-mother','layout-measure','layout-product');
 pane.classList.add('layout-'+layout); activateWorkspace(layout);
 if(layout==='measure'){renderMeasureGrid();updateMeasurementHeading()}
 if(layout==='product')renderProductPanel();
 if(layout==='mother'&&$('#motherQualityInfo'))$('#motherQualityInfo').value=S.measure.qualityInfo||'異常情報なし';
 const summary=$('#toleranceSummary');if(summary&&$('#measureType')?.value==='板厚/板幅')summary.hidden=true;
}
/* v33: 「揃い/肉厚/長さ」は縦割数で分割した丈(1〜N)ごとに複数行で保持する。
   丈は旧VBA帳票の「丈」テーブル（長さ/肉厚/揃い/外観/備考）と同じ、
   丈=最終的に分割された各ピースを指す1..N連番（頭/尾のサンプリング位置とは無関係）。
   v34: 横スクロールが出る横並び表は廃止し、丈番号タブ+縦並びフォームに変更。
   検証(activeRequiredControls)は全丈分のDOM要素を必要とするため、非表示の
   互換テーブル(#productRowsBody)は残し、可視フォームの入力と値を同期させる。 */
let productActiveLen=1;
function blankProductRow(){return{productLength:'',wallThickness:'',alignmentCode:'',edgeShape:'',occurrencePosition:'',regularity:'',pitch:'',alignmentValue:'',note:''}}
function productRowCount(){return Math.max(1,Math.min(9,+$('#verticalCount')?.value||1))}
function judgeAlignmentCode(code){code=String(code||'').trim();if(!code)return '';return code==='0000'?'OK':'NG'}
function updateProductStatus(){
 const m=S.measure;if(!m?.product?.rows)return;
 const n=productRowCount(),filled=m.product.rows.slice(0,n).filter(r=>['productLength','wallThickness','alignmentCode'].some(k=>String(r?.[k]||'').trim()!=='')).length;
 if($('#productMeasureStatus'))$('#productMeasureStatus').textContent=filled?`入力済み ${filled}/${n}丈`:'入力待ち';
}
function productRowFilled(r){return ['productLength','wallThickness','alignmentCode'].some(k=>String(r?.[k]||'').trim()!=='')}
function renderProductPanel(){
 const m=S.measure;const body=$('#productRowsBody'),tabs=$('#productLengthTabs'),fields=$('#productLengthFields');
 if(!body||!tabs||!fields||!m)return;
 if(!m.product||!Array.isArray(m.product.rows))m.product={rows:Array.from({length:LENGTH_SLOTS},blankProductRow)};
 const n=productRowCount();
 if(productActiveLen>n)productActiveLen=n;
 if(productActiveLen<1)productActiveLen=1;
 /* 検証(activeRequiredControls)が丈ごとのDOM要素を必要とするため、非表示のまま
    互換テーブルは保持し、可視フォームの入力をここにも反映させる。 */
 body.innerHTML=Array.from({length:n},(_,i)=>{
  const r=m.product.rows[i]||(m.product.rows[i]=blankProductRow());
  const field=(key,type)=>`<input data-product-field="${key}" value="${esc(r[key]||'')}" type="${type||'text'}"${type==='number'?' inputmode="decimal" step="any"':''}>`;
  return `<tr data-row="${i}"><th>${i+1}</th><td>${field('productLength','number')}</td><td>${field('wallThickness','number')}</td><td>${field('alignmentCode')}</td><td>${field('edgeShape')}</td><td>${field('occurrencePosition')}</td><td>${field('regularity')}</td><td>${field('pitch','number')}</td><td>${field('alignmentValue')}</td><td>${field('note')}</td></tr>`;
 }).join('');

 /* 丈番号タブ: 選択中の丈を強調し、必須3項目(長さ/肉厚/揃いコード)が
    入力済みの丈にはドットを表示して一覧性を確保する（横スクロール回避）。 */
 tabs.innerHTML=Array.from({length:n},(_,i)=>`<button type="button" data-len="${i+1}" class="${i+1===productActiveLen?'active ':''}${productRowFilled(m.product.rows[i])?'filled':''}">${i+1}</button>`).join('');
 tabs.querySelectorAll('button').forEach(b=>b.onclick=()=>{productActiveLen=+b.dataset.len;renderProductPanel()});

 const i=productActiveLen-1,r=m.product.rows[i]=m.product.rows[i]||blankProductRow(),judge=judgeAlignmentCode(r.alignmentCode);
 const field=(key,label,type,wide)=>`<label${wide?' class="wide"':''}>${esc(label)}<input data-product-field="${key}" value="${esc(r[key]||'')}" type="${type||'text'}"${type==='number'?' inputmode="decimal" step="any"':''}></label>`;
 fields.innerHTML=field('productLength','長さ','number')+field('wallThickness','肉厚','number')
  +`<label>揃いコード<input data-product-field="alignmentCode" value="${esc(r.alignmentCode||'')}"></label>`
  +`<label>判定<span class="product-judge${judge==='OK'?' ok':judge==='NG'?' ng':''}" id="productJudgeBadge">${esc(judge)}</span></label>`
  +field('edgeShape','1桁目 エッジ形状')+field('occurrencePosition','2桁目 発生位置')+field('regularity','3桁目 規則性')
  +field('pitch','ピッチ','number')+field('alignmentValue','4桁目 値')+field('note','備考','text',true);
 fields.querySelectorAll('[data-product-field]').forEach(el=>{
  el.oninput=()=>{
   const key=el.dataset.productField,row=m.product.rows[i]=m.product.rows[i]||blankProductRow();row[key]=el.value;
   const shadow=body.querySelector(`tr[data-row="${i}"] [data-product-field="${key}"]`);if(shadow)shadow.value=el.value;
   if(key==='alignmentCode'){const j=judgeAlignmentCode(el.value),badge=$('#productJudgeBadge');if(badge){badge.textContent=j;badge.className='product-judge'+(j==='OK'?' ok':j==='NG'?' ng':'')}}
   if(key==='productLength'||key==='wallThickness'||key==='alignmentCode'){const tabBtn=tabs.querySelector(`button[data-len="${i+1}"]`);if(tabBtn)tabBtn.classList.toggle('filled',productRowFilled(row))}
   markDirty();updateProductStatus();
  };
 });
 upgradeManualInputTypes();updateProductStatus();
 loadFlatComment(); applyInputProtection();
}
if($('#productAllOk'))$('#productAllOk').onclick=()=>{
 const n=productRowCount();
 for(let i=0;i<n;i++){const row=S.measure.product.rows[i]=S.measure.product.rows[i]||blankProductRow();Object.assign(row,{alignmentCode:'0000',edgeShape:'0',occurrencePosition:'0',regularity:'0',alignmentValue:'0'})}
 renderProductPanel();markDirty();
};
$('#verticalCount')?.addEventListener('change',()=>{if($('#measureType').value==='揃い/肉厚/長さ')renderProductPanel()});
/* 測定種ごとに運用が固定されているため、入力モードの切替UI自体を出さない。
   - 板厚/板幅・バリ: 測定器からの自動転送のみ。
   - ラテラルボー・テレスコープ・巻ずれ・フラットネス: 実運用は手動入力のみ
     (対応する自動転送デバイスがないため)。伝送状態欄(受信欄・検知回数等)
     も自動転送を前提にした表示のため、手動固定の測定種では丸ごと隠す。 */
/* 設定系入力の変更はすべて未保存フラグを立てる(個別のonchangeを持つ要素は
   この後の個別割当が優先される。この行は必ず個別割当より先に実行すること)。 */
document.querySelectorAll('.selectors input,.selectors select,.material-grid input').forEach(x=>x.onchange=markDirty);
const AUTO_ONLY_MEASURE_TYPES={'板厚/板幅':1,'バリ':1};
const MANUAL_ONLY_MEASURE_TYPES={'ラテラルボー':1,'テレスコープ':1,'巻ずれ':1,'フラットネス':1};
function syncInputModeLock(){
 if(!S.measure)return;
 const type=$('#measureType')?.value,tabs=$('.mode-tabs'),statusBox=$('#inputStatusBox');
 const forceAuto=!!AUTO_ONLY_MEASURE_TYPES[type],forceManual=!!MANUAL_ONLY_MEASURE_TYPES[type];
 if(tabs)tabs.hidden=forceAuto||forceManual;
 if(statusBox)statusBox.hidden=forceManual;
 const desiredMode=forceAuto?'auto':forceManual?'manual':null;
 if(desiredMode&&S.measure.settings.inputMode!==desiredMode){
  S.measure.settings.inputMode=desiredMode;
  document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x.dataset.mode===desiredMode));
  applyInputProtection();
  updateReceiveState(document.activeElement===$('#deviceInput'));
 }
}
$('#measureType').onchange=()=>{S.measure.settings.wStep=0;S.measure.settings.tStep=0;S.measure.settings.burrFirst=null;S.measure.settings.measureType=$('#measureType').value;applyRightLayout();syncInputModeLock();$('#deviceInput').focus();markDirty()};
/* 測定画面全体の再描画。旧実装は9層のラップ(モード表示→製品丈→検証→
   基本情報→公差セレクタ→コース→作業時間→タブ初期化)だったものを、
   実行順を保ったまま一本の関数へ整理した。 */
function renderMeasurement(){
 hydrateBusinessFields();
 productActiveLen=1;
 measureDirty=false;const m=S.measure,b=m.basic;updateLengthOptions(m.settings.verticalCount||1);updateCoilOptions(m.settings.horizontalCount||1);$('#modalEquipment').textContent=b.equipment;const fields=[['ロット№','lotNo'],['検査No.','inspectionNo'],['オーダーNo.','orderNo'],['引当No.','allocationNo'],['鋳造No.','castingNo'],['用途コード','purposeCode'],['用途名','purposeName'],['取引先','customer'],['納入先','delivery'],['実績コース','course']];let h='<div class="info-grid">'+fields.map(([l,k])=>k==='lotNo'?`<div class="field"><label>${l}</label><button type="button" class="lot-dsp-link" title="クリックでLotDspをこのロット番号で開きます">${esc(b[k])||'—'}</button></div>`:`<div class="field ${['customer','delivery','course'].includes(k)?'full':''}"><label>${l}</label><output title="${esc(b[k])}">${esc(b[k])}</output></div>`).join('');h+=`<div class="dimension"><b></b><b>材質</b><b>調質</b><b>板厚</b><b>板幅</b><b>板丈</b><b>オーダー</b><span>${esc(b.orderMaterial)}</span><span>${esc(b.orderTemper)}</span><span>${esc(fmtDim(b.orderThickness,3))}</span><span>${esc(fmtDim(b.orderWidth,1))}</span><span>${esc(fmtDim(b.orderLength,1))}</span><b>製造</b><span>${esc(b.mfgMaterial)}</span><span>${esc(b.mfgTemper)}</span><span>${esc(fmtDim(b.mfgThickness,3))}</span><span>${esc(fmtDim(b.mfgWidth,1))}</span><span>${esc(fmtDim(b.mfgLength,1))}</span></div></div>`;$('#basicInfo').innerHTML=h;Object.entries(m.settings).forEach(([k,v])=>{const el=$('#'+k);if(el){if(el.type==='checkbox')el.checked=v;else el.value=v}});$('#qualityInfo').value=m.qualityInfo;document.querySelectorAll('[data-mother]').forEach(x=>x.value=m.mother[x.dataset.mother]||'');$('#motherOriginalWidth').textContent=fmtDim(b.originalWidth,1)||'－';document.querySelectorAll('[name=burr]').forEach(x=>x.checked=x.value===m.settings.burr);renderMeasureGrid();renderStats();setState('IndexedDB読込済み')
 {const mode=S.measure.settings.inputMode||'auto';document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x.dataset.mode===mode))}
 activateWorkspace($('#measureType').value==='母材'?'mother':'measure');
 applyInputProtection();
 updateReceiveState(document.activeElement===$('#deviceInput'));
 renderProductPanel();
 applyRightLayout();
 requestAnimationFrame(updateValidationVisuals);
 upgradeManualInputTypes();
 renderQualityGradePanel();
 bindInfoTabs();
 renderDataManagementPanel();
 renderResidualCourseEverywhere();
 renderCourseHierarchy();
 configureToleranceSelector();
 document.querySelectorAll('[data-lefttab]').forEach(x=>x.classList.toggle('active',x.dataset.lefttab==='worktime'));
 document.querySelectorAll('[data-leftpanel]').forEach(x=>x.hidden=x.dataset.leftpanel!=='worktime');
 updateWorkTimePanel();
 updateMeasurementHeading();
}
// Unified required/valid/NG visual language.
function hasValue(el){return String(el?.value??'').trim()!==''&&String(el?.value??'').trim()!=='-'}
function setVisualState(el,state){
 if(!el)return;el.classList.remove('validation-required','validation-valid','validation-ng');
 el.classList.add(state==='ng'?'validation-ng':state==='valid'?'validation-valid':'validation-required');
 el.setAttribute('aria-invalid',state==='valid'?'false':'true');
}
function activeRequiredControls(){
 const controls=[];
 ['operator','inspector'].forEach(id=>controls.push({el:$('#'+id),label:id==='operator'?'オペレータ':'検査員'}));
 const type=$('#measureType')?.value;
 if(type==='母材'){
  document.querySelectorAll('[data-mother]').forEach((el,i)=>controls.push({el,label:['手計算','全長','MINカード指示','MAXカード指示','前オフ実績','後オフ実績','前オフカード指示','後オフカード指示'][i]||'母材'}));
 }else if(type==='揃い/肉厚/長さ'){
  const fieldLabels={productLength:'長さ',wallThickness:'肉厚',alignmentCode:'揃い'};
  document.querySelectorAll('#productRowsBody tr').forEach((tr,i)=>{
   tr.querySelectorAll('[data-product-field]').forEach(el=>{const label=fieldLabels[el.dataset.productField];if(label)controls.push({el,label:`${label}(丈${i+1})`})});
  });
 }else{
  document.querySelectorAll('#measurementGrid input[data-mkey]').forEach(el=>{if(!el.closest('.inactive'))controls.push({el,label:`測定値 ${Number(el.dataset.j)+1}`})});
 }
 return controls.filter(x=>x.el);
}
function updateValidationVisuals(){
 const required=activeRequiredControls(),requiredSet=new Set(required.map(x=>x.el));
 document.querySelectorAll('.validation-required,.validation-valid,.validation-ng').forEach(el=>{if(!requiredSet.has(el))el.classList.remove('validation-required','validation-valid','validation-ng')});
 required.forEach(({el})=>{
  if(el.classList.contains('ng'))setVisualState(el,'ng');
  else setVisualState(el,hasValue(el)?'valid':'required');
 });
 const missing=required.filter(({el})=>!hasValue(el)),ng=required.filter(({el})=>el.classList.contains('ng'));
 const button=$('#complete');if(button){button.classList.toggle('validation-blocked',missing.length>0||ng.length>0);button.title=missing.length?`未入力 ${missing.length}件`:ng.length?`公差外 ${ng.length}件`:'完了できます'}
 return{missing,ng};
}
function showValidationMessage(result){
 document.querySelectorAll('.validation-message').forEach(x=>x.remove());
 const target=$('.center-pane'),message=document.createElement('div');message.className='validation-message';
 const missingNames=[...new Set(result.missing.map(x=>x.label))];
 message.textContent=result.ng.length?`完了できません。未入力 ${result.missing.length}件、公差外 ${result.ng.length}件を確認してください。`:`完了できません。未入力項目を確認してください: ${missingNames.slice(0,6).join('、')}${missingNames.length>6?' ほか':''}`;
 target.prepend(message);result.missing[0]?.el?.focus();
}
function judgeInput(el,key,value,index){
 el.classList.remove('ng','complete');
 if(key==='flatness'){
  if(String(el.value||'').trim()!=='')el.classList.add('complete');
  return;
 }
 const raw=String(el.value??'').trim(),tol=toleranceFor(key==='thickness'?'thickness':'width',index),num=Number(raw);
 if(raw!==''&&Number.isFinite(num)){el.classList.add('complete');if(tol&&(num<tol[0]||num>tol[1]))el.classList.add('ng')}
}
document.addEventListener('input',event=>{if(event.target.matches('input,select,textarea'))updateValidationVisuals()},true);
document.addEventListener('change',event=>{if(event.target.matches('input,select,textarea'))updateValidationVisuals()},true);
// Information architecture: basic / quality grade / data management.
const qualityGradeFields=[
 ['生地外観',['生地外観','品質等級_生地外観','QCD1','RQCD1']],['フラットネス',['フラットネス等級','品質等級_フラットネス','QCD2','RQCD2']],
 ['付着油',['付着油','品質等級_付着油','QCD3','RQCD3']],['切断面',['切断面','品質等級_切断面','QCD4','RQCD4']],
 ['板厚公差',['板厚公差等級','品質等級_板厚公差','QCD5','RQCD5']],['幅丈公差',['幅丈公差','巾丈公差','品質等級_幅丈公差','QCD6','RQCD6']],
 ['ラテラルボー',['ラテラルボー等級','品質等級_ラテラルボー','QCD7','RQCD7']],['直角度',['直角度','品質等級_直角度','QCD8','RQCD8']],
 ['方向性',['方向性','品質等級_方向性','QCD9','RQCD9']],['強度',['強度','品質等級_強度','QCD10','RQCD10']],
 ['アルマイト',['アルマイト','品質等級_アルマイト','QCD11','RQCD11']],['表面処理',['表面処理','品質等級_表面処理','QCD15','RQCD15']]
];
function hydrateBusinessFields(){
 if(!S.measure)return;const b=S.measure.basic||(S.measure.basic={}),r=S.measure.source||S.measure.snapshot?.source||{};
 const extra={
  customer:['取引先','取引先名','得意先','得意先名','TOKUNA','TOKU_NA'],delivery:['納入先','納入先名','受渡先','NONNA','NON_NA'],
  course:['実績コース','実績設備コース','実績設備ｺｰｽ','設計コース','残仕掛設備コース','残仕掛設備ｺｰｽ','JBSMC','SBSMC','ZANMC'],
  orderNo:['オーダー番号','ｵｰﾀﾞｰ番号','受注番号','JUON','JUNO'],orderMaterial:['オーダー材質','ｵｰﾀﾞｰ材質','JUA'],orderTemper:['オーダー調質','ｵｰﾀﾞｰ調質','JUB'],
  orderThickness:['オーダー板厚','ｵｰﾀﾞｰ板厚','JUX'],orderWidth:['オーダー板幅','ｵｰﾀﾞｰ板幅','JUY'],orderLength:['オーダー板丈','ｵｰﾀﾞｰ板丈','JUZ']
 };
 Object.entries(extra).forEach(([k,names])=>{if(!b[k]){for(const n of names){if(r[n]!==undefined&&r[n]!==null&&String(r[n]).trim()!==''){b[k]=String(r[n]);break}}}})
 {const r=S.measure.source||S.measure.snapshot?.source||{};if(r['実績_設備ｺｰｽ']!==undefined&&r['実績_設備ｺｰｽ']!==null)S.measure.basic.course=String(r['実績_設備ｺｰｽ'])}
}
// Exact source fields requested by the operation database.
const QUALITY_GRADE_SOURCE={
 '生地外観':['品質ｸﾞﾚｰﾄﾞ_生地外観'],'フラットネス':['品質ｸﾞﾚｰﾄﾞ_ﾌﾗｯﾄﾈｽ','品質ｸﾞﾚｰﾄﾞ_フラットネス'],
 '付着油':['品質ｸﾞﾚｰﾄﾞ_付着油'],'切断面':['品質ｸﾞﾚｰﾄﾞ_切断面'],'板厚公差':['品質ｸﾞﾚｰﾄﾞ_板厚公差'],
 '幅丈公差':['品質ｸﾞﾚｰﾄﾞ_幅丈公差','品質ｸﾞﾚｰﾄﾞ_巾丈公差'],'ラテラルボー':['品質ｸﾞﾚｰﾄﾞ_ﾗﾃﾗﾙﾎﾞｰ','品質ｸﾞﾚｰﾄﾞ_ラテラルボー'],
 '直角度':['品質ｸﾞﾚｰﾄﾞ_直角度'],'方向性':['品質ｸﾞﾚｰﾄﾞ_方向性'],'強度':['品質ｸﾞﾚｰﾄﾞ_強度'],
 'アルマイト':['品質ｸﾞﾚｰﾄﾞ_ｱﾙﾏｲﾄ','品質ｸﾞﾚｰﾄﾞ_アルマイト'],'表面処理':['品質ｸﾞﾚｰﾄﾞ_表面処理']
};
function renderQualityGradePanel(){const panel=$('#qualityGradePanel');if(!panel)return;const m=S.measure;m.qualityGrades=m.qualityGrades||{};Object.entries(QUALITY_GRADE_SOURCE).forEach(([label,names])=>m.qualityGrades[label]=sourceValue(names));panel.innerHTML=`<div class="quality-grade-grid">${Object.keys(QUALITY_GRADE_SOURCE).map(label=>`<div class="quality-grade-item"><b>${esc(label)}</b><span title="${esc(m.qualityGrades[label]||'')}">${esc(m.qualityGrades[label]||'未設定')}</span></div>`).join('')}</div>`}
function renderDataManagementPanel(){
 const panel=$('#dataManagementPanel');if(!panel)return;hydrateBusinessFields();const b=S.measure.basic;
 const rows=[['取引先',b.customer],['納入先',b.delivery],['実績コース',b.course],['オーダー番号',b.orderNo],['オーダー材質',b.orderMaterial],['オーダー調質',b.orderTemper],['オーダー板厚',b.orderThickness],['オーダー板幅',b.orderWidth],['オーダー板丈',b.orderLength]];
 panel.innerHTML=`<div class="data-management-grid">${rows.map(([l,v])=>`<b>${esc(l)}</b><span title="${esc(v||'')}">${esc(v||'未設定')}</span>`).join('')}</div>`;
 {const panel=$('#dataManagementPanel'),r=S.measure?.source||S.measure?.snapshot?.source||{};
 if(!panel)return;const grid=panel.querySelector('.data-management-grid');if(!grid)return;
 const residual=Object.entries(r).find(([k])=>normalizedFieldName(k)===normalizedFieldName('残仕掛設備ｺｰｽ'))?.[1]??'';
 const children=[...grid.children],actualIndex=children.findIndex(x=>x.tagName==='B'&&x.textContent==='実績コース'),ref=actualIndex>=0?children[actualIndex+1]:null;
 const label=document.createElement('b');label.textContent='残コース';const value=document.createElement('span');value.textContent=String(residual||'未設定');value.title=String(residual||'');
 if(ref){ref.after(label,value)}else grid.append(label,value);
 }
}
function bindInfoTabs(){document.querySelectorAll('[data-infotab]').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('[data-infotab]').forEach(x=>x.classList.toggle('active',x===btn));document.querySelectorAll('[data-infopanel]').forEach(p=>p.hidden=p.dataset.infopanel!==btn.dataset.infotab)})}
function upgradeManualInputTypes(){
 document.querySelectorAll('input[data-mother],input[data-product-field]').forEach(el=>{
  if(el.type==='number'){
   el.step='any';
   el.inputMode='decimal';
   el.classList.add('numeric-input');
   el.classList.remove('text-input');
  }else{
   el.classList.add('text-input');
   el.classList.remove('numeric-input');
  }
 });
}
function renderResidualCourseEverywhere(){
 if(!S.measure)return;const residual=sourceField(['残仕掛設備ｺｰｽ','残仕掛設備コース']);S.measure.basic.residualCourse=residual;
 const basic=$('#basicInfo .info-grid');if(basic){basic.querySelectorAll('.residual-course-field').forEach(x=>x.remove());const course=[...basic.querySelectorAll('.field')].find(x=>x.querySelector('label')?.textContent==='実績コース');const item=document.createElement('div');item.className='field full residual-course-field';item.innerHTML=`<label>残コース</label><output title="${esc(residual)}">${esc(residual||'未設定')}</output>`;if(course)course.after(item);else basic.append(item)}
 const grid=$('#dataManagementPanel .data-management-grid');if(grid){[...grid.querySelectorAll('[data-residual-course]')].forEach(x=>x.remove());const children=[...grid.children],courseIndex=children.findIndex(x=>x.tagName==='B'&&x.textContent==='実績コース'),courseValue=courseIndex>=0?children[courseIndex+1]:null,label=document.createElement('b'),value=document.createElement('span');label.textContent='残コース';value.textContent=residual||'未設定';value.title=residual;label.dataset.residualCourse='1';value.dataset.residualCourse='1';if(courseValue)courseValue.after(label,value);else grid.append(label,value)}
}
/* 公差の内訳(基準値・±・計算式)を見出し領域へ表示する。 */
function updateMeasurementHeading(){
 const type=$('#measureType').value;$('#measurePanelTitle').textContent=type==='板厚/板幅'?'板厚・板幅測定':type+'測定';
 if(type==='フラットネス'){$('#toleranceSummary').innerHTML='<div class="tol-status no-data"><b>判定基準</b><span>〇＝OK　△・×＝NG　条ごとに記号を入力してください。</span></div>';return}
 const kind=type==='板厚/板幅'?'thickness':'width',detail=toleranceDetail(kind),base=Number(kind==='thickness'?S.measure.basic.mfgThickness:S.measure.basic.mfgWidth);
 if(!detail){$('#toleranceSummary').innerHTML='<div class="tol-status no-data"><b>公差情報なし</b><span>選択した公差区分に使用可能なプラス・マイナス値がありません。</span></div>';return}
 const labels={manufacturing:'製造公差',order:'オーダー公差',instruction:'指示公差'},sourceLabel=labels[detail.source],requestedLabel=labels[configuredToleranceSource()],fallback=detail.fallback?`${requestedLabel}が不足しているため製造公差を使用`:'';
 $('#toleranceSummary').innerHTML=`<div class="tol-source-row"><span class="tolerance-source-badge ${detail.source==='order'?'order':''}">${sourceLabel}</span>${fallback?`<span class="tol-fallback">${esc(fallback)}</span>`:''}</div><div class="tol-facts"><div><small>基準値</small><b>${base}</b></div><div><small>公差 ＋</small><b>+${detail.plus}</b><em>${esc(detail.plusKey)}</em></div><div><small>公差 －</small><b>-${detail.minus}</b><em>${esc(detail.minusKey)}</em></div><div class="tol-result"><small>判定範囲</small><b>${detail.range[0]} ～ ${detail.range[1]}</b></div></div><div class="tol-formula">計算: ${base} - ${detail.minus} = ${detail.range[0]} ／ ${base} + ${detail.plus} = ${detail.range[1]}</div>`;
}
// Design, actual and residual courses are rendered as one ordered information group.
function renderCourseHierarchy(){
 if(!S.measure)return;const design=designCourseValue(),actual=actualCourseValue(),residual=residualCourseValue();S.measure.basic.designCourse=design;S.measure.basic.course=actual;S.measure.basic.residualCourse=residual;
 const basic=$('#basicInfo .info-grid');if(basic){[...basic.querySelectorAll('.course-stack-field,.residual-course-field')].forEach(x=>x.remove());const old=[...basic.querySelectorAll('.field')].find(x=>x.querySelector('label')?.textContent==='実績コース');if(old)old.remove();const anchor=[...basic.querySelectorAll('.field')].find(x=>x.querySelector('label')?.textContent==='納入先');[['設計コース',design],['実績コース',actual],['残コース',residual]].forEach(([label,value],i)=>{const item=document.createElement('div');item.className='field full course-stack-field';item.innerHTML=`<label>${label}</label><output title="${esc(value)}">${esc(value||'未設定')}</output>`;if(anchor){const prior=[...basic.querySelectorAll('.course-stack-field')].at(-1);(prior||anchor).after(item)}else basic.append(item)})}
 const grid=$('#dataManagementPanel .data-management-grid');if(grid){const pairs=[];for(let i=0;i<grid.children.length;i+=2)pairs.push([grid.children[i]?.textContent,grid.children[i+1]?.textContent]);const keep=pairs.filter(([label])=>!['設計コース','実績コース','残コース'].includes(label));const insertAt=Math.max(0,keep.findIndex(([label])=>label==='オーダー番号'));keep.splice(insertAt,0,['設計コース',design||'未設定'],['実績コース',actual||'未設定'],['残コース',residual||'未設定']);grid.innerHTML=keep.map(([label,value])=>`<b>${esc(label||'')}</b><span title="${esc(value||'')}">${esc(value||'未設定')}</span>`).join('')}
 updateCourseGuard();
}
function configureToleranceSelector(){const el=$('#toleranceSource');if(!el||!S.measure)return;const type=$('#measureType').value,isDimensional=type==='板厚/板幅',order=el.querySelector('option[value="order"]'),availability=orderToleranceAvailability();order.disabled=!availability.available;order.textContent=availability.available?'オーダー公差':'オーダー公差（データなし）';order.classList.toggle('order-tolerance-unavailable',!availability.available);if(!availability.available&&S.measure.settings.toleranceSource==='order')S.measure.settings.toleranceSource='manufacturing';el.value=S.measure.settings.toleranceSource||'manufacturing';el.disabled=!isDimensional;el.title=isDimensional?(availability.available?'製造公差またはオーダー公差を選択できます':'オーダー公差がないため製造公差のみ使用できます'):'板厚・板幅以外は指示公差を自動適用します';el.onchange=()=>{if(el.value==='order'&&!availability.available)return;S.measure.settings.toleranceSource=el.value;renderMeasureGrid();updateMeasurementHeading();markDirty()}}
/* 作業時間パネル。開始→終了の順序を強制するロック付き打刻。 */
function formatWorkTime(value){if(!value)return '';const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function stampWorkTimeLocked(kind){if(!S.measure)return;S.measure.workTime=S.measure.workTime||{};const now=new Date();if(kind==='start'){if(S.measure.workTime.endAt){showToast('開始時刻は変更できません','終了時刻の記録後は開始時刻を変更できません。');return}S.measure.workTime.startAt=now.toISOString()}else{if(!S.measure.workTime.startAt){showToast('開始時刻が未記録です','先に開始時刻を記録してください。');return}if(now<new Date(S.measure.workTime.startAt)){showToast('終了時刻を記録できません','終了時刻は開始時刻より後である必要があります。');return}S.measure.workTime.endAt=now.toISOString()}updateWorkTimePanel();markDirty();updateValidationVisuals()}
function updateWorkTimePanel(){if(!S.measure)return;S.measure.workTime=S.measure.workTime||{startAt:'',endAt:''};const start=$('#workStartAt'),end=$('#workEndAt');if(!start||!end)return;start.dataset.iso=S.measure.workTime.startAt||'';end.dataset.iso=S.measure.workTime.endAt||'';start.value=formatWorkTime(start.dataset.iso);end.value=formatWorkTime(end.dataset.iso);$('#stampWorkStart').disabled=!!S.measure.workTime.startAt;$('#stampWorkEnd').disabled=!S.measure.workTime.startAt||!!S.measure.workTime.endAt;[[ $('#workStartCard'),start.dataset.iso],[ $('#workEndCard'),end.dataset.iso]].forEach(([card,value])=>{card?.classList.toggle('validation-required',!value);card?.classList.toggle('validation-valid',!!value)});$('#workDuration').textContent=S.measure.workTime.endAt?`実作業時間 ${formatDuration(durationMs(S.measure))}`:S.measure.workTime.startAt?'作業中':'未計測';$('#stampWorkStart').onclick=()=>stampWorkTimeLocked('start');$('#stampWorkEnd').onclick=()=>stampWorkTimeLocked('end')}
document.querySelectorAll('[data-worktab]').forEach(b=>b.onclick=()=>activateWorkspace(b.dataset.worktab));
bindTabs('left','left');
$('#reloadMaster').onclick=()=>loadMeasurementContext();
$('#verticalCount').addEventListener('change',()=>{updateLengthOptions($('#verticalCount').value);renderMeasureGrid()});
$('#horizontalCount').addEventListener('change',()=>{updateCoilOptions($('#horizontalCount').value);renderMeasureGrid()});
function lockCounts(){const has=Object.values(S.measure.measurements).some(a=>a.flat().some(v=>v!==''));$('#verticalCount').disabled=has;$('#horizontalCount').disabled=has}
