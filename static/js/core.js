"use strict";
/* app-core.js: 起動・DB/テーブル一覧・記録管理・測定ワークスペース基盤 */
const LENGTH_SLOTS=12;const $=s=>document.querySelector(s),S={db:null,table:null,catalog:[],tables:[],columns:[],rows:[],page:1,count:0,current:null,measure:null};
const api=async(u,o)=>{let r;try{r=await fetch(u,{cache:'no-store',...(o||{})})}catch(error){throw Error('サーバーへ接続できません。Flaskアプリが起動中か、ポート5029で開いているか確認してください。詳細: '+(error?.message||String(error)))}const text=await r.text();let j={};try{j=text?JSON.parse(text):{}}catch(_){j={error:text}}if(!r.ok)throw Error(j.error||('HTTP '+r.status));return j},esc=v=>{const d=document.createElement('div');d.textContent=v??'';return d.innerHTML};
async function init(){
 const build=await api('/api/build');document.title='測定伝送システム';
 const badge=document.querySelector('.build-badge');
 if(badge){
  badge.textContent=build.version?`VER${build.version}`:'バージョン不明';
  badge.title=build.commit?`コミット: ${build.commit}${build.commit_at?' / '+new Date(build.commit_at).toLocaleString('ja-JP'):''}${build.dirty?'（未コミットの変更あり）':''}`:'';
 }
 const d=await api('/api/catalog');S.catalog=d.databases;
 const nav=$('#nav');
 d.databases.forEach(x=>{
  let b=nav?.querySelector(`[data-db-key="${x.key}"]`);
  if(!b){b=document.createElement('button');b.type='button';b.className='db nav-item nav-item--view';b.dataset.dbKey=x.key;b.innerHTML='<span></span>';nav?.append(b)}
  (b.querySelector('span')||b).textContent=x.label;b.onclick=()=>selectDb(x.key,b);
 });
 const drafts=$('#homeDrafts'),history=$('#homeHistory');if(drafts)drafts.onclick=()=>openRecords('編集中');if(history)history.onclick=()=>openRecords('履歴');
 bindAppSettingsControls();await refreshDraftCount();showQuota();
}
async function selectDb(k,b){S.db=k;document.querySelectorAll('.db').forEach(x=>x.classList.remove('active'));b.classList.add('active');S.tables=(await api(`/api/tables?db=${encodeURIComponent(k)}`)).tables;renderTabs();if(S.tables.length)selectTable(S.tables[0])}
function renderTabs(){$('#tabs').innerHTML='';S.tables.forEach(t=>{const b=document.createElement('button');b.className='tab'+(t===S.table?' active':'');b.textContent=t;b.onclick=()=>selectTable(t);$('#tabs').append(b)})}
function selectTable(t){S.table=t;S.page=1;renderTabs();load()}
async function load(){const q=new URLSearchParams({db:S.db,table:S.table,page:S.page,page_size:$('#pageSize').value,search:$('#search').value});const d=await api('/api/table?'+q);Object.assign(S,{columns:d.columns,rows:d.rows,count:d.count});const info=S.catalog.find(x=>x.key===S.db);$('#fileName').textContent=info.file_name;$('#tableName').textContent=S.table;renderGrid()}
function renderGrid(){const t=document.createElement('table');t.innerHTML='<thead><tr><th>#</th>'+S.columns.map(c=>`<th>${esc(c)}</th>`).join('')+'</tr></thead>';const b=document.createElement('tbody');S.rows.forEach((r,i)=>{const tr=document.createElement('tr');tr.innerHTML=`<td>${(S.page-1)*+$('#pageSize').value+i+1}</td>`+S.columns.map(c=>`<td>${esc(r[c])}</td>`).join('');if(S.db==='SIKALOTNOW'){tr.classList.add('measurement-row');tr.title='ダブルクリックで測定画面を開く';tr.addEventListener('dblclick',e=>{e.preventDefault();e.stopPropagation();openMeasurement(r).catch(err=>alert('測定画面を開けません: '+err.message))})}b.append(tr)});t.append(b);$('#grid').replaceChildren(t);$('#count').textContent=`全 ${S.count.toLocaleString()}件`;$('#page').textContent=`${S.page}ページ`;$('#prev').disabled=S.page===1;$('#next').disabled=S.page*+$('#pageSize').value>=S.count}
const aliases={lotNo:['ロット番号','ﾛｯﾄ番号','LTNO'],inspectionNo:['検査番号','KNNO'],orderNo:['オーダー番号','JUON','JUNO'],castingNo:['鋳造番号','CYNO'],allocationNo:['引当番号','HKNO'],orderMaterial:['オーダー材質','JUA'],orderTemper:['オーダー調質','JUB'],orderThickness:['オーダー板厚','JUX'],orderWidth:['オーダー板幅','JUY'],orderLength:['オーダー板丈','JUZ'],mfgMaterial:['製造材質','LTA'],mfgTemper:['製造調質','LTB'],mfgThickness:['製造板厚','LTX'],mfgWidth:['製造板幅','LTY'],mfgLength:['製造板丈','LTZ'],purposeCode:['用途コード','用途ｺｰﾄﾞ','YOTOC'],purposeName:['用途名','YOTON'],customer:['取引先','TOKUNA'],delivery:['納入先','NONNA'],designCourse:['設計_設備ｺｰｽ','設計_設備コース'],course:['実績_設備ｺｰｽ','実績_設備コース','実績コース'],residualCourse:['残仕掛設備ｺｰｽ','残仕掛設備コース','ZANMC'],equipment:['BOX設計_設備名','設備']};
function pick(row,key){for(const n of aliases[key]||[])if(row[n]!==undefined&&row[n]!==null)return String(row[n]);return ''}
function blankMeasure(row){return{id:crypto.randomUUID(),status:'編集中',updatedAt:new Date().toISOString(),source:row,basic:Object.fromEntries(Object.keys(aliases).map(k=>[k,pick(row,k)])),settings:{operator:'-',inspector:'-',lengthPos:'1(頭)',measureType:'母材',verticalCount:1,horizontalCount:1,unwind:'上出し',innerDiameter:'-',spool:'-',thicknessGauge:'-',widthGauge:'-',widthOrder:'通常',widthDirection:'昇順',inputMode:'auto',tStep:0,wStep:0,burrFirst:null,ngCount:0,burr:'指定なし',innerTape:false,crewSize:'-'},mother:{},qualityInfo:'異常情報なし',measurements:{thickness:Array.from({length:LENGTH_SLOTS},()=>Array(3).fill('')),width:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),lateral:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),burr:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),telescope:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),offset:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),flatness:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),comments:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill(''))}}}
async function openMeasurement(row){if(!row)throw Error('対象データがありません');S.current=row;const key=lotKey(row),saved=await idbGet(key);S.measure=saved||blankMeasure(row);S.measure.id=key;renderMeasurement();$('#measureModal').hidden=false;requestAnimationFrame(()=>$('#deviceInput').focus())}
function lotKey(r){return [pick(r,'equipment'),pick(r,'lotNo'),pick(r,'inspectionNo'),pick(r,'castingNo')].join('|')}
/* 基本情報タブの寸法表示整形。板厚=小数2桁 / 板幅・板丈=小数1桁。数値でない・空欄はそのまま。 */
function fmtDim(value,digits){const raw=String(value??'').trim();if(raw==='')return '';const n=Number(raw);return Number.isFinite(n)?n.toFixed(digits):raw}
function renderMeasurement(){const m=S.measure,b=m.basic;updateLengthOptions(m.settings.verticalCount||1);updateCoilOptions(m.settings.horizontalCount||1);$('#modalEquipment').textContent=b.equipment;const fields=[['ロット№','lotNo'],['検査No.','inspectionNo'],['オーダーNo.','orderNo'],['引当No.','allocationNo'],['鋳造No.','castingNo'],['用途コード','purposeCode'],['用途名','purposeName'],['取引先','customer'],['納入先','delivery'],['実績コース','course']];let h='<div class="info-grid">'+fields.map(([l,k])=>k==='lotNo'?`<div class="field"><label>${l}</label><button type="button" class="lot-dsp-link" title="クリックでLotDspをこのロット番号で開きます">${esc(b[k])||'—'}</button></div>`:`<div class="field ${['customer','delivery','course'].includes(k)?'full':''}"><label>${l}</label><output title="${esc(b[k])}">${esc(b[k])}</output></div>`).join('');h+=`<div class="dimension"><b></b><b>材質</b><b>調質</b><b>板厚</b><b>板幅</b><b>板丈</b><b>オーダー</b><span>${esc(b.orderMaterial)}</span><span>${esc(b.orderTemper)}</span><span>${esc(fmtDim(b.orderThickness,2))}</span><span>${esc(fmtDim(b.orderWidth,1))}</span><span>${esc(fmtDim(b.orderLength,1))}</span><b>製造</b><span>${esc(b.mfgMaterial)}</span><span>${esc(b.mfgTemper)}</span><span>${esc(fmtDim(b.mfgThickness,2))}</span><span>${esc(fmtDim(b.mfgWidth,1))}</span><span>${esc(fmtDim(b.mfgLength,1))}</span></div></div>`;$('#basicInfo').innerHTML=h;Object.entries(m.settings).forEach(([k,v])=>{const el=$('#'+k);if(el){if(el.type==='checkbox')el.checked=v;else el.value=v}});$('#qualityInfo').value=m.qualityInfo;document.querySelectorAll('[data-mother]').forEach(x=>x.value=m.mother[x.dataset.mother]||'');document.querySelectorAll('[name=burr]').forEach(x=>x.checked=x.value===m.settings.burr);renderMeasureGrid();renderStats();setState('IndexedDB読込済み')}
/* ロット№クリックでLotDsp検索サイトをロット番号指定で開く。
   linkkeyは「7文字固定幅のロット番号 + 半角スペース3つ + 7文字固定幅の
   鋳造番号」という構成(実機のURLから確認)。
   別オリジンのためフォームへの直接書き込みはできないが、この形式で
   URLを開けば相手側アプリがlinkkeyを読み取って検索まで行う。念のため
   ロット番号はクリップボードにもコピーしておく(自動遷移が効かない
   場合の手動貼り付け用フォールバック)。 */
const LOT_DSP_BASE='http://nlmfangyweb1a/LotDspWeb/#/lotdsp';
function lotDspField(v){return String(v||'').slice(0,7).padEnd(7,' ')}
function lotDspLinkKey(lotNo,castingNo){return lotDspField(lotNo)+'   '+lotDspField(castingNo)}
function buildLotDspUrl(lotNo,castingNo,tab){return `${LOT_DSP_BASE}?linkkey=${encodeURIComponent(lotDspLinkKey(lotNo,castingNo))}&tab=${encodeURIComponent(tab)}`}
function copyText(text){
 if(navigator.clipboard&&window.isSecureContext)return navigator.clipboard.writeText(text).catch(()=>copyTextFallback(text));
 copyTextFallback(text);return Promise.resolve();
}
function copyTextFallback(text){
 const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.focus();ta.select();
 try{document.execCommand('copy')}catch(_){}
 document.body.removeChild(ta);
}
function openLotDsp(lotNo,castingNo,tab){
 if(!lotNo){showToast('ロット番号が未設定です','LotDspへは移動できません');return}
 window.open(buildLotDspUrl(lotNo,castingNo,tab),'_blank','noopener');
 copyText(lotNo);
}
document.addEventListener('click',e=>{
 const link=e.target.closest('.lot-dsp-link');if(!link)return;
 openLotDsp(S.measure?.basic?.lotNo,S.measure?.basic?.castingNo,localStorage.getItem('LotDspLastTabV1')||'1');
});
/* タブ番号は測定画面には出さず、アプリ設定(使用設備の設定)モーダルの
   内部設定として切り替える。ロット№欄の見た目・サイズは常に元のまま。
   既定値はTab1(実機URLの例に合わせる)。 */
