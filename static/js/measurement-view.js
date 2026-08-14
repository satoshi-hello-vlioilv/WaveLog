"use strict";
/* measurement-view.js: 測定画面の構成 — データ形状(ensureMeasureShape/collect)、
   画面全体の描画(renderMeasurement)、左右パネル、入力検証、作業時間、公差表示の見出し。 */
// 横割数(条数)・縦割数(丈割数)の初期値は仕掛データ側の「BOX設計_横割数」
// 「BOX設計_縦割数」から読む。値が無い/数値でない/範囲外の場合のみ、従来
// 通り1を初期値とする(安全側。#horizontalCountは1〜40、#verticalCountは
// 1〜9が入力欄の許容範囲)。
function defaultHorizontalCount(row){
 const n=Number(pick(row,'boxHorizontalCount'));
 return Number.isFinite(n)&&n>=1&&n<=40?Math.round(n):1;
}
function defaultVerticalCount(row){
 const n=Number(pick(row,'boxVerticalCount'));
 return Number.isFinite(n)&&n>=1&&n<=9?Math.round(n):1;
}
function blankMeasure(row){return{id:crypto.randomUUID(),status:'編集中',updatedAt:new Date().toISOString(),source:row,basic:Object.fromEntries(Object.keys(aliases).map(k=>[k,pick(row,k)])),settings:{operator:'-',inspector:'-',lengthPos:'1(頭)',measureType:'母材',verticalCount:defaultVerticalCount(row),horizontalCount:defaultHorizontalCount(row),unwind:'上出し',innerDiameter:'-',spool:'-',thicknessGauge:'-',widthGauge:'-',widthOrder:'通常',widthDirection:'昇順',inputMode:'auto',tStep:0,wStep:0,burrFirst:null,ngCount:0,burr:'指定なし',coilStop:'指定なし',crewSize:'-'},mother:{},qualityInfo:'異常情報なし',measurements:{thickness:Array.from({length:LENGTH_SLOTS},()=>Array(3).fill('')),width:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),lateral:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),burr:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),telescope:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),offset:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),flatness:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),comments:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill(''))}}}
/* 保存データ/新規データを最新スキーマへ整形する。旧実装は多層ラップ
   (基本形状→製品丈→登録設備→作業時間)だったものを一本化した。 */