(function(){
 const sel=document.getElementById('lotDspTabSetting');if(!sel)return;
 sel.value=localStorage.getItem('LotDspLastTabV1')||'1';
 sel.onchange=()=>localStorage.setItem('LotDspLastTabV1',sel.value);
})();
function renderMeasureGrid(){const type=$('#measureType').value,map={母材:'width','板厚/板幅':'width',ラテラルボー:'lateral',バリ:'burr',テレスコープ:'telescope',巻ずれ:'offset'},key=map[type]||'width',rows=S.measure.measurements[key],l=Math.max(1,+$('#verticalCount').value||1),w=Math.max(1,+$('#horizontalCount').value||1);let h='<table class="measure-grid-table"><thead><tr><th>丈＼条</th>'+Array.from({length:w},(_,i)=>`<th>${i+1}</th>`).join('')+'</tr></thead><tbody>';for(let i=0;i<l;i++)h+=`<tr><th>${i+1}</th>`+Array.from({length:w},(_,j)=>`<td><input data-mkey="${key}" data-i="${i}" data-j="${j}" value="${esc(rows[i][j])}"></td>`).join('')+'</tr>';$('#measurementGrid').innerHTML=h+'</tbody></table>';document.querySelectorAll('[data-mkey]').forEach(x=>x.oninput=()=>{S.measure.measurements[x.dataset.mkey][+x.dataset.i][+x.dataset.j]=x.value;renderStats();markDirty()})}
function nums(a){return a.flat().map(Number).filter(Number.isFinite).filter(x=>x!==0)}function stat(a){const n=nums(a);if(!n.length)return['','','','',0];const av=n.reduce((x,y)=>x+y,0)/n.length,sd=Math.sqrt(n.reduce((x,y)=>x+(y-av)**2,0)/n.length);return[Math.min(...n),av,Math.max(...n),sd*3,n.length]}
function renderStats(){const types=[['板厚','thickness',3],['板幅','width',2],['バリ','burr',3],['ラテラルボー','lateral',1],['巻きずれ','offset',1],['テレスコープ','telescope',1]];$('#stats').innerHTML=types.map(([l,k,d])=>{const s=stat(S.measure.measurements[k]);return `<tr><th>${l}</th>${s.slice(0,4).map(v=>`<td>${v===''?'':Number(v).toFixed(d)}</td>`).join('')}<td>${s[4]}</td></tr>`}).join('')}
function collect(){const m=S.measure;m.updatedAt=new Date().toISOString();['operator','inspector','lengthPos','measureType','verticalCount','horizontalCount','unwind','innerDiameter','spool','thicknessGauge','widthGauge','widthOrder','widthDirection','crewSize'].forEach(k=>{const el=$('#'+k);if(el)m.settings[k]=el.value});m.settings.burr=document.querySelector('[name=burr]:checked')?.value||'';m.settings.innerTape=$('#innerTape').checked;m.qualityInfo=$('#qualityInfo').value;document.querySelectorAll('[data-mother]').forEach(x=>m.mother[x.dataset.mother]=x.value);saveFlatComment();return m}
function encodePayload(m){const sep='\u001f',row='\u001e';const enc=a=>a.map(x=>Array.isArray(x)?x.join(sep):x).join(row);return JSON.stringify({id:m.id,status:m.status,basic:m.basic,settings:m.settings,mother:m.mother,qualityInfo:m.qualityInfo,data:Object.fromEntries(Object.entries(m.measurements).map(([k,v])=>[k,enc(v)]))})}
async function saveLocal(status='編集中'){const m=collect();m.status=status;await idbPut(m);setState(status==='完了'?'完了・端末保存済み':'端末保存済み');return m}
async function backup(){const m=await saveLocal(S.measure.status);const x={id:m.id,equipment:m.basic.equipment,lotNo:m.basic.lotNo,inspectionNo:m.basic.inspectionNo,castingNo:m.basic.castingNo,status:m.status,codec:'delimiter-v1',payload:encodePayload(m)};await api('/api/measurement/backup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(x)});setState('Accessバックアップ済み')}
function setState(x){$('#localState').textContent=x}function markDirty(){setState('未保存')}
const DB='MeasurementLocal',STORE='lots';function idb(){return new Promise((ok,no)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'id'});r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}async function idbGet(id){const d=await idb();return new Promise((o,n)=>{const r=d.transaction(STORE).objectStore(STORE).get(id);r.onsuccess=()=>o(r.result);r.onerror=()=>n(r.error)})}async function idbPut(v){const d=await idb();return new Promise((o,n)=>{const r=d.transaction(STORE,'readwrite').objectStore(STORE).put(v);r.onsuccess=()=>o();r.onerror=()=>n(r.error)})}async function idbDelete(id){const d=await idb();return new Promise((o,n)=>{const r=d.transaction(STORE,'readwrite').objectStore(STORE).delete(id);r.onsuccess=()=>o();r.onerror=()=>n(r.error)})}
async function showQuota(){if(navigator.storage?.estimate){const q=await navigator.storage.estimate();$('#quota').textContent=`IndexedDB使用 ${(q.usage/1048576).toFixed(1)}MB / 上限目安 ${(q.quota/1073741824).toFixed(1)}GB`}}
$('#search').oninput=()=>{clearTimeout(S.t);S.t=setTimeout(()=>{S.page=1;load()},300)};$('#pageSize').onchange=()=>{S.page=1;load()};$('#reload').onclick=load;$('#prev').onclick=()=>{if(S.page>1){S.page--;load()}};$('#next').onclick=()=>{S.page++;load()};$('#closeModal').onclick=()=>$('#measureModal').hidden=true;$('.shade').onclick=()=>$('#measureModal').hidden=true;$('#measureType').onchange=renderMeasureGrid;$('#verticalCount').onchange=renderMeasureGrid;$('#horizontalCount').onchange=renderMeasureGrid;$('#saveDraft').onclick=()=>saveLocal();$('#complete').onclick=async()=>{await saveLocal('完了');await backup()};$('#backupNow').onclick=backup;$('#discard').onclick=async()=>{if(confirm('端末内の測定データを削除しますか？')){await idbDelete(S.measure.id);$('#measureModal').hidden=true}};document.querySelectorAll('.selectors input,.selectors select,.material-grid input').forEach(x=>x.onchange=markDirty);

/* v29 indexed draft resume and tolerance visualization */
function updateLengthOptions(count){const el=$('#lengthPos');if(!el)return;const current=el.value||S.measure?.settings?.lengthPos||'1(頭)',n=Math.max(1,Math.min(9,+count||1)),values=[];for(let i=1;i<=n;i++)values.push(`${i}(頭)`);values.push(`${n}(尾)`);el.innerHTML=[...new Set(values)].map(v=>`<option>${v}</option>`).join('');el.value=[...el.options].some(o=>o.value===current)?current:values[0]}
function updateCoilOptions(count){const el=$('#coilNo');if(!el)return;const n=Math.max(1,Math.min(40,+count||1)),current=+el.value||1;el.innerHTML=Array.from({length:n},(_,i)=>`<option value="${i+1}">${i+1}条</option>`).join('');el.value=Math.min(current,n);loadFlatComment()}
/* v35: フラットネスは入力内容(measureType)の一項目として、巻ずれ・テレスコープと
   同じ条グリッドで判定記号(〇/△/×)を入力する形に変更。備考のみ対象条を選んで
   入力するミニパネルとして残す（#coilNo/#coilCommentはフラットネス選択時のみ
   動的に生成されるため、両関数とも要素が無ければ何もしない）。 */
function saveFlatComment(){if(!S.measure||!$('#coilNo'))return;const i=(+$('#coilNo').value||1)-1,j=lengthIndex();S.measure.measurements.comments[j][i]=String($('#coilComment').value||'').replace(/[;|]/g,'')}
function loadFlatComment(){if(!S.measure||!$('#coilNo'))return;const i=(+$('#coilNo').value||1)-1,j=lengthIndex();$('#coilComment').value=S.measure.measurements.comments[j][i]||''}
function bindTabs(group,panel){document.querySelectorAll(`[data-${group}tab]`).forEach(btn=>btn.onclick=()=>{document.querySelectorAll(`[data-${group}tab]`).forEach(x=>x.classList.toggle('active',x===btn));document.querySelectorAll(`[data-${group}panel]`).forEach(x=>x.hidden=x.dataset[group+'panel']!==btn.dataset[group+'tab'])})}
function optionFill(id,items,current='-'){const el=$('#'+id);if(!el)return;const vals=['-',...new Set(items||[])];el.innerHTML=vals.map(v=>`<option>${esc(v)}</option>`).join('');if(vals.includes(current))el.value=current}
function qualityText(items){if(!items?.length)return '異常情報なし';return items.slice(0,4).map((q,i)=>`(${i+1}) ${q['発生設備']||''} ${q['登録日時']||''} ${q['異常内容']||''}\nコメント：${q['コメント']||''}\n最終処置：${q['最終処置']||''}\n保留設定日：${q['保留設定日']||''}　保留解除日：${q['保留解除']||''}`).join('\n\n')}
async function loadMeasurementContext(){const m=S.measure,u=new URLSearchParams({lot:m.basic.lotNo,equipment:m.basic.equipment});try{setState('マスタ読込中');const x=await api('/api/measurement/context?'+u);optionFill('operator',x.operators,m.settings.operator);optionFill('inspector',x.inspectors||x.operators,m.settings.inspector);optionFill('thicknessGauge',x.thickness_gauges,m.settings.thicknessGauge);optionFill('widthGauge',x.width_gauges,m.settings.widthGauge);optionFill('innerDiameter',x.inner_diameters,m.settings.innerDiameter);optionFill('spool',x.spools,m.settings.spool);if(x.quality?.length){m.qualityInfo=qualityText(x.quality);$('#qualityInfo').value=m.qualityInfo}$('#masterDiagnostic').textContent=JSON.stringify(x.diagnostics,null,2);const total=(x.operators?.length||0)+(x.thickness_gauges?.length||0)+(x.width_gauges?.length||0)+(x.inner_diameters?.length||0)+(x.spools?.length||0);setState(`マスタ ${total}件読込済み`)}catch(e){setState('マスタ読込エラー');$('#masterDiagnostic').textContent=e.stack||e.message;console.warn('context load failed',e)}}
function widthSequence(max,order,dir){let a=Array.from({length:max},(_,i)=>i);if(order==='奇数条優先')a=[...a.filter(i=>i%2===0),...a.filter(i=>i%2===1)];if(order==='偶数条優先')a=[...a.filter(i=>i%2===1),...a.filter(i=>i%2===0)];if(dir==='降順')a=a.reverse();return a}
function lengthIndex(){const el=$('#lengthPos');if(!el)return 0;const opts=[...el.options],idx=opts.findIndex(o=>o.value===el.value);return Math.max(0,Math.min(LENGTH_SLOTS-1,idx>=0?idx:0))}
/* 測定器のキー入力受付中に、日本語IME等の影響で数字・記号が全角へ
   変換され、Tabまでの間に解析不能な文字列になる不具合への対策。
   全角英数記号(U+FF01-FF5E)と全角スペースを半角へ強制変換する。 */
function toHalfWidth(str){return String(str??'').replace(/[！-～]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0xFEE0)).replace(/　/g,' ')}
function deviceParse(raw){const v=toHalfWidth(String(raw||'')).trim().toUpperCase();if(v==='#DELETEMODE#'||v==='DELETE')return{device:'delete',value:null};if(v.includes('+#L'))return{device:'tape',value:Number(v.split('+#L')[1])};if(!v.includes('+'))return Number.isFinite(Number(v))?{device:'manual',value:Number(v)}:{device:'invalid',value:null};const [code,data]=v.split('+');let device='invalid';if(code.startsWith('DT1')){const kind=code.slice(-2,-1);device=kind==='0'?'micrometer':kind==='1'?'caliper':kind==='2'?'depth':'invalid'}const num=Number(String(data).replace(/M$/,''));return{device,value:Number.isFinite(num)?num:null}}
function activeMeasureKey(){return({母材:'mother', '板厚/板幅':'width',ラテラルボー:'lateral',バリ:'burr',テレスコープ:'telescope',巻ずれ:'offset',フラットネス:'flatness'})[$('#measureType').value]||'width'}
function toleranceFor(kind,index=0){const r=S.measure.source||{},b=S.measure.basic;const val=(names)=>{for(const n of names)if(r[n]!==undefined&&r[n]!==null&&r[n]!=='')return Number(r[n]);return NaN};if(kind==='thickness'){const base=Number(b.mfgThickness),plus=val(['板厚公差_製造_プラス','KOSAXSMP']),minus=val(['板厚公差_製造_マイナス','KOSAXSMM']);return(Number.isFinite(base)&&Number.isFinite(plus)&&Number.isFinite(minus))?[base-minus,base+plus]:null}const base=Number(b.mfgWidth),plus=val(['板幅公差_製造_プラス','KOSAYSMP']),minus=val(['板幅公差_製造_マイナス','KOSAYSMM']);return(Number.isFinite(base)&&Number.isFinite(plus)&&Number.isFinite(minus))?[base-minus,base+plus]:null}
function judgeInput(el,key,value,index){el.classList.remove('ng','complete');if(key==='flatness'){if(String(el.value||'').trim()!=='')el.classList.add('complete');return}const tol=toleranceFor(key==='thickness'?'thickness':'width',index);if(Number.isFinite(value)){el.classList.add('complete');if(tol&&(value<tol[0]||value>tol[1]))el.classList.add('ng')}}
function focusCurrent(){document.querySelectorAll('[data-mkey]').forEach(x=>x.classList.remove('current'));const m=S.measure.settings,key=activeMeasureKey();let sel;if(key==='width'&&m.pendingDevice==='micrometer')sel=`[data-mkey="thickness"][data-j="${m.tStep||0}"]`;else sel=`[data-mkey="${key}"][data-i="${lengthIndex()}"][data-j="${m.wStep||0}"]`;const el=document.querySelector(sel);if(el){el.classList.add('current');el.scrollIntoView({block:'nearest',inline:'nearest'})}$('#stepStatus').textContent=`入力位置 ${key==='width'&&m.pendingDevice==='micrometer'?'板厚 '+((m.tStep||0)+1):'丈 '+(lengthIndex()+1)+' / 条 '+((m.wStep||0)+1)}`}
function advanceWidth(){const m=S.measure.settings,max=Math.max(1,+$('#horizontalCount').value||1),seq=widthSequence(max,$('#widthOrder').value,$('#widthDirection').value),pos=seq.indexOf(m.wStep||0);m.wStep=seq[(pos+1)%seq.length]}
function processDeviceInput(raw){const p=deviceParse(raw),m=S.measure,st=m.settings,type=$('#measureType').value,li=lengthIndex();$('#deviceInput').classList.remove('device-ok','device-error');if(p.device==='invalid'||p.value===null&&p.device!=='delete'){setState('入力形式エラー');$('#deviceInput').classList.add('device-error');return}if(p.device==='delete'){const key=activeMeasureKey();if(key==='width'&&st.pendingDevice==='micrometer')m.measurements.thickness[li][st.tStep||0]='';else m.measurements[key][li][st.wStep||0]='';renderMeasureGrid();markDirty();return}
 if(type==='板厚/板幅'){
  if(p.device==='micrometer'){const j=st.tStep||0;m.measurements.thickness[li][j]=p.value.toFixed(3);st.tStep=(j+1)%3;st.pendingDevice='micrometer'}
  else if(['caliper','tape','manual'].includes(p.device)){const j=st.wStep||0;m.measurements.width[li][j]=p.value.toFixed(p.device==='caliper'?2:1);st.pendingDevice='width';advanceWidth()}
  else return inputError('板厚はマイクロメータ、板幅はノギスまたはコンベックスを使用してください')
 }else if(type==='バリ'){
  if(!['micrometer','manual'].includes(p.device))return inputError('バリはマイクロメータを使用してください');const j=st.wStep||0;if(st.burrFirst===null||st.burrFirst===undefined){st.burrFirst=p.value;setState(`STEP 2/2 バリ高さを測定してください。基準 ${p.value}`)}else{const diff=p.value-st.burrFirst;if(diff<0)return inputError('測定値がマイナスになります。DELETEして再測定してください');m.measurements.burr[li][j]=Math.abs(diff).toFixed(3);st.burrFirst=null;advanceWidth();setState('STEP 1/2 バリ測定対象の板厚を測定してください')}
 }else if(type==='テレスコープ'){
  if(!['depth','manual'].includes(p.device))return inputError('テレスコープはデプスゲージを使用してください');m.measurements.telescope[li][st.wStep||0]=p.value.toFixed(2);advanceWidth()
 }else{const key=activeMeasureKey();m.measurements[key][li][st.wStep||0]=type==='ラテラルボー'?(Math.ceil(p.value*2)/2).toFixed(1):p.value.toFixed(1);advanceWidth()}
 $('#deviceInput').classList.add('device-ok');$('#deviceInput').value='';renderMeasureGrid();renderStats();markDirty();focusCurrent()
}
function inputError(msg){setState(msg);$('#deviceInput').classList.add('device-error')}
function renderMeasureGrid(){const type=$('#measureType').value,key=activeMeasureKey(),m=S.measure,l=Math.max(1,+$('#verticalCount').value||1),w=Math.max(1,+$('#horizontalCount').value||1);let h='';if(type==='板厚/板幅'){const li=lengthIndex();h+='<table class="measure-grid-table"><thead><tr><th>板厚</th><th>OS</th><th>CL</th><th>DS</th></tr></thead><tbody><tr><th>丈 '+(li+1)+'</th>'+m.measurements.thickness[li].map((v,j)=>`<td><input data-mkey="thickness" data-i="${li}" data-j="${j}" value="${esc(v)}"></td>`).join('')+'</tr></tbody></table>'}
 const rows=m.measurements[key==='mother'?'width':key];h+='<table class="measure-grid-table"><thead><tr><th>丈＼条</th>'+Array.from({length:w},(_,i)=>`<th>${i+1}</th>`).join('')+'</tr></thead><tbody>';for(let i=0;i<l;i++)h+=`<tr><th>${i+1}</th>`+Array.from({length:w},(_,j)=>`<td><input data-mkey="${key==='mother'?'width':key}" data-i="${i}" data-j="${j}" value="${esc(rows[i][j])}"></td>`).join('')+'</tr>';$('#measurementGrid').innerHTML=h+'</tbody></table>';document.querySelectorAll('[data-mkey]').forEach(x=>{const v=Number(x.value);judgeInput(x,x.dataset.mkey,v,+x.dataset.j);x.onclick=()=>{m.settings.wStep=+x.dataset.j;if(x.dataset.mkey==='thickness')m.settings.tStep=+x.dataset.j;focusCurrent();$('#deviceInput').focus()};x.oninput=()=>{m.measurements[x.dataset.mkey][+x.dataset.i][+x.dataset.j]=x.value;judgeInput(x,x.dataset.mkey,Number(x.value),+x.dataset.j);renderStats();markDirty()};x.onkeydown=e=>{if(e.key==='Delete'){x.value='';x.oninput()}if(e.key==='Enter'){e.preventDefault();advanceWidth();focusCurrent();$('#deviceInput').focus()}}});focusCurrent()}
async function openMeasurement(row){if(!row)throw Error('対象データがありません');S.current=row;const key=lotKey(row),saved=await idbGet(key);if(saved){const resume=confirm('編集中のデータがあります。読み込みますか？\n「キャンセル」は新規データとして開きます。');S.measure=resume?saved:blankMeasure(row)}else S.measure=blankMeasure(row);S.measure.id=key;renderMeasurement();$('#measureModal').hidden=false;await loadMeasurementContext();requestAnimationFrame(()=>$('#deviceInput').focus())}
async function idbAll(){const d=await idb();return new Promise((o,n)=>{const r=d.transaction(STORE).objectStore(STORE).getAll();r.onsuccess=()=>o(r.result||[]);r.onerror=()=>n(r.error)})}
async function openRecords(status){const all=await idbAll(),items=all.filter(x=>status==='履歴'?x.status==='完了':x.status!=='完了');$('#recordTitle').textContent=status;$('#recordList').innerHTML=items.length?'':'<p>対象データはありません。</p>';items.forEach(x=>{const c=document.createElement('article');c.className='record-card';c.innerHTML=`<h3>${esc(x.basic?.lotNo||x.id)}</h3><p>${esc(x.basic?.inspectionNo||'')} / ${esc(x.basic?.castingNo||'')}</p><p>${esc(x.status)}　${esc(x.updatedAt||'')}</p><div><button class="resume">${status==='履歴'?'プレビュー':'再開'}</button><button class="danger">削除</button></div>`;c.querySelector('.resume').onclick=()=>{S.measure=x;renderMeasurement();$('#recordModal').hidden=true;$('#measureModal').hidden=false};c.querySelector('.danger').onclick=async()=>{if(confirm('このデータを削除しますか？')){await idbDelete(x.id);openRecords(status)}};$('#recordList').append(c)});$('#recordModal').hidden=false}
async function registerNg(){const m=await saveLocal('測定値NG');m.settings.ngCount=(m.settings.ngCount||0)+1;await idbPut(m);setState(`NGロット ${m.settings.ngCount}回目を保存`)}
function lockCounts(){const has=Object.values(S.measure.measurements).some(a=>a.flat().some(v=>v!==''));$('#verticalCount').disabled=has;$('#horizontalCount').disabled=has}

function updateReceiveState(focused=document.activeElement===$('#deviceInput')){if(!S.measure)return;const manual=S.measure.settings.inputMode==='manual',box=$('#inputStatusBox'),inp=$('#deviceInput');box.classList.remove('receiving','manual-state','not-ready-state');inp.classList.remove('manual-receive','locked-receive');if(manual){box.classList.add('manual-state');inp.classList.add('manual-receive');$('#inputReady').textContent='手動入力モード';$('#inputModeHelp').textContent='測定セルへ直接入力（Enterで確定）';$('#receiveLock').textContent='手入力許可';inp.placeholder='必要に応じて数値を入力'}else if(focused){box.classList.add('receiving');$('#inputReady').textContent='伝送入力受付中';$('#inputModeHelp').textContent='測定器からの転送待ち。Tabで受信確定';$('#receiveLock').textContent='転送専用';inp.placeholder='測定器データ受信専用'}else{box.classList.add('not-ready-state');inp.classList.add('locked-receive');$('#inputReady').textContent='伝送入力停止中';$('#inputModeHelp').textContent='受信欄をクリックすると受付を再開します';$('#receiveLock').textContent='受付停止';inp.placeholder='クリックして伝送受付を再開'}}$('#deviceInput').onfocus=()=>updateReceiveState(true);$('#deviceInput').onblur=()=>updateReceiveState(false);
$('#deviceInput').oninput=e=>{const normalized=toHalfWidth(e.target.value);if(normalized!==e.target.value)e.target.value=normalized};
$('#deviceInput').onkeydown=e=>{
 /* 測定器からの転送はキー入力を極めて短い間隔で連続送信するため、
    途中で偶然Ctrl/Alt等の修飾キーが混じるとブラウザの検索(Ctrl+F)等の
    既定ショートカットが割り込み、フォーカスが奪われて最後のTabまで
    受信できなくなることがある。受信欄では修飾キー付きの入力を
    すべて無効化し、ブラウザ側へ渡さないようにする。 */
 if(e.ctrlKey||e.metaKey||e.altKey){e.preventDefault();return}
 const auto=S.measure?.settings?.inputMode!=='manual',accept=(auto&&e.key==='Tab')||(!auto&&e.key==='Enter');
 if(accept){e.preventDefault();const target=e.target;requestAnimationFrame(()=>processDeviceInput(target.value))}
 else if((e.key==='Delete'||e.key==='Backspace')&&!e.target.value){e.preventDefault();processDeviceInput('#DeleteMode#')}
 else if(e.key==='ArrowDown'||(e.key==='Enter'&&!e.target.value)){e.preventDefault();advanceWidth();focusCurrent()}
 else if(e.key==='ArrowUp'){e.preventDefault();const seq=widthSequence(Math.max(1,+$('#horizontalCount').value||1),$('#widthOrder').value,$('#widthDirection').value),pos=seq.indexOf(S.measure.settings.wStep||0);S.measure.settings.wStep=seq[(pos-1+seq.length)%seq.length];focusCurrent()}
};
$('#measureType').onchange=()=>{S.measure.settings.wStep=0;S.measure.settings.tStep=0;S.measure.settings.burrFirst=null;activateWorkspace($('#measureType').value==='母材'?'mother':'measure');renderMeasureGrid();updateMeasurementHeading();$('#deviceInput').focus()};
$('#lengthPos').onchange=()=>{renderMeasureGrid();$('#deviceInput').focus()};
$('#widthOrder').onchange=focusCurrent;$('#widthDirection').onchange=focusCurrent;
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-mode]').forEach(x=>x.classList.remove('active'));b.classList.add('active');S.measure.settings.inputMode=b.dataset.mode;$('#deviceInput').readOnly=false;applyInputProtection();$('#deviceInput').focus();updateReceiveState(true);setState(b.dataset.mode==='auto'?'自動転送: Tabで受信':'手動入力: Enterで確定')});
$('#openDrafts').onclick=()=>openRecords('編集中');$('#openHistory').onclick=()=>openRecords('履歴');$('#closeRecords').onclick=()=>$('#recordModal').hidden=true;$('#ngLot').onclick=registerNg;
const oldSaveLocal=saveLocal;saveLocal=async function(status='編集中'){lockCounts();return oldSaveLocal(status)};

function activateWorkspace(name){document.querySelectorAll('[data-worktab]').forEach(b=>b.classList.toggle('active',b.dataset.worktab===name));document.querySelectorAll('[data-workpanel]').forEach(p=>p.hidden=p.dataset.workpanel!==name)}
function updateMeasurementHeading(){const type=$('#measureType').value;$('#measurePanelTitle').textContent=type==='板厚/板幅'?'板厚・板幅測定':type+'測定';const t=toleranceFor(type==='板厚/板幅'?'thickness':'width');$('#toleranceSummary').textContent=t?`許容範囲 ${t[0]} ～ ${t[1]}　クリックは入力位置選択のみ。値は受信欄から登録します。`:'公差情報なし　クリックは入力位置選択のみ。値は受信欄から登録します。'}
function applyInputProtection(){if(!S.measure)return;const manual=S.measure.settings.inputMode==='manual';document.querySelectorAll('[data-mkey]').forEach(el=>{el.readOnly=!manual;el.classList.toggle('auto-locked',!manual);el.tabIndex=manual?0:-1;el.title=manual?'手入力可能':'自動転送中。クリックは入力位置の選択のみです。'});document.querySelectorAll('[data-mother]').forEach(el=>{el.readOnly=!manual;el.tabIndex=manual?0:-1})}
function splitSourceRows(){const m=S.measure;if(m.settings.splitSources?.length)return m.settings.splitSources;const r=m.source||{},out=[];for(let i=1;i<=8;i++){const lot=r['LTNO'+i]||r['分割ロット'+i]||'',count=+(r['YK'+i]||r['K05JO'+i]||0),width=r['WW'+i]||r['K05W'+i]||'',tol=r['KN'+i]||i;if(lot&&count)out.push({lot:String(lot),count,width:String(width),tol:String(tol)})}if(!out.length)out.push({lot:m.basic.lotNo||'当ロット',count:Math.max(1,+$('#horizontalCount').value||1),width:m.basic.mfgWidth||'',tol:'0'});m.settings.splitSources=out;return out}
function splitGrouped(sequence,sources){const map=Object.fromEntries(sources.map(x=>[x.lot,x])),groups=[];sequence.forEach(lot=>{const last=groups.at(-1);if(last&&last.lot===lot)last.count++;else groups.push({lot,count:1,width:map[lot]?.width||'',tol:map[lot]?.tol||''})});return groups}
function renderSplit(){const sources=splitSourceRows(),seq=S.measure.settings.splitSequence||[],counts={};seq.forEach(x=>counts[x]=(counts[x]||0)+1);const total=sources.reduce((a,x)=>a+x.count,0);$('#splitSources').innerHTML='<div class="split-row head"><b>ロットNo.</b><b>横割</b><b>割幅</b><b>公差</b></div>'+sources.map((x,i)=>`<div class="split-row source ${counts[x.lot]>=x.count?'disabled':''}" data-source="${i}"><span>${esc(x.lot)}</span><span>${x.count}</span><span>${esc(x.width)}</span><span>${esc(x.tol)}</span></div>`).join('');document.querySelectorAll('[data-source]').forEach(row=>row.ondblclick=()=>{const x=sources[+row.dataset.source],used=counts[x.lot]||0;if(used<x.count){seq.push(x.lot);S.measure.settings.splitSequence=seq;renderSplit()}});const groups=splitGrouped(seq,sources);$('#splitResult').innerHTML='<div class="split-row head"><b>ロットNo.</b><b>横割</b><b>割幅</b><b>公差</b></div>'+Array.from({length:8},(_,i)=>{const g=groups[i];return `<div class="split-row ${g?'':'disabled'}"><span>${esc(g?.lot||'')}</span><span>${g?.count||''}</span><span>${esc(g?.width||'')}</span><span>${esc(g?.tol||'')}</span></div>`}).join('');$('#splitSequence').innerHTML=seq.map((x,i)=>`<li>${i+1} - ${esc(x)}</li>`).join('');$('#splitTotal').textContent=total;$('#splitLotCount').textContent=new Set(sources.map(x=>x.lot)).size;$('#splitRegistered').textContent=seq.length;$('#applySplit').disabled=seq.length!==total||groups.length>8;$('#splitGrid').innerHTML=groups.length?groups.map((g,i)=>`${i+1}. ${esc(g.lot)} / ${g.count}条 / 幅 ${esc(g.width)} / 公差 ${esc(g.tol)}`).join('<br>'):'分割無し'}
function openSplit(){if(!S.measure)return;renderSplit();$('#splitModal').hidden=false}
function applySplit(){const sources=splitSourceRows(),seq=S.measure.settings.splitSequence||[],groups=splitGrouped(seq,sources),total=sources.reduce((a,x)=>a+x.count,0);if(seq.length!==total)return alert('全条分を登録してください。');if(groups.length>8)return alert('システム上8を超える分割は設定できません。');S.measure.settings.splitGroups=groups;const tags=[];groups.forEach((g,i)=>{for(let k=0;k<g.count;k++)tags.push(g.tol)});S.measure.settings.toleranceTags=tags;$('#horizontalCount').value=total;updateCoilOptions(total);$('#splitModal').hidden=true;markDirty();setState('条割を変更しました')}
document.querySelectorAll('[data-worktab]').forEach(b=>b.onclick=()=>activateWorkspace(b.dataset.worktab));
$('#openSplit').onclick=openSplit;$('#closeSplit').onclick=()=>$('#splitModal').hidden=true;$('#undoSplit').onclick=()=>{S.measure.settings.splitSequence?.pop();renderSplit()};$('#resetSplit').onclick=()=>{S.measure.settings.splitSequence=[];renderSplit()};$('#applySplit').onclick=applySplit;
bindTabs('left','left');
$('#reloadMaster').onclick=loadMeasurementContext;
$('#verticalCount').addEventListener('change',()=>{updateLengthOptions($('#verticalCount').value);renderMeasureGrid()});
$('#horizontalCount').addEventListener('change',()=>{updateCoilOptions($('#horizontalCount').value);renderMeasureGrid()});
/* #coilNo/#coilComment/#flatAllOkはフラットネス選択時のみ動的に生成されるため、
   結びつけはrenderMeasureGridVertical側で行う（静的バインドはしない）。 */



function makeMeasureInput(key,i,j,value){const mode=key==='flatness'?'text':'decimal';return `<input data-mkey="${key}" data-i="${i}" data-j="${j}" value="${esc(value)}" inputmode="${mode}" aria-label="${j+1}条">`}
function bindMeasureInputs(){const m=S.measure;document.querySelectorAll('[data-mkey]').forEach(x=>{judgeInput(x,x.dataset.mkey,Number(x.value),+x.dataset.j);x.onclick=()=>{if(x.dataset.mkey==='thickness')m.settings.tStep=+x.dataset.j;else m.settings.wStep=+x.dataset.j;focusCurrent();$('#deviceInput').focus()};x.oninput=()=>{m.measurements[x.dataset.mkey][+x.dataset.i][+x.dataset.j]=x.value;judgeInput(x,x.dataset.mkey,Number(x.value),+x.dataset.j);renderStats();markDirty()};x.onkeydown=e=>{if(S.measure.settings.inputMode!=='manual'){e.preventDefault();return}if(e.key==='Delete'){x.value='';x.oninput()}if(e.key==='Enter'){e.preventDefault();advanceWidth();focusCurrent()}}})}
function renderMeasureGridVertical(){const type=$('#measureType').value,key=activeMeasureKey(),m=S.measure,li=lengthIndex(),count=Math.max(1,Math.min(40,+$('#horizontalCount').value||1));let h='';if(type==='板厚/板幅'){const vals=m.measurements.thickness[li];h+=`<section class="measure-grid-block"><div class="measure-grid-block-title"><span>板厚</span><span class="measure-status">${vals.filter(v=>v!=='').length===3?'測定完了':'測定待ち'}</span></div><div class="thickness-vertical"><b>位置</b><b>OS</b><b>CL</b><b>DS</b><span>丈 ${li+1}</span>${vals.map((v,j)=>makeMeasureInput('thickness',li,j,v)).join('')}</div></section>`}
 const actualKey=key==='mother'?'width':key,rows=m.measurements[actualKey],values=rows[li],label=type==='板厚/板幅'?'板幅':type,statusCount=values.slice(0,count).filter(v=>v!=='').length;h+=`<section class="measure-grid-block"><div class="measure-grid-block-title"><span>${esc(label)}</span><span class="measure-status">${statusCount===count?'測定完了':statusCount?'測定中 '+statusCount+'/'+count:'測定待ち'}</span></div><div class="strip-layout">`;for(let col=0;col<2;col++){h+=`<div class="strip-column"><div class="strip-head"><span>条</span><span>測定値</span></div>`;for(let row=0;row<20;row++){const j=col*20+row,active=j<count;h+=`<div class="strip-row ${active?'':'inactive'}"><label>${j+1}</label><div class="strip-input-wrap">${makeMeasureInput(actualKey,li,j,active?values[j]:'')}</div></div>`}h+='</div>'}h+='</div></section>';$('#measurementGrid').innerHTML=h;bindMeasureInputs();applyInputProtection();focusCurrent();updateMeasurementHeading()}
const renderMeasurementBase=renderMeasurement;renderMeasurement=function(){renderMeasurementBase();const mode=S.measure.settings.inputMode||'auto';document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x.dataset.mode===mode));activateWorkspace($('#measureType').value==='母材'?'mother':'measure');applyInputProtection();updateMeasurementHeading();updateReceiveState(document.activeElement===$('#deviceInput'))};
const renderMeasureGridBase=renderMeasureGrid;renderMeasureGrid=function(){renderMeasureGridVertical()};


function normalizedLot(value){return String(value||'').normalize('NFKC').replace(/[\s　_-]/g,'').toUpperCase()}
function ensureMeasureShape(m){if(!m)return m;m.basic=m.basic||{};m.settings={operator:'-',inspector:'-',lengthPos:'1(頭)',measureType:'母材',verticalCount:1,horizontalCount:1,unwind:'上出し',innerDiameter:'-',spool:'-',thicknessGauge:'-',widthGauge:'-',widthOrder:'通常',widthDirection:'昇順',inputMode:'auto',tStep:0,wStep:0,burrFirst:null,ngCount:0,burr:'指定なし',innerTape:false,...(m.settings||{})};m.mother=m.mother||{};m.qualityInfo=m.qualityInfo||'異常情報なし';m.measurements=m.measurements||{};const shape=(name,width)=>{const src=Array.isArray(m.measurements[name])?m.measurements[name]:[];m.measurements[name]=Array.from({length:LENGTH_SLOTS},(_,i)=>Array.from({length:width},(_,j)=>src[i]?.[j]??''))};shape('thickness',3);['width','lateral','burr','telescope','offset','flatness','comments'].forEach(k=>shape(k,40));return m}
async function refreshDraftCount(){try{const all=await idbAll(),drafts=all.filter(x=>x.status!=='完了');$('#homeDraftCount').textContent=drafts.length}catch(e){$('#homeDraftCount').textContent='!'}}
async function findDraftForRow(row){const all=await idbAll(),targetLot=normalizedLot(pick(row,'lotNo')),targetInspection=normalizedLot(pick(row,'inspectionNo')),targetCasting=normalizedLot(pick(row,'castingNo')),drafts=all.filter(x=>x.status!=='完了'&&normalizedLot(x.basic?.lotNo)===targetLot);drafts.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));return drafts.find(x=>targetInspection&&normalizedLot(x.basic?.inspectionNo)===targetInspection)||drafts.find(x=>targetCasting&&normalizedLot(x.basic?.castingNo)===targetCasting)||drafts[0]||null}
async function resumeStoredMeasure(saved,row=null){S.current=row||saved.source||null;S.measure=ensureMeasureShape(saved);if(row){S.measure.source={...(S.measure.source||{}),...row};S.measure.basic={...S.measure.basic,...Object.fromEntries(Object.keys(aliases).map(k=>[k,pick(row,k)||S.measure.basic[k]||'']))}}renderMeasurement();$('#recordModal').hidden=true;$('#measureModal').hidden=false;await loadMeasurementContext();requestAnimationFrame(()=>$('#deviceInput').focus())}
openMeasurement=async function(row){if(!row)throw Error('対象データがありません');S.current=row;const found=await findDraftForRow(row);if(found){const when=found.updatedAt?new Date(found.updatedAt).toLocaleString('ja-JP'):'';const resume=confirm(`同一ロットの編集中データが見つかりました。\n\nロット: ${found.basic?.lotNo||pick(row,'lotNo')}\n保存日時: ${when}\n状態: ${found.status||'編集中'}\n\n続きから再開しますか？\n「キャンセル」は新規データとして開きます。`);if(resume)return resumeStoredMeasure(found,row)}const m=blankMeasure(row);m.id=lotKey(row)||crypto.randomUUID();S.measure=ensureMeasureShape(m);renderMeasurement();$('#measureModal').hidden=false;await loadMeasurementContext();requestAnimationFrame(()=>$('#deviceInput').focus())}
openRecords=async function(status){const all=await idbAll(),items=all.filter(x=>status==='履歴'?x.status==='完了':x.status!=='完了').sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))),currentLot=normalizedLot(S.current?pick(S.current,'lotNo'):'');$('#recordTitle').textContent=status==='履歴'?'完了履歴':'編集中データ';$('#recordList').innerHTML=items.length?`<div class="resume-notice">${items.length}件あります。再開するロットの「続きから再開」を選択してください。</div>`:'<p>対象データはありません。</p>';items.forEach(x=>{ensureMeasureShape(x);const same=currentLot&&normalizedLot(x.basic?.lotNo)===currentLot,c=document.createElement('article');c.className='record-card'+(same?' is-same-lot':'');c.innerHTML=`<h3>${esc(x.basic?.lotNo||x.id)} ${same?'<small>選択中の仕掛と同一ロット</small>':''}</h3><div class="record-meta"><b>検査番号</b><span>${esc(x.basic?.inspectionNo||'-')}</span><b>鋳造番号</b><span>${esc(x.basic?.castingNo||'-')}</span><b>状態</b><span>${esc(x.status||'編集中')}</span><b>保存日時</b><span>${esc(x.updatedAt?new Date(x.updatedAt).toLocaleString('ja-JP'):'-')}</span></div><div><button class="resume">${status==='履歴'?'プレビュー':'続きから再開'}</button><button class="danger">削除</button></div>`;c.querySelector('.resume').onclick=()=>resumeStoredMeasure(x,same?S.current:null);c.querySelector('.danger').onclick=async()=>{if(confirm('この端末内データを削除しますか？')){await idbDelete(x.id);await refreshDraftCount();openRecords(status)}};$('#recordList').append(c)});$('#recordModal').hidden=false}
const saveLocalV29=saveLocal;saveLocal=async function(status='編集中'){const result=await saveLocalV29(status);await refreshDraftCount();return result}
function toleranceInfoFor(key,index,value){
 if(key==='flatness'){const v=String(value||'').trim();return v===''?{tol:null,state:'wait',pos:50}:{tol:null,state:v==='〇'?'ok':'ng',pos:50}}
 const tol=toleranceFor(key==='thickness'?'thickness':'width',index),num=Number(value);if(!tol||!Number.isFinite(num))return{tol,state:'wait',pos:50};const low=tol[0],high=tol[1],span=Math.max(Math.abs(high-low),.000001),viewLow=low-span*.25,viewHigh=high+span*.25,pos=Math.max(0,Math.min(100,(viewHigh-num)/(viewHigh-viewLow)*100));return{tol,state:num<low||num>high?'ng':'ok',pos}}
function makeToleranceVisual(key,values,count){const valid=values.slice(0,count).map(Number).filter(Number.isFinite),tol=toleranceFor(key==='thickness'?'thickness':'width');if(!tol)return'<aside class="tolerance-visual"><div class="tol-caption">公差情報なし</div></aside>';const markers=valid.slice(-12).map(v=>{const t=toleranceInfoFor(key,0,v);return`<i class="value-marker ${t.state}" style="top:${t.pos}%" title="${v}"></i>`}).join('');return`<aside class="tolerance-visual"><b class="tol-upper">上限 ${tol[1]}</b><span class="tol-caption">公差内</span>${markers}<b class="tol-lower">下限 ${tol[0]}</b></aside>`}
function makeMeasureInputV29(key,i,j,value,active=true){const info=toleranceInfoFor(key,j,value),pill=active&&value!==''?`<span class="judge-pill ${info.state}">${info.state==='ok'?'OK':'NG'}</span>`:'';return `<div class="strip-input-wrap">${makeMeasureInput(key,i,j,value)}${pill}</div>`}
renderMeasureGridVertical=function(){const type=$('#measureType').value,key=activeMeasureKey(),m=S.measure,li=lengthIndex(),count=Math.max(1,Math.min(40,+$('#horizontalCount').value||1));let h='';if(type==='板厚/板幅'){const vals=m.measurements.thickness[li],status=vals.filter(v=>v!=='').length;h+=`<section class="measure-grid-block compact-thickness"><div class="measure-grid-block-title"><span>板厚</span><span class="measure-status">${status===3?'測定完了':status?'測定中 '+status+'/3':'測定待ち'}</span></div><div class="thickness-vertical"><b>位置</b><b>OS</b><b>CL</b><b>DS</b><span>丈 ${li+1}</span>${vals.map((v,j)=>makeMeasureInput('thickness',li,j,v)).join('')}</div></section>`}const actualKey=key==='mother'?'width':key,values=m.measurements[actualKey][li],label=type==='板厚/板幅'?'板幅':type,statusCount=values.slice(0,count).filter(v=>v!=='').length;h+=`<section class="measure-grid-block"><div class="measure-grid-block-title"><span>${esc(label)}</span><span class="measure-status">${statusCount===count?'測定完了':statusCount?'測定中 '+statusCount+'/'+count:'測定待ち'}</span></div><div class="strip-layout-shell">${makeToleranceVisual(actualKey,values,count)}<div class="strip-layout">`;for(let col=0;col<2;col++){h+=`<div class="strip-column"><div class="strip-head"><span>条</span><span>測定値・判定</span></div>`;for(let row=0;row<20;row++){const j=col*20+row,active=j<count;h+=`<div class="strip-row ${active?'':'inactive'}"><label>${j+1}</label>${makeMeasureInputV29(actualKey,li,j,active?values[j]:'',active)}</div>`}h+='</div>'}h+='</div></div></section>';$('#measurementGrid').innerHTML=h;bindMeasureInputs();applyInputProtection();focusCurrent();updateMeasurementHeading()}


/* v30: non-blocking automatic draft resume and three right-side layouts */
function showToast(title, detail='', duration=3400){
 const area=$('#toastArea'); if(!area)return;
 const item=document.createElement('div'); item.className='toast';
 item.innerHTML=`<b>${esc(title)}</b>${detail?`<small>${esc(detail)}</small>`:''}`;
 area.append(item); setTimeout(()=>{item.classList.add('out');setTimeout(()=>item.remove(),220)},duration);
}
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
const collectV30Base=collect;
collect=function(){
 const m=collectV30Base();m.product=m.product&&Array.isArray(m.product.rows)?m.product:{rows:Array.from({length:LENGTH_SLOTS},blankProductRow)};
 document.querySelectorAll('#productRowsBody tr').forEach(tr=>{
  const i=+tr.dataset.row,row=m.product.rows[i]=m.product.rows[i]||blankProductRow();
  tr.querySelectorAll('[data-product-field]').forEach(el=>row[el.dataset.productField]=el.value);
 });
 return m;
};
const ensureMeasureShapeV30Base=ensureMeasureShape;
ensureMeasureShape=function(m){
 m=ensureMeasureShapeV30Base(m);
 if(!m.product||!Array.isArray(m.product.rows)){
  const legacy=m.product&&typeof m.product==='object'?m.product:null;
  m.product={rows:Array.from({length:LENGTH_SLOTS},blankProductRow)};
  if(legacy&&(legacy.productLength||legacy.wallThickness||legacy.alignmentCode)){
   Object.assign(m.product.rows[0],{productLength:legacy.productLength||'',wallThickness:legacy.wallThickness||'',alignmentCode:legacy.alignmentCode||'',edgeShape:legacy.edgeShape||'',occurrencePosition:legacy.occurrencePosition||'',regularity:legacy.regularity||'',pitch:legacy.pitch||'',alignmentValue:legacy.alignmentValue||''});
  }
 }else if(m.product.rows.length<LENGTH_SLOTS){
  while(m.product.rows.length<LENGTH_SLOTS)m.product.rows.push(blankProductRow());
 }
 return m;
};
const renderMeasurementV30Base=renderMeasurement;
renderMeasurement=function(){productActiveLen=1;renderMeasurementV30Base();renderProductPanel();applyRightLayout()};
if($('#productAllOk'))$('#productAllOk').onclick=()=>{
 const n=productRowCount();
 for(let i=0;i<n;i++){const row=S.measure.product.rows[i]=S.measure.product.rows[i]||blankProductRow();Object.assign(row,{alignmentCode:'0000',edgeShape:'0',occurrencePosition:'0',regularity:'0',alignmentValue:'0'})}
 renderProductPanel();markDirty();
};
$('#verticalCount')?.addEventListener('change',()=>{if($('#measureType').value==='揃い/肉厚/長さ')renderProductPanel()});
$('#measureType').onchange=()=>{S.measure.settings.wStep=0;S.measure.settings.tStep=0;S.measure.settings.burrFirst=null;S.measure.settings.measureType=$('#measureType').value;applyRightLayout();$('#deviceInput').focus();markDirty()};
openMeasurement=async function(row){
 if(!row)throw Error('対象データがありません'); S.current=row;
 const found=await findDraftForRow(row);
 if(found){
  await resumeStoredMeasure(found,row);
  const when=found.updatedAt?new Date(found.updatedAt).toLocaleString('ja-JP'):'';
  showToast('編集中データを読み込みました',`ロット ${found.basic?.lotNo||pick(row,'lotNo')} / 保存日時 ${when}`);
  return;
 }
 const m=blankMeasure(row);m.id=lotKey(row)||crypto.randomUUID();S.measure=ensureMeasureShape(m);
 renderMeasurement();$('#measureModal').hidden=false;await loadMeasurementContext();
 requestAnimationFrame(()=>$('#deviceInput').focus());
};