function ensureMeasureShape(m){
 if(!m)return m;
 {
m.basic=m.basic||{};m.settings={operator:'-',inspector:'-',lengthPos:'1(頭)',measureType:'母材',verticalCount:1,horizontalCount:1,unwind:'上出し',innerDiameter:'-',spool:'-',thicknessGauge:'-',widthGauge:'-',widthOrder:'通常',widthDirection:'昇順',inputMode:'auto',tStep:0,wStep:0,burrFirst:null,ngCount:0,burr:'指定なし',coilStop:'指定なし',...(m.settings||{})};
/* コイル止めは以前「内巻両面テープ」チェックボックス1個(真偽値innerTape)
   だった。マスタ化して選択欄になったので、過去のデータは真偽値から
   名称へ読み替える(旧レコードを開いたときに「指定なし」へ化けないように)。
   innerTape自体は残さない——両方あると、どちらが正か分からなくなる。 */
if(m.settings.innerTape!==undefined){
 if(!(m.settings||{}).coilStop||m.settings.coilStop==='指定なし')
  m.settings.coilStop=m.settings.innerTape?'内巻両面テープ':'指定なし';
 delete m.settings.innerTape;
}
m.mother=m.mother||{};m.qualityInfo=m.qualityInfo||'異常情報なし';m.measurements=m.measurements||{};const shape=(name,width)=>{const src=Array.isArray(m.measurements[name])?m.measurements[name]:[];m.measurements[name]=Array.from({length:LENGTH_SLOTS},(_,i)=>Array.from({length:width},(_,j)=>src[i]?.[j]??''))};shape('thickness',3);['width','lateral','burr','telescope','offset','flatness','comments'].forEach(k=>shape(k,40));
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
 /* Accessへのバックアップ同期状態。status: 'synced'(直近の送信に成功)/
    'pending'(まだ送信していない、または未送信のまま作成された旧データ)/
    'failed'(直近の送信が失敗)。records-store.js の markSyncResult が
    backupRecord() の成否に応じて更新する。旧データ(このフィールドが無い)は
    実際に送信できたか判定できないため安全側でpendingとし、再送の対象にする
    (backupRecordはDELETE+INSERTのため再送しても重複しない)。 */
 m.syncState={status:'pending',lastAttempt:'',lastError:'',attempts:0,...(m.syncState||{})};
 return m;
}
/* 画面の入力値をS.measureへ回収する。設定→母材→製品丈→登録設備→作業時間の順。 */
function collect(){
 // verticalCount/horizontalCountはdefaultVerticalCount/defaultHorizontalCountが
 // 数値で設定する項目のため、DOM値(常に文字列)を読み戻す際も数値へ揃える
 // (揃えないと、後続のリロード等を経ない一度目の保存でだけ文字列型のまま
 // 保存され、===比較箇所で不整合を起こし得る)。
 const m=S.measure;m.updatedAt=new Date().toISOString();['operator','inspector','lengthPos','measureType','verticalCount','horizontalCount','unwind','innerDiameter','spool','thicknessGauge','widthGauge','widthOrder','widthDirection','crewSize','burr','coilStop'].forEach(k=>{const el=$('#'+k);if(!el)return;m.settings[k]=(k==='verticalCount'||k==='horizontalCount')?(Number(el.value)||1):el.value});m.qualityInfo=$('#qualityInfo').value;document.querySelectorAll('[data-mother]').forEach(x=>m.mother[x.dataset.mother]=x.value);saveFlatComment();
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
/* 横割数(条数)の入力上限を、この設備の最大条数(設備マスタ)へ合わせる。
   設備ごとに割れる条数が違うため、40固定だと他設備で入れられてしまう。
   マスタが未設定/未取得のときは構造上の上限(40)のまま。 */
function currentMaxStrips(){
 const n=Number(S.measure?.settings?.maxStrips);
 return Number.isFinite(n)&&n>=1?Math.min(40,Math.round(n)):40;
}
function applyMaxStripsToInputs(){
 const max=currentMaxStrips(),el=$('#horizontalCount');
 if(!el)return;
 el.max=String(max);
 el.title=`この設備で割れる最大条数は${max}条です（マスタ管理 > 設備の「最大条数」）。`;
 if(Number(el.value)>max){el.value=String(max);if(typeof markDirty==='function')markDirty()}
}
function updateCoilOptions(count){const el=$('#coilNo');if(!el)return;const n=Math.max(1,Math.min(currentMaxStrips(),+count||1)),current=+el.value||1;el.innerHTML=Array.from({length:n},(_,i)=>`<option value="${i+1}">${i+1}条</option>`).join('');el.value=Math.min(current,n);loadFlatComment()}
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
 if(layout==='mother'&&$('#motherQualityInfo')){const qi=S.measure.qualityInfo||'異常情報なし';$('#motherQualityInfo').value=qi;if($('#motherQualitySum'))$('#motherQualitySum').textContent=qi.split('\n')[0]}
 const summary=$('#toleranceSummary');if(summary&&$('#measureType')?.value==='板厚/板幅')summary.hidden=true;
}
/* v33: 「揃い/肉厚/長さ」は縦割数で分割した丈(1〜N)ごとに複数行で保持する。
   丈は旧VBA帳票の「丈」テーブル（長さ/肉厚/揃い/外観/備考）と同じ、
   丈=最終的に分割された各ピースを指す1..N連番（頭/尾のサンプリング位置とは無関係）。
   v34では丈番号タブ+縦並びフォームにしていたが、§9.131で**全丈を1つの表**へ
   戻した（②の作業面は実測1059×920pxあり、9丈×9項目は横スクロールなしで
   収まる）。読み書きするDOMは`#productRowsBody`の1本だけで、
   `collect()`・`activeRequiredControls()`も同じものを見る。 */
function blankProductRow(){return{productLength:'',wallThickness:'',alignmentCode:'',edgeShape:'',occurrencePosition:'',regularity:'',pitch:'',alignmentValue:'',note:''}}
function productRowCount(){return Math.max(1,Math.min(9,+$('#verticalCount')?.value||1))}
function judgeAlignmentCode(code){code=String(code||'').trim();if(!code)return '';return code==='0000'?'OK':'NG'}
function updateProductStatus(){
 const m=S.measure;if(!m?.product?.rows)return;
 const n=productRowCount(),filled=m.product.rows.slice(0,n).filter(r=>['productLength','wallThickness','alignmentCode'].some(k=>String(r?.[k]||'').trim()!=='')).length;
 if($('#productMeasureStatus'))$('#productMeasureStatus').textContent=filled?`入力済み ${filled}/${n}丈`:'入力待ち';
}
/* 丈は**全部を1つの表で**出す（§9.131）。以前は丈番号タブで1丈ずつ切り替え、
   同じ内容の隠しテーブルを裏で同期させていた。理由は「横スクロールを避ける」
   だったが、実測すると②の作業面は1059×920pxあり、**9丈×9項目は横スクロール
   なしで収まる**（切り替えた側の空きは542px）。タブで隠す必要が無いなら
   隠さない——切り替えの手間も、2つのDOMを同期させる仕掛けも消える。
   `collect()`・`activeRequiredControls()`が読むのは元から`#productRowsBody`
   なので、**読み書きの経路は1本のまま**になる。 */
function renderProductPanel(){
 const m=S.measure;const body=$('#productRowsBody'),tabs=$('#productLengthTabs'),fields=$('#productLengthFields');
 if(!body||!m)return;
 if(!m.product||!Array.isArray(m.product.rows))m.product={rows:Array.from({length:LENGTH_SLOTS},blankProductRow)};
 const n=productRowCount();
 /* 1丈ずつの器は使わない。**残骸を残さない**（空のタブ列が細い帯として残る）。 */
 if(tabs){tabs.innerHTML='';tabs.hidden=true}
 if(fields){fields.innerHTML='';fields.hidden=true}
 body.innerHTML=Array.from({length:n},(_,i)=>{
  const r=m.product.rows[i]||(m.product.rows[i]=blankProductRow());
  const field=(key,type)=>`<input data-product-field="${key}" value="${esc(r[key]||'')}" type="${type||'text'}"${type==='number'?' inputmode="decimal" step="any"':''}>`;
  const judge=judgeAlignmentCode(r.alignmentCode);
  return `<tr data-row="${i}"><th>${i+1}</th><td>${field('productLength','number')}</td><td>${field('wallThickness','number')}</td><td>${field('alignmentCode')}</td>`
   +`<td><span class="product-judge${judge==='OK'?' ok':judge==='NG'?' ng':''}" data-product-judge="${i}">${esc(judge)}</span></td>`
   +`<td>${field('edgeShape')}</td><td>${field('occurrencePosition')}</td><td>${field('regularity')}</td><td>${field('pitch','number')}</td><td>${field('alignmentValue')}</td><td>${field('note')}</td></tr>`;
 }).join('');
 body.querySelectorAll('[data-product-field]').forEach(el=>{
  el.oninput=()=>{
   const tr=el.closest('tr'),i=+tr.dataset.row,key=el.dataset.productField;
   const row=m.product.rows[i]=m.product.rows[i]||blankProductRow();
   row[key]=el.value;
   if(key==='alignmentCode'){
    const j=judgeAlignmentCode(el.value),badge=tr.querySelector('[data-product-judge]');
    if(badge){badge.textContent=j;badge.className='product-judge'+(j==='OK'?' ok':j==='NG'?' ng':'')}
   }
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
 measureDirty=false;const m=S.measure,b=m.basic;updateLengthOptions(m.settings.verticalCount||1);updateCoilOptions(m.settings.horizontalCount||1);$('#modalEquipment').textContent=b.equipment;/* 基本情報の並び(§9.55)。13項目を「主識別 → 識別番号 → 製品 → コース」の
    4かたまりへ束ね、参照用の項目はラベルと値を1行に収める。以前は全項目が
    ラベル上・値下の同じ見た目で、短い値(コース等)まで全幅を1行使っていたため
    縦に収まらず常時スクロールしていた。 */
 const idFields=[['検査No.','inspectionNo'],['鋳造No.','castingNo'],['オーダーNo.','orderNo'],['引当No.','allocationNo']];
 const productFields=[['用途名','purposeName'],['用途コード','purposeCode'],['取引先','customer'],['納入先','delivery']];
 const cell=([l,k])=>`<div class="field"><label>${l}</label><output title="${esc(b[k])}">${esc(b[k])||'—'}</output></div>`;
 let h='<div class="info-grid">'
  +`<div class="field full info-lot"><label>ロット№</label><button type="button" class="lot-dsp-link" title="クリックでLotDspをこのロット番号で開きます">${esc(b.lotNo)||'—'}</button></div>`
  +'<div class="info-group">識別番号</div>'+idFields.map(cell).join('')
  +'<div class="info-group">製品</div>'+productFields.map(cell).join('')
  +'<div class="info-group info-group-course">コース</div>';h+=`<div class="dimension"><b></b><b>材質</b><b>調質</b><b>板厚</b><b>板幅</b><b>板丈</b><b>オーダー</b><span>${esc(b.orderMaterial)}</span><span>${esc(b.orderTemper)}</span><span>${esc(fmtDim(b.orderThickness,3))}</span><span>${esc(fmtDim(b.orderWidth,1))}</span><span>${esc(fmtDim(b.orderLength,1))}</span><b>製造</b><span>${esc(b.mfgMaterial)}</span><span>${esc(b.mfgTemper)}</span><span>${esc(fmtDim(b.mfgThickness,3))}</span><span>${esc(fmtDim(b.mfgWidth,1))}</span><span>${esc(fmtDim(b.mfgLength,1))}</span></div></div>`;$('#basicInfo').innerHTML=h;Object.entries(m.settings).forEach(([k,v])=>{const el=$('#'+k);if(el){if(el.type==='checkbox')el.checked=v;else el.value=v}});$('#qualityInfo').value=m.qualityInfo;document.querySelectorAll('[data-mother]').forEach(x=>x.value=m.mother[x.dataset.mother]||'');$('#motherOriginalWidth').textContent=fmtDim(b.originalWidth,1)||'－';renderMeasureGrid();renderStats();setState('IndexedDB読込済み')
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
 renderScheduleInfo();
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
 const basic=$('#basicInfo .info-grid');if(basic){basic.querySelectorAll('.residual-course-field').forEach(x=>x.remove());const course=[...basic.querySelectorAll('.field')].find(x=>x.querySelector('label')?.textContent==='実績');const item=document.createElement('div');item.className='field residual-course-field';item.innerHTML=`<label>残</label><output title="${esc(residual)}">${esc(residual||'未設定')}</output>`;if(course)course.after(item);else basic.append(item)}
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
 const basic=$('#basicInfo .info-grid');if(basic){[...basic.querySelectorAll('.course-stack-field,.residual-course-field')].forEach(x=>x.remove());const old=[...basic.querySelectorAll('.field')].find(x=>x.querySelector('label')?.textContent==='実績コース');if(old)old.remove();
  /* コースは「設計→実績→残」の順に意味がつながる1かたまり(§9.55)。
     コース見出しの直後へこの順で並べる。**3項目とも縦に1行ずつ**で、
     横幅はエリアいっぱい(全幅・折り返し)——実機のコースは
     「3文字+空白」×25程度まで伸びるので、2列の半分では平均的な長さすら
     入らない。幅の確保はCSS(.course-stack-field)側で行うため、ここでは
     長さを測って出し分けることはしない(短いときだけ2列へ戻ると、行の位置が
     ロットごとに動いて読み取りにくかった)。 */
  const anchor=basic.querySelector('.info-group-course')||[...basic.querySelectorAll('.field')].find(x=>x.querySelector('label')?.textContent==='納入先');
  /* ラベルは「設計」「実績」「残」だけにする。**すぐ上に「コース」という
     見出しが出ている**ので、各行に「コース」を繰り返すのは冗長で、その
     ぶん値へ渡せる横幅が減っていた(実機のコースは長い)。
     短くすると3つとも同じ文字数になり、値の開始位置も自然に揃う
     (以前は「設計コース」5文字と「残コース」4文字で14pxずれていた)。 */
  [['設計',design],['実績',actual],['残',residual]].forEach(([label,value])=>{const item=document.createElement('div');item.className='field course-stack-field';item.innerHTML=`<label>${label}</label><output title="${esc(value)}">${esc(value||'未設定')}</output>`;if(anchor){const prior=[...basic.querySelectorAll('.course-stack-field')].at(-1);(prior||anchor).after(item)}else basic.append(item)})
 }
 const grid=$('#dataManagementPanel .data-management-grid');if(grid){const pairs=[];for(let i=0;i<grid.children.length;i+=2)pairs.push([grid.children[i]?.textContent,grid.children[i+1]?.textContent]);const keep=pairs.filter(([label])=>!['設計コース','実績コース','残コース'].includes(label));const insertAt=Math.max(0,keep.findIndex(([label])=>label==='オーダー番号'));keep.splice(insertAt,0,['設計コース',design||'未設定'],['実績コース',actual||'未設定'],['残コース',residual||'未設定']);grid.innerHTML=keep.map(([label,value])=>`<b>${esc(label||'')}</b><span title="${esc(value||'')}">${esc(value||'未設定')}</span>`).join('')}
 updateCourseGuard();
}
/* ---------- 作業スケジュールとの連携(読み取りのみ、docs/SCHEDULE_MODE_DESIGN.md §9.7) ----------
   測定画面を開いたロットが作業予定に含まれていれば、基本情報タブへ
   「予定 2番目 / 予定開始 11:44 / 見積 2時間32分」の1行を出す。書き込みは
   行わない(進捗は§7.4の実績突合で自動反映される)。取得はopenMeasurement()の
   finally(CLAUDE.mdの既知の落とし穴どおり)で1回だけ行い、結果はモジュール内
   変数へキャッシュする(renderMeasurement()のたびに毎回問い合わせない)。 */
let scheduleInfoCache=null;
function scheduleMinutesLabel(min){
 if(min===null||min===undefined)return '-';
 const v=Math.round(min);
 if(v<60)return `${v}分`;
 return `${Math.floor(v/60)}時間${v%60?(v%60)+'分':''}`;
}
function renderScheduleInfo(){
 const basic=$('#basicInfo .info-grid');if(!basic)return;
 basic.querySelectorAll('.schedule-info-field').forEach(x=>x.remove());
 const lotNo=S.measure?.basic?.lotNo;
 if(!lotNo||!scheduleInfoCache||normalizedLot(scheduleInfoCache.lotNo)!==normalizedLot(lotNo))return;
 const anchor=[...basic.querySelectorAll('.field')].find(x=>x.querySelector('label')?.textContent==='ロット№');
 const item=document.createElement('div');
 item.className='field full schedule-info-field';
 item.innerHTML=`<label>作業予定</label><output>予定 ${scheduleInfoCache.position}番目 / 予定開始 ${esc(scheduleInfoCache.startText)} / 見積 ${esc(scheduleInfoCache.minutesText)}</output>`;
 if(anchor)anchor.after(item);else basic.prepend(item);
}
async function refreshScheduleInfo(){
 scheduleInfoCache=null;
 const lotNo=S.measure?.basic?.lotNo,equipment=typeof currentConfiguredEquipment==='function'?currentConfiguredEquipment():'';
 if(lotNo&&equipment){
  try{
   const r=await api('/api/schedule/plan?equipment='+encodeURIComponent(equipment));
   if(r&&r.configured&&Array.isArray(r.entries)){
    const active=r.entries.filter(e=>e.state!=='完了'&&e.state!=='取消');
    const idx=active.findIndex(e=>normalizedLot(e.lotNo)===normalizedLot(lotNo));
    if(idx>=0){
     const entry=active[idx];
     scheduleInfoCache={lotNo,position:idx+1,
      startText:entry.plannedStart?new Date(entry.plannedStart).toLocaleString('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'未定',
      minutesText:scheduleMinutesLabel(entry.estimate?.minutes)};
    }
   }
  }catch(e){/* 補助表示のためベストエフォート。未設定・取得失敗時は単に出さない */}
 }
 renderScheduleInfo();
}
function configureToleranceSelector(){const el=$('#toleranceSource');if(!el||!S.measure)return;const type=$('#measureType').value,isDimensional=type==='板厚/板幅',order=el.querySelector('option[value="order"]'),availability=orderToleranceAvailability();order.disabled=!availability.available;order.textContent=availability.available?'オーダー公差':'オーダー公差（データなし）';order.classList.toggle('order-tolerance-unavailable',!availability.available);if(!availability.available&&S.measure.settings.toleranceSource==='order')S.measure.settings.toleranceSource='manufacturing';el.value=S.measure.settings.toleranceSource||'manufacturing';el.disabled=!isDimensional;el.title=isDimensional?(availability.available?'製造公差またはオーダー公差を選択できます':'オーダー公差がないため製造公差のみ使用できます'):'板厚・板幅以外は指示公差を自動適用します';el.onchange=()=>{if(el.value==='order'&&!availability.available)return;S.measure.settings.toleranceSource=el.value;renderMeasureGrid();updateMeasurementHeading();markDirty()}}
/* 作業時間パネル。開始→終了の順序を強制するロック付き打刻。 */
function formatWorkTime(value){if(!value)return '';const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function stampWorkTimeLocked(kind){if(!S.measure)return;S.measure.workTime=S.measure.workTime||{};const now=new Date();if(kind==='start'){if(S.measure.workTime.endAt){showToast('開始時刻は変更できません','終了時刻の記録後は開始時刻を変更できません。');return}S.measure.workTime.startAt=now.toISOString()}else{if(!S.measure.workTime.startAt){showToast('開始時刻が未記録です','先に開始時刻を記録してください。');return}if(now<new Date(S.measure.workTime.startAt)){showToast('終了時刻を記録できません','終了時刻は開始時刻より後である必要があります。');return}S.measure.workTime.endAt=now.toISOString()}updateWorkTimePanel();markDirty();updateValidationVisuals()}
function updateWorkTimePanel(){if(!S.measure)return;S.measure.workTime=S.measure.workTime||{startAt:'',endAt:''};const start=$('#workStartAt'),end=$('#workEndAt');if(!start||!end)return;start.dataset.iso=S.measure.workTime.startAt||'';end.dataset.iso=S.measure.workTime.endAt||'';start.value=formatWorkTime(start.dataset.iso);end.value=formatWorkTime(end.dataset.iso);$('#stampWorkStart').disabled=!!S.measure.workTime.startAt;$('#stampWorkEnd').disabled=!S.measure.workTime.startAt||!!S.measure.workTime.endAt;[[ $('#workStartCard'),start.dataset.iso],[ $('#workEndCard'),end.dataset.iso]].forEach(([card,value])=>{card?.classList.toggle('validation-required',!value);card?.classList.toggle('validation-valid',!!value)});$('#workDuration').textContent=S.measure.workTime.endAt?`実作業時間 ${formatDuration(durationMs(S.measure))}`:S.measure.workTime.startAt?'作業中':'未計測';$('#stampWorkStart').onclick=()=>stampWorkTimeLocked('start');$('#stampWorkEnd').onclick=()=>stampWorkTimeLocked('end')}
document.querySelectorAll('[data-worktab]').forEach(b=>b.onclick=()=>activateWorkspace(b.dataset.worktab));
bindTabs('left','left');
$('#reloadMaster').onclick=()=>loadMeasurementContext(true);
$('#verticalCount').addEventListener('change',()=>{updateLengthOptions($('#verticalCount').value);renderMeasureGrid()});
$('#horizontalCount').addEventListener('change',()=>{
 /* 設備ごとの最大条数を超えた入力はその場で戻す。max属性だけだとスピナーは
    止まるが、手打ち・貼り付けは通ってしまう。 */
 const el=$('#horizontalCount'),max=currentMaxStrips();
 if(Number(el.value)>max){
  el.value=String(max);
  showToast?.('条数を上限に合わせました',`この設備で割れるのは最大${max}条です。`,4000);
 }
 updateCoilOptions(el.value);renderMeasureGrid();
});
function lockCounts(){const has=Object.values(S.measure.measurements).some(a=>a.flat().some(v=>v!==''));$('#verticalCount').disabled=has;$('#horizontalCount').disabled=has}