/* v31: VBA-compatible manual mother entry, reliable persistence, complete resume snapshot */
const MIRROR_KEY='MeasurementLocalMirrorV31';
function mirrorRead(){try{return JSON.parse(localStorage.getItem(MIRROR_KEY)||'{}')}catch(e){console.warn('mirror read failed',e);return {}}}
function mirrorWrite(record){const all=mirrorRead();all[record.id]=record;localStorage.setItem(MIRROR_KEY,JSON.stringify(all))}
function mirrorDelete(id){const all=mirrorRead();delete all[id];localStorage.setItem(MIRROR_KEY,JSON.stringify(all))}
async function reliableAll(){
 const merged=new Map(Object.entries(mirrorRead()));
 try{(await idbAll()).forEach(x=>merged.set(x.id,x))}catch(e){console.warn('IndexedDB list failed, mirror used',e)}
 return [...merged.values()].map(ensureMeasureShape);
}
async function reliableGet(id){
 try{const x=await idbGet(id);if(x)return ensureMeasureShape(x)}catch(e){console.warn('IndexedDB get failed, mirror used',e)}
 const x=mirrorRead()[id];return x?ensureMeasureShape(x):null;
}
async function reliablePut(record){
 let idbOK=false,mirrorOK=false;
 try{await idbPut(record);idbOK=true}catch(e){console.error('IndexedDB save failed',e)}
 try{mirrorWrite(record);mirrorOK=true}catch(e){console.error('mirror save failed',e)}
 if(!idbOK&&!mirrorOK)throw Error('端末内保存に失敗しました。ブラウザーの保存領域を確認してください。');
 return{idbOK,mirrorOK};
}
async function reliableDelete(id){try{await idbDelete(id)}catch(e){console.warn(e)}try{mirrorDelete(id)}catch(e){console.warn(e)}}
function applyContextSnapshot(x){
 const m=S.measure;if(!m||!x)return;
 optionFill('operator',x.operators,m.settings.operator);optionFill('inspector',x.inspectors||x.operators,m.settings.inspector);
 optionFill('thicknessGauge',x.thickness_gauges,m.settings.thicknessGauge);optionFill('widthGauge',x.width_gauges,m.settings.widthGauge);
 optionFill('innerDiameter',x.inner_diameters,m.settings.innerDiameter);optionFill('spool',x.spools,m.settings.spool);
 if(x.quality?.length){m.qualityInfo=qualityText(x.quality)}
 $('#qualityInfo').value=m.qualityInfo||'異常情報なし';if($('#motherQualityInfo'))$('#motherQualityInfo').value=$('#qualityInfo').value;
 $('#masterDiagnostic').textContent=JSON.stringify(x.diagnostics||{},null,2);
}
loadMeasurementContext=async function(force=false){
 const m=S.measure;if(!m)return;
 if(m.snapshot?.context&&!force){applyContextSnapshot(m.snapshot.context);setState('保存済み参照データを復元');return m.snapshot.context}
 const u=new URLSearchParams({lot:m.basic.lotNo,equipment:m.basic.equipment});
 try{
  setState('仕掛・品質・マスタ読込中');const x=await api('/api/measurement/context?'+u);
  m.snapshot=m.snapshot||{};m.snapshot.context=structuredClone(x);m.snapshot.source=structuredClone(m.source||{});m.snapshot.basic=structuredClone(m.basic||{});
  m.snapshot.loadedAt=new Date().toISOString();m.snapshot.schema='v32-full';
  applyContextSnapshot(x);setState(`初期参照データを格納済み / 品質情報 ${x.quality?.length||0}件`);return x;
 }catch(e){setState('参照データ読込エラー');$('#masterDiagnostic').textContent=e.stack||e.message;throw e}
};
const applyInputProtectionV31Base=applyInputProtection;
applyInputProtection=function(){
 applyInputProtectionV31Base();
 const mother=$('#measureType')?.value==='母材';
 if(mother)document.querySelectorAll('[data-mother]').forEach(el=>{el.readOnly=false;el.disabled=false;el.tabIndex=0;el.classList.remove('auto-locked');el.title='母材は手動入力できます'});
 /* フラットネスは測定器転送の対象外(〇/△/×または自由記述)のため、
    転送モードに関わらず常にセルへ直接入力できるようにする。 */
 if($('#measureType')?.value==='フラットネス')document.querySelectorAll('input[data-mkey="flatness"]').forEach(el=>{el.readOnly=false;el.tabIndex=0;el.classList.remove('auto-locked');el.title='記号(〇/△/×)または自由記述を入力できます'});
};
encodePayload=function(m){return JSON.stringify(m)};
function showSaveOverlay(title,detail){$('#saveOverlayTitle').textContent=title;$('#saveOverlayDetail').textContent=detail;$('#saveOverlay').hidden=false}
function hideSaveOverlay(){$('#saveOverlay').hidden=true}
async function backupRecord(m){
 const x={id:m.id,equipment:m.basic.equipment,lotNo:m.basic.lotNo,inspectionNo:m.basic.inspectionNo,castingNo:m.basic.castingNo,status:m.status,codec:'json-full-v32',payload:encodePayload(m)};
 return api('/api/measurement/backup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(x)});
}
async function persistAndTransition(status){
 showSaveOverlay(status==='完了'?'完了登録しています':'一時保存しています','入力内容と初期参照データを端末へ保存中');
 try{
  const m=collect();m.status=status;m.updatedAt=new Date().toISOString();m.snapshot=m.snapshot||{};
  m.snapshot.source=structuredClone(m.source||{});m.snapshot.basic=structuredClone(m.basic||{});m.snapshot.savedAt=m.updatedAt;m.snapshot.schema='v32-full';
  const result=await reliablePut(m);let accessOK=true;
  try{await backupRecord(m)}catch(e){accessOK=false;console.warn('Access backup failed',e)}
  await refreshDraftCount();$('#measureModal').hidden=true;hideSaveOverlay();
  showToast(status==='完了'?'完了登録しました':'一時保存しました',`${m.basic.lotNo||''} / IndexedDB ${result.idbOK?'OK':'代替保存'} / Access ${accessOK?'OK':'未完了'}`,6500);
  await openRecords(status==='完了'?'履歴':'編集中');
 }catch(e){hideSaveOverlay();setState('保存エラー');alert('保存できませんでした: '+e.message)}
}
refreshDraftCount=async function(){try{const all=await reliableAll();$('#homeDraftCount').textContent=all.filter(x=>x.status!=='完了').length}catch(e){$('#homeDraftCount').textContent='!'}};
findDraftForRow=async function(row){
 const all=await reliableAll(),targetLot=normalizedLot(pick(row,'lotNo')),targetInspection=normalizedLot(pick(row,'inspectionNo')),targetCasting=normalizedLot(pick(row,'castingNo'));
 const drafts=all.filter(x=>x.status!=='完了'&&normalizedLot(x.basic?.lotNo)===targetLot).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
 return drafts.find(x=>targetInspection&&normalizedLot(x.basic?.inspectionNo)===targetInspection)||drafts.find(x=>targetCasting&&normalizedLot(x.basic?.castingNo)===targetCasting)||drafts[0]||null;
};
openRecords=async function(status){
 const all=await reliableAll(),items=all.filter(x=>status==='履歴'?x.status==='完了':x.status!=='完了').sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
 $('#recordTitle').textContent=status==='履歴'?'完了履歴':'編集中データ一覧';$('#recordList').innerHTML='';
 const bar=document.createElement('div');bar.className='record-toolbar';bar.innerHTML=`<span>${items.length}件　保存先: IndexedDB＋ブラウザー代替領域</span><button type="button">一覧を再読込</button>`;bar.querySelector('button').onclick=()=>openRecords(status);$('#recordList').append(bar);
 if(!items.length){const e=document.createElement('div');e.className='record-empty';e.textContent='対象データはありません。';$('#recordList').append(e)}
 items.forEach(x=>{const c=document.createElement('article');c.className='record-card';c.innerHTML=`<h3>${esc(x.basic?.lotNo||x.id)}</h3><div class="record-meta"><b>検査番号</b><span>${esc(x.basic?.inspectionNo||'-')}</span><b>鋳造番号</b><span>${esc(x.basic?.castingNo||'-')}</span><b>保存日時</b><span>${esc(x.updatedAt?new Date(x.updatedAt).toLocaleString('ja-JP'):'-')}</span><b>保存形式</b><span>${esc(x.snapshot?.schema||'旧形式')}</span></div><div><button class="resume">${status==='履歴'?'内容を開く':'続きから再開'}</button><button class="danger">削除</button></div>`;
  c.querySelector('.resume').onclick=async()=>{S.measure=ensureMeasureShape(x);S.current=x.source||x.snapshot?.source||null;renderMeasurement();$('#recordModal').hidden=true;$('#measureModal').hidden=false;await loadMeasurementContext(false);showToast('保存データを復元しました',`${x.basic?.lotNo||''} / ${x.snapshot?.schema||'旧形式'}`)};
  c.querySelector('.danger').onclick=async()=>{if(confirm('この端末内データを削除しますか？')){await reliableDelete(x.id);await refreshDraftCount();openRecords(status)}};$('#recordList').append(c)
 });$('#recordModal').hidden=false;
};
resumeStoredMeasure=async function(saved,row=null){S.current=row||saved.source||saved.snapshot?.source||null;S.measure=ensureMeasureShape(saved);renderMeasurement();$('#recordModal').hidden=true;$('#measureModal').hidden=false;await loadMeasurementContext(false);requestAnimationFrame(()=>$('#deviceInput').focus())};
openMeasurement=async function(row){
 if(!row)throw Error('対象データがありません');S.current=row;const found=await findDraftForRow(row);
 if(found){await openRecords('編集中');showToast('編集中データがあります','一覧から再開するデータを選択してください。');return}
 const m=blankMeasure(row);m.id=lotKey(row)||crypto.randomUUID();S.measure=ensureMeasureShape(m);renderMeasurement();$('#measureModal').hidden=false;
 await loadMeasurementContext(true);await reliablePut(collect());await refreshDraftCount();requestAnimationFrame(()=>$('#deviceInput').focus());
};
$('#saveDraft').onclick=()=>persistAndTransition('編集中');
$('#complete').onclick=()=>persistAndTransition('完了');
$('#backupNow').onclick=async()=>{showSaveOverlay('Accessへバックアップ','完全スナップショットを送信中');try{const m=collect();await reliablePut(m);await backupRecord(m);hideSaveOverlay();showToast('Accessバックアップ完了',m.basic.lotNo||'')}catch(e){hideSaveOverlay();alert('バックアップ失敗: '+e.message)}};
$('#discard').onclick=async()=>{if(confirm('端末内の測定データを削除しますか？')){await reliableDelete(S.measure.id);await refreshDraftCount();$('#measureModal').hidden=true}};
$('#homeDrafts').onclick=()=>openRecords('編集中');$('#openDrafts').onclick=()=>openRecords('編集中');


// v32 final navigation controller
function bindV32Navigation(){
 const open=async status=>{try{await openRecords(status)}catch(e){console.error(e);alert('保存データ一覧を開けません: '+e.message)}};
 [['homeDrafts','編集中'],['homeHistory','履歴'],['openDrafts','編集中'],['openHistory','履歴']].forEach(([id,status])=>{const b=$('#'+id);if(b){b.onclick=null;b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();open(status)})}})
}
// 仕掛からは最新の同一ロットを直接再開。一覧ルートは左ボタンに独立して残す。
openMeasurement=async function(row){
 if(!row)throw Error('対象データがありません');S.current=row;const found=await findDraftForRow(row);
 if(found){await resumeStoredMeasure(found,row);showToast('編集中データを直接再開しました',`${found.basic?.lotNo||pick(row,'lotNo')} / ${found.updatedAt?new Date(found.updatedAt).toLocaleString('ja-JP'):''}`);return}
 const m=blankMeasure(row);m.id=lotKey(row)||crypto.randomUUID();S.measure=ensureMeasureShape(m);renderMeasurement();$('#measureModal').hidden=false;await loadMeasurementContext(true);await reliablePut(collect());await refreshDraftCount();requestAnimationFrame(()=>$('#deviceInput').focus())
};
const initV32Base=init;init=async function(){try{await initV32Base()}catch(e){console.error('初期化エラー',e);showToast('初期化の一部に失敗',e.message,8000)}finally{bindV32Navigation()}};

// Current: record list opens immediately, then loads storage asynchronously.
async function openRecordsSafe(status='編集中'){
 const modal=$('#recordModal'),title=$('#recordTitle'),list=$('#recordList');
 title.textContent=status==='履歴'?'完了データ':'保存データから再開';
 list.innerHTML='<div class="record-loading">保存データを読み込んでいます...</div>';
 modal.hidden=false;
 try{await openRecords(status)}catch(error){
  console.error('record list error',error);
  list.innerHTML=`<div class="record-empty"><b>保存データを表示できませんでした。</b><div class="save-result">${esc(error?.message||String(error))}</div><button id="retryRecordList" type="button">再読込</button></div>`;
  $('#retryRecordList').onclick=()=>openRecordsSafe(status);
 }
}
// Capture phase keeps the navigation working even if another handler fails or is overwritten.
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-open-records],#homeDrafts,#homeHistory,#openDrafts,#openHistory');
 if(!button)return;
 event.preventDefault();event.stopImmediatePropagation();
 const status=button.dataset.openRecords||(button.id==='homeHistory'||button.id==='openHistory'?'履歴':'編集中');
 openRecordsSafe(status);
},true);


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
// Fix empty string being interpreted as numeric zero, while keeping red for tolerance NG.
judgeInput=function(el,key,value,index){
 el.classList.remove('ng','complete');
 if(key==='flatness'){
  if(String(el.value||'').trim()!=='')el.classList.add('complete');
  return;
 }
 const raw=String(el.value??'').trim(),tol=toleranceFor(key==='thickness'?'thickness':'width',index),num=Number(raw);
 if(raw!==''&&Number.isFinite(num)){el.classList.add('complete');if(tol&&(num<tol[0]||num>tol[1]))el.classList.add('ng')}
};
const persistAndTransitionValidated=persistAndTransition;
persistAndTransition=async function(status){
 updateValidationVisuals();
 if(status==='完了'){const result=updateValidationVisuals();if(result.missing.length||result.ng.length){showValidationMessage(result);return}}
 return persistAndTransitionValidated(status);
};
const renderMeasurementValidated=renderMeasurement;
renderMeasurement=function(){renderMeasurementValidated();requestAnimationFrame(updateValidationVisuals)};
const renderMeasureGridValidated=renderMeasureGrid;
renderMeasureGrid=function(){renderMeasureGridValidated();requestAnimationFrame(updateValidationVisuals)};
document.addEventListener('input',event=>{if(event.target.matches('input,select,textarea'))updateValidationVisuals()},true);
document.addEventListener('change',event=>{if(event.target.matches('input,select,textarea'))updateValidationVisuals()},true);
$('#complete').onclick=()=>persistAndTransition('完了');


// Information architecture: basic / quality grade / data management.
const qualityGradeFields=[
 ['生地外観',['生地外観','品質等級_生地外観','QCD1','RQCD1']],['フラットネス',['フラットネス等級','品質等級_フラットネス','QCD2','RQCD2']],
 ['付着油',['付着油','品質等級_付着油','QCD3','RQCD3']],['切断面',['切断面','品質等級_切断面','QCD4','RQCD4']],
 ['板厚公差',['板厚公差等級','品質等級_板厚公差','QCD5','RQCD5']],['幅丈公差',['幅丈公差','巾丈公差','品質等級_幅丈公差','QCD6','RQCD6']],
 ['ラテラルボー',['ラテラルボー等級','品質等級_ラテラルボー','QCD7','RQCD7']],['直角度',['直角度','品質等級_直角度','QCD8','RQCD8']],
 ['方向性',['方向性','品質等級_方向性','QCD9','RQCD9']],['強度',['強度','品質等級_強度','QCD10','RQCD10']],
 ['アルマイト',['アルマイト','品質等級_アルマイト','QCD11','RQCD11']],['表面処理',['表面処理','品質等級_表面処理','QCD15','RQCD15']]
];
function sourceValue(names){const r=S.measure?.source||S.measure?.snapshot?.source||{};for(const n of names){if(r[n]!==undefined&&r[n]!==null&&String(r[n]).trim()!=='')return String(r[n])}return ''}
function hydrateBusinessFields(){
 if(!S.measure)return;const b=S.measure.basic||(S.measure.basic={}),r=S.measure.source||S.measure.snapshot?.source||{};
 const extra={
  customer:['取引先','取引先名','得意先','得意先名','TOKUNA','TOKU_NA'],delivery:['納入先','納入先名','受渡先','NONNA','NON_NA'],
  course:['実績コース','実績設備コース','実績設備ｺｰｽ','設計コース','残仕掛設備コース','残仕掛設備ｺｰｽ','JBSMC','SBSMC','ZANMC'],
  orderNo:['オーダー番号','ｵｰﾀﾞｰ番号','受注番号','JUON','JUNO'],orderMaterial:['オーダー材質','ｵｰﾀﾞｰ材質','JUA'],orderTemper:['オーダー調質','ｵｰﾀﾞｰ調質','JUB'],
  orderThickness:['オーダー板厚','ｵｰﾀﾞｰ板厚','JUX'],orderWidth:['オーダー板幅','ｵｰﾀﾞｰ板幅','JUY'],orderLength:['オーダー板丈','ｵｰﾀﾞｰ板丈','JUZ']
 };
 Object.entries(extra).forEach(([k,names])=>{if(!b[k]){for(const n of names){if(r[n]!==undefined&&r[n]!==null&&String(r[n]).trim()!==''){b[k]=String(r[n]);break}}}})
}
function renderQualityGradePanel(){
 const panel=$('#qualityGradePanel');if(!panel)return;
 const m=S.measure;m.qualityGrades=m.qualityGrades||{};
 qualityGradeFields.forEach(([label,names])=>{if(!m.qualityGrades[label])m.qualityGrades[label]=sourceValue(names)});
 panel.innerHTML=`<div class="quality-grade-grid">${qualityGradeFields.map(([label])=>`<div class="quality-grade-item"><b>${esc(label)}</b><span title="${esc(m.qualityGrades[label]||'')}">${esc(m.qualityGrades[label]||'未設定')}</span></div>`).join('')}</div>`;
}
function renderDataManagementPanel(){
 const panel=$('#dataManagementPanel');if(!panel)return;hydrateBusinessFields();const b=S.measure.basic;
 const rows=[['取引先',b.customer],['納入先',b.delivery],['実績コース',b.course],['オーダー番号',b.orderNo],['オーダー材質',b.orderMaterial],['オーダー調質',b.orderTemper],['オーダー板厚',b.orderThickness],['オーダー板幅',b.orderWidth],['オーダー板丈',b.orderLength]];
 panel.innerHTML=`<div class="data-management-grid">${rows.map(([l,v])=>`<b>${esc(l)}</b><span title="${esc(v||'')}">${esc(v||'未設定')}</span>`).join('')}</div>`;
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
const renderMeasurementInfoBase=renderMeasurement;
renderMeasurement=function(){hydrateBusinessFields();renderMeasurementInfoBase();upgradeManualInputTypes();renderQualityGradePanel();renderDataManagementPanel();bindInfoTabs()};


// Exact source fields requested by the operation database.
const QUALITY_GRADE_SOURCE={
 '生地外観':['品質ｸﾞﾚｰﾄﾞ_生地外観'],'フラットネス':['品質ｸﾞﾚｰﾄﾞ_ﾌﾗｯﾄﾈｽ','品質ｸﾞﾚｰﾄﾞ_フラットネス'],
 '付着油':['品質ｸﾞﾚｰﾄﾞ_付着油'],'切断面':['品質ｸﾞﾚｰﾄﾞ_切断面'],'板厚公差':['品質ｸﾞﾚｰﾄﾞ_板厚公差'],
 '幅丈公差':['品質ｸﾞﾚｰﾄﾞ_幅丈公差','品質ｸﾞﾚｰﾄﾞ_巾丈公差'],'ラテラルボー':['品質ｸﾞﾚｰﾄﾞ_ﾗﾃﾗﾙﾎﾞｰ','品質ｸﾞﾚｰﾄﾞ_ラテラルボー'],
 '直角度':['品質ｸﾞﾚｰﾄﾞ_直角度'],'方向性':['品質ｸﾞﾚｰﾄﾞ_方向性'],'強度':['品質ｸﾞﾚｰﾄﾞ_強度'],
 'アルマイト':['品質ｸﾞﾚｰﾄﾞ_ｱﾙﾏｲﾄ','品質ｸﾞﾚｰﾄﾞ_アルマイト'],'表面処理':['品質ｸﾞﾚｰﾄﾞ_表面処理']
};
function configuredToleranceSource(){return S.measure?.settings?.toleranceSource||'manufacturing'}
function toleranceFieldValue(names){const r=S.measure?.source||S.measure?.snapshot?.source||{};for(const n of names){const v=r[n];if(v!==undefined&&v!==null&&String(v).trim()!==''){const num=Number(v);if(Number.isFinite(num))return num}}return NaN}
function toleranceDetail(kind,index=0){
 const b=S.measure.basic,requested=configuredToleranceSource(),isT=kind==='thickness',base=Number(isT?b.mfgThickness:b.mfgWidth);
 const orderPlus=isT?['板厚公差_ｵｰﾀﾞｰ_プラス','板厚公差_オーダー_プラス','KOSAXSOP']:['板幅公差_ｵｰﾀﾞｰ_プラス','板幅公差_オーダー_プラス','KOSAYSOP'];
 const orderMinus=isT?['板厚公差_ｵｰﾀﾞｰ_マイナス','板厚公差_オーダー_マイナス','KOSAXSOM']:['板幅公差_ｵｰﾀﾞｰ_マイナス','板幅公差_オーダー_マイナス','KOSAYSOM'];
 const mfgPlus=isT?['板厚公差_製造_プラス','KOSAXSMP']:['板幅公差_製造_プラス','KOSAYSMP'];
 const mfgMinus=isT?['板厚公差_製造_マイナス','KOSAXSMM']:['板幅公差_製造_マイナス','KOSAYSMM'];
 let source=requested,plus=toleranceFieldValue(requested==='order'?orderPlus:mfgPlus),minus=toleranceFieldValue(requested==='order'?orderMinus:mfgMinus),fallback=false;
 if((!Number.isFinite(plus)||!Number.isFinite(minus))&&requested==='order'){source='manufacturing';fallback=true;plus=toleranceFieldValue(mfgPlus);minus=toleranceFieldValue(mfgMinus)}
 return Number.isFinite(base)&&Number.isFinite(plus)&&Number.isFinite(minus)?{range:[base-minus,base+plus],source,fallback,plus,minus}:null;
}
toleranceFor=function(kind,index=0){return toleranceDetail(kind,index)?.range||null};
updateMeasurementHeading=function(){
 const type=$('#measureType').value,kind=type==='板厚/板幅'?'thickness':'width',detail=toleranceDetail(kind);
 $('#measurePanelTitle').textContent=type==='板厚/板幅'?'板厚・板幅測定':type+'測定';
 if(!detail){$('#toleranceSummary').innerHTML='<span class="tolerance-source-badge">公差なし</span>公差情報がありません。';return}
 const label=detail.source==='order'?'オーダー公差':'製造公差',fallback=detail.fallback?'（オーダー公差未設定のため製造公差へ切替）':'';
 $('#toleranceSummary').innerHTML=`<span class="tolerance-source-badge ${detail.source==='order'?'order':''}">${label}</span>許容範囲 ${detail.range[0]} ～ ${detail.range[1]} ${fallback}`;
};
function configureToleranceSelector(){const el=$('#toleranceSource');if(!el||!S.measure)return;el.value=configuredToleranceSource();el.onchange=()=>{S.measure.settings.toleranceSource=el.value;renderMeasureGrid();updateMeasurementHeading();markDirty()}}
const hydrateBusinessExactBase=hydrateBusinessFields;
hydrateBusinessFields=function(){hydrateBusinessExactBase();const r=S.measure.source||S.measure.snapshot?.source||{};if(r['実績_設備ｺｰｽ']!==undefined&&r['実績_設備ｺｰｽ']!==null)S.measure.basic.course=String(r['実績_設備ｺｰｽ'])};
renderQualityGradePanel=function(){const panel=$('#qualityGradePanel');if(!panel)return;const m=S.measure;m.qualityGrades=m.qualityGrades||{};Object.entries(QUALITY_GRADE_SOURCE).forEach(([label,names])=>m.qualityGrades[label]=sourceValue(names));panel.innerHTML=`<div class="quality-grade-grid">${Object.keys(QUALITY_GRADE_SOURCE).map(label=>`<div class="quality-grade-item"><b>${esc(label)}</b><span title="${esc(m.qualityGrades[label]||'')}">${esc(m.qualityGrades[label]||'未設定')}</span></div>`).join('')}</div>`};
// Add an explicit virtual action column instead of writing into the last data column.
renderGrid=function(){
 const t=document.createElement('table'),isWork=S.db==='SIKALOTNOW';t.innerHTML='<thead><tr><th>#</th>'+S.columns.map(c=>`<th>${esc(c)}</th>`).join('')+(isWork?'<th class="measurement-action-head">測定</th>':'')+'</tr></thead>';const b=document.createElement('tbody');
 S.rows.forEach((r,i)=>{const tr=document.createElement('tr');tr.innerHTML=`<td>${(S.page-1)*+$('#pageSize').value+i+1}</td>`+S.columns.map(c=>`<td>${esc(r[c])}</td>`).join('')+(isWork?'<td class="measurement-action-cell"><button type="button" class="measurement-action-button">開く</button></td>':'');if(isWork){tr.classList.add('measurement-row');const open=e=>{e.preventDefault();e.stopPropagation();openMeasurement(r).catch(err=>alert('測定画面を開けません: '+err.message))};tr.addEventListener('dblclick',open);tr.querySelector('.measurement-action-button').onclick=open}b.append(tr)});
 t.append(b);$('#grid').replaceChildren(t);$('#count').textContent=`全 ${S.count.toLocaleString()}件`;$('#page').textContent=`${S.page}ページ`;$('#prev').disabled=S.page===1;$('#next').disabled=S.page*+$('#pageSize').value>=S.count;
};
const renderMeasurementExactBase=renderMeasurement;
renderMeasurement=function(){renderMeasurementExactBase();configureToleranceSelector();updateMeasurementHeading()};


// Database field normalization supports half-width/full-width variants such as ﾌﾟﾗｽ / プラス.
function normalizedFieldName(name){return String(name||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase()}
function fieldNumberByRule({prefixes=[],contains=[],sign}){
 const r=S.measure?.source||S.measure?.snapshot?.source||{},signWord=sign==='plus'?'プラス':'マイナス';
 for(const [key,value] of Object.entries(r)){
  const n=normalizedFieldName(key);
  if(prefixes.length&&!prefixes.some(x=>n.includes(normalizedFieldName(x))))continue;
  if(contains.length&&!contains.every(x=>n.includes(normalizedFieldName(x))))continue;
  if(!n.includes(signWord))continue;
  const num=Number(value);if(Number.isFinite(num))return{value:num,key};
 }
 return null;
}
function exactFieldNumber(names){const r=S.measure?.source||S.measure?.snapshot?.source||{};for(const requested of names){const rn=normalizedFieldName(requested);for(const [key,value] of Object.entries(r)){if(normalizedFieldName(key)===rn){const num=Number(value);if(Number.isFinite(num))return{value:num,key}}}}return null}
function instructedTolerance(kind,sign){
 const dimension=kind==='thickness'?'板厚':'板幅';
 return fieldNumberByRule({prefixes:['指示_'],contains:[dimension],sign})||fieldNumberByRule({prefixes:['指示_'],contains:[kind==='thickness'?'厚':'幅'],sign});
}
// Replace tolerance resolution with normalized exact matching and instruction-source support.
toleranceDetail=function(kind,index=0){
 const b=S.measure.basic,requested=configuredToleranceSource(),isT=kind==='thickness',base=Number(isT?b.mfgThickness:b.mfgWidth),dimension=isT?'板厚':'板幅';
 const fields={
  manufacturing:{plus:[`${dimension}公差_製造_ﾌﾟﾗｽ`,`${dimension}公差_製造_プラス`,isT?'KOSAXSMP':'KOSAYSMP'],minus:[`${dimension}公差_製造_ﾏｲﾅｽ`,`${dimension}公差_製造_マイナス`,isT?'KOSAXSMM':'KOSAYSMM']},
  order:{plus:[`${dimension}公差_ｵｰﾀﾞｰ_ﾌﾟﾗｽ`,`${dimension}公差_オーダー_プラス`,isT?'KOSAXSOP':'KOSAYSOP'],minus:[`${dimension}公差_ｵｰﾀﾞｰ_ﾏｲﾅｽ`,`${dimension}公差_オーダー_マイナス`,isT?'KOSAXSOM':'KOSAYSOM']}
 };
 let source=requested,plus,minus,plusKey='',minusKey='',fallback=false;
 if(requested==='instruction'){
  const p=instructedTolerance(kind,'plus'),m=instructedTolerance(kind,'minus');plus=p?.value;minus=m?.value;plusKey=p?.key||'';minusKey=m?.key||'';
 }else{
  const p=exactFieldNumber(fields[requested].plus),m=exactFieldNumber(fields[requested].minus);plus=p?.value;minus=m?.value;plusKey=p?.key||'';minusKey=m?.key||'';
 }
 if((!Number.isFinite(plus)||!Number.isFinite(minus))&&requested!=='manufacturing'){
  source='manufacturing';fallback=true;const p=exactFieldNumber(fields.manufacturing.plus),m=exactFieldNumber(fields.manufacturing.minus);plus=p?.value;minus=m?.value;plusKey=p?.key||'';minusKey=m?.key||'';
 }
 return Number.isFinite(base)&&Number.isFinite(plus)&&Number.isFinite(minus)?{range:[base-minus,base+plus],source,fallback,plus,minus,plusKey,minusKey}:null;
};
updateMeasurementHeading=function(){
 const type=$('#measureType').value,kind=type==='板厚/板幅'?'thickness':'width',detail=toleranceDetail(kind);$('#measurePanelTitle').textContent=type==='板厚/板幅'?'板厚・板幅測定':type+'測定';
 if(!detail){$('#toleranceSummary').innerHTML='<span class="tolerance-source-badge">公差なし</span>選択した公差情報がありません。';return}
 const labels={manufacturing:'製造公差',order:'オーダー公差',instruction:'指示公差'},label=labels[detail.source],fallback=detail.fallback?`（${labels[configuredToleranceSource()]}未設定のため製造公差へ切替）`:'';
 $('#toleranceSummary').innerHTML=`<span class="tolerance-source-badge ${detail.source==='order'?'order':''}">${label}</span>許容範囲 ${detail.range[0]} ～ ${detail.range[1]} ${fallback}<small class="tolerance-fields">${esc(detail.plusKey)} / ${esc(detail.minusKey)}</small>`;
};
// Residual course appears directly under actual course.
const renderDataManagementCourseBase=renderDataManagementPanel;
renderDataManagementPanel=function(){
 renderDataManagementCourseBase();const panel=$('#dataManagementPanel'),r=S.measure?.source||S.measure?.snapshot?.source||{};
 if(!panel)return;const grid=panel.querySelector('.data-management-grid');if(!grid)return;
 const residual=Object.entries(r).find(([k])=>normalizedFieldName(k)===normalizedFieldName('残仕掛設備ｺｰｽ'))?.[1]??'';
 const children=[...grid.children],actualIndex=children.findIndex(x=>x.tagName==='B'&&x.textContent==='実績コース'),ref=actualIndex>=0?children[actualIndex+1]:null;
 const label=document.createElement('b');label.textContent='残コース';const value=document.createElement('span');value.textContent=String(residual||'未設定');value.title=String(residual||'');
 if(ref){ref.after(label,value)}else grid.append(label,value);
};
// Explicit, staged waiting feedback for the two perceived slow routes.
function showWaiting(title,detail,progress){showSaveOverlay(title,detail);const p=$('#waitingProgress');if(p)p.textContent=progress||'処理を開始しています'}
function updateWaiting(detail,progress){if(detail)$('#saveOverlayDetail').textContent=detail;const p=$('#waitingProgress');if(p&&progress)p.textContent=progress}
const openMeasurementWaitingBase=openMeasurement;
openMeasurement=async function(row){
 const lot=pick(row,'lotNo')||'選択ロット';showWaiting('測定画面を準備しています',`ロット ${lot} の保存データを確認中`,'1/3 端末内の編集中データを検索しています');
 try{updateWaiting(`ロット ${lot} の仕掛情報を取得中`,'2/3 仕掛・公差・品質等級・品質情報を読み込んでいます');const result=await openMeasurementWaitingBase(row);updateWaiting('画面を構成しています','3/3 入力欄と判定条件を反映しています');return result}finally{hideSaveOverlay()}
};
const openRecordsSafeWaitingBase=openRecordsSafe;
openRecordsSafe=async function(status='編集中'){
 showWaiting(status==='履歴'?'完了データを取得しています':'編集中データを取得しています','この端末の保存領域を確認中','IndexedDBと代替保存領域を照合しています');
 try{return await openRecordsSafeWaitingBase(status)}finally{hideSaveOverlay()}
};
const loadMeasurementContextWaitingBase=loadMeasurementContext;
loadMeasurementContext=async function(force=false){updateWaiting('仕掛・品質・マスタを取得中','公差、品質等級、取引先、コース、マスタ候補を読み込んでいます');return loadMeasurementContextWaitingBase(force)};


// Final correction: residual course is rendered in both basic information and data management.
function sourceField(names){
 const sources=[S.current,S.measure?.source,S.measure?.snapshot?.source,S.measure?.snapshot?.basic,S.measure?.basic].filter(x=>x&&typeof x==='object');
 for(const wanted of names){const wn=normalizedFieldName(wanted);for(const source of sources){for(const [key,value] of Object.entries(source)){if(normalizedFieldName(key)===wn&&value!==undefined&&value!==null&&String(value).trim()!=='')return String(value)}}}
 return '';
}
function renderResidualCourseEverywhere(){
 if(!S.measure)return;const residual=sourceField(['残仕掛設備ｺｰｽ','残仕掛設備コース']);S.measure.basic.residualCourse=residual;
 const basic=$('#basicInfo .info-grid');if(basic){basic.querySelectorAll('.residual-course-field').forEach(x=>x.remove());const course=[...basic.querySelectorAll('.field')].find(x=>x.querySelector('label')?.textContent==='実績コース');const item=document.createElement('div');item.className='field full residual-course-field';item.innerHTML=`<label>残コース</label><output title="${esc(residual)}">${esc(residual||'未設定')}</output>`;if(course)course.after(item);else basic.append(item)}
 const grid=$('#dataManagementPanel .data-management-grid');if(grid){[...grid.querySelectorAll('[data-residual-course]')].forEach(x=>x.remove());const children=[...grid.children],courseIndex=children.findIndex(x=>x.tagName==='B'&&x.textContent==='実績コース'),courseValue=courseIndex>=0?children[courseIndex+1]:null,label=document.createElement('b'),value=document.createElement('span');label.textContent='残コース';value.textContent=residual||'未設定';value.title=residual;label.dataset.residualCourse='1';value.dataset.residualCourse='1';if(courseValue)courseValue.after(label,value);else grid.append(label,value)}
}
const renderMeasurementResidualBase=renderMeasurement;
renderMeasurement=function(){renderMeasurementResidualBase();renderDataManagementPanel();renderResidualCourseEverywhere();updateMeasurementHeading()};

// Cognitive display: show raw tolerance values, calculation, source columns and final range.
updateMeasurementHeading=function(){
 const type=$('#measureType').value;$('#measurePanelTitle').textContent=type==='板厚/板幅'?'板厚・板幅測定':type+'測定';
 if(type==='フラットネス'){$('#toleranceSummary').innerHTML='<div class="tol-status no-data"><b>判定基準</b><span>〇＝OK　△・×＝NG　条ごとに記号を入力してください。</span></div>';return}
 const kind=type==='板厚/板幅'?'thickness':'width',detail=toleranceDetail(kind),base=Number(kind==='thickness'?S.measure.basic.mfgThickness:S.measure.basic.mfgWidth);
 if(!detail){$('#toleranceSummary').innerHTML='<div class="tol-status no-data"><b>公差情報なし</b><span>選択した公差区分に使用可能なプラス・マイナス値がありません。</span></div>';return}
 const labels={manufacturing:'製造公差',order:'オーダー公差',instruction:'指示公差'},sourceLabel=labels[detail.source],requestedLabel=labels[configuredToleranceSource()],fallback=detail.fallback?`${requestedLabel}が不足しているため製造公差を使用`:'';
 $('#toleranceSummary').innerHTML=`<div class="tol-source-row"><span class="tolerance-source-badge ${detail.source==='order'?'order':''}">${sourceLabel}</span>${fallback?`<span class="tol-fallback">${esc(fallback)}</span>`:''}</div><div class="tol-facts"><div><small>基準値</small><b>${base}</b></div><div><small>公差 ＋</small><b>+${detail.plus}</b><em>${esc(detail.plusKey)}</em></div><div><small>公差 －</small><b>-${detail.minus}</b><em>${esc(detail.minusKey)}</em></div><div class="tol-result"><small>判定範囲</small><b>${detail.range[0]} ～ ${detail.range[1]}</b></div></div><div class="tol-formula">計算: ${base} - ${detail.minus} = ${detail.range[0]} ／ ${base} + ${detail.plus} = ${detail.range[1]}</div>`;
};

// Waiting feedback on the initial navigation. Yield one frame so acknowledgement appears immediately.
function nextPaint(){return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))}
function databaseLabel(key){return key==='SIKALOTNOW'?'仕掛一覧':key==='SIKALOTDEF'?'品質データ':key==='MASTER'?'マスタ':'データ'}
selectDb=async function(k,b){
 const label=databaseLabel(k);showWaiting(`${label}へ切り替えています`,`接続先を確認しています: ${label}`,'1/3 データベースのテーブル構成を取得しています');await nextPaint();
 try{S.db=k;document.querySelectorAll('.db').forEach(x=>x.classList.remove('active'));b.classList.add('active');const result=await api(`/api/tables?db=${encodeURIComponent(k)}`);S.tables=result.tables;updateWaiting(`${label}の表示対象を確認中`,'2/3 表示可能なテーブルを整理しています');renderTabs();if(S.tables.length)await selectTable(S.tables[0]);else $('#grid').textContent='表示可能なテーブルがありません。'}catch(e){$('#grid').innerHTML=`<div class="load-error"><b>${esc(label)}を開けませんでした</b><span>${esc(e.message)}</span></div>`;throw e}finally{hideSaveOverlay()}
};
selectTable=async function(t){
 S.table=t;S.page=1;renderTabs();const label=databaseLabel(S.db);showWaiting(`${label}を読み込んでいます`,`テーブル: ${t}`,'3/3 列情報と一覧データを取得しています');await nextPaint();try{await load()}finally{hideSaveOverlay()}
};
const loadListBase=load;
load=async function(){
 const label=databaseLabel(S.db),table=S.table||'テーブル';if($('#saveOverlay').hidden){showWaiting(`${label}を更新しています`,`テーブル: ${table}`,'検索条件を反映して一覧データを取得しています');await nextPaint()}
 try{return await loadListBase()}finally{hideSaveOverlay()}
};


// Application equipment setting and design-course guard.
const APP_EQUIPMENT_KEY='AccessMeasurementConfiguredEquipment';
function currentConfiguredEquipment(){return String(localStorage.getItem(APP_EQUIPMENT_KEY)||'').trim()}
/* 更新対象者（ユーザーID）の管理。マスタ更新時にサーバーへ送信し記録する。 */
const USER_ID_KEY='AccessMeasurementUserId';
function currentUserId(){return String(localStorage.getItem(USER_ID_KEY)||'').trim()}
function setUserId(id){id=String(id||'').trim().slice(0,50);if(id)localStorage.setItem(USER_ID_KEY,id);return id}
function ensureUserId(){
 let id=currentUserId();
 if(!id){
  const input=(typeof prompt==='function')?prompt('マスタ更新の記録に使うユーザーID（社員番号など）を入力してください。'):'';
  id=setUserId(input||'');
 }
 return id;
}
function withUserId(body){return Object.assign({},body||{},{user_id:ensureUserId()})}
function designCourseValue(){return sourceField(['設計_設備ｺｰｽ','設計_設備コース'])}
function actualCourseValue(){return sourceField(['実績_設備ｺｰｽ','実績_設備コース'])}
function residualCourseValue(){return sourceField(['残仕掛設備ｺｰｽ','残仕掛設備コース'])}
function normalizeCourseText(v){return String(v||'').normalize('NFKC').toUpperCase().replace(/[\s　]+/g,'')}
function equipmentIsInDesignCourse(equipment,course){const e=normalizeCourseText(equipment),c=normalizeCourseText(course);return !!e&&!!c&&c.includes(e)}
function updateCourseGuard(){
 if(!S.measure)return;const equipment=currentConfiguredEquipment(),course=designCourseValue(),warning=$('#courseWarning');
 if(!warning)return;
 if(!equipment){warning.hidden=false;warning.textContent='アプリ使用設備が未設定です。左メニューの「アプリ使用設備を設定」から登録してください。';return}
 if(!course){warning.hidden=false;warning.textContent=`設計コースが取得できないため、設備「${equipment}」の対象判定ができません。`;return}
 if(!equipmentIsInDesignCourse(equipment,course)){warning.hidden=false;warning.textContent=`対象外設備の可能性があります。設定設備「${equipment}」は設計コース「${course}」に含まれていません。登録前に確認してください。`;return}
 warning.hidden=true;warning.textContent='';
}
function openAppSettings(){const value=currentConfiguredEquipment();$('#configuredEquipment').value=value;const status=$('#equipmentSettingStatus');status.textContent=value?`現在の設定: ${value}`:'使用設備は未登録です';status.className='setting-status '+(value?'ok':'warn');$('#appSettingsModal').hidden=false;requestAnimationFrame(()=>$('#configuredEquipment').focus())}
function closeAppSettings(){$('#appSettingsModal').hidden=true}
function bindAppSettingsControls(){
 const openButton=$('#openAppSettings'),closeButton=$('#closeAppSettings'),cancelButton=$('#cancelAppSettings'),saveButton=$('#saveAppSettings');
 if(openButton)openButton.onclick=openAppSettings;
 if(closeButton)closeButton.onclick=closeAppSettings;
 if(cancelButton)cancelButton.onclick=closeAppSettings;
 if(saveButton)saveButton.onclick=()=>{
  const input=$('#configuredEquipment'),status=$('#equipmentSettingStatus');
  if(!input||!status)return;
  const value=input.value.trim();
  if(!value){status.textContent='設備名を入力してください。';status.className='setting-status warn';return}
  localStorage.setItem(APP_EQUIPMENT_KEY,value);status.textContent=`保存しました: ${value}`;status.className='setting-status ok';updateCourseGuard();setTimeout(closeAppSettings,450)
 };
}


// Design, actual and residual courses are rendered as one ordered information group.
function renderCourseHierarchy(){
 if(!S.measure)return;const design=designCourseValue(),actual=actualCourseValue(),residual=residualCourseValue();S.measure.basic.designCourse=design;S.measure.basic.course=actual;S.measure.basic.residualCourse=residual;
 const basic=$('#basicInfo .info-grid');if(basic){[...basic.querySelectorAll('.course-stack-field,.residual-course-field')].forEach(x=>x.remove());const old=[...basic.querySelectorAll('.field')].find(x=>x.querySelector('label')?.textContent==='実績コース');if(old)old.remove();const anchor=[...basic.querySelectorAll('.field')].find(x=>x.querySelector('label')?.textContent==='納入先');[['設計コース',design],['実績コース',actual],['残コース',residual]].forEach(([label,value],i)=>{const item=document.createElement('div');item.className='field full course-stack-field';item.innerHTML=`<label>${label}</label><output title="${esc(value)}">${esc(value||'未設定')}</output>`;if(anchor){const prior=[...basic.querySelectorAll('.course-stack-field')].at(-1);(prior||anchor).after(item)}else basic.append(item)})}
 const grid=$('#dataManagementPanel .data-management-grid');if(grid){const pairs=[];for(let i=0;i<grid.children.length;i+=2)pairs.push([grid.children[i]?.textContent,grid.children[i+1]?.textContent]);const keep=pairs.filter(([label])=>!['設計コース','実績コース','残コース'].includes(label));const insertAt=Math.max(0,keep.findIndex(([label])=>label==='オーダー番号'));keep.splice(insertAt,0,['設計コース',design||'未設定'],['実績コース',actual||'未設定'],['残コース',residual||'未設定']);grid.innerHTML=keep.map(([label,value])=>`<b>${esc(label||'')}</b><span title="${esc(value||'')}">${esc(value||'未設定')}</span>`).join('')}
 updateCourseGuard();
}

// Order tolerance can only be selected when all required order values exist.
function orderToleranceAvailability(){const t=toleranceDataForSource('thickness','order'),w=toleranceDataForSource('width','order');return{available:!!(t||w),thickness:!!t,width:!!w}}
function toleranceDataForSource(kind,source){
 const isT=kind==='thickness',dimension=isT?'板厚':'板幅',fields={manufacturing:{plus:[`${dimension}公差_製造_ﾌﾟﾗｽ`,`${dimension}公差_製造_プラス`,isT?'KOSAXSMP':'KOSAYSMP'],minus:[`${dimension}公差_製造_ﾏｲﾅｽ`,`${dimension}公差_製造_マイナス`,isT?'KOSAXSMM':'KOSAYSMM']},order:{plus:[`${dimension}公差_ｵｰﾀﾞｰ_ﾌﾟﾗｽ`,`${dimension}公差_オーダー_プラス`,isT?'KOSAXSOP':'KOSAYSOP'],minus:[`${dimension}公差_ｵｰﾀﾞｰ_ﾏｲﾅｽ`,`${dimension}公差_オーダー_マイナス`,isT?'KOSAXSOM':'KOSAYSOM']}};
 const p=exactFieldNumber(fields[source].plus),m=exactFieldNumber(fields[source].minus);return p&&m?{plus:p.value,minus:m.value,plusKey:p.key,minusKey:m.key}:null;
}
function applyInstructionToleranceForOtherTargets(kind){const p=instructedTolerance(kind,'plus'),m=instructedTolerance(kind,'minus');return p&&m?{plus:p.value,minus:m.value,plusKey:p.key,minusKey:m.key}:null}
toleranceDetail=function(kind,index=0){
 const type=$('#measureType')?.value||S.measure?.settings?.measureType||'',isDimensional=type==='板厚/板幅',b=S.measure.basic,base=Number(kind==='thickness'?b.mfgThickness:b.mfgWidth);
 let requested=configuredToleranceSource();if(!isDimensional)requested='instruction';let data=requested==='instruction'?applyInstructionToleranceForOtherTargets(kind):toleranceDataForSource(kind,requested),source=requested,fallback=false;
 if(!data&&requested!=='manufacturing'){source='manufacturing';fallback=true;data=toleranceDataForSource(kind,'manufacturing')}
 return data&&Number.isFinite(base)?{range:[base-data.minus,base+data.plus],source,fallback,...data}:null;
};
configureToleranceSelector=function(){const el=$('#toleranceSource');if(!el||!S.measure)return;const type=$('#measureType').value,isDimensional=type==='板厚/板幅',order=el.querySelector('option[value="order"]'),availability=orderToleranceAvailability();order.disabled=!availability.available;order.textContent=availability.available?'オーダー公差':'オーダー公差（データなし）';order.classList.toggle('order-tolerance-unavailable',!availability.available);if(!availability.available&&S.measure.settings.toleranceSource==='order')S.measure.settings.toleranceSource='manufacturing';el.value=S.measure.settings.toleranceSource||'manufacturing';el.disabled=!isDimensional;el.title=isDimensional?(availability.available?'製造公差またはオーダー公差を選択できます':'オーダー公差がないため製造公差のみ使用できます'):'板厚・板幅以外は指示公差を自動適用します';el.onchange=()=>{if(el.value==='order'&&!availability.available)return;S.measure.settings.toleranceSource=el.value;renderMeasureGrid();updateMeasurementHeading();markDirty()}};

const renderMeasurementSettingsBase=renderMeasurement;
renderMeasurement=function(){renderMeasurementSettingsBase();renderCourseHierarchy();configureToleranceSelector();updateMeasurementHeading()};


// Final workflow: registration gate, saved registration identity, and scalable record list.
let pendingMeasurementRow=null;
function updateRegisteredEquipmentBadge(){const badge=$('#registeredEquipmentBadge'),equipment=currentConfiguredEquipment();if(!badge)return;const label=badge.querySelector('.equip-badge-text')||badge;label.textContent=equipment?`使用設備: ${equipment}`:'使用設備: 未登録';badge.classList.toggle('unregistered',!equipment);badge.title=equipment?'クリックして使用設備を変更できます':'測定開始前に使用設備の登録が必要です';badge.onclick=openAppSettings}
function requireEquipmentBeforeMeasurement(row){
 const equipment=currentConfiguredEquipment();if(equipment)return true;
 pendingMeasurementRow=row||null;openAppSettings();const status=$('#equipmentSettingStatus');if(status){status.textContent='測定を開始するには、使用設備の登録が必要です。';status.className='setting-status warn'}return false;
}
const bindAppSettingsControlsFinalBase=bindAppSettingsControls;
bindAppSettingsControls=function(){
 bindAppSettingsControlsFinalBase();updateRegisteredEquipmentBadge();
 const save=$('#saveAppSettings');if(save)save.onclick=async()=>{
  const input=$('#configuredEquipment'),status=$('#equipmentSettingStatus');if(!input||!status)return;const value=input.value.trim();
  if(!value){status.textContent='設備名を入力してください。';status.className='setting-status warn';return}
  localStorage.setItem(APP_EQUIPMENT_KEY,value);status.textContent=`登録しました: ${value}`;status.className='setting-status ok';updateRegisteredEquipmentBadge();updateCourseGuard();
  const row=pendingMeasurementRow;pendingMeasurementRow=null;setTimeout(closeAppSettings,250);if(row){await nextPaint();openMeasurement(row).catch(error=>alert('測定画面を開けません: '+error.message))}
 };
};
const openMeasurementRegistrationBase=openMeasurement;
openMeasurement=async function(row){if(!requireEquipmentBeforeMeasurement(row))return;const result=await openMeasurementRegistrationBase(row);if(S.measure){S.measure.settings=S.measure.settings||{};S.measure.settings.registeredEquipment=currentConfiguredEquipment();S.measure.registeredEquipment=currentConfiguredEquipment();updateCourseGuard()}return result};
const collectEquipmentBase=collect;
collect=function(){const m=collectEquipmentBase();const equipment=currentConfiguredEquipment();m.settings=m.settings||{};m.settings.registeredEquipment=equipment;m.registeredEquipment=equipment;m.snapshot=m.snapshot||{};m.snapshot.registeredEquipment=equipment;return m};
const ensureMeasureShapeEquipmentBase=ensureMeasureShape;
ensureMeasureShape=function(m){m=ensureMeasureShapeEquipmentBase(m);if(m){m.settings.registeredEquipment=m.settings.registeredEquipment||m.registeredEquipment||m.snapshot?.registeredEquipment||''}return m};

let recordListState={status:'編集中',items:[],query:'',sort:'updated-desc'};
function recordSearchText(x){return [x.basic?.lotNo,x.basic?.inspectionNo,x.basic?.castingNo,x.basic?.equipment,x.settings?.registeredEquipment,x.registeredEquipment,x.status].map(v=>String(v||'').normalize('NFKC').toLowerCase()).join(' ')}
function sortedFilteredRecords(){let items=recordListState.items.filter(x=>recordSearchText(x).includes(recordListState.query.normalize('NFKC').toLowerCase()));items=[...items];if(recordListState.sort==='updated-asc')items.sort((a,b)=>String(a.updatedAt||'').localeCompare(String(b.updatedAt||'')));else if(recordListState.sort==='lot-asc')items.sort((a,b)=>String(a.basic?.lotNo||'').localeCompare(String(b.basic?.lotNo||''),'ja'));else items.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));return items}
function renderRecordListRows(){
 const list=$('#recordList'),items=sortedFilteredRecords(),currentLot=normalizedLot(S.current?pick(S.current,'lotNo'):'');if(!list)return;
 list.innerHTML='<div class="record-list-head"><span>ロット番号</span><span>検査番号</span><span>鋳造番号</span><span>状態</span><span>更新日時</span><span>登録設備</span><span>操作</span></div>';
 if(!items.length){list.insertAdjacentHTML('beforeend','<div class="record-empty">検索条件に一致するデータはありません。</div>')}
 items.forEach(x=>{const same=currentLot&&normalizedLot(x.basic?.lotNo)===currentLot,row=document.createElement('article');row.className='record-list-row'+(same?' is-same-lot':'');const equipment=x.settings?.registeredEquipment||x.registeredEquipment||x.snapshot?.registeredEquipment||'-';row.innerHTML=`<div class="record-list-cell primary" title="${esc(x.basic?.lotNo||x.id)}">${esc(x.basic?.lotNo||x.id)}</div><div class="record-list-cell" title="${esc(x.basic?.inspectionNo||'-')}">${esc(x.basic?.inspectionNo||'-')}</div><div class="record-list-cell" title="${esc(x.basic?.castingNo||'-')}">${esc(x.basic?.castingNo||'-')}</div><div class="record-list-cell">${esc(x.status||'編集中')}</div><div class="record-list-cell"><time>${esc(x.updatedAt?new Date(x.updatedAt).toLocaleString('ja-JP'):'-')}</time></div><div class="record-list-cell" title="${esc(equipment)}">${esc(equipment)}</div><div class="record-list-actions"><button class="resume">${recordListState.status==='履歴'?'内容を開く':'続きから再開'}</button><button class="danger">削除</button></div>`;
  row.querySelector('.resume').onclick=async()=>{if(!requireEquipmentBeforeMeasurement(x.source||x.snapshot?.source||null))return;S.measure=ensureMeasureShape(x);S.current=x.source||x.snapshot?.source||null;renderMeasurement();$('#recordModal').hidden=true;$('#measureModal').hidden=false;await loadMeasurementContext(false);updateCourseGuard()};
  row.querySelector('.danger').onclick=async()=>{if(confirm('この端末内データを削除しますか？')){await reliableDelete(x.id);await refreshDraftCount();await openRecords(recordListState.status)}};list.append(row)
 });
 const result=$('#recordSearchResult');if(result)result.textContent=`${items.length} / ${recordListState.items.length}件を表示`;
}
openRecords=async function(status){
 const all=await reliableAll();recordListState={status,items:all.filter(x=>status==='履歴'?x.status==='完了':x.status!=='完了').map(ensureMeasureShape),query:'',sort:'updated-desc'};$('#recordTitle').textContent=status==='履歴'?'完了データ':'編集中データ一覧';$('#recordModal').hidden=false;
 const search=$('#recordSearch'),sort=$('#recordSort'),clear=$('#clearRecordSearch');if(search){search.value='';search.oninput=()=>{recordListState.query=search.value;renderRecordListRows()}}if(sort){sort.value='updated-desc';sort.onchange=()=>{recordListState.sort=sort.value;renderRecordListRows()}}if(clear)clear.onclick=()=>{recordListState.query='';if(search)search.value='';renderRecordListRows()};renderRecordListRows();requestAnimationFrame(()=>search?.focus())
};

bindAppSettingsControls();
init().catch(error=>{
 console.error('初期化エラー',error);
 const grid=$('#grid');if(grid)grid.innerHTML=`<div class="load-error"><b>画面を初期化できませんでした</b><span>${esc(error?.message||String(error))}</span></div>`;
});


/* Current hotfix: safe settings modal, reliable resume, richer list, and work time stamps. */
openAppSettings=function(){
 const modal=$('#appSettingsModal'),input=$('#configuredEquipment'),status=$('#equipmentSettingStatus');
 if(!modal||!input||!status){console.error('設備設定画面の要素が不足しています',{modal:!!modal,input:!!input,status:!!status});showToast('設備設定を開けません','画面を再読込してください。',7000);return false}
 const value=currentConfiguredEquipment();input.value=value;status.textContent=value?`現在の設定: ${value}`:'使用設備は未登録です';status.className='setting-status '+(value?'ok':'warn');modal.hidden=false;requestAnimationFrame(()=>input.focus());return true;
};
const ensureMeasureShapeWorkBase=ensureMeasureShape;
ensureMeasureShape=function(m){m=ensureMeasureShapeWorkBase(m);if(m){m.workTime={startAt:'',endAt:'',...(m.workTime||{})}}return m};
const collectWorkBase=collect;
collect=function(){const m=collectWorkBase();m.workTime=m.workTime||{};m.workTime.startAt=$('#workStartAt')?.dataset.iso||m.workTime.startAt||'';m.workTime.endAt=$('#workEndAt')?.dataset.iso||m.workTime.endAt||'';return m};
function formatWorkTime(value){if(!value)return '';const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function updateWorkTimePanel(){if(!S.measure)return;S.measure.workTime=S.measure.workTime||{startAt:'',endAt:''};const start=$('#workStartAt'),end=$('#workEndAt');if(!start||!end)return;start.dataset.iso=S.measure.workTime.startAt||'';end.dataset.iso=S.measure.workTime.endAt||'';start.value=formatWorkTime(start.dataset.iso);end.value=formatWorkTime(end.dataset.iso);const startCard=$('#workStartCard'),endCard=$('#workEndCard');[[startCard,start.dataset.iso],[endCard,end.dataset.iso]].forEach(([card,value])=>{card?.classList.toggle('validation-required',!value);card?.classList.toggle('validation-valid',!!value)});let text='未計測';if(start.dataset.iso&&end.dataset.iso){const ms=new Date(end.dataset.iso)-new Date(start.dataset.iso);if(ms>=0){const mins=Math.floor(ms/60000),secs=Math.floor((ms%60000)/1000);text=`作業時間 ${Math.floor(mins/60)}時間 ${mins%60}分 ${secs}秒`}}$('#workDuration').textContent=text}
function stampWorkTime(kind){if(!S.measure)return;S.measure.workTime=S.measure.workTime||{};const now=new Date().toISOString();if(kind==='end'&&!S.measure.workTime.startAt){showToast('開始時刻が未記録です','先に「開始時刻を記録」を押してください。');return}S.measure.workTime[kind==='start'?'startAt':'endAt']=now;if(kind==='start')S.measure.workTime.endAt='';updateWorkTimePanel();markDirty();updateValidationVisuals()}
const renderMeasurementWorkBase=renderMeasurement;
renderMeasurement=function(){renderMeasurementWorkBase();updateWorkTimePanel();const a=$('#stampWorkStart'),b=$('#stampWorkEnd');if(a)a.onclick=()=>stampWorkTime('start');if(b)b.onclick=()=>stampWorkTime('end')};
const activeRequiredControlsWorkBase=activeRequiredControls;
activeRequiredControls=function(){const controls=activeRequiredControlsWorkBase();controls.push({el:$('#workStartAt'),label:'作業開始時刻'},{el:$('#workEndAt'),label:'作業終了時刻'});return controls.filter(x=>x.el)};
function resumeRecordFromList(x){return async()=>{try{if(!requireEquipmentBeforeMeasurement(x.source||x.snapshot?.source||null))return;S.measure=ensureMeasureShape(x);S.current=x.source||x.snapshot?.source||null;renderMeasurement();const recordModal=$('#recordModal'),measureModal=$('#measureModal');if(recordModal)recordModal.hidden=true;if(measureModal)measureModal.hidden=false;await loadMeasurementContext(false);updateCourseGuard();showToast('編集中データを再開しました',String(x.basic?.lotNo||x.id))}catch(error){console.error('resume failed',error);showToast('再開できませんでした',error?.message||String(error),8000)}}}
renderRecordListRows=function(){
 const list=$('#recordList'),items=sortedFilteredRecords(),currentLot=normalizedLot(S.current?pick(S.current,'lotNo'):'');if(!list)return;
 list.innerHTML='<div class="record-list-head"><span>ロット番号</span><span>検査番号</span><span>鋳造番号</span><span>オーダー番号</span><span>取引先</span><span>コース</span><span>状態</span><span>更新日時</span><span>操作</span></div>';
 if(!items.length)list.insertAdjacentHTML('beforeend','<div class="record-empty">検索条件に一致するデータはありません。</div>');
 items.forEach(x=>{ensureMeasureShape(x);const same=currentLot&&normalizedLot(x.basic?.lotNo)===currentLot,row=document.createElement('article'),resume=resumeRecordFromList(x),course=x.basic?.residualCourse||x.basic?.course||x.basic?.designCourse||'-';row.className='record-list-row'+(same?' is-same-lot':'');row.tabIndex=0;row.title=recordListState.status==='履歴'?'ダブルクリックで内容を開きます':'ダブルクリックで続きから再開します';row.innerHTML=`<div class="record-list-cell primary" title="${esc(x.basic?.lotNo||x.id)}">${esc(x.basic?.lotNo||x.id)}</div><div class="record-list-cell">${esc(x.basic?.inspectionNo||'-')}</div><div class="record-list-cell">${esc(x.basic?.castingNo||'-')}</div><div class="record-list-cell secondary">${esc(x.basic?.orderNo||'-')}</div><div class="record-list-cell secondary" title="${esc(x.basic?.customer||'-')}">${esc(x.basic?.customer||'-')}</div><div class="record-list-cell secondary" title="${esc(course)}">${esc(course)}</div><div class="record-list-cell">${esc(x.status||'編集中')}</div><div class="record-list-cell"><time>${esc(x.updatedAt?new Date(x.updatedAt).toLocaleString('ja-JP'):'-')}</time></div><div class="record-list-actions"><button class="resume" type="button">${recordListState.status==='履歴'?'内容を開く':'続きから再開'}</button><button class="danger" type="button">削除</button></div>`;
 const resumeButton=row.querySelector('.resume');resumeButton.disabled=false;resumeButton.onclick=event=>{event.preventDefault();event.stopPropagation();resume()};row.ondblclick=event=>{if(event.target.closest('.danger'))return;event.preventDefault();resume()};row.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();resume()}};row.querySelector('.danger').onclick=async event=>{event.stopPropagation();if(confirm('この端末内データを削除しますか？')){await reliableDelete(x.id);await refreshDraftCount();await openRecords(recordListState.status)}};list.append(row)
 });
 const result=$('#recordSearchResult');if(result)result.textContent=`${items.length} / ${recordListState.items.length}件を表示`;
};
queueMicrotask(()=>{updateRegisteredEquipmentBadge();const start=$('#stampWorkStart'),end=$('#stampWorkEnd');if(start)start.onclick=()=>stampWorkTime('start');if(end)end.onclick=()=>stampWorkTime('end')});


/* Equipment settings final controller: repairs missing DOM, closes lower layers, and owns all entry points. */
function ensureEquipmentSettingsModal(){
 let modal=$('#appSettingsModal');
 if(modal&&$('#configuredEquipment')&&$('#equipmentSettingStatus')&&$('#saveAppSettings'))return modal;
 modal?.remove();
 const wrapper=document.createElement('div');wrapper.className='record-modal';wrapper.hidden=true;wrapper.id='appSettingsModal';wrapper.innerHTML=`<div class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="equipmentSettingsTitle"><header><div><small>APPLICATION SETTINGS</small><h2 id="equipmentSettingsTitle">使用設備の設定</h2></div><button id="closeAppSettings" type="button" aria-label="閉じる">×</button></header><div class="settings-body"><p>この端末で測定する設備を登録します。登録設備は、仕掛データの設計コースとの照合と保存データの識別に使用します。</p><label>使用設備名<input autocomplete="off" id="configuredEquipment" placeholder="例: LS4" type="text"/></label><div class="setting-status warn" id="equipmentSettingStatus">使用設備は未登録です</div><div class="settings-actions"><button id="cancelAppSettings" type="button">キャンセル</button><button id="saveAppSettings" type="button">この設備を登録</button></div></div></div>`;
 document.body.append(wrapper);return wrapper;
}
function updateEquipmentEntryPoints(){
 const equipment=currentConfiguredEquipment(),configured=!!equipment,banner=$('#equipmentSetupBanner');
 const header=$('.equipment-header-button'),headerName=$('#headerEquipmentName');if(header){header.classList.toggle('is-unset',!configured)}if(headerName)headerName.textContent=equipment||'未設定';
 if(banner){banner.classList.toggle('configured',configured);const title=$('#equipmentSetupTitle'),help=$('#equipmentSetupHelp'),button=banner.querySelector('button');if(title)title.textContent=configured?`使用設備: ${equipment}`:'最初に使用設備を設定してください';if(help)help.textContent=configured?'この端末の登録設備です。変更する場合は右のボタンを押してください。':'測定を開始する前に、この端末で使用する設備を登録します。';if(button)button.textContent=configured?'使用設備を変更':'使用設備を設定'}
 updateRegisteredEquipmentBadge();
}
function openEquipmentSettingsFinal(reason='manual'){
 const modal=ensureEquipmentSettingsModal();
 ['recordModal','measureModal','splitModal'].forEach(id=>{const el=$('#'+id);if(el&&!el.hidden)el.hidden=true});hideSaveOverlay();
 const input=$('#configuredEquipment'),status=$('#equipmentSettingStatus'),value=currentConfiguredEquipment();input.value=value;status.textContent=reason==='required'?'測定を開始するには、使用設備の登録が必要です。':value?`現在の設定: ${value}`:'使用設備は未登録です。設備名を入力してください。';status.className='setting-status '+(value&&reason!=='required'?'ok':'warn');modal.hidden=false;
 const close=()=>{modal.hidden=true};$('#closeAppSettings').onclick=close;$('#cancelAppSettings').onclick=close;
 $('#saveAppSettings').onclick=async()=>{const equipment=input.value.trim();if(!equipment){status.textContent='設備名を入力してください。';status.className='setting-status warn';input.focus();return}localStorage.setItem(APP_EQUIPMENT_KEY,equipment);status.textContent=`登録しました: ${equipment}`;status.className='setting-status ok';updateEquipmentEntryPoints();updateCourseGuard();const row=pendingMeasurementRow;pendingMeasurementRow=null;setTimeout(close,220);if(row){await nextPaint();openMeasurement(row).catch(error=>{console.error(error);showToast('測定画面を開けません',error.message,8000)})}};
 requestAnimationFrame(()=>input.focus());return true;
}
openAppSettings=()=>openEquipmentSettingsFinal('manual');
requireEquipmentBeforeMeasurement=function(row){if(currentConfiguredEquipment())return true;pendingMeasurementRow=row||null;openEquipmentSettingsFinal('required');return false};
document.addEventListener('click',event=>{const trigger=event.target.closest('[data-open-equipment-settings],#registeredEquipmentBadge');if(!trigger)return;event.preventDefault();event.stopImmediatePropagation();openEquipmentSettingsFinal('manual')},true);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#appSettingsModal')?.hidden){$('#appSettingsModal').hidden=true}},true);
queueMicrotask(()=>{ensureEquipmentSettingsModal();updateEquipmentEntryPoints()});


/* Equipment master final workflow. */
let equipmentMasterState={items:[],loaded:false,created:false};
function residualEquipmentSuggestion(){const raw=residualCourseValue();return String(raw||'').trim().split(/[\\s　]+/).filter(Boolean)[0]||''}
async function loadEquipmentMaster(force=false){
 if(equipmentMasterState.loaded&&!force)return equipmentMasterState;
 const result=await api('/api/equipment-master');equipmentMasterState={items:result.items||[],loaded:true,created:!!result.created};
 const list=$('#equipmentMasterOptions');if(list)list.innerHTML=equipmentMasterState.items.map(x=>`<option value="${esc(x.name)}"></option>`).join('');return equipmentMasterState;
}
function findMasterEquipment(name){const n=normalizeCourseText(name);return equipmentMasterState.items.find(x=>normalizeCourseText(x.name)===n)||null}
function updateEquipmentMasterHelp(){
 const input=$('#configuredEquipment'),help=$('#equipmentMasterHelp');if(!input||!help)return;const value=input.value.trim(),existing=findMasterEquipment(value);
 if(!equipmentMasterState.items.length){help.className='equipment-master-help warn';help.textContent='設備マスタに登録がありません。設備名を入力して登録すると、設備マスタへ自動登録され、次回から設備リストに表示されます。';return}
 if(!value){help.className='equipment-master-help';help.textContent=`設備マスタから選択してください。登録済み ${equipmentMasterState.items.length}件`;return}
 if(existing){help.className='equipment-master-help ok';help.textContent=`設備マスタ登録済み: ${existing.name}`;return}
 help.className='equipment-master-help warn';help.textContent=`「${value}」は設備マスタにありません。登録すると設備マスタへ自動登録し、次回から設備リストに表示します。`;
}
async function registerAndSelectEquipment(name){const result=await api('/api/equipment-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(withUserId({name}))});localStorage.setItem(APP_EQUIPMENT_KEY,result.name);await loadEquipmentMaster(true);return result}
openEquipmentSettingsFinal=async function(reason='manual',suggested=''){
 const modal=ensureEquipmentSettingsModal();['recordModal','measureModal','splitModal'].forEach(id=>{const el=$('#'+id);if(el&&!el.hidden)el.hidden=true});hideSaveOverlay();
 const input=$('#configuredEquipment'),status=$('#equipmentSettingStatus');try{await loadEquipmentMaster()}catch(error){status.textContent='設備マスタを準備できません: '+error.message;status.className='setting-status warn';modal.hidden=false;return false}
 const current=currentConfiguredEquipment(),suggestion=suggested||((reason==='suggestion'||reason==='required')?residualEquipmentSuggestion():'');input.value=suggestion||current||'';updateEquipmentMasterHelp();status.textContent=reason==='required'?'測定を開始するには、設備マスタを基準に使用設備を登録してください。':current?`現在の設定: ${current}`:'使用設備を選択または入力してください。';status.className='setting-status '+(current&&reason==='manual'?'ok':'warn');modal.hidden=false;input.oninput=updateEquipmentMasterHelp;
 const close=()=>{modal.hidden=true};$('#closeAppSettings').onclick=close;$('#cancelAppSettings').onclick=close;
 $('#saveAppSettings').onclick=async()=>{const name=input.value.trim();if(!name){status.textContent='設備名を選択または入力してください。';status.className='setting-status warn';input.focus();return}status.textContent='設備マスタを確認しています。';try{const result=await registerAndSelectEquipment(name);status.textContent=result.message;status.className='setting-status ok';updateEquipmentEntryPoints();updateCourseGuard();const row=pendingMeasurementRow;pendingMeasurementRow=null;setTimeout(close,500);if(row){await nextPaint();openMeasurement(row).catch(error=>showToast('測定画面を開けません',error.message,8000))}}catch(error){status.textContent='設備を登録できません: '+error.message;status.className='setting-status warn'}};
 requestAnimationFrame(()=>input.focus());return true;
};
openAppSettings=()=>openEquipmentSettingsFinal('manual');
requireEquipmentBeforeMeasurement=function(row){if(currentConfiguredEquipment())return true;pendingMeasurementRow=row||null;openEquipmentSettingsFinal('required');return false};
updateCourseGuard=function(){
 if(!S.measure)return;const equipment=currentConfiguredEquipment(),course=designCourseValue(),residual=residualCourseValue(),suggestion=residualEquipmentSuggestion(),warning=$('#courseWarning');if(!warning)return;
 let message='',show=false;if(!equipment){message='使用設備が未設定です。設備マスタから登録してください。';show=true}else if(!course){message=`設計コースが取得できないため、設備「${equipment}」の対象判定ができません。`;show=true}else if(!equipmentIsInDesignCourse(equipment,course)){message=`設定設備「${equipment}」は設計コース「${course}」に含まれていません。`;show=true}
 warning.hidden=!show;if(!show){warning.innerHTML='';return}
 warning.innerHTML=`<span class="course-warning-main">${esc(message)}</span><span class="course-warning-actions">${suggestion?`<span class="course-suggestion">候補: ${esc(suggestion)}</span>`:''}<button type="button" id="changeEquipmentFromWarning">${suggestion?'候補の設備へ変更':'設備登録を変更'}</button></span>`;
 const button=$('#changeEquipmentFromWarning');if(button)button.onclick=()=>openEquipmentSettingsFinal('suggestion',suggestion);
};
const updateEquipmentEntryPointsMasterBase=updateEquipmentEntryPoints;
updateEquipmentEntryPoints=function(){updateEquipmentEntryPointsMasterBase();const configured=!!currentConfiguredEquipment(),banner=$('#equipmentSetupBanner');if(banner)banner.classList.toggle('configured',configured)};
queueMicrotask(async()=>{try{await loadEquipmentMaster();updateEquipmentEntryPoints()}catch(error){console.warn('equipment master init failed',error)}});


/* Final: app identity, master-only equipment selection, work-time tab and duration. */
document.title='測定伝送システム';
function durationMs(record){const a=record?.workTime?.startAt,b=record?.workTime?.endAt;if(!a||!b)return null;const ms=new Date(b)-new Date(a);return Number.isFinite(ms)&&ms>=0?ms:null}
function formatDuration(ms){if(ms===null||ms===undefined)return '-';const sec=Math.floor(ms/1000),h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return `${h}時間 ${m}分 ${s}秒`}
function fillEquipmentSelect(selected='',suggested=''){
 const select=$('#configuredEquipment');if(!select)return;const names=equipmentMasterState.items.map(x=>x.name),preset=suggested&&names.find(x=>normalizeCourseText(x)===normalizeCourseText(suggested)),current=selected&&names.find(x=>normalizeCourseText(x)===normalizeCourseText(selected));
 select.innerHTML='<option value="">設備マスタから選択</option>'+names.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('')+'<option value="__new__">＋ 設備マスタへ新規登録</option>';const unmatchedSuggestion=suggested&&!preset?suggested:'',unmatchedCurrent=selected&&!current?selected:'';select.value=preset||current||((unmatchedSuggestion||unmatchedCurrent)?'__new__':'');$('#newEquipmentEntry').hidden=select.value!=='__new__';const newName=$('#newEquipmentName');if(newName)newName.value=unmatchedSuggestion||unmatchedCurrent||'';select.onchange=()=>{$('#newEquipmentEntry').hidden=select.value!=='__new__';if(select.value!=='__new__'&&newName)newName.value='';updateEquipmentMasterHelp()};
}
updateEquipmentMasterHelp=function(){const select=$('#configuredEquipment'),help=$('#equipmentMasterHelp');if(!select||!help)return;if(!equipmentMasterState.items.length){help.className='equipment-master-help warn';help.textContent='設備マスタに登録がありません。「設備マスタへ新規登録」から最初の設備を登録してください。';return}if(select.value==='__new__'){help.className='equipment-master-help warn';help.textContent='入力した設備をマスタ.accdbの設備マスタへ登録し、次回から一覧に表示します。';return}if(select.value){help.className='equipment-master-help ok';help.textContent=`設備マスタから選択: ${select.value}`;return}help.className='equipment-master-help';help.textContent=`設備マスタから選択してください。登録済み ${equipmentMasterState.items.length}件`};
openEquipmentSettingsFinal=async function(reason='manual',suggested=''){
 const modal=ensureEquipmentSettingsModal();['recordModal','measureModal','splitModal'].forEach(id=>{const el=$('#'+id);if(el&&!el.hidden)el.hidden=true});hideSaveOverlay();const status=$('#equipmentSettingStatus');modal.hidden=false;
 try{await loadEquipmentMaster(true)}catch(error){status.textContent=error.message;status.className='setting-status warn';return false}
 const suggestion=suggested||((reason==='suggestion'||reason==='required')?residualEquipmentSuggestion():'');fillEquipmentSelect(currentConfiguredEquipment(),suggestion);updateEquipmentMasterHelp();status.textContent=suggestion?`残コースから候補設備「${suggestion}」をプリセットしました。`:currentConfiguredEquipment()?`現在の設定: ${currentConfiguredEquipment()}`:'設備マスタから使用設備を選択してください。';status.className='setting-status '+(suggestion||!currentConfiguredEquipment()?'warn':'ok');
 const close=()=>modal.hidden=true;$('#closeAppSettings').onclick=close;$('#cancelAppSettings').onclick=close;
 $('#saveAppSettings').onclick=async()=>{const select=$('#configuredEquipment');let name=select.value;if(name==='__new__')name=$('#newEquipmentName').value.trim();if(!name){status.textContent='設備を選択してください。';status.className='setting-status warn';select.focus();return}try{const result=await registerAndSelectEquipment(name);status.textContent=result.message;status.className='setting-status ok';updateEquipmentEntryPoints();updateCourseGuard();const row=pendingMeasurementRow;pendingMeasurementRow=null;setTimeout(close,450);if(row){await nextPaint();openMeasurement(row).catch(error=>showToast('測定画面を開けません',error.message,8000))}}catch(error){status.textContent=error.message;status.className='setting-status warn'}};requestAnimationFrame(()=>$('#configuredEquipment').focus());return true;
};
function stampWorkTimeLocked(kind){if(!S.measure)return;S.measure.workTime=S.measure.workTime||{};const now=new Date();if(kind==='start'){if(S.measure.workTime.endAt){showToast('開始時刻は変更できません','終了時刻の記録後は開始時刻を変更できません。');return}S.measure.workTime.startAt=now.toISOString()}else{if(!S.measure.workTime.startAt){showToast('開始時刻が未記録です','先に開始時刻を記録してください。');return}if(now<new Date(S.measure.workTime.startAt)){showToast('終了時刻を記録できません','終了時刻は開始時刻より後である必要があります。');return}S.measure.workTime.endAt=now.toISOString()}updateWorkTimePanel();markDirty();updateValidationVisuals()}
updateWorkTimePanel=function(){if(!S.measure)return;S.measure.workTime=S.measure.workTime||{startAt:'',endAt:''};const start=$('#workStartAt'),end=$('#workEndAt');if(!start||!end)return;start.dataset.iso=S.measure.workTime.startAt||'';end.dataset.iso=S.measure.workTime.endAt||'';start.value=formatWorkTime(start.dataset.iso);end.value=formatWorkTime(end.dataset.iso);$('#stampWorkStart').disabled=!!S.measure.workTime.startAt;$('#stampWorkEnd').disabled=!S.measure.workTime.startAt||!!S.measure.workTime.endAt;[[ $('#workStartCard'),start.dataset.iso],[ $('#workEndCard'),end.dataset.iso]].forEach(([card,value])=>{card?.classList.toggle('validation-required',!value);card?.classList.toggle('validation-valid',!!value)});$('#workDuration').textContent=S.measure.workTime.endAt?`実作業時間 ${formatDuration(durationMs(S.measure))}`:S.measure.workTime.startAt?'作業中':'未計測';$('#stampWorkStart').onclick=()=>stampWorkTimeLocked('start');$('#stampWorkEnd').onclick=()=>stampWorkTimeLocked('end')};
const renderMeasurementWorkTabBase=renderMeasurement;renderMeasurement=function(){renderMeasurementWorkTabBase();document.querySelectorAll('[data-lefttab]').forEach(x=>x.classList.toggle('active',x.dataset.lefttab==='worktime'));document.querySelectorAll('[data-leftpanel]').forEach(x=>x.hidden=x.dataset.leftpanel!=='worktime');updateWorkTimePanel()};
renderRecordListRows=function(){const list=$('#recordList'),items=sortedFilteredRecords(),currentLot=normalizedLot(S.current?pick(S.current,'lotNo'):'');if(!list)return;list.innerHTML='<div class="record-list-head"><span>ロット番号</span><span>検査番号</span><span>鋳造番号</span><span>オーダー番号</span><span>取引先</span><span>コース</span><span>状態</span><span>オペレータ</span><span>作業開始時刻</span><span>更新日時</span><span>実作業時間</span><span>操作</span></div>';if(!items.length)list.insertAdjacentHTML('beforeend','<div class="record-empty">検索条件に一致するデータはありません。</div>');items.forEach(x=>{ensureMeasureShape(x);const same=currentLot&&normalizedLot(x.basic?.lotNo)===currentLot,row=document.createElement('article'),resume=resumeRecordFromList(x),course=x.basic?.residualCourse||x.basic?.course||x.basic?.designCourse||'-';row.className='record-list-row'+(same?' is-same-lot':'');row.tabIndex=0;row.innerHTML=`<div class="record-list-cell primary">${esc(x.basic?.lotNo||x.id)}</div><div class="record-list-cell">${esc(x.basic?.inspectionNo||'-')}</div><div class="record-list-cell">${esc(x.basic?.castingNo||'-')}</div><div class="record-list-cell secondary">${esc(x.basic?.orderNo||'-')}</div><div class="record-list-cell secondary">${esc(x.basic?.customer||'-')}</div><div class="record-list-cell secondary">${esc(course)}</div><div class="record-list-cell">${esc(x.status||'編集中')}</div><div class="record-list-cell secondary">${esc(x.settings?.operator||'-')}</div><div class="record-list-cell"><time>${esc(x.workTime?.startAt?formatWorkTime(x.workTime.startAt):'-')}</time></div><div class="record-list-cell"><time>${esc(x.updatedAt?new Date(x.updatedAt).toLocaleString('ja-JP'):'-')}</time></div><div class="record-list-cell record-duration">${esc(formatDuration(durationMs(x)))}</div><div class="record-list-actions"><button class="resume" type="button">${recordListState.status==='履歴'?'内容を開く':'続きから再開'}</button><button class="danger" type="button">削除</button></div>`;row.querySelector('.resume').onclick=e=>{e.stopPropagation();resume()};row.ondblclick=e=>{if(!e.target.closest('.danger'))resume()};row.onkeydown=e=>{if(e.key==='Enter')resume()};row.querySelector('.danger').onclick=async e=>{e.stopPropagation();if(confirm('この端末内データを削除しますか？')){await reliableDelete(x.id);await refreshDraftCount();await openRecords(recordListState.status)}};list.append(row)});const result=$('#recordSearchResult');if(result)result.textContent=`${items.length} / ${recordListState.items.length}件を表示`};
queueMicrotask(()=>{updateEquipmentEntryPoints();const badge=$('#registeredEquipmentBadge');if(badge){badge.setAttribute('role','button');badge.tabIndex=0;badge.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openEquipmentSettingsFinal('manual')}}}});


/* Compact single-page thickness/width workspace with left-side tolerance information. */
function compactToleranceFacts(kind){
 const detail=toleranceDetail(kind),base=Number(kind==='thickness'?S.measure.basic.mfgThickness:S.measure.basic.mfgWidth),labels={manufacturing:'製造公差',order:'オーダー公差',instruction:'指示公差'};
 if(!detail)return{html:'<div class="compact-tol-card no-data"><b>公差情報なし</b><span>判定条件を取得できません</span></div>',range:null};
 const source=labels[detail.source]||'公差',low=detail.range[0],high=detail.range[1];
 return{range:detail.range,html:`<div class="compact-tol-card"><span class="compact-tol-source">${esc(source)}</span><dl><dt>基準</dt><dd>${esc(base)}</dd><dt>公差</dt><dd>+${esc(detail.plus)} / -${esc(detail.minus)}</dd><dt>上限</dt><dd>${esc(high)}</dd><dt>下限</dt><dd>${esc(low)}</dd></dl><div class="compact-tol-range">${esc(low)} ～ ${esc(high)}</div></div>`};
}
function compactToleranceScale(kind,values,count){
 if(kind==='flatness')return '<div class="compact-tol-card"><span class="compact-tol-source">判定基準</span><span>〇＝OK<br>△・×＝NG</span></div>';
 const facts=compactToleranceFacts(kind),range=facts.range;if(!range)return facts.html;
 const valid=values.slice(0,count).map(v=>String(v).trim()).filter(Boolean).map(Number).filter(Number.isFinite),low=range[0],high=range[1],span=Math.max(high-low,.000001),viewLow=low-span*.3,viewHigh=high+span*.3;
 const marks=valid.slice(-20).map((v,index)=>{const pos=Math.max(3,Math.min(97,(viewHigh-v)/(viewHigh-viewLow)*100)),ng=v<low||v>high;return `<i class="compact-value-mark ${ng?'ng':'ok'}" style="top:${pos}%" title="${esc(v)}"></i>`}).join('');
 return `<div class="compact-tol-scale"><span class="compact-scale-label upper">上限<br><b>${esc(high)}</b></span><span class="compact-scale-safe">公差内</span>${marks}<span class="compact-scale-label lower">下限<br><b>${esc(low)}</b></span></div>${facts.html}`;
}
function compactMeasureStatus(done,total){return done===total?'測定完了':done?`測定中 ${done}/${total}`:'測定待ち'}
renderMeasureGridVertical=function(){
 const type=$('#measureType').value,key=activeMeasureKey(),m=S.measure,li=lengthIndex(),count=Math.max(1,Math.min(40,+$('#horizontalCount').value||1));
 if(type!=='板厚/板幅'){
  const actualKey=key==='mother'?'width':key,values=m.measurements[actualKey][li],done=values.slice(0,count).filter(v=>v!=='').length;
  const bulkBtn=type==='フラットネス'?'<span class="flat-pick-group"><span class="flat-pick-label">現在の条へ入力</span><button type="button" class="flat-pick" data-sym="〇">〇</button><button type="button" class="flat-pick" data-sym="△">△</button><button type="button" class="flat-pick" data-sym="×">×</button></span><button type="button" id="flatAllOk">全条 〇</button>':'';
  let h=`<section class="measure-grid-block compact-other"><div class="measure-grid-block-title"><span>${esc(type)}</span><div class="measure-status-group"><span class="measure-status">${compactMeasureStatus(done,count)}</span>${bulkBtn}</div></div><div class="compact-width-body"><aside class="compact-tolerance-side">${compactToleranceScale(actualKey,values,count)}</aside><div class="strip-layout compact-strip-layout">`;
  for(let col=0;col<2;col++){h+='<div class="strip-column"><div class="strip-head"><span>条</span><span>測定値・判定</span></div>';for(let row=0;row<20;row++){const j=col*20+row,active=j<count;h+=`<div class="strip-row ${active?'':'inactive'}"><label>${j+1}</label>${makeMeasureInputV29(actualKey,li,j,active?values[j]:'',active)}</div>`}h+='</div>'}h+='</div></div></section>';
  if(type==='フラットネス')h+=`<section class="measure-grid-block flatness-note-block"><div class="measure-grid-block-title"><span>備考</span></div><div class="flatness-entry"><label>対象条<select id="coilNo"></select></label><label>備考<textarea id="coilComment"></textarea></label></div></section>`;
  $('#measurementGrid').innerHTML=h;
 }else{
  const thickness=m.measurements.thickness[li],width=m.measurements.width[li],tDone=thickness.filter(v=>v!=='').length,wDone=width.slice(0,count).filter(v=>v!=='').length;
  let h=`<div class="compact-dimension-workspace"><section class="measure-grid-block compact-thickness"><div class="measure-grid-block-title"><span>板厚</span><span class="measure-status">${compactMeasureStatus(tDone,3)}</span></div><div class="compact-thickness-body"><aside class="compact-tolerance-side thickness-side">${compactToleranceFacts('thickness').html}</aside><div class="thickness-vertical"><b>位置</b><b>OS</b><b>CL</b><b>DS</b><span>丈 ${li+1}</span>${thickness.map((v,j)=>makeMeasureInput('thickness',li,j,v)).join('')}</div></div></section>`;
  h+=`<section class="measure-grid-block compact-width"><div class="measure-grid-block-title"><span>板幅</span><span class="measure-status">${compactMeasureStatus(wDone,count)}</span></div><div class="compact-width-body"><aside class="compact-tolerance-side">${compactToleranceScale('width',width,count)}</aside><div class="strip-layout compact-strip-layout">`;
  for(let col=0;col<2;col++){h+='<div class="strip-column"><div class="strip-head"><span>条</span><span>測定値・判定</span></div>';for(let row=0;row<20;row++){const j=col*20+row,active=j<count;h+=`<div class="strip-row ${active?'':'inactive'}"><label>${j+1}</label>${makeMeasureInputV29('width',li,j,active?width[j]:'',active)}</div>`}h+='</div>'}h+='</div></div></section></div>';$('#measurementGrid').innerHTML=h;
 }
 bindMeasureInputs();applyInputProtection();focusCurrent();updateMeasurementHeading();const summary=$('#toleranceSummary');if(summary)summary.hidden=type==='板厚/板幅';
 if(type==='フラットネス'){
  updateCoilOptions($('#horizontalCount').value);
  $('#coilNo').onchange=()=>{saveFlatComment();loadFlatComment()};
  $('#coilComment').onchange=()=>{saveFlatComment();markDirty()};
  $('#flatAllOk').onclick=()=>{const j=lengthIndex(),n=Math.max(1,+$('#horizontalCount').value||1);for(let c=0;c<n;c++)m.measurements.flatness[j][c]='〇';renderMeasureGrid();markDirty()};
  loadFlatComment();
  bindFlatnessInputs();
 }
};
function focusFlatnessCurrentCell(){const m=S.measure,el=document.querySelector(`input[data-mkey="flatness"][data-i="${lengthIndex()}"][data-j="${m.settings.wStep||0}"]`);if(el)el.focus()}
function bindFlatnessInputs(){
 const m=S.measure;
 /* フラットネスは記号(〇/△/×)または自由記述のため、他項目のような
    測定器転送(deviceInput)経由の数値受信とは切り離し、セルへ直接
    入力できるようにする。 */
 document.querySelectorAll('input[data-mkey="flatness"]').forEach(x=>{
  x.onclick=()=>{m.settings.wStep=+x.dataset.j;focusCurrent()};
  x.onkeydown=e=>{
   if(e.key==='Delete'){x.value='';x.oninput();m.settings.wStep=+x.dataset.j;renderMeasureGrid();focusFlatnessCurrentCell();return}
   if(e.key==='Enter'){e.preventDefault();advanceWidth();renderMeasureGrid();focusFlatnessCurrentCell()}
  };
 });
 document.querySelectorAll('.flat-pick').forEach(btn=>{
  btn.onclick=()=>{
   const j=lengthIndex(),c=m.settings.wStep||0;
   m.measurements.flatness[j][c]=btn.dataset.sym;
   advanceWidth();renderMeasureGrid();markDirty();focusFlatnessCurrentCell();
  };
 });
}
const applyRightLayoutCompactBase=applyRightLayout;
applyRightLayout=function(){applyRightLayoutCompactBase();const summary=$('#toleranceSummary');if(summary)summary.hidden=$('#measureType')?.value==='板厚/板幅'};


/* Measurement precision and zero-order-tolerance correction. */
function measurementDigits(key){return key==='thickness'?3:key==='width'?1:null}
function fixedMeasurementValue(key,value){const raw=String(value??'').trim(),digits=measurementDigits(key);if(raw===''||digits===null)return raw;const n=Number(raw);return Number.isFinite(n)?n.toFixed(digits):raw}
function fixedToleranceValue(kind,value){const n=Number(value);if(!Number.isFinite(n))return '-';return n.toFixed(kind==='thickness'?3:1)}
const makeMeasureInputPrecisionBase=makeMeasureInput;
makeMeasureInput=function(key,i,j,value){return makeMeasureInputPrecisionBase(key,i,j,fixedMeasurementValue(key,value))};
const bindMeasureInputsPrecisionBase=bindMeasureInputs;
bindMeasureInputs=function(){
 bindMeasureInputsPrecisionBase();
 document.querySelectorAll('[data-mkey="thickness"],[data-mkey="width"]').forEach(el=>{
  const previousBlur=el.onblur;
  el.onblur=event=>{if(previousBlur)previousBlur.call(el,event);const formatted=fixedMeasurementValue(el.dataset.mkey,el.value);if(el.value!==formatted){el.value=formatted;S.measure.measurements[el.dataset.mkey][+el.dataset.i][+el.dataset.j]=formatted;judgeInput(el,el.dataset.mkey,Number(formatted),+el.dataset.j);renderStats();markDirty()}}
 });
};
const processDeviceInputPrecisionBase=processDeviceInput;
processDeviceInput=function(raw){const type=$('#measureType')?.value,parsed=deviceParse(raw);if(type==='板厚/板幅'&&parsed.value!==null&&Number.isFinite(parsed.value)&&['caliper','tape','manual'].includes(parsed.device)){const normalized={...parsed,value:Number(parsed.value.toFixed(1))};const original=deviceParse;deviceParse=()=>normalized;try{return processDeviceInputPrecisionBase(raw)}finally{deviceParse=original}}return processDeviceInputPrecisionBase(raw)};
const toleranceDataForSourcePrecisionBase=toleranceDataForSource;
toleranceDataForSource=function(kind,source){const data=toleranceDataForSourcePrecisionBase(kind,source);if(source==='order'&&data&&(Number(data.plus)===0||Number(data.minus)===0))return null;return data};
compactToleranceFacts=function(kind){
 const detail=toleranceDetail(kind),base=Number(kind==='thickness'?S.measure.basic.mfgThickness:S.measure.basic.mfgWidth),labels={manufacturing:'製造公差',order:'オーダー公差',instruction:'指示公差'};
 if(!detail)return{html:'<div class="compact-tol-card no-data"><b>公差情報なし</b><span>判定条件を取得できません</span></div>',range:null};
 const source=labels[detail.source]||'公差',low=detail.range[0],high=detail.range[1],baseText=fixedToleranceValue(kind,base),plusText=fixedToleranceValue(kind,detail.plus),minusText=fixedToleranceValue(kind,detail.minus),lowText=fixedToleranceValue(kind,low),highText=fixedToleranceValue(kind,high);
 return{range:detail.range,html:`<div class="compact-tol-card"><span class="compact-tol-source">${esc(source)}</span><dl><dt>基準</dt><dd>${esc(baseText)}</dd><dt>公差</dt><dd>+${esc(plusText)} / -${esc(minusText)}</dd><dt>上限</dt><dd>${esc(highText)}</dd><dt>下限</dt><dd>${esc(lowText)}</dd></dl><div class="compact-tol-range">${esc(lowText)} ～ ${esc(highText)}</div></div>`};
};
compactToleranceScale=function(kind,values,count){
 const facts=compactToleranceFacts(kind),range=facts.range;if(!range)return facts.html;const valid=values.slice(0,count).map(v=>String(v).trim()).filter(Boolean).map(Number).filter(Number.isFinite),low=range[0],high=range[1],span=Math.max(high-low,.000001),viewLow=low-span*.3,viewHigh=high+span*.3;
 const marks=valid.slice(-20).map(v=>{const pos=Math.max(3,Math.min(97,(viewHigh-v)/(viewHigh-viewLow)*100)),ng=v<low||v>high;return `<i class="compact-value-mark ${ng?'ng':'ok'}" style="top:${pos}%" title="${esc(fixedToleranceValue(kind,v))}"></i>`}).join('');
 return `<div class="compact-tol-scale"><span class="compact-scale-label upper">上限<br><b>${esc(fixedToleranceValue(kind,high))}</b></span><span class="compact-scale-safe">公差内</span>${marks}<span class="compact-scale-label lower">下限<br><b>${esc(fixedToleranceValue(kind,low))}</b></span></div>${facts.html}`;
};


/* Final title guard for delayed initialization and browser history restoration. */
function enforceApplicationTitle(){if(document.title!=='測定伝送システム')document.title='測定伝送システム'}
enforceApplicationTitle();window.addEventListener('pageshow',enforceApplicationTitle);document.addEventListener('visibilitychange',()=>{if(!document.hidden)enforceApplicationTitle()});


/* Horizontal tolerance summary: preserve hierarchy while avoiding vertical clipping. */
function compactToleranceData(kind){
 const detail=toleranceDetail(kind),base=Number(kind==='thickness'?S.measure.basic.mfgThickness:S.measure.basic.mfgWidth),labels={manufacturing:'製造公差',order:'オーダー公差',instruction:'指示公差'};
 if(!detail)return null;
 return{source:labels[detail.source]||'公差',base:fixedToleranceValue(kind,base),plus:fixedToleranceValue(kind,detail.plus),minus:fixedToleranceValue(kind,detail.minus),low:fixedToleranceValue(kind,detail.range[0]),high:fixedToleranceValue(kind,detail.range[1]),range:detail.range};
}
compactToleranceFacts=function(kind){
 const data=compactToleranceData(kind);if(!data)return{html:'<div class="compact-tol-inline no-data"><b>公差情報なし</b><span>判定条件を取得できません</span></div>',range:null};
 return{range:data.range,html:`<div class="compact-tol-inline"><span class="compact-tol-source">${esc(data.source)}</span><span class="tol-inline-fact"><small>基準</small><b>${esc(data.base)}</b></span><span class="tol-inline-fact"><small>公差</small><b>+${esc(data.plus)} / -${esc(data.minus)}</b></span><span class="tol-inline-fact range"><small>判定範囲</small><b>${esc(data.low)} ～ ${esc(data.high)}</b></span></div>`};
};
compactToleranceScale=function(kind,values,count){
 const facts=compactToleranceFacts(kind),range=facts.range;if(!range)return facts.html;const valid=values.slice(0,count).map(v=>String(v).trim()).filter(Boolean).map(Number).filter(Number.isFinite),low=range[0],high=range[1],span=Math.max(high-low,.000001),viewLow=low-span*.3,viewHigh=high+span*.3;
 const marks=valid.slice(-20).map(v=>{const pos=Math.max(3,Math.min(97,(viewHigh-v)/(viewHigh-viewLow)*100)),ng=v<low||v>high;return `<i class="compact-value-mark ${ng?'ng':'ok'}" style="top:${pos}%" title="${esc(fixedToleranceValue(kind,v))}"></i>`}).join('');
 return `${facts.html}<div class="compact-tol-scale"><span class="compact-scale-label upper">上限 <b>${esc(fixedToleranceValue(kind,high))}</b></span><span class="compact-scale-safe">公差内</span>${marks}<span class="compact-scale-label lower">下限 <b>${esc(fixedToleranceValue(kind,low))}</b></span></div>`;
};


/* Final fit-first tolerance layout: two logical rows sized to the actual numeric domains. */
compactToleranceFacts=function(kind){
 const data=compactToleranceData(kind);if(!data)return{html:'<div class="compact-tol-two-row no-data"><b>公差情報なし</b><span>判定条件を取得できません</span></div>',range:null};
 return{range:data.range,html:`<div class="compact-tol-two-row"><div class="tol-row-primary"><span class="compact-tol-source">${esc(data.source)}</span><span class="tol-pair"><small>基準</small><b>${esc(data.base)}</b></span><span class="tol-pair tolerance"><small>公差</small><b>+${esc(data.plus)} / -${esc(data.minus)}</b></span></div><div class="tol-row-range"><small>判定範囲</small><b>${esc(data.low)} ～ ${esc(data.high)}</b></div></div>`};
};
compactToleranceScale=function(kind,values,count){
 const facts=compactToleranceFacts(kind),range=facts.range;if(!range)return facts.html;const valid=values.slice(0,count).map(v=>String(v).trim()).filter(Boolean).map(Number).filter(Number.isFinite),low=range[0],high=range[1],span=Math.max(high-low,.000001),viewLow=low-span*.3,viewHigh=high+span*.3;
 const marks=valid.slice(-20).map(v=>{const pos=Math.max(3,Math.min(97,(viewHigh-v)/(viewHigh-viewLow)*100)),ng=v<low||v>high;return `<i class="compact-value-mark ${ng?'ng':'ok'}" style="top:${pos}%" title="${esc(fixedToleranceValue(kind,v))}"></i>`}).join('');
 return `${facts.html}<div class="compact-tol-scale"><span class="compact-scale-label upper">上限 <b>${esc(fixedToleranceValue(kind,high))}</b></span><span class="compact-scale-safe">公差内</span>${marks}<span class="compact-scale-label lower">下限 <b>${esc(fixedToleranceValue(kind,low))}</b></span></div>`;
};


/* Final relative 40:60 layout and three-row tolerance hierarchy. */
compactToleranceFacts=function(kind){
 const data=compactToleranceData(kind);
 if(!data)return{html:'<div class="compact-tol-three-row no-data"><b>公差情報なし</b><span>判定条件を取得できません</span></div>',range:null};
 return{range:data.range,html:`<div class="compact-tol-three-row"><div class="tol-line tol-line-base"><span class="compact-tol-source">${esc(data.source)}</span><span class="tol-value-pair"><small>基準</small><b>${esc(data.base)}</b></span></div><div class="tol-line tol-line-plusminus"><span class="tol-value-pair"><small>公差＋</small><b>+${esc(data.plus)}</b></span><span class="tol-value-pair"><small>公差－</small><b>-${esc(data.minus)}</b></span></div><div class="tol-line tol-line-range"><small>判定範囲</small><b>${esc(data.low)} ～ ${esc(data.high)}</b></div></div>`};
};
compactToleranceScale=function(kind,values,count){
 const facts=compactToleranceFacts(kind),range=facts.range;
 if(!range)return facts.html;
 const valid=values.slice(0,count).map(v=>String(v).trim()).filter(Boolean).map(Number).filter(Number.isFinite),low=range[0],high=range[1],span=Math.max(high-low,.000001),viewLow=low-span*.3,viewHigh=high+span*.3;
 const marks=valid.slice(-20).map(v=>{const pos=Math.max(3,Math.min(97,(viewHigh-v)/(viewHigh-viewLow)*100)),ng=v<low||v>high;return `<i class="compact-value-mark ${ng?'ng':'ok'}" style="top:${pos}%" title="${esc(fixedToleranceValue(kind,v))}"></i>`}).join('');
 return `${facts.html}<div class="compact-tol-scale"><span class="compact-scale-label upper">上限 <b>${esc(fixedToleranceValue(kind,high))}</b></span><span class="compact-scale-safe">公差内</span>${marks}<span class="compact-scale-label lower">下限 <b>${esc(fixedToleranceValue(kind,low))}</b></span></div>`;
};

