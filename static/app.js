"use strict";const LENGTH_SLOTS=12;const $=s=>document.querySelector(s),S={db:null,table:null,catalog:[],tables:[],columns:[],rows:[],page:1,count:0,current:null,measure:null};
const api=async(u,o)=>{let r;try{r=await fetch(u,{cache:'no-store',...(o||{})})}catch(error){throw Error('サーバーへ接続できません。Flaskアプリが起動中か、ポート5029で開いているか確認してください。詳細: '+(error?.message||String(error)))}const text=await r.text();let j={};try{j=text?JSON.parse(text):{}}catch(_){j={error:text}}if(!r.ok)throw Error(j.error||('HTTP '+r.status));return j},esc=v=>{const d=document.createElement('div');d.textContent=v??'';return d.innerHTML};
async function init(){
 const build=await api('/api/build');document.title='測定伝送システム';
 const d=await api('/api/catalog');S.catalog=d.databases;
 const nav=$('#nav');
 d.databases.forEach(x=>{
  let b=nav?.querySelector(`[data-db-key="${x.key}"]`);
  if(!b){b=document.createElement('button');b.className='db';b.dataset.dbKey=x.key;nav?.append(b)}
  b.textContent=x.label;b.onclick=()=>selectDb(x.key,b);
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
function blankMeasure(row){return{id:crypto.randomUUID(),status:'編集中',updatedAt:new Date().toISOString(),source:row,basic:Object.fromEntries(Object.keys(aliases).map(k=>[k,pick(row,k)])),settings:{operator:'-',inspector:'-',lengthPos:'1(頭)',measureType:'母材',verticalCount:1,horizontalCount:1,unwind:'上出し',innerDiameter:'-',spool:'-',thicknessGauge:'-',widthGauge:'-',widthOrder:'通常',widthDirection:'昇順',inputMode:'auto',tStep:0,wStep:0,burrFirst:null,ngCount:0,burr:'指定なし',innerTape:false,crewSize:'1'},mother:{},qualityInfo:'異常情報なし',measurements:{thickness:Array.from({length:LENGTH_SLOTS},()=>Array(3).fill('')),width:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),lateral:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),burr:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),telescope:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),offset:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),flatness:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),comments:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill(''))}}}
async function openMeasurement(row){if(!row)throw Error('対象データがありません');S.current=row;const key=lotKey(row),saved=await idbGet(key);S.measure=saved||blankMeasure(row);S.measure.id=key;renderMeasurement();$('#measureModal').hidden=false;requestAnimationFrame(()=>$('#deviceInput').focus())}
function lotKey(r){return [pick(r,'equipment'),pick(r,'lotNo'),pick(r,'inspectionNo'),pick(r,'castingNo')].join('|')}
/* 基本情報タブの寸法表示整形。板厚=小数2桁 / 板幅・板丈=小数1桁。数値でない・空欄はそのまま。 */
function fmtDim(value,digits){const raw=String(value??'').trim();if(raw==='')return '';const n=Number(raw);return Number.isFinite(n)?n.toFixed(digits):raw}
function renderMeasurement(){const m=S.measure,b=m.basic;updateLengthOptions(m.settings.verticalCount||1);updateCoilOptions(m.settings.horizontalCount||1);$('#modalEquipment').textContent=b.equipment;const fields=[['管理No.','lotNo'],['検査No.','inspectionNo'],['オーダーNo.','orderNo'],['引当No.','allocationNo'],['鋳造No.','castingNo'],['用途コード','purposeCode'],['用途名','purposeName'],['取引先','customer'],['納入先','delivery'],['実績コース','course']];let h='<div class="info-grid">'+fields.map(([l,k])=>`<div class="field ${['customer','delivery','course'].includes(k)?'full':''}"><label>${l}</label><output title="${esc(b[k])}">${esc(b[k])}</output></div>`).join('');h+=`<div class="dimension"><b></b><b>材質</b><b>調質</b><b>板厚</b><b>板幅</b><b>板丈</b><b>オーダー</b><span>${esc(b.orderMaterial)}</span><span>${esc(b.orderTemper)}</span><span>${esc(fmtDim(b.orderThickness,2))}</span><span>${esc(fmtDim(b.orderWidth,1))}</span><span>${esc(fmtDim(b.orderLength,1))}</span><b>製造</b><span>${esc(b.mfgMaterial)}</span><span>${esc(b.mfgTemper)}</span><span>${esc(fmtDim(b.mfgThickness,2))}</span><span>${esc(fmtDim(b.mfgWidth,1))}</span><span>${esc(fmtDim(b.mfgLength,1))}</span></div></div>`;$('#basicInfo').innerHTML=h;Object.entries(m.settings).forEach(([k,v])=>{const el=$('#'+k);if(el){if(el.type==='checkbox')el.checked=v;else el.value=v}});$('#qualityInfo').value=m.qualityInfo;document.querySelectorAll('[data-mother]').forEach(x=>x.value=m.mother[x.dataset.mother]||'');document.querySelectorAll('[name=burr]').forEach(x=>x.checked=x.value===m.settings.burr);renderMeasureGrid();renderStats();setState('IndexedDB読込済み')}
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
function saveFlatComment(){if(!S.measure||!$('#coilNo'))return;const i=(+$('#coilNo').value||1)-1,j=lengthIndex();S.measure.measurements.flatness[j][i]=$('#flatness').value;S.measure.measurements.comments[j][i]=String($('#coilComment').value||'').replace(/[;|]/g,'')}
function loadFlatComment(){if(!S.measure||!$('#coilNo'))return;const i=(+$('#coilNo').value||1)-1,j=lengthIndex();$('#flatness').value=S.measure.measurements.flatness[j][i]||'';$('#coilComment').value=S.measure.measurements.comments[j][i]||''}
function bindTabs(group,panel){document.querySelectorAll(`[data-${group}tab]`).forEach(btn=>btn.onclick=()=>{document.querySelectorAll(`[data-${group}tab]`).forEach(x=>x.classList.toggle('active',x===btn));document.querySelectorAll(`[data-${group}panel]`).forEach(x=>x.hidden=x.dataset[group+'panel']!==btn.dataset[group+'tab'])})}
function optionFill(id,items,current='-'){const el=$('#'+id);if(!el)return;const vals=['-',...new Set(items||[])];el.innerHTML=vals.map(v=>`<option>${esc(v)}</option>`).join('');if(vals.includes(current))el.value=current}
function qualityText(items){if(!items?.length)return '異常情報なし';return items.slice(0,4).map((q,i)=>`(${i+1}) ${q['発生設備']||''} ${q['登録日時']||''} ${q['異常内容']||''}\nコメント：${q['コメント']||''}\n最終処置：${q['最終処置']||''}\n保留設定日：${q['保留設定日']||''}　保留解除日：${q['保留解除']||''}`).join('\n\n')}
async function loadMeasurementContext(){const m=S.measure,u=new URLSearchParams({lot:m.basic.lotNo,equipment:m.basic.equipment});try{setState('マスタ読込中');const x=await api('/api/measurement/context?'+u);optionFill('operator',x.operators,m.settings.operator);optionFill('inspector',x.inspectors||x.operators,m.settings.inspector);optionFill('thicknessGauge',x.thickness_gauges,m.settings.thicknessGauge);optionFill('widthGauge',x.width_gauges,m.settings.widthGauge);optionFill('innerDiameter',x.inner_diameters,m.settings.innerDiameter);optionFill('spool',x.spools,m.settings.spool);if(x.quality?.length){m.qualityInfo=qualityText(x.quality);$('#qualityInfo').value=m.qualityInfo}$('#masterDiagnostic').textContent=JSON.stringify(x.diagnostics,null,2);const total=(x.operators?.length||0)+(x.thickness_gauges?.length||0)+(x.width_gauges?.length||0)+(x.inner_diameters?.length||0)+(x.spools?.length||0);setState(`マスタ ${total}件読込済み`)}catch(e){setState('マスタ読込エラー');$('#masterDiagnostic').textContent=e.stack||e.message;console.warn('context load failed',e)}}
function widthSequence(max,order,dir){let a=Array.from({length:max},(_,i)=>i);if(order==='奇数条優先')a=[...a.filter(i=>i%2===0),...a.filter(i=>i%2===1)];if(order==='偶数条優先')a=[...a.filter(i=>i%2===1),...a.filter(i=>i%2===0)];if(dir==='降順')a=a.reverse();return a}
function lengthIndex(){const el=$('#lengthPos');if(!el)return 0;const opts=[...el.options],idx=opts.findIndex(o=>o.value===el.value);return Math.max(0,Math.min(LENGTH_SLOTS-1,idx>=0?idx:0))}
function deviceParse(raw){const v=String(raw||'').trim().toUpperCase();if(v==='#DELETEMODE#'||v==='DELETE')return{device:'delete',value:null};if(v.includes('+#L'))return{device:'tape',value:Number(v.split('+#L')[1])};if(!v.includes('+'))return Number.isFinite(Number(v))?{device:'manual',value:Number(v)}:{device:'invalid',value:null};const [code,data]=v.split('+');let device='invalid';if(code.startsWith('DT1')){const kind=code.slice(-2,-1);device=kind==='0'?'micrometer':kind==='1'?'caliper':kind==='2'?'depth':'invalid'}const num=Number(String(data).replace(/M$/,''));return{device,value:Number.isFinite(num)?num:null}}
function activeMeasureKey(){return({母材:'mother', '板厚/板幅':'width',ラテラルボー:'lateral',バリ:'burr',テレスコープ:'telescope',巻ずれ:'offset'})[$('#measureType').value]||'width'}
function toleranceFor(kind,index=0){const r=S.measure.source||{},b=S.measure.basic;const val=(names)=>{for(const n of names)if(r[n]!==undefined&&r[n]!==null&&r[n]!=='')return Number(r[n]);return NaN};if(kind==='thickness'){const base=Number(b.mfgThickness),plus=val(['板厚公差_製造_プラス','KOSAXSMP']),minus=val(['板厚公差_製造_マイナス','KOSAXSMM']);return(Number.isFinite(base)&&Number.isFinite(plus)&&Number.isFinite(minus))?[base-minus,base+plus]:null}const base=Number(b.mfgWidth),plus=val(['板幅公差_製造_プラス','KOSAYSMP']),minus=val(['板幅公差_製造_マイナス','KOSAYSMM']);return(Number.isFinite(base)&&Number.isFinite(plus)&&Number.isFinite(minus))?[base-minus,base+plus]:null}
function judgeInput(el,key,value,index){const tol=toleranceFor(key==='thickness'?'thickness':'width',index);el.classList.remove('ng','complete');if(Number.isFinite(value)){el.classList.add('complete');if(tol&&(value<tol[0]||value>tol[1]))el.classList.add('ng')}}
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

function updateReceiveState(focused=document.activeElement===$('#deviceInput')){if(!S.measure)return;const manual=S.measure.settings.inputMode==='manual',box=$('#inputStatusBox'),inp=$('#deviceInput');box.classList.remove('receiving','manual-state','not-ready-state');inp.classList.remove('manual-receive','locked-receive');if(manual){box.classList.add('manual-state');inp.classList.add('manual-receive');$('#inputReady').textContent='手動入力モード';$('#inputModeHelp').textContent='測定セルへ直接入力（Enterで確定）';$('#receiveLock').textContent='手入力許可';inp.placeholder='必要に応じて数値を入力'}else if(focused){box.classList.add('receiving');$('#inputReady').textContent='伝送入力受付中';$('#inputModeHelp').textContent='測定器からの転送待ち。Tabで受信確定';$('#receiveLock').textContent='転送専用';inp.placeholder='測定器データ受信専用'}else{box.classList.add('not-ready-state');inp.classList.add('locked-receive');$('#inputReady').textContent='伝送入力停止中';$('#inputModeHelp').textContent='受信欄をクリックすると受付を再開します';$('#receiveLock').textContent='受付停止';inp.placeholder='クリックして伝送受付を再開'}}$('#deviceInput').onfocus=()=>updateReceiveState(true);$('#deviceInput').onblur=()=>updateReceiveState(false);$('#deviceInput').onkeydown=e=>{const auto=S.measure?.settings?.inputMode!=='manual',accept=(auto&&e.key==='Tab')||(!auto&&e.key==='Enter');if(accept){e.preventDefault();processDeviceInput(e.target.value)}else if((e.key==='Delete'||e.key==='Backspace')&&!e.target.value){e.preventDefault();processDeviceInput('#DeleteMode#')}else if(e.key==='ArrowDown'||(e.key==='Enter'&&!e.target.value)){e.preventDefault();advanceWidth();focusCurrent()}else if(e.key==='ArrowUp'){e.preventDefault();const seq=widthSequence(Math.max(1,+$('#horizontalCount').value||1),$('#widthOrder').value,$('#widthDirection').value),pos=seq.indexOf(S.measure.settings.wStep||0);S.measure.settings.wStep=seq[(pos-1+seq.length)%seq.length];focusCurrent()}};
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
$('#coilNo').onchange=()=>{saveFlatComment();loadFlatComment()};$('#flatness').onchange=()=>{saveFlatComment();markDirty()};$('#coilComment').onchange=()=>{saveFlatComment();markDirty()};
$('#flatAllOk').onclick=()=>{const j=lengthIndex(),n=Math.max(1,+$('#horizontalCount').value||1);for(let i=0;i<n;i++)S.measure.measurements.flatness[j][i]='〇';loadFlatComment();markDirty()};



function makeMeasureInput(key,i,j,value){return `<input data-mkey="${key}" data-i="${i}" data-j="${j}" value="${esc(value)}" inputmode="decimal" aria-label="${j+1}条">`}
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
function toleranceInfoFor(key,index,value){const tol=toleranceFor(key==='thickness'?'thickness':'width',index),num=Number(value);if(!tol||!Number.isFinite(num))return{tol,state:'wait',pos:50};const low=tol[0],high=tol[1],span=Math.max(Math.abs(high-low),.000001),viewLow=low-span*.25,viewHigh=high+span*.25,pos=Math.max(0,Math.min(100,(viewHigh-num)/(viewHigh-viewLow)*100));return{tol,state:num<low||num>high?'ng':'ok',pos}}
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
 const raw=String(el.value??'').trim(),tol=toleranceFor(key==='thickness'?'thickness':'width',index),num=Number(raw);
 el.classList.remove('ng','complete');
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
 const type=$('#measureType').value,kind=type==='板厚/板幅'?'thickness':'width',detail=toleranceDetail(kind),base=Number(kind==='thickness'?S.measure.basic.mfgThickness:S.measure.basic.mfgWidth);$('#measurePanelTitle').textContent=type==='板厚/板幅'?'板厚・板幅測定':type+'測定';
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
function updateRegisteredEquipmentBadge(){const badge=$('#registeredEquipmentBadge'),equipment=currentConfiguredEquipment();if(!badge)return;badge.textContent=equipment?`使用設備: ${equipment}`:'使用設備: 未登録';badge.classList.toggle('unregistered',!equipment);badge.title=equipment?'クリックして使用設備を変更できます':'測定開始前に使用設備の登録が必要です';badge.onclick=openAppSettings}
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
renderRecordListRows=function(){const list=$('#recordList'),items=sortedFilteredRecords(),currentLot=normalizedLot(S.current?pick(S.current,'lotNo'):'');if(!list)return;list.innerHTML='<div class="record-list-head"><span>ロット番号</span><span>検査番号</span><span>鋳造番号</span><span>オーダー番号</span><span>取引先</span><span>コース</span><span>状態</span><span>更新日時</span><span>実作業時間</span><span>操作</span></div>';if(!items.length)list.insertAdjacentHTML('beforeend','<div class="record-empty">検索条件に一致するデータはありません。</div>');items.forEach(x=>{ensureMeasureShape(x);const same=currentLot&&normalizedLot(x.basic?.lotNo)===currentLot,row=document.createElement('article'),resume=resumeRecordFromList(x),course=x.basic?.residualCourse||x.basic?.course||x.basic?.designCourse||'-';row.className='record-list-row'+(same?' is-same-lot':'');row.tabIndex=0;row.innerHTML=`<div class="record-list-cell primary">${esc(x.basic?.lotNo||x.id)}</div><div class="record-list-cell">${esc(x.basic?.inspectionNo||'-')}</div><div class="record-list-cell">${esc(x.basic?.castingNo||'-')}</div><div class="record-list-cell secondary">${esc(x.basic?.orderNo||'-')}</div><div class="record-list-cell secondary">${esc(x.basic?.customer||'-')}</div><div class="record-list-cell secondary">${esc(course)}</div><div class="record-list-cell">${esc(x.status||'編集中')}</div><div class="record-list-cell"><time>${esc(x.updatedAt?new Date(x.updatedAt).toLocaleString('ja-JP'):'-')}</time></div><div class="record-list-cell record-duration">${esc(formatDuration(durationMs(x)))}</div><div class="record-list-actions"><button class="resume" type="button">${recordListState.status==='履歴'?'内容を開く':'続きから再開'}</button><button class="danger" type="button">削除</button></div>`;row.querySelector('.resume').onclick=e=>{e.stopPropagation();resume()};row.ondblclick=e=>{if(!e.target.closest('.danger'))resume()};row.onkeydown=e=>{if(e.key==='Enter')resume()};row.querySelector('.danger').onclick=async e=>{e.stopPropagation();if(confirm('この端末内データを削除しますか？')){await reliableDelete(x.id);await refreshDraftCount();await openRecords(recordListState.status)}};list.append(row)});const result=$('#recordSearchResult');if(result)result.textContent=`${items.length} / ${recordListState.items.length}件を表示`};
queueMicrotask(()=>{updateEquipmentEntryPoints();const badge=$('#registeredEquipmentBadge');if(badge){badge.setAttribute('role','button');badge.tabIndex=0;badge.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openEquipmentSettingsFinal('manual')}}}});


/* Compact single-page thickness/width workspace with left-side tolerance information. */
function compactToleranceFacts(kind){
 const detail=toleranceDetail(kind),base=Number(kind==='thickness'?S.measure.basic.mfgThickness:S.measure.basic.mfgWidth),labels={manufacturing:'製造公差',order:'オーダー公差',instruction:'指示公差'};
 if(!detail)return{html:'<div class="compact-tol-card no-data"><b>公差情報なし</b><span>判定条件を取得できません</span></div>',range:null};
 const source=labels[detail.source]||'公差',low=detail.range[0],high=detail.range[1];
 return{range:detail.range,html:`<div class="compact-tol-card"><span class="compact-tol-source">${esc(source)}</span><dl><dt>基準</dt><dd>${esc(base)}</dd><dt>公差</dt><dd>+${esc(detail.plus)} / -${esc(detail.minus)}</dd><dt>上限</dt><dd>${esc(high)}</dd><dt>下限</dt><dd>${esc(low)}</dd></dl><div class="compact-tol-range">${esc(low)} ～ ${esc(high)}</div></div>`};
}
function compactToleranceScale(kind,values,count){
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
  let h=`<section class="measure-grid-block compact-other"><div class="measure-grid-block-title"><span>${esc(type)}</span><span class="measure-status">${compactMeasureStatus(done,count)}</span></div><div class="compact-width-body"><aside class="compact-tolerance-side">${compactToleranceScale(actualKey,values,count)}</aside><div class="strip-layout compact-strip-layout">`;
  for(let col=0;col<2;col++){h+='<div class="strip-column"><div class="strip-head"><span>条</span><span>測定値・判定</span></div>';for(let row=0;row<20;row++){const j=col*20+row,active=j<count;h+=`<div class="strip-row ${active?'':'inactive'}"><label>${j+1}</label>${makeMeasureInputV29(actualKey,li,j,active?values[j]:'',active)}</div>`}h+='</div>'}h+='</div></div></section>';$('#measurementGrid').innerHTML=h;
 }else{
  const thickness=m.measurements.thickness[li],width=m.measurements.width[li],tDone=thickness.filter(v=>v!=='').length,wDone=width.slice(0,count).filter(v=>v!=='').length;
  let h=`<div class="compact-dimension-workspace"><section class="measure-grid-block compact-thickness"><div class="measure-grid-block-title"><span>板厚</span><span class="measure-status">${compactMeasureStatus(tDone,3)}</span></div><div class="compact-thickness-body"><aside class="compact-tolerance-side thickness-side">${compactToleranceFacts('thickness').html}</aside><div class="thickness-vertical"><b>位置</b><b>OS</b><b>CL</b><b>DS</b><span>丈 ${li+1}</span>${thickness.map((v,j)=>makeMeasureInput('thickness',li,j,v)).join('')}</div></div></section>`;
  h+=`<section class="measure-grid-block compact-width"><div class="measure-grid-block-title"><span>板幅</span><span class="measure-status">${compactMeasureStatus(wDone,count)}</span></div><div class="compact-width-body"><aside class="compact-tolerance-side">${compactToleranceScale('width',width,count)}</aside><div class="strip-layout compact-strip-layout">`;
  for(let col=0;col<2;col++){h+='<div class="strip-column"><div class="strip-head"><span>条</span><span>測定値・判定</span></div>';for(let row=0;row<20;row++){const j=col*20+row,active=j<count;h+=`<div class="strip-row ${active?'':'inactive'}"><label>${j+1}</label>${makeMeasureInputV29('width',li,j,active?width[j]:'',active)}</div>`}h+='</div>'}h+='</div></div></section></div>';$('#measurementGrid').innerHTML=h;
 }
 bindMeasureInputs();applyInputProtection();focusCurrent();updateMeasurementHeading();const summary=$('#toleranceSummary');if(summary)summary.hidden=type==='板厚/板幅';
};
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

/* ============================================================
   測定種別の判定公差ソース（2026-07-20 追加）
   - 板厚/板幅・母材・揃い/肉厚/長さ: 従来の判定公差ロジックを使用。
   - ラテラルボー等（板厚でも板幅でもない項目）: 「指示_<項目>」の
     単一値を判定公差として取得。該当フィールドが無い測定種
     (テレスコープ・バリ・巻ずれ 等) は公差を表示しない。
   ============================================================ */
(function(){
  if(typeof toleranceDetail!=='function'||typeof compactToleranceFacts!=='function')return;
  // 測定種 -> 参照する「指示_*」フィールド候補（半角/全角の別名を許容）
  var INSTRUCTION_FIELDS={
    'ラテラルボー':['指示_ﾗﾃﾗﾙﾎﾞｰ','指示_ラテラルボー'],
    '直角度':['指示_直角度'],
    '中歪':['指示_中歪_高さ','指示_中歪'],
    '耳歪':['指示_耳歪_高さ','指示_耳歪'],
    'そり巾':['指示_そり巾_方向高さ','指示_そり巾'],
    'そり丈':['指示_そり丈_方向高さ','指示_そり丈']
  };
  var DIMENSIONAL={'板厚/板幅':1,'母材':1,'揃い/肉厚/長さ':1};
  function norm(s){return (typeof normalizedFieldName==='function')?normalizedFieldName(s):String(s||'').normalize('NFKC').replace(/[\s　]+/g,'').toLowerCase();}
  function currentType(){return ($('#measureType')&&$('#measureType').value)||(S.measure&&S.measure.settings&&S.measure.settings.measureType)||'';}
  function instructionSingle(type){
    var cands=INSTRUCTION_FIELDS[type];
    if(!cands)return null;
    var src=(S.measure&&(S.measure.source||(S.measure.snapshot&&S.measure.snapshot.source)))||{};
    for(var i=0;i<cands.length;i++){
      var wn=norm(cands[i]);
      for(var k in src){
        if(norm(k)===wn){
          var num=Number(src[k]);
          if(Number.isFinite(num))return{value:num,key:k};
        }
      }
    }
    return null;
  }
  var baseDetail=toleranceDetail;
  toleranceDetail=function(kind,index){
    var type=currentType();
    if(DIMENSIONAL[type])return baseDetail(kind,index);
    var single=instructionSingle(type);
    if(!single)return null; // 指示公差の該当なし -> 表示しない
    return {range:[0,single.value],source:'instruction',fallback:false,plus:single.value,minus:0,plusKey:single.key,minusKey:'',base:0,single:true,instructionType:type};
  };
  var baseFacts=compactToleranceFacts;
  compactToleranceFacts=function(kind){
    var detail=toleranceDetail(kind);
    if(detail&&detail.single){
      var label=detail.instructionType||'指示';
      var v=detail.plus;
      var html='<div class="compact-tol-three-row"><div class="tol-line tol-line-base"><span class="compact-tol-source">指示公差</span><span class="tol-value-pair"><small>'+esc(label)+'</small><b>'+esc(v)+'</b></span></div><div class="tol-line tol-line-range"><small>判定範囲</small><b>0 ～ '+esc(v)+'</b></div></div>';
      return {range:detail.range,html:html};
    }
    return baseFacts(kind);
  };
})();


/* ============================================================
 Current hotfix 2026-07-20: tolerance visual, manual audit,
 length/strip lock, and safer work-list fetch diagnostics.
 ============================================================ */
(function(){
  if(typeof $!=='function')return;
  const RESTRICTED_MANUAL_KEYS={thickness:'板厚',width:'板幅',lateral:'ラテラルボー',burr:'バリ'};
  const LOCKED_MEASUREMENT_KEYS=['thickness','width','lateral','burr','telescope','offset'];
  const pad2=n=>String(n).padStart(2,'0');
  function nowText(){const d=new Date();return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate())+' '+pad2(d.getHours())+':'+pad2(d.getMinutes())+':'+pad2(d.getSeconds())}
  function ensureManualLog(){if(!S.measure)return [];S.measure.manualInputLog=Array.isArray(S.measure.manualInputLog)?S.measure.manualInputLog:[];return S.measure.manualInputLog}
  function appendManualLog(reason,detail={}){
    if(!S.measure)return;
    const entry={at:new Date().toISOString(),timeText:nowText(),reason,operator:$('#operator')?.value||'',lengthPos:$('#lengthPos')?.value||'',measureType:$('#measureType')?.value||'',inputMode:S.measure.settings?.inputMode||'',...detail};
    ensureManualLog().push(entry);
    S.measure.settings=S.measure.settings||{};
    S.measure.settings.manualInputDetected=true;
    if(typeof markDirty==='function')markDirty();
  }
  function hasDimensionData(){
    if(!S.measure?.measurements)return false;
    return LOCKED_MEASUREMENT_KEYS.some(k=>(S.measure.measurements[k]||[]).some(row=>(row||[]).some(v=>String(v??'').trim()!=='')));
  }
  function updateDimensionLocks(){
    const locked=hasDimensionData();
    ['verticalCount','horizontalCount'].forEach(id=>{const el=$('#'+id);if(!el)return;el.disabled=locked;el.classList.toggle('dimension-locked',locked);el.title=locked?'丈数・条数に関係する測定データがあるため変更できません。対象データをすべて消すと変更できます。':''});
    const openSplit=$('#openSplit');if(openSplit){openSplit.disabled=locked;openSplit.title=locked?'測定データ入力後は条割を変更できません。対象データをすべて消すと変更できます。':''}
    return locked;
  }
  function lastMeasuredValue(values,count){
    for(let i=Math.min(values.length,count)-1;i>=0;i--){const raw=String(values[i]??'').trim();const n=Number(raw);if(raw!==''&&Number.isFinite(n))return{value:n,index:i,raw};}
    return null;
  }
  function currentKindLabel(kind){return kind==='thickness'?'板厚':kind==='width'?'板幅':($('#measureType')?.value||'測定値')}
  function formatTol(kind,v){return typeof fixedToleranceValue==='function'?fixedToleranceValue(kind,v):(Number.isFinite(Number(v))?String(v):'-')}

  // 図示は「直前に測定した1点」だけを表示し、公差内ラベルを左寄せ、中央基準値も表示する。
  if(typeof compactToleranceScale==='function'){
    compactToleranceScale=function(kind,values,count){
      const facts=compactToleranceFacts(kind),range=facts.range;
      if(!range)return facts.html;
      const low=range[0],high=range[1],span=Math.max(high-low,.000001),viewLow=low-span*.3,viewHigh=high+span*.3;
      const last=lastMeasuredValue(values,count);
      const mark=last?(()=>{const pos=Math.max(3,Math.min(97,(viewHigh-last.value)/(viewHigh-viewLow)*100)),ng=last.value<low||last.value>high,label=currentKindLabel(kind)+' '+(last.index+1)+' : '+last.raw;return '<div class="compact-value-mark last '+(ng?'ng':'ok')+'" style="top:'+pos+'%" title="直前データ '+esc(label)+'"></div><div class="compact-last-value '+(ng?'ng':'ok')+'" style="top:'+pos+'%">直前 '+esc(last.raw)+'</div>'})():'';
      const center=(low+high)/2;
      return facts.html+'<div class="compact-tol-scale">'
        +'<div class="compact-scale-label upper">上限 <b>'+esc(formatTol(kind,high))+'</b></div>'
        +'<div class="compact-scale-safe compact-scale-safe-left">公差内</div>'
        +'<div class="compact-scale-center">中央 <b>'+esc(formatTol(kind,center))+'</b></div>'
        +mark
        +'<div class="compact-scale-label lower">下限 <b>'+esc(formatTol(kind,low))+'</b></div>'
        +'</div>';
    };
  }

  // 手動入力モード切替時の警告と記録。
  function bindManualModeWarning(){
    document.querySelectorAll('[data-mode]').forEach(btn=>{
      if(btn.dataset.hotfixManualBound==='1')return;
      btn.dataset.hotfixManualBound='1';
      btn.addEventListener('click',event=>{
        if(btn.dataset.mode!=='manual'||!S.measure)return;
        const msg='手動入力は例外操作です。板厚・板幅・ラテラルボー・バリは自動転送が基本のため、手動入力に切り替えた事実を記録します。';
        alert(msg);
        appendManualLog('手動入力モードへ切替',{message:msg});
      },true);
    });
  }

  // 手動入力時はセルにフォーカスを残す。自動時は従来通り受信欄へ戻す。
  const baseBindMeasureInputs=typeof bindMeasureInputs==='function'?bindMeasureInputs:null;
  if(baseBindMeasureInputs){
    bindMeasureInputs=function(){
      baseBindMeasureInputs();
      document.querySelectorAll('[data-mkey]').forEach(el=>{
        el.addEventListener('focus',()=>{if(S.measure?.settings?.inputMode==='manual')el.select?.();});
        el.addEventListener('click',event=>{
          if(S.measure?.settings?.inputMode==='manual'){
            event.stopImmediatePropagation();
            if(el.dataset.mkey==='thickness')S.measure.settings.tStep=+el.dataset.j;else S.measure.settings.wStep=+el.dataset.j;
            el.readOnly=false;el.tabIndex=0;el.focus();setTimeout(()=>el.select?.(),0);
          }
        },true);
        el.addEventListener('input',()=>{
          if(S.measure?.settings?.inputMode==='manual'&&RESTRICTED_MANUAL_KEYS[el.dataset.mkey]){
            appendManualLog('手動入力値を記録',{item:RESTRICTED_MANUAL_KEYS[el.dataset.mkey],row:Number(el.dataset.i)+1,column:Number(el.dataset.j)+1,value:el.value});
          }
          updateDimensionLocks();
        },true);
      });
      updateDimensionLocks();
      bindManualModeWarning();
    };
  }

  // 受信欄から manual として入った場合も記録する。
  if(typeof processDeviceInput==='function'){
    const baseProcessDeviceInput=processDeviceInput;
    processDeviceInput=function(raw){
      const parsed=typeof deviceParse==='function'?deviceParse(raw):null;
      const beforeKey=typeof activeMeasureKey==='function'?activeMeasureKey():'';
      if(parsed?.device==='manual'&&['thickness','width','lateral','burr'].includes(beforeKey)){
        appendManualLog('受信欄から手動数値を登録',{item:RESTRICTED_MANUAL_KEYS[beforeKey]||beforeKey,value:parsed.value});
      }
      const result=baseProcessDeviceInput(raw);
      updateDimensionLocks();
      return result;
    };
  }

  // collect/ensure に手動入力ログとロック状態を保持する。
  if(typeof collect==='function'){
    const baseCollect=collect;
    collect=function(){const m=baseCollect();m.manualInputLog=ensureManualLog();m.settings.dimensionLocked=hasDimensionData();return m;};
  }
  if(typeof ensureMeasureShape==='function'){
    const baseEnsure=ensureMeasureShape;
    ensureMeasureShape=function(m){m=baseEnsure(m);if(m){m.manualInputLog=Array.isArray(m.manualInputLog)?m.manualInputLog:[];m.settings=m.settings||{};m.settings.dimensionLocked=!!m.settings.dimensionLocked;}return m;};
  }

  // 丈位置・測定種別切替時は保存済み配列から再描画し、続きから入力する。
  ['lengthPos','measureType'].forEach(id=>{const el=$('#'+id);if(el&&el.dataset.hotfixSwitchBound!=='1'){el.dataset.hotfixSwitchBound='1';el.addEventListener('change',()=>{if(typeof renderMeasureGrid==='function')renderMeasureGrid();updateDimensionLocks();},true);}});
  ['verticalCount','horizontalCount'].forEach(id=>{const el=$('#'+id);if(el&&el.dataset.hotfixCountBound!=='1'){el.dataset.hotfixCountBound='1';el.addEventListener('mousedown',event=>{if(hasDimensionData()){event.preventDefault();showToast?.('丈数・条数は変更できません','測定データをすべて消すと再度変更できます。',4500)}},true);}});

  // fetch失敗時の原因表示は、先頭のapi関数で一元対応。

  // 画面描画後に必ず再適用。
  if(typeof renderMeasurement==='function'){
    const baseRenderMeasurement=renderMeasurement;
    renderMeasurement=function(){baseRenderMeasurement();bindManualModeWarning();updateDimensionLocks();};
  }
  if(typeof renderMeasureGrid==='function'){
    const baseRenderMeasureGrid=renderMeasureGrid;
    renderMeasureGrid=function(){baseRenderMeasureGrid();updateDimensionLocks();};
  }
  queueMicrotask(()=>{bindManualModeWarning();updateDimensionLocks();});
})();


/* ============================================================
   Hotfix 2026-07-20 D: 汎用フィルタ（コンパクト＋サジェスト＋ローディング）と公差数直線
   --------------------------------------------------------------
   設計指針（認知心理学 / 情報アーキテクチャ）:
   - 再認 > 想起 (Nielsen): 条件を打ち込むのではなく、保存済み/よく使う
     フィルタをチップとして提示し「選ぶ」操作へ置き換える。
   - チャンク化 / グルーピング (Miller, Gestalt近接): 候補を
     「保存フィルタ」「よく使う条件」「候補の値」に分節化して認知負荷を下げる。
   - 段階的開示: 主導線は1つの検索窓。詳細ビルダーは折りたたみ既定。
   - 選択過多の回避 (Hick): 各グループの提示数を制限し、頻度×新しさで並べる。
   - トークン入力: アクティブ条件と入力欄を同一面に置き、次々に追加/削除できる。
   - フィードバック: マスタ読み書きは待ちが出るためローディングを明示する。
   ============================================================ */
(function(){
  if(typeof $!=='function')return;
  const FILTER_STORE='MeasurementGenericFilterPresetsV1';
  const USAGE_STORE='MeasurementFilterCondUsageV1';
  const OPS=[
    ['contains','含む'],['not_contains','含まない'],['eq','＝ 一致'],['neq','≠ 不一致'],
    ['starts','前方一致'],['ends','後方一致'],['gt','> より大きい'],['gte','>= 以上'],['lt','< より小さい'],['lte','<= 以下'],['empty','空欄'],['not_empty','空欄以外']
  ];
  S.genericFilters=Array.isArray(S.genericFilters)?S.genericFilters:[];
  S.filterPresets=readLocalPresets();
  S.filterPresetSource='local';
  S.filterCondUsage=readUsage();

  function readLocalPresets(){try{return JSON.parse(localStorage.getItem(FILTER_STORE)||'[]')}catch(_){return []}}
  function writeLocalPresets(){try{localStorage.setItem(FILTER_STORE,JSON.stringify((S.filterPresets||[]).slice(0,120)))}catch(_){}}
  function readUsage(){try{return JSON.parse(localStorage.getItem(USAGE_STORE)||'{}')}catch(_){return {}}}
  function writeUsage(){try{localStorage.setItem(USAGE_STORE,JSON.stringify(S.filterCondUsage||{}))}catch(_){}}
  function opLabel(op){return OPS.find(x=>x[0]===op)?.[1]||op}
  function opShort(op){return (OPS.find(x=>x[0]===op)?.[1]||op).split(' ')[0]}
  function noValueOp(op){return ['empty','not_empty'].includes(op)}
  function filterKey(f){return [f.column,f.op,f.value].join('\u001f')}
  function formatTol(kind,v){return typeof fixedToleranceValue==='function'?fixedToleranceValue(kind,v):(Number.isFinite(Number(v))?String(v):'-')}
  function currentTablePresets(){return (S.filterPresets||[]).filter(p=>(!p.db||p.db===S.db)&&(!p.table||p.table===S.table))}
  function condLabel(f){return `${f.column} ${opShort(f.op)}${noValueOp(f.op)?'':' '+f.value}`}
  function bumpCondUsage(f){const k=filterKey(f);const u=S.filterCondUsage[k]||{count:0};u.count=(u.count||0)+1;u.at=Date.now();u.f={column:f.column,op:f.op,value:f.value};S.filterCondUsage[k]=u;writeUsage()}

  /* ---- ローディング表示 ---- */
  function setInlineLoading(show,text){
    const el=$('#filterInlineLoading');if(!el)return;
    const t=$('#filterInlineLoadingText');if(t&&text)t.textContent=text;
    el.hidden=!show;
  }
  function setPanelLoading(container,show,text){
    if(!container)return;let box=container.querySelector(':scope > .panel-loading');
    if(show){
      if(!box){box=document.createElement('div');box.className='panel-loading';box.innerHTML='<div class="pl-box"><span class="mini-spinner"></span><span class="pl-text"></span></div>';container.appendChild(box)}
      box.querySelector('.pl-text').textContent=text||'読み込んでいます...';box.hidden=false;
    }else if(box){box.hidden=true}
  }
  const canWait=()=>typeof showWaiting==='function'&&typeof hideSaveOverlay==='function';

  /* ---- マスタ連携（読込・保存・削除・使用回数） ---- */
  async function loadMasterPresets(opts={}){
    if(opts.inline!==false)setInlineLoading(true,'マスタからフィルタを読込中');
    try{
      const r=await api('/api/filter-presets');
      S.filterPresets=(r.items||[]).map(x=>({id:x.id,name:x.name,db:x.db,table:x.table,filters:Array.isArray(x.filters)?x.filters:[],uses:x.uses||0,lastUsed:x.last_used,updatedAt:x.updated_at,master:true}));
      S.filterPresetSource='master';writeLocalPresets();return true;
    }catch(e){
      S.filterPresets=readLocalPresets();S.filterPresetSource='local';console.warn('フィルタマスタ読込失敗、ローカルを使用',e);return false;
    }finally{setInlineLoading(false)}
  }
  async function saveCurrentFiltersToMaster(){
    if(!S.genericFilters.length){showToast?.('保存する条件がありません','条件を追加してから保存してください。',3800);return}
    const suggested=S.genericFilters.map(condLabel).join(' / ').slice(0,60);
    const name=prompt('フィルタ名を入力してください（マスタへ登録します）。',suggested);
    if(!name)return;
    const payload={name:name.trim(),db:S.db,table:S.table,filters:structuredClone(S.genericFilters)};
    if(canWait())showWaiting('フィルタをマスタへ保存しています','マスタ.accdb のフィルタプリセットマスタへ書き込み中','1/2 サーバーへ条件を送信しています');
    try{
      const r=await api('/api/filter-presets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(withUserId(payload))});
      if(canWait())updateWaiting('登録内容を取得しています','2/2 最新のフィルタ一覧を読み込んでいます');
      await loadMasterPresets({inline:false});
      showToast?.('フィルタマスタへ保存しました',r.message||name,3800);
    }catch(e){
      const preset={id:crypto.randomUUID(),name:name.trim(),db:S.db,table:S.table,filters:structuredClone(S.genericFilters),updatedAt:new Date().toISOString(),master:false};
      S.filterPresets=[preset,...(S.filterPresets||[]).filter(x=>!(x.name===preset.name&&x.db===preset.db&&x.table===preset.table))].slice(0,120);
      writeLocalPresets();S.filterPresetSource='local';
      showToast?.('マスタへ保存できませんでした','この端末内にのみ保存しました。詳細: '+e.message,6500);
    }finally{if(canWait())hideSaveOverlay()}
    renderGenericFilterBar();renderFilterPresetList();
  }
  async function deletePreset(preset){
    if(!confirm(`登録フィルタ「${preset.name}」を削除しますか？`))return;
    const listEl=$('#filterPresetList');
    if(preset.master&&preset.id!=null){
      setPanelLoading(listEl,true,'マスタから削除しています...');
      try{await api('/api/filter-presets/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(withUserId({id:preset.id}))});await loadMasterPresets({inline:false})}
      catch(e){showToast?.('マスタから削除できませんでした',e.message,6500)}
      finally{setPanelLoading(listEl,false)}
    }else{
      S.filterPresets=(S.filterPresets||[]).filter(x=>x!==preset);writeLocalPresets();
    }
    renderGenericFilterBar();renderFilterPresetList();
  }
  function markPresetUsed(preset){
    if(!preset)return;preset.uses=(preset.uses||0)+1;
    if(preset.master&&preset.id!=null){
      // 使用回数はサジェスト順位の材料。ブロックせず裏で加算する。
      api('/api/filter-presets/use',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:preset.id,user_id:currentUserId()})}).catch(()=>{});
    }
  }

  /* 保存フィルタの適用（置換）と、サジェストからの追加（マージ） */
  function applyPreset(preset,{merge=false}={}){
    markPresetUsed(preset);
    const incoming=structuredClone(preset.filters||[]);
    if(merge){const seen=new Set(S.genericFilters.map(filterKey));incoming.forEach(f=>{if(!seen.has(filterKey(f)))S.genericFilters.push(f)})}
    else{S.genericFilters=incoming}
    S.genericFilters.forEach(bumpCondUsage);
    S.page=1;renderGenericFilterBar();load();
  }

  /* ---- 汎用フィルタ バー本体 ---- */
  function ensureGenericFilterBar(){
    let bar=$('#genericFilterBar');if(bar)return bar;
    bar=document.createElement('section');bar.id='genericFilterBar';bar.className='generic-filter-bar';
    const grid=$('#grid');grid?.parentNode?.insertBefore(bar,grid);
    bar.innerHTML=`
      <div class="filter-search-row">
        <b>フィルタ</b>
        <span class="filter-count" id="filterCount">0件</span>
        <div class="filter-token-input" id="filterTokenInput">
          <input class="filter-token-search" id="filterTokenSearch" autocomplete="off" placeholder="検索して条件を追加（列名・値・保存フィルタ）">
        </div>
        <div class="filter-suggest" id="filterSuggest" hidden></div>
        <span class="filter-inline-loading" id="filterInlineLoading" hidden><span class="mini-spinner"></span><span id="filterInlineLoadingText">読込中</span></span>
        <div class="filter-search-row-actions">
          <button id="filterToggle" type="button">詳細</button>
          <button id="saveFilterPreset" type="button">マスタへ保存</button>
          <button id="openFilterPresets" type="button">登録一覧</button>
          <button id="clearGenericFilters" type="button">全解除</button>
        </div>
      </div>
      <div class="filter-body" id="filterBody" hidden>
        <div class="filter-builder">
          <label>カラム<select id="filterColumn"></select></label>
          <label>比較<select id="filterOp"></select></label>
          <label>検査値<input id="filterValue" list="filterSuggestList" placeholder="値を入力/候補から選択"><datalist id="filterSuggestList"></datalist></label>
          <button id="addGenericFilter" type="button">追加</button>
        </div>
      </div>`;
    // 詳細ビルダー（段階的開示）
    $('#filterToggle').onclick=()=>{const body=$('#filterBody');body.hidden=!body.hidden;$('#filterToggle').textContent=body.hidden?'詳細':'閉じる'};
    $('#filterOp').innerHTML=OPS.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
    $('#filterColumn').onchange=updateFilterSuggestions;
    $('#filterOp').onchange=()=>{$('#filterValue').disabled=noValueOp($('#filterOp').value)};
    $('#addGenericFilter').onclick=()=>{const f={column:$('#filterColumn').value,op:$('#filterOp').value,value:$('#filterValue').value.trim()};if(!f.column)return;if(!noValueOp(f.op)&&!f.value){$('#filterValue').focus();return}addGenericFilter(f);$('#filterValue').value=''};
    $('#saveFilterPreset').onclick=saveCurrentFiltersToMaster;
    $('#openFilterPresets').onclick=openFilterPresetModal;
    $('#clearGenericFilters').onclick=()=>{S.genericFilters=[];S.page=1;renderGenericFilterBar();load()};
    bindTokenSearch();
    return bar;
  }
  function updateFilterColumns(){
    ensureGenericFilterBar();const select=$('#filterColumn');if(!select)return;const current=select.value;
    select.innerHTML=(S.columns||[]).map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if((S.columns||[]).includes(current))select.value=current;
    updateFilterSuggestions();
  }
  function updateFilterSuggestions(){
    const col=$('#filterColumn')?.value,list=$('#filterSuggestList');if(!col||!list)return;
    const vals=[...new Set((S.rows||[]).map(r=>String(r[col]??'').trim()).filter(Boolean))].slice(0,80);
    list.innerHTML=vals.map(v=>`<option value="${esc(v)}"></option>`).join('');
  }
  function addGenericFilter(f){
    const key=filterKey(f);if(!S.genericFilters.some(x=>filterKey(x)===key))S.genericFilters.push(f);
    bumpCondUsage(f);S.page=1;renderGenericFilterBar();load();
  }

  /* アクティブ条件トークンを検索窓の中に描画（近接・同一面） */
  function renderActiveTokens(){
    const box=$('#filterTokenInput');if(!box)return;const input=$('#filterTokenSearch');
    box.querySelectorAll('.filter-tag').forEach(x=>x.remove());
    S.genericFilters.forEach((f,i)=>{
      const tag=document.createElement('span');tag.className='filter-tag';tag.title=`${f.column} ${opLabel(f.op)}${noValueOp(f.op)?'':' '+f.value}`;
      tag.innerHTML=`<span>${esc(f.column)}</span><b>${esc(opShort(f.op))}</b>${noValueOp(f.op)?'':`<em>${esc(f.value)}</em>`}<i data-filter-index="${i}" title="解除">×</i>`;
      tag.querySelector('i').onclick=e=>{e.stopPropagation();S.genericFilters.splice(i,1);S.page=1;renderGenericFilterBar();load()};
      box.insertBefore(tag,input);
    });
    const count=$('#filterCount');if(count)count.textContent=`${S.genericFilters.length}件`;
  }
  function renderGenericFilterBar(){
    ensureGenericFilterBar();updateFilterColumns();renderActiveTokens();
  }

  /* ---- サジェスト（再認・チャンク化・頻度順） ---- */
  function frequentConditions(){
    // 保存フィルタの条件＋利用履歴を統合し、頻度×新しさで並べる。
    const map=new Map();
    currentTablePresets().forEach(p=>(p.filters||[]).forEach(f=>{const k=filterKey(f);const e=map.get(k)||{f,count:0,at:0};e.count+=Math.max(1,p.uses||1);map.set(k,e)}));
    Object.values(S.filterCondUsage||{}).forEach(u=>{if(!u.f)return;const k=filterKey(u.f);const e=map.get(k)||{f:u.f,count:0,at:0};e.count+=(u.count||0)*2;e.at=Math.max(e.at,u.at||0);map.set(k,e)});
    const active=new Set(S.genericFilters.map(filterKey));
    return [...map.values()].filter(e=>!active.has(filterKey(e.f))).sort((a,b)=>b.count-a.count||b.at-a.at).map(e=>e.f);
  }
  function valueSuggestions(q){
    // 入力語に一致するカラム/値を、現在の一覧データから提案（列 含む 語 / 列 = 値）。
    if(!q)return [];const nq=q.normalize('NFKC').toLowerCase();const out=[];const seen=new Set();
    (S.columns||[]).forEach(col=>{
      // 列名が一致 → 「列 含む 語」を提案（値は空でも空欄以外の意図に近い）
      if(String(col).normalize('NFKC').toLowerCase().includes(nq)){const f={column:col,op:'contains',value:q};const k=filterKey(f);if(!seen.has(k)){seen.add(k);out.push({f,tag:'列名一致'})}}
    });
    (S.columns||[]).forEach(col=>{
      const vals=[...new Set((S.rows||[]).map(r=>String(r[col]??'').trim()).filter(Boolean))];
      const hit=vals.find(v=>v.normalize('NFKC').toLowerCase().includes(nq));
      if(hit){const f={column:col,op:'eq',value:hit};const k=filterKey(f);if(!seen.has(k)){seen.add(k);out.push({f,tag:'値一致'})}}
    });
    return out.slice(0,8);
  }
  let suggestFlat=[],suggestIndex=-1;
  function renderSuggest(){
    const box=$('#filterSuggest'),input=$('#filterTokenSearch');if(!box||!input)return;
    const q=input.value.trim(),nq=q.normalize('NFKC').toLowerCase();suggestFlat=[];suggestIndex=-1;
    const groups=[];
    // 1) 保存フィルタ（マスタ）— 再認しやすい単位。適用でまとめて追加。
    let presets=currentTablePresets();
    if(nq)presets=presets.filter(p=>p.name.normalize('NFKC').toLowerCase().includes(nq)||(p.filters||[]).some(f=>condLabel(f).normalize('NFKC').toLowerCase().includes(nq)));
    presets=[...presets].sort((a,b)=>(b.uses||0)-(a.uses||0)||String(b.lastUsed||b.updatedAt||'').localeCompare(String(a.lastUsed||a.updatedAt||''))).slice(0,8);
    if(presets.length){
      groups.push({icon:'★',title:`よく使うフィルタ（マスタ）${S.filterPresetSource==='master'?'':'※端末保存'}`,chips:presets.map(p=>({cls:'preset',main:p.name,sub:`${(p.filters||[]).length}条件${p.uses?' · '+p.uses+'回':''}`,onpick:()=>{applyPreset(p,{merge:true});afterPick()}}))});
    }
    // 2) よく使う条件 — 単一条件を追加。
    let conds=frequentConditions();
    if(nq)conds=conds.filter(f=>condLabel(f).normalize('NFKC').toLowerCase().includes(nq));
    conds=conds.slice(0,8);
    if(conds.length){
      groups.push({icon:'⟳',title:'よく使う条件',chips:conds.map(f=>({cls:'',col:f.column,op:opShort(f.op),val:noValueOp(f.op)?'':f.value,onpick:()=>{addGenericFilter(f);afterPick()}}))});
    }
    // 3) 候補の値 — 入力語からデータに基づく候補を生成。
    const vsug=valueSuggestions(q);
    if(vsug.length){
      groups.push({icon:'🔎',title:'候補の値（この一覧のデータから）',chips:vsug.map(v=>({cls:'op-select',col:v.f.column,op:opShort(v.f.op),val:noValueOp(v.f.op)?'':v.f.value,sub:v.tag,onpick:()=>{addGenericFilter(v.f);afterPick()}}))});
    }
    if(!groups.length){box.innerHTML=`<div class="filter-suggest-empty">${q?`「${esc(q)}」に一致する候補はありません。詳細から条件を作成できます。`:'保存フィルタや利用履歴がここに提案されます。'}</div>`;box.hidden=false;return}
    box.innerHTML=groups.map(g=>`
      <div class="filter-suggest-group">
        <div class="filter-suggest-head"><span class="fs-icon">${g.icon}</span>${esc(g.title)}</div>
        <div class="filter-suggest-items"></div>
      </div>`).join('');
    const groupEls=box.querySelectorAll('.filter-suggest-group');
    groups.forEach((g,gi)=>{
      const wrap=groupEls[gi].querySelector('.filter-suggest-items');
      g.chips.forEach(c=>{
        const chip=document.createElement('button');chip.type='button';chip.className='suggest-chip '+(c.cls||'');
        chip.innerHTML=c.main?`<span>${esc(c.main)}</span>${c.sub?`<small>${esc(c.sub)}</small>`:''}`:`<span>${esc(c.col)}</span><b>${esc(c.op)}</b>${c.val?`<em>${esc(c.val)}</em>`:''}${c.sub?`<small>${esc(c.sub)}</small>`:''}`;
        chip.onclick=c.onpick;wrap.appendChild(chip);suggestFlat.push(chip);
      });
    });
    box.hidden=false;
  }
  function afterPick(){const input=$('#filterTokenSearch');if(input){input.value='';input.focus()}renderSuggest()}
  function moveSuggest(dir){
    if(!suggestFlat.length)return;suggestIndex=(suggestIndex+dir+suggestFlat.length)%suggestFlat.length;
    suggestFlat.forEach((c,i)=>c.classList.toggle('active',i===suggestIndex));
    suggestFlat[suggestIndex]?.scrollIntoView({block:'nearest'});
  }
  function bindTokenSearch(){
    const input=$('#filterTokenSearch'),box=$('#filterTokenInput'),suggest=$('#filterSuggest');if(!input)return;
    input.addEventListener('focus',()=>{box.classList.add('focus-within');renderSuggest()});
    input.addEventListener('input',()=>renderSuggest());
    input.addEventListener('keydown',e=>{
      if(e.key==='ArrowDown'){e.preventDefault();moveSuggest(1)}
      else if(e.key==='ArrowUp'){e.preventDefault();moveSuggest(-1)}
      else if(e.key==='Enter'){e.preventDefault();(suggestFlat[suggestIndex]||suggestFlat[0])?.click()}
      else if(e.key==='Escape'){suggest.hidden=true}
      else if(e.key==='Backspace'&&!input.value&&S.genericFilters.length){S.genericFilters.pop();S.page=1;renderGenericFilterBar();load()}
    });
    const row=input.closest('.filter-search-row')||box;document.addEventListener('click',e=>{if(!row.contains(e.target)){box.classList.remove('focus-within');if(suggest)suggest.hidden=true}});
  }

  /* ---- 登録フィルタ一覧モーダル ---- */
  function ensureFilterPresetModal(){
    let modal=$('#filterPresetModal');if(modal)return modal;
    modal=document.createElement('div');modal.className='record-modal';modal.id='filterPresetModal';modal.hidden=true;
    modal.innerHTML=`
      <div class="filter-preset-dialog">
        <header><div><small>SAVED FILTERS (MASTER)</small><h2>登録フィルタ一覧</h2></div><button id="closeFilterPresets" type="button">×</button></header>
        <div class="filter-preset-body">
          <div class="filter-preset-toolbar"><span id="filterPresetSummary"></span><button id="reloadFilterPresets" type="button">再読込</button></div>
          <div class="filter-preset-list" id="filterPresetList"></div>
        </div>
      </div>`;
    document.body.append(modal);
    $('#closeFilterPresets').onclick=()=>{modal.hidden=true};
    $('#reloadFilterPresets').onclick=async()=>{const list=$('#filterPresetList');setPanelLoading(list,true,'マスタから再読込しています...');await loadMasterPresets({inline:false});setPanelLoading(list,false);renderFilterPresetList();renderGenericFilterBar()};
    modal.addEventListener('click',e=>{if(e.target===modal)modal.hidden=true});
    return modal;
  }
  async function openFilterPresetModal(){
    ensureFilterPresetModal();$('#filterPresetModal').hidden=false;
    const list=$('#filterPresetList');list.innerHTML='';setPanelLoading(list,true,'登録フィルタを読み込んでいます...');
    await loadMasterPresets({inline:false});setPanelLoading(list,false);renderFilterPresetList();renderGenericFilterBar();
  }
  function renderFilterPresetList(){
    const list=$('#filterPresetList');if(!list)return;
    const all=S.filterPresets||[],forThis=currentTablePresets();
    const summary=$('#filterPresetSummary');
    if(summary)summary.textContent=`保存先: ${S.filterPresetSource==='master'?'マスタ.accdb':'この端末（マスタ未接続）'}　全 ${all.length}件（現在の一覧向け ${forThis.length}件）`;
    const ordered=[...forThis,...all.filter(p=>!forThis.includes(p))];
    const loading=list.querySelector(':scope > .panel-loading');
    list.querySelectorAll(':scope > .filter-preset-item, :scope > .record-empty').forEach(x=>x.remove());
    if(!ordered.length){const e=document.createElement('div');e.className='record-empty';e.textContent='登録済みフィルタはありません。「マスタへ保存」で登録できます。';list.appendChild(e);return}
    ordered.forEach(p=>{
      const item=document.createElement('div');item.className='filter-preset-item';
      const conds=(p.filters||[]).map(f=>`<span class="fp-cond">${esc(f.column)} <b>${esc(opShort(f.op))}</b>${noValueOp(f.op)?'':' '+esc(f.value)}</span>`).join('');
      item.innerHTML=`<div class="fp-name" title="${esc(p.name)}">${esc(p.name)}${p.uses?`<small>使用 ${p.uses}回</small>`:''}</div><div class="fp-target">${esc((p.db||'全DB')+' / '+(p.table||'全テーブル'))}</div><div class="fp-conds">${conds||'<span class="fp-cond">条件なし</span>'}</div><div class="fp-actions"><button class="apply" type="button">適用</button><button class="danger" type="button">削除</button></div>`;
      item.querySelector('.apply').onclick=()=>{applyPreset(p);$('#filterPresetModal').hidden=true};
      item.querySelector('.danger').onclick=()=>deletePreset(p);
      if(loading)list.insertBefore(item,loading);else list.appendChild(item);
    });
  }

  // /api/table へフィルタ条件を送信する。
  if(typeof load==='function'){
    load=async function(){
      const q=new URLSearchParams({db:S.db,table:S.table,page:S.page,page_size:$('#pageSize').value,search:$('#search').value});
      if(S.genericFilters?.length)q.set('filters',JSON.stringify(S.genericFilters));
      const d=await api('/api/table?'+q);Object.assign(S,{columns:d.columns,rows:d.rows,count:d.count});
      const info=S.catalog.find(x=>x.key===S.db)||{};$('#fileName').textContent=info.file_name||'';$('#tableName').textContent=S.table;renderGrid();renderGenericFilterBar();
    };
  }
  if(typeof renderTabs==='function'){
    const baseRenderTabs=renderTabs;renderTabs=function(){baseRenderTabs();ensureGenericFilterBar();renderGenericFilterBar();};
  }
  const baseRenderGrid=typeof renderGrid==='function'?renderGrid:null;
  if(baseRenderGrid){renderGrid=function(){baseRenderGrid();renderGenericFilterBar();updateFilterSuggestions();};}

  /* ---- 公差数直線: 縦軸を左へ寄せ、測定値はドット＋条番号/数値 ---- */
  if(typeof compactToleranceScale==='function'){
    compactToleranceScale=function(kind,values,count){
      const facts=compactToleranceFacts(kind),range=facts.range;if(!range)return facts.html;
      const low=Number(range[0]),high=Number(range[1]),span=Math.max(high-low,.000001);
      const viewLow=low-span*.25,viewHigh=high+span*.25;
      const pct=v=>Math.max(0,Math.min(100,(viewHigh-v)/(viewHigh-viewLow)*100));
      const upper=pct(high),lower=pct(low),center=pct((low+high)/2);
      const last=(function(){for(let i=Math.min(values.length,count)-1;i>=0;i--){const raw=String(values[i]??'').trim(),n=Number(raw);if(raw!==''&&Number.isFinite(n))return{raw,n,index:i}}return null})();
      const mark=last?(()=>{const p=Math.max(5,Math.min(95,pct(last.n))),ng=last.n<low||last.n>high;return `<div class="numberline-measure ${ng?'ng':'ok'}" style="top:${p}%"><span class="nl-dot"></span><b><span>条${last.index+1}</span>${esc(last.raw)}</b></div>`})():'';
      return facts.html+`<div class="accurate-numberline" style="--upper:${upper}%;--lower:${lower}%;--center:${center}%">
        <div class="numberline-band high"></div><div class="numberline-band ok"></div><div class="numberline-band low"></div>
        <div class="numberline-track"></div>
        <div class="numberline-tick upper"><b><span>上限</span>${esc(formatTol(kind,high))}</b></div>
        <div class="numberline-tick center"><b><span>中央</span>${esc(formatTol(kind,(low+high)/2))}</b></div>
        <div class="numberline-tick lower"><b><span>下限</span>${esc(formatTol(kind,low))}</b></div>
        ${mark}
      </div>`;
    };
  }

  // 起動時: バー生成 → マスタからサジェスト材料を先読み（ローディング表示つき）。
  queueMicrotask(async()=>{ensureGenericFilterBar();renderGenericFilterBar();try{await loadMasterPresets();renderGenericFilterBar()}catch(_){}});
})();


/* ============================================================
   Hotfix 2026-07-21: ラテラルボー等の「指示値」表示（②）
   --------------------------------------------------------------
   - 指示_ﾗﾃﾗﾙﾎﾞｰ 等は "2.0/2M" のような文字列で格納される。
     数値部(2.0)と評価単位部(2M / 1M)を分離して表示する。
   - 板厚・板幅以外（ラテラルボー等）の測定種では、数値上下限用の
     公差カード（上部カード）は内容がふさわしくないため表示しない。
     代わりに測定データ側へ「指示値 ＋ 評価単位」カードを表示する。
   - #toleranceSummary（上部の要約）も指示型では抑止する。
   ============================================================ */
(function(){
  if(typeof $!=='function')return;
  // 測定種 -> 参照する「指示_*」フィールド候補（半角/全角の別名を許容）
  var INSTRUCTION_FIELDS={
    'ラテラルボー':['指示_ﾗﾃﾗﾙﾎﾞｰ','指示_ラテラルボー'],
    '直角度':['指示_直角度'],
    '中歪':['指示_中歪_高さ','指示_中歪'],
    '耳歪':['指示_耳歪_高さ','指示_耳歪'],
    'そり巾':['指示_そり巾_方向高さ','指示_そり巾'],
    'そり丈':['指示_そり丈_方向高さ','指示_そり丈']
  };
  function norm(s){return (typeof normalizedFieldName==='function')?normalizedFieldName(s):String(s||'').normalize('NFKC').replace(/[\s\u3000]+/g,'').toLowerCase();}
  function currentType(){return ($('#measureType')&&$('#measureType').value)||(S.measure&&S.measure.settings&&S.measure.settings.measureType)||'';}
  function isInstructionType(type){return !!INSTRUCTION_FIELDS[type];}
  // 仕掛データから指示値の生文字列を取得
  function rawInstruction(type){
    var cands=INSTRUCTION_FIELDS[type];if(!cands)return null;
    var src=(S.measure&&(S.measure.source||(S.measure.snapshot&&S.measure.snapshot.source)))||{};
    for(var i=0;i<cands.length;i++){var wn=norm(cands[i]);for(var k in src){if(norm(k)===wn){var raw=String(src[k]==null?'':src[k]).trim();if(raw!=='')return{raw:raw,key:k};}}}
    return null;
  }
  // "2.0/2M" -> {value:2.0, unit:'2M', raw:'2.0/2M'}
  function parseInstruction(raw){
    if(raw==null)return null;var s=String(raw).normalize('NFKC').trim();if(s==='')return null;
    var value=NaN,unit='';var parts=s.split('/');
    var nm=String(parts[0]).match(/-?\d+(?:\.\d+)?/);if(nm)value=Number(nm[0]);
    if(parts.length>1){var u=String(parts[1]).trim();var um=u.match(/(\d+)\s*[mMｍＭ]/);unit=um?um[1]+'M':u;}
    return{value:value,unit:unit,raw:s};
  }
  function instructionInfo(){
    var type=currentType();var got=rawInstruction(type);if(!got)return null;
    var parsed=parseInstruction(got.raw);if(!parsed)return null;parsed.key=got.key;parsed.type=type;return parsed;
  }
  // 指示値カード（測定データ側に表示）
  function instructionCardHtml(){
    var info=instructionInfo();
    if(!info)return '<div class="instruction-tol-card no-data"><span>指示値なし</span></div>';
    var valText=Number.isFinite(info.value)?String(info.value):esc(info.raw);
    var unitText=info.unit?info.unit+'単位':'単位指定なし';
    return '<div class="instruction-tol-card">'
      +'<div class="instruction-tol-head"><span class="compact-tol-source">指示公差</span><span class="instruction-tol-type">'+esc(info.type)+'</span></div>'
      +'<div class="instruction-tol-main"><span class="instruction-tol-value">'+esc(valText)+'</span><span class="instruction-tol-unit">'+esc(unitText)+'</span></div>'
      +'<div class="instruction-tol-raw">指示値: '+esc(info.raw)+'</div>'
      +'</div>';
  }

  // toleranceDetail: 指示型は文字列の数値部を判定範囲[0,value]として返す（判定・図示に利用）。
  if(typeof toleranceDetail==='function'){
    var baseDetail=toleranceDetail;
    toleranceDetail=function(kind,index){
      var type=currentType();
      if(isInstructionType(type)){
        var info=instructionInfo();
        if(!info||!Number.isFinite(info.value))return null;
        return {range:[0,info.value],source:'instruction',fallback:false,plus:info.value,minus:0,plusKey:info.key,minusKey:'',base:0,single:true,instructionType:type,unit:info.unit,raw:info.raw};
      }
      return baseDetail(kind,index);
    };
  }

  // 公差カード/スケールは指示型では専用カードへ置換（数値上下限バー・数直線は出さない）。
  if(typeof compactToleranceFacts==='function'){
    var baseFacts=compactToleranceFacts;
    compactToleranceFacts=function(kind){
      var type=currentType();
      if(isInstructionType(type)){var info=instructionInfo();return {range:(info&&Number.isFinite(info.value))?[0,info.value]:null,html:instructionCardHtml()};}
      return baseFacts(kind);
    };
  }
  if(typeof compactToleranceScale==='function'){
    var baseScale=compactToleranceScale;
    compactToleranceScale=function(kind,values,count){
      var type=currentType();
      if(isInstructionType(type))return instructionCardHtml();
      return baseScale(kind,values,count);
    };
  }

  // 上部の要約(#toleranceSummary)は指示型では抑止（内容がふさわしくないため）。
  function suppressSummaryForInstruction(){var type=currentType();if(isInstructionType(type)){var s=$('#toleranceSummary');if(s)s.hidden=true;}}
  if(typeof renderMeasureGridVertical==='function'){
    var baseRMGV=renderMeasureGridVertical;
    renderMeasureGridVertical=function(){baseRMGV();suppressSummaryForInstruction();};
  }
  if(typeof updateMeasurementHeading==='function'){
    var baseUMH=updateMeasurementHeading;
    updateMeasurementHeading=function(){baseUMH();suppressSummaryForInstruction();};
  }
})();

/* ============================================================
 2026-07-21: 作業時間の再編集UI / マスタ管理モーダル（最終版）
 ============================================================ */
(function(){
 if(typeof $!=='function')return;
 /* ---------- 作業時間: 直接編集・再調整対応 ---------- */
 const pad2=n=>String(n).padStart(2,'0');
 function isoToLocalInput(iso){if(!iso)return '';const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`}
 function localInputToIso(v){if(!v)return '';const d=new Date(v);if(Number.isNaN(d.getTime()))return '';return d.toISOString()}
 function wt(){S.measure.workTime=S.measure.workTime||{startAt:'',endAt:''};return S.measure.workTime}
 function syncField(id){const el=$('#'+id);if(!el||!S.measure)return;const w=wt();const iso=id==='workStartAt'?w.startAt:w.endAt;el.dataset.iso=iso||'';el.value=isoToLocalInput(iso)}
 function orderInvalid(){const w=wt();return !!(w.startAt&&w.endAt&&(new Date(w.endAt)-new Date(w.startAt)<0))}
 function refreshWorkTime(){
  if(!S.measure)return;const w=wt();
  const hasStart=!!w.startAt,hasEnd=!!w.endAt,invalid=orderInvalid();
  const startCard=$('#workStartCard'),endCard=$('#workEndCard'),endInput=$('#workEndAt');
  if(startCard){startCard.classList.toggle('validation-valid',hasStart);startCard.classList.toggle('validation-required',!hasStart)}
  if(endCard){endCard.classList.toggle('validation-ng',invalid);endCard.classList.toggle('validation-valid',hasEnd&&!invalid);endCard.classList.toggle('validation-required',!hasEnd)}
  if(endInput)endInput.classList.toggle('ng',invalid);
  const dur=$('#workDuration'),hint=$('#workTimeHint');
  if(dur){
   if(invalid)dur.textContent='終了が開始より前です';
   else if(hasStart&&hasEnd)dur.textContent=`実作業時間 ${formatDuration(durationMs(S.measure))}`;
   else if(hasStart)dur.textContent='作業中';
   else dur.textContent='未計測';
  }
  if(hint)hint.textContent=invalid?'終了時刻は開始時刻より後にしてください。時刻は直接編集・再調整できます。':'開始・終了の両方を設定すると完了登録できます。時刻は直接編集・再調整できます。';
 }
 function afterWorkChange(){refreshWorkTime();markDirty();if(typeof updateValidationVisuals==='function')updateValidationVisuals()}
 function commitField(id){const el=$('#'+id);if(!el||!S.measure)return;const iso=localInputToIso(el.value);el.dataset.iso=iso;const w=wt();if(id==='workStartAt')w.startAt=iso;else w.endAt=iso;afterWorkChange()}
 function stampNow(id){if(!S.measure)return;const w=wt(),iso=new Date().toISOString();if(id==='workStartAt')w.startAt=iso;else w.endAt=iso;syncField(id);afterWorkChange();showToast&&showToast(id==='workStartAt'?'開始時刻を記録しました':'終了時刻を記録しました',formatWorkTime(iso))}
 function clearField(id){if(!S.measure)return;const w=wt();if(id==='workStartAt')w.startAt='';else w.endAt='';syncField(id);afterWorkChange()}
 function bindWorkTime(){
  const s=$('#workStartAt'),e=$('#workEndAt');
  if(s){s.readOnly=false;s.disabled=false;s.onchange=()=>commitField('workStartAt');s.oninput=()=>commitField('workStartAt')}
  if(e){e.readOnly=false;e.disabled=false;e.onchange=()=>commitField('workEndAt');e.oninput=()=>commitField('workEndAt')}
  const sb=$('#stampWorkStart'),eb=$('#stampWorkEnd'),sc=$('#clearWorkStart'),ec=$('#clearWorkEnd');
  if(sb){sb.disabled=false;sb.onclick=()=>stampNow('workStartAt')}
  if(eb){eb.disabled=false;eb.onclick=()=>stampNow('workEndAt')}
  if(sc)sc.onclick=()=>clearField('workStartAt');
  if(ec)ec.onclick=()=>clearField('workEndAt');
 }
 updateWorkTimePanel=function(){if(!S.measure)return;syncField('workStartAt');syncField('workEndAt');bindWorkTime();refreshWorkTime()};

 /* ---------- マスタ管理モーダル（刷新版: 大画面・高密度・検索・IDリネーム更新） ---------- */
 const MASTER_DEFS=[
  {key:'operator',label:'オペレータ',icon:'人',endpoint:'/api/operator-master',hasDelete:true,
   fields:[{k:'name',label:'氏名',required:true,key:true},{k:'yomi',label:'ヨミガナ'}],
   cols:[{k:'name',label:'氏名',grow:2},{k:'yomi',label:'ヨミガナ',grow:2}]},
  {key:'device',label:'機器',icon:'器',endpoint:'/api/device-master',hasDelete:true,
   fields:[{k:'kind',label:'測定区分',type:'select',options:['板厚','板幅','その他',''],key:true},{k:'name',label:'機器名',required:true,key:true},{k:'note',label:'備考'}],
   cols:[{k:'kind',label:'測定区分',grow:1},{k:'name',label:'機器名',grow:2},{k:'note',label:'備考',grow:3}]},
  {key:'spool',label:'スプール種別',icon:'巻',endpoint:'/api/spool-master',hasDelete:true,
   fields:[{k:'name',label:'種別名',required:true,key:true},{k:'note',label:'備考'}],
   cols:[{k:'name',label:'種別名',grow:2},{k:'note',label:'備考',grow:3}]},
  {key:'inner',label:'内径種別',icon:'径',endpoint:'/api/inner-master',hasDelete:true,
   fields:[{k:'name',label:'内径種別',required:true,key:true},{k:'note',label:'備考'}],
   cols:[{k:'name',label:'内径種別',grow:2},{k:'note',label:'備考',grow:3}]},
  {key:'equipment',label:'設備',icon:'設',endpoint:'/api/equipment-master',hasDelete:false,
   fields:[{k:'name',label:'設備名',required:true,key:true}],
   cols:[{k:'name',label:'設備名',grow:2}]},
 ];
 let maintState={defKey:'operator',items:[],editing:null,query:''};
 function currentDef(){return MASTER_DEFS.find(d=>d.key===maintState.defKey)||MASTER_DEFS[0]}

 function ensureMaintModal(){
  let modal=$('#masterMaintModal');if(modal)return modal;
  modal=document.createElement('div');modal.className='record-modal mm-modal';modal.id='masterMaintModal';modal.hidden=true;
  modal.innerHTML=`<div class="mm-dialog">
   <header class="mm-head">
    <div class="mm-head-title"><h2>マスタ管理</h2><span class="mm-sub">登録内容の追加・編集・無効化。更新はすべて更新者IDとともに記録されます。</span></div>
    <label class="mm-head-user">更新者ID<input id="masterUserId" type="text" autocomplete="off" placeholder="社員番号など"></label>
    <button id="closeMasterMaint" class="mm-close" type="button" aria-label="閉じる">×</button>
   </header>
   <div class="mm-body">
    <nav class="mm-nav" id="masterMaintNav" aria-label="マスタ種別"></nav>
    <section class="mm-main">
     <div class="mm-toolbar">
      <div class="mm-toolbar-left"><b id="masterMaintTitle">オペレータ</b><span class="mm-count" id="masterMaintCount"></span></div>
      <div class="mm-toolbar-right">
       <div class="mm-search"><span class="mm-search-icon" aria-hidden="true">🔍</span><input id="masterMaintSearch" type="search" placeholder="一覧を絞り込み（名称・更新者など）" autocomplete="off"></div>
       <button id="reloadMasterMaint" type="button" class="mm-btn-ghost">再読込</button>
      </div>
     </div>
     <form class="mm-form" id="masterMaintForm"></form>
     <div class="mm-list-wrap"><div class="mm-list" id="masterMaintList"></div></div>
    </section>
   </div>
  </div>`;
  document.body.append(modal);
  $('#closeMasterMaint').onclick=()=>{modal.hidden=true};
  modal.addEventListener('click',ev=>{if(ev.target===modal)modal.hidden=true});
  const uid=$('#masterUserId');if(uid){uid.value=currentUserId();uid.onchange=()=>setUserId(uid.value)}
  $('#reloadMasterMaint').onclick=()=>loadMaint(true);
  const search=$('#masterMaintSearch');if(search){search.oninput=()=>{maintState.query=search.value;renderMaintList()}}
  const nav=$('#masterMaintNav');
  nav.innerHTML=MASTER_DEFS.map(d=>`<button type="button" data-master="${d.key}"><span class="mm-nav-ico" aria-hidden="true">${esc(d.icon)}</span><span class="mm-nav-label">${esc(d.label)}</span></button>`).join('');
  nav.querySelectorAll('[data-master]').forEach(b=>b.onclick=()=>{maintState.defKey=b.dataset.master;maintState.editing=null;maintState.query='';const se=$('#masterMaintSearch');if(se)se.value='';syncNav();loadMaint(true)});
  return modal;
 }
 function syncNav(){document.querySelectorAll('#masterMaintNav [data-master]').forEach(b=>b.classList.toggle('active',b.dataset.master===maintState.defKey))}
 function requireMaintUser(){const el=$('#masterUserId');const id=String(el?el.value:'').trim();if(!id){showToast('更新者IDを入力してください','マスタ更新には更新者IDが必要です。',4200);el&&el.focus();return null}setUserId(id);return id}

 function renderMaintForm(){
  const def=currentDef(),form=$('#masterMaintForm');if(!form)return;const editing=maintState.editing;
  const controls=def.fields.map(f=>{
   const val=editing?String(editing[f.k]??''):'';
   if(f.type==='select'){
    const opts=(f.options||[]).map(o=>`<option value="${esc(o)}"${o===val?' selected':''}>${esc(o||'（指定なし）')}</option>`).join('');
    return `<label class="mm-field"><span>${esc(f.label)}${f.required?'<i>*</i>':''}${f.key?'<em class="mm-keytag">キー</em>':''}</span><select data-field="${f.k}">${opts}</select></label>`;
   }
   return `<label class="mm-field"><span>${esc(f.label)}${f.required?'<i>*</i>':''}${f.key?'<em class="mm-keytag">キー</em>':''}</span><input data-field="${f.k}" type="text" value="${esc(val)}" autocomplete="off"></label>`;
  }).join('');
  const chip=editing?`<span class="mm-mode-chip editing">編集中 <b>${esc(editing[def.cols[0].k]||'')}</b><small>ID:${esc(editing.id)}</small></span>`:`<span class="mm-mode-chip new">新規登録</span>`;
  form.innerHTML=`<div class="mm-form-head">${chip}${editing?'<button type="button" id="masterMaintNew" class="mm-btn-ghost sm">＋ 新規入力に切替</button>':''}</div>
   <div class="mm-form-fields">${controls}</div>
   <div class="mm-form-tail"><button type="submit" class="mm-btn-primary">${editing?'更新を保存':'追加登録'}</button><span class="mm-form-hint">${editing?'キー項目（名称・区分など）も変更できます。保存すると同じIDのまま更新（リネーム）されます。同名が既にある場合は更新できません。':'必須(*)を入力して追加登録します。'}</span></div>`;
  form.onsubmit=ev=>{ev.preventDefault();submitMaint()};
  const nb=$('#masterMaintNew');if(nb)nb.onclick=()=>{maintState.editing=null;renderMaintForm()};
 }

 function setMaintLoading(show,text){
  const dialog=$('#masterMaintModal .mm-dialog');if(!dialog)return;
  let box=dialog.querySelector(':scope > .mm-loading');
  if(show){
   if(!box){box=document.createElement('div');box.className='mm-loading';box.innerHTML='<div class="mm-loading-box"><span class="mini-spinner"></span><b></b></div>';dialog.appendChild(box)}
   box.querySelector('b').textContent=text||'処理しています…';box.hidden=false;
  }else if(box){box.hidden=true}
 }
 async function submitMaint(){
  const def=currentDef(),uid=requireMaintUser();if(uid===null)return;const editing=maintState.editing;
  const body={user_id:uid};let ok=true;
  if(editing)body.id=editing.id;
  def.fields.forEach(f=>{const el=$(`#masterMaintForm [data-field="${f.k}"]`);const v=String(el?el.value:'').trim();if(f.required&&!v)ok=false;body[f.k]=v});
  if(!ok){showToast('入力を確認してください','必須項目が未入力です。',4000);return}
  const endpoint=editing?def.endpoint+'/update':def.endpoint;
  try{
   setMaintLoading(true,editing?`${def.label}を更新しています…`:`${def.label}を登録しています…`);
   const r=await api(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   maintState.editing=null;await loadMaint(true);
   showToast&&showToast(def.label+(editing?'を更新しました':'を登録しました'),(r&&r.message)||'',3600);
  }catch(e){showToast&&showToast(editing?'更新できませんでした':'登録できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }
 async function deleteMaint(item){
  const def=currentDef();if(!def.hasDelete)return;const uid=requireMaintUser();if(uid===null)return;
  const nm=item[def.cols[0].k]||item.name||'';
  if(!confirm(`${def.label}「${nm}」を無効化（削除）しますか？`))return;
  try{
   setMaintLoading(true,`${def.label}を無効化しています…`);
   await api(def.endpoint+'/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,user_id:uid})});
   if(maintState.editing&&maintState.editing.id===item.id)maintState.editing=null;
   await loadMaint(true);showToast&&showToast(def.label+'を無効化しました',nm,3600);
  }catch(e){showToast&&showToast('削除できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }

 function fmtDT(v){if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?'-':d.toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
 function maintGridTemplate(def){const data=def.cols.map(c=>`minmax(120px,${c.grow||1}fr)`).join(' ');return `${data} 120px 150px 132px`}
 function filteredMaintItems(def){
  const q=String(maintState.query||'').trim().normalize('NFKC').toLowerCase();
  let items=maintState.items||[];
  if(q)items=items.filter(it=>{const hay=[...def.cols.map(c=>it[c.k]),it.updated_by].map(v=>String(v??'').normalize('NFKC').toLowerCase()).join(' ');return hay.includes(q)});
  return items;
 }
 function renderMaintList(){
  const def=currentDef(),list=$('#masterMaintList');if(!list)return;
  const all=maintState.items||[],items=filteredMaintItems(def),tmpl=maintGridTemplate(def);
  const cnt=$('#masterMaintCount');if(cnt)cnt.textContent=maintState.query?`${items.length} / 有効 ${all.length}件`:`有効 ${all.length}件`;
  const headCols=def.cols.map(c=>`<span>${esc(c.label)}</span>`).join('');
  list.innerHTML=`<div class="mm-row head" style="grid-template-columns:${tmpl}">${headCols}<span>更新者</span><span>更新日時</span><span class="mm-act">操作</span></div>`;
  if(!items.length){list.insertAdjacentHTML('beforeend',`<div class="mm-empty">${all.length&&maintState.query?'絞り込み条件に一致するデータがありません。':'有効なデータがありません。上のフォームから追加してください。'}</div>`);return}
  const frag=document.createDocumentFragment();
  items.forEach(it=>{
   const row=document.createElement('div');row.className='mm-row'+(maintState.editing&&maintState.editing.id===it.id?' editing':'');row.style.gridTemplateColumns=tmpl;row.tabIndex=0;row.title='クリックで編集フォームに読み込みます';
   const cells=def.cols.map(c=>`<span title="${esc(it[c.k]??'')}">${esc(it[c.k]??'')||'<em class="mm-blank">—</em>'}</span>`).join('');
   row.innerHTML=`${cells}<span class="mm-user" title="${esc(it.updated_by||'')}">${esc(it.updated_by||'-')}</span><span class="mm-date">${esc(fmtDT(it.updated_at))}</span><span class="mm-act"><button type="button" class="mm-edit">編集</button>${def.hasDelete?'<button type="button" class="mm-del">削除</button>':''}</span>`;
   const edit=()=>{maintState.editing=Object.assign({},it);renderMaintForm();const f=$('#masterMaintForm');if(f)f.scrollIntoView({block:'nearest'})};
   row.querySelector('.mm-edit').onclick=e=>{e.stopPropagation();edit()};
   const del=row.querySelector('.mm-del');if(del)del.onclick=e=>{e.stopPropagation();deleteMaint(it)};
   row.onclick=()=>edit();row.onkeydown=e=>{if(e.key==='Enter')edit()};
   frag.append(row);
  });
  list.append(frag);
 }
 async function loadMaint(force){
  const def=currentDef();const title=$('#masterMaintTitle');if(title)title.textContent=def.label+'マスタ';
  const list=$('#masterMaintList');if(list&&force)list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  renderMaintForm();
  try{
   const r=await api(def.endpoint);maintState.items=(r&&r.items)||[];
   renderMaintList();
  }catch(e){if(list)list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 function openMasterMaint(){const modal=ensureMaintModal();const uid=$('#masterUserId');if(uid)uid.value=currentUserId();maintState.editing=null;maintState.query='';const se=$('#masterMaintSearch');if(se)se.value='';syncNav();modal.hidden=false;loadMaint(true);requestAnimationFrame(()=>{const u=$('#masterUserId');if(u&&!u.value)u.focus()})}

 function bindMasterMaint(){const b=$('#openMasterMaint');if(b)b.onclick=e=>{e.preventDefault();openMasterMaint()}}
 document.addEventListener('click',e=>{const t=e.target.closest('#openMasterMaint');if(!t)return;e.preventDefault();e.stopImmediatePropagation();openMasterMaint()},true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#masterMaintModal')?.hidden){$('#masterMaintModal').hidden=true}},true);
 queueMicrotask(()=>{bindMasterMaint()});
})();



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
 const baseColors={teal:'#087c89',blue:'#2563eb',green:'#16a34a',orange:'#f59e0b',red:'#dc2626',purple:'#7c3aed',slate:'#334155',pink:'#db2777'};
 const stackPalette=['#087c89','#2563eb','#16a34a','#f59e0b','#dc2626','#7c3aed','#0f766e','#e11d48','#64748b','#84cc16','#06b6d4','#a855f7','#94a3b8','#f97316'];
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

 function ensurePrintButton(){const actions=document.querySelector('.global-actions');if(!actions||$id('printCurrentView'))return;const b=document.createElement('button');b.id='printCurrentView';b.type='button';b.className='print-button';b.textContent='印刷';b.onclick=()=>window.print();actions.append(b)}

 function setPeriod(kind){const s=$id('qaStart'),e=$id('qaEnd');if(!s||!e)return;const now=new Date(),pad=n=>String(n).padStart(2,'0'),d0=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T00:00`,d1=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T23:59`;let a=new Date(now),b=new Date(now);if(kind==='7d')a.setDate(now.getDate()-6);else if(kind==='30d')a.setDate(now.getDate()-29);else if(kind==='90d')a.setDate(now.getDate()-89);else if(kind==='thisMonth'){a=new Date(now.getFullYear(),now.getMonth(),1);b=new Date(now.getFullYear(),now.getMonth()+1,0)}else if(kind==='lastMonth'){a=new Date(now.getFullYear(),now.getMonth()-1,1);b=new Date(now.getFullYear(),now.getMonth(),0)}else if(kind==='ytd')a=new Date(now.getFullYear(),0,1);s.value=d0(a);e.value=d1(b);const seg=$id('qaPeriodKind');if(seg)seg.value=kind;setSeg('qaPeriodSeg',kind);updateSummaries()}

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
    <div class="qa-actions"><button type="button" id="qaRefresh" class="qa-primary">グラフを作成／更新</button><button type="button" id="qaPrint" class="qa-secondary">印刷</button></div>
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
  /* 見た目の変更はクライアント側で即時再描画（同サイズ） */
  ['qaChartType','qaBarWidth','qaBarMetric','qaLineMetric','qaSort','qaLimit','qaColor','qaShowValues'].forEach(id=>{const el=p.querySelector('#'+id);if(el)el.addEventListener('change',()=>{updateColor();updateToolbarDisclosure();if(last)render(last)})});
  applyDisclosure();updateColor();
  return p;
 }

 function updateColor(){const dot=$id('qaColorDot');if(dot)dot.style.background=baseColor()}
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
   if(stack&&hasSeries){body+=items.map((it,i)=>{const cx=x(i);let acc=0;return keys.map((k,si)=>{const v=Number(it.stacks?.[k]?.[metric]||0);if(!v)return '';const yy=yB(acc+v),hh=yB(acc)-yy;acc+=v;return `<rect x="${cx-bw/2}" y="${yy}" width="${bw}" height="${Math.max(1,hh)}" fill="${stackPalette[si%stackPalette.length]}" opacity=".85"><title>${html(it.label)} / ${html(k)}: ${fmt(v)}</title></rect>`}).join('')}).join('')}
   else{body+=items.map((it,i)=>{const v=Number(it[barMetric]||0);return `<rect x="${x(i)-bw/2}" y="${yB(v)}" width="${bw}" height="${Math.max(1,T+plotH-yB(v))}" rx="3" fill="${color}" opacity=".5"><title>${html(it.label)} 棒(${METRIC_LABEL[barMetric]}): ${fmt(v)}</title></rect>`}).join('')}
   const pts=items.map((it,i)=>`${x(i)},${yL(Number(it[lineMetric]||0))}`).join(' ');
   body+=`<polyline class="qa-line" points="${pts}" stroke="${color}"></polyline>`+items.map((it,i)=>`<circle class="qa-point" cx="${x(i)}" cy="${yL(Number(it[lineMetric]||0))}" r="4" fill="${color}"><title>${html(it.label)} 線(${METRIC_LABEL[lineMetric]}): ${fmt(Number(it[lineMetric]||0))}</title></circle>`).join('');
   if(showVal)body+=items.map((it,i)=>`<text class="qa-value" x="${x(i)}" y="${yL(Number(it[lineMetric]||0))-7}" text-anchor="middle">${fmt(Number(it[lineMetric]||0))}</text>`).join('');
  }else if(hasSeries&&stack){
   body=items.map((it,i)=>{const total=stackTotal(it)||1;let acc=0;const cx=x(i);const segs=keys.map((k,si)=>{let v=Number(it.stacks?.[k]?.[metric]||0);if(!v)return '';let disp=pct?v/total*100:v;const yy=yB(acc+disp),hh=yB(acc)-yy;acc+=disp;return `<rect x="${cx-bw/2}" y="${yy}" width="${bw}" height="${Math.max(1,hh)}" fill="${stackPalette[si%stackPalette.length]}"><title>${html(it.label)} / ${html(k)}: ${fmt(v)}</title></rect>`}).join('');const lab=showVal&&!pct?`<text class="qa-value" x="${cx}" y="${yB(stackTotal(it))-6}" text-anchor="middle">${fmt(stackTotal(it))}</text>`:'';return segs+lab}).join('');
  }else if(hasSeries){
   const clusterW=bandWidth(slot,barFactor(),10),innerGap=Math.min(4,clusterW/keys.length*0.15);
   const gw=Math.max(3,clusterW/keys.length-innerGap),groupW=gw*keys.length+innerGap*(keys.length-1);
   body=items.map((it,i)=>{const x0=x(i)-groupW/2;return keys.map((k,si)=>{const v=Number(it.stacks?.[k]?.[metric]||0);return `<rect x="${x0+si*(gw+innerGap)}" y="${yB(v)}" width="${gw}" height="${Math.max(1,T+plotH-yB(v))}" rx="2" fill="${stackPalette[si%stackPalette.length]}"><title>${html(it.label)} / ${html(k)}: ${fmt(v)}</title></rect>`}).join('')}).join('');
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
   body=items.map((it,i)=>{const total=stackTotal(it)||1;let acc=0;const yy=yrow(i);const segs=keys.map((k,si)=>{let v=Number(it.stacks?.[k]?.[metric]||0);if(!v)return '';let disp=pct?v/total*100:v;const x0=xv(acc),w=xv(acc+disp)-x0;acc+=disp;return `<rect x="${x0}" y="${yy}" width="${Math.max(1,w)}" height="${rowH}" fill="${stackPalette[si%stackPalette.length]}"><title>${html(it.label)} / ${html(k)}: ${fmt(v)}</title></rect>`}).join('');const lab=showVal&&!pct?`<text class="qa-value" x="${xv(stackTotal(it))+6}" y="${yy+rowH/2+4}">${fmt(stackTotal(it))}</text>`:'';return segs+lab}).join('');
  }else if(hasSeries){
   const clusterH=bandWidth(stride,barFactor(),10),innerGap=Math.min(3,clusterH/keys.length*0.15);
   const gh=Math.max(2,clusterH/keys.length-innerGap);
   body=items.map((it,i)=>{const y0=yrow(i,clusterH);return keys.map((k,si)=>{const v=Number(it.stacks?.[k]?.[metric]||0);return `<rect x="${L}" y="${y0+si*(gh+innerGap)}" width="${Math.max(1,xv(v)-L)}" height="${gh}" fill="${stackPalette[si%stackPalette.length]}"><title>${html(it.label)} / ${html(k)}: ${fmt(v)}</title></rect>`}).join('')}).join('');
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
  items.forEach((it,i)=>{const v=Number(it[metric]||0),frac=v/total,a1=a0+frac*2*Math.PI,col=stackPalette[i%stackPalette.length];arcs+=`<path d="${arcPath(cx,cy,r,ir,a0,a1)}" fill="${col}" stroke="#fff" stroke-width="2"><title>${html(it.label)}: ${fmt(v)} (${(frac*100).toFixed(1)}%)</title></path>`;if(showVal&&frac>=0.04){const mid=(a0+a1)/2,lr=ir>0?(r+ir)/2:r*0.62,[lx,ly]=polar(cx,cy,lr,mid);arcs+=`<text class="qa-pie-label" x="${lx}" y="${ly}" text-anchor="middle">${Math.round(frac*100)}%</text>`}a0=a1});
  const center=donut?`<text x="${cx}" y="${cy-4}" text-anchor="middle" class="qa-donut-total">${fmt(total)}</text><text x="${cx}" y="${cy+16}" text-anchor="middle" class="qa-donut-sub">${METRIC_LABEL[metric]||''}</text>`:'';
  const head=(title?`<text class="qa-chart-title" x="${W/2}" y="16" text-anchor="middle">${html(title)}</text>`:'')+(subtitle?`<text class="qa-chart-subtitle" x="${W/2}" y="${16+titleH}" text-anchor="middle">${html(subtitle)}</text>`:'');
  const legendRow=legendSvg(legendInfo,Math.max(8,(W-Math.max(...legendInfo.placements.map(p=>p.x),0))/2-70),H-legendH+8);
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${html(title||'品質データ分析グラフ（円）')}">${head}${arcs}${center}${legendRow}</svg>`;
 }

 function legend(data,items,metric,flags,hasSeries){
  if(flags.combo){const bm=val('qaBarMetric')||'count',lm=val('qaLineMetric')||'sum';return `<span class="qa-lg"><i class="sw" style="background:${baseColor()};opacity:.5"></i>棒: ${METRIC_LABEL[bm]}</span><span class="qa-lg"><i class="ln" style="background:${baseColor()}"></i>折れ線: ${METRIC_LABEL[lm]}</span>`}
  if(flags.pie){return `<div class="qa-stack-legend">${items.map((it,i)=>`<span><i style="background:${stackPalette[i%stackPalette.length]}"></i>${html(ell(it.label,16))}</span>`).join('')}</div>`}
  if(hasSeries)return `<div class="qa-stack-legend">${(data.stack_keys||[]).map((k,i)=>`<span><i style="background:${stackPalette[i%stackPalette.length]}"></i>${html(k)}</span>`).join('')}</div>`;
  return `<span class="qa-color-dot" style="background:${baseColor()}"></span>${METRIC_LABEL[metric]||''}`;
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

 async function run(){
  const panel=ensurePanel();if(panel.hidden)return;
  $id('qaChart').innerHTML='<div class="qa-empty">グラフを作成しています…</div>';
  const q=new URLSearchParams({table:S.table||'',group_col:val('qaGroupCol'),metric:val('qaMetric')||'count',value_col:val('qaValueCol'),stack_col:val('qaSeriesCol'),date_col:val('qaDateCol'),search:val('qaSearch'),bucket:val('qaBucket')||'day',dimension:val('qaDimension')||'category',max_rows:'20000'});
  const st=val('qaStart'),en=val('qaEnd');if(st)q.set('start',st);if(en)q.set('end',en);
  try{const data=await api('/api/quality/analysis?'+q.toString());requestAnimationFrame(()=>render(data))}catch(err){$id('qaChart').innerHTML=`<div class="qa-empty">グラフ作成に失敗しました: ${html(err.message)}</div>`}
 }

 function sync(){
  ensurePrintButton();const panel=ensurePanel();
  const isQ=typeof S!=='undefined'&&S.db==='SIKALOTDEF';
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

 if(typeof renderGrid==='function'){const old=renderGrid;renderGrid=function(){old();sync()}}
 if(typeof selectDb==='function'){const old=selectDb;selectDb=async function(k,b){const r=await old(k,b);sync();return r}}
 if(typeof selectTable==='function'){const old=selectTable;selectTable=async function(t){const r=await old(t);sync();return r}}
 window.addEventListener('resize',()=>{clearTimeout(window._qaRz);window._qaRz=setTimeout(()=>{const p=$id('qualityAnalysisPanel');if(last&&p&&!p.hidden&&p.dataset.view==='graph')render(last)},150)});
 document.addEventListener('DOMContentLoaded',sync);queueMicrotask(sync);
})();


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
- 「測定データ.accdb」への保存内容と同一のローカル保存レコード
  （reliableAll）を対象データとする。印刷・PDF保存はブラウザーの
  印刷機能を使い、追加ライブラリなしで完結させる。
============================================================ */
(function(){
 let rpState={items:[],query:'',sort:'updated-desc',selectedId:''},rpZoom='fit';
 const $id=id=>document.getElementById(id);
 function fmtDT(v){if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?'-':d.toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
 function fmtDimSafe(v,d){const raw=String(v??'').trim();if(raw==='')return '';const n=Number(raw);return Number.isFinite(n)?n.toFixed(d):raw}
 function statusLabel(s){return s||'編集中'}
 function statusClass(s){return s==='完了'?'done':s==='測定値NG'?'ng':''}

 function ensureNavButton(){
  const nav=document.querySelector('.local-nav');if(!nav||$id('openReportList'))return;
  const b=document.createElement('button');b.type='button';b.id='openReportList';b.className='db local-report-btn';
  b.innerHTML='<span>測定帳票</span>';b.title='端末保存済みのロットから帳票（印刷・PDF）を作成します';
  b.onclick=openReportView;nav.append(b);
 }

 function exitReportView(){
  if(!document.body.classList.contains('rp-mode'))return;
  document.body.classList.remove('rp-mode');
  $id('openReportList')?.classList.remove('active');
  const panel=$id('reportPanel');if(panel)panel.hidden=true;
 }
 if(typeof selectDb==='function'){const old=selectDb;selectDb=async function(k,b){exitReportView();return old(k,b)}}

 function ensurePanel(){
  let panel=$id('reportPanel');if(panel)return panel;
  panel=document.createElement('section');panel.className='rp-panel';panel.id='reportPanel';panel.hidden=true;
  panel.innerHTML=`
   <header class="rp-head">
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
        <button type="button" data-val="100">100%</button>
       </div>
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
  panel.querySelectorAll('[data-seg="rpZoomSeg"] button').forEach(b=>b.onclick=()=>setZoom(b.dataset.val));
  window.addEventListener('resize',()=>{if(rpZoom==='fit')fitPage()});
  return panel;
 }

 /* ---------- A4ページの表示倍率（既定=ページ全体をフィット表示） ---------- */
 function setZoom(v){
  rpZoom=v;
  document.querySelectorAll('[data-seg="rpZoomSeg"] button').forEach(b=>b.classList.toggle('active',b.dataset.val===v));
  if(v==='fit')fitPage();else resetPageScale();
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
   page.style.transform=`scale(${scale})`;
   box.style.width=`${pw*scale}px`;box.style.height=`${ph*scale}px`;
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
   row.onclick=()=>selectLot(x.id);frag.append(row);
  });
  list.innerHTML='';list.append(frag);
 }

 function reportSection(title,rows,cols){
  const body=rows.map(([label,value])=>`<div class="rp-field"><span class="rp-field-label">${esc(label)}</span><span class="rp-field-value" title="${esc(value||'-')}">${esc(value||'-')}</span></div>`).join('');
  return `<section class="rp-section"><h3>${esc(title)}</h3><div class="rp-grid${cols?' rp-grid-'+cols:''}">${body}</div></section>`;
 }
 function dimensionSection(b){
  const row=(label,mat,temper,thick,width,length)=>`<tr><th>${esc(label)}</th><td>${esc(mat||'-')}</td><td>${esc(temper||'-')}</td><td>${esc(fmtDimSafe(thick,2)||'-')}</td><td>${esc(fmtDimSafe(width,1)||'-')}</td><td>${esc(fmtDimSafe(length,1)||'-')}</td></tr>`;
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
  const m=x.mother||{};
  return `<section class="rp-section"><h3>母材実績／カード指示</h3><table class="rp-dim-table"><thead><tr><th></th><th>手計算</th><th>全長</th><th>前オフ</th><th>後オフ</th></tr></thead><tbody><tr><th>実績</th><td>${esc(m.manual||'-')}</td><td>${esc(m.fullLength||'-')}</td><td>${esc(m.front||'-')}</td><td>${esc(m.rear||'-')}</td></tr><tr><th>カード指示</th><td>${esc(m.minCard||'-')}</td><td>${esc(m.maxCard||'-')}</td><td>${esc(m.frontCard||'-')}</td><td>${esc(m.rearCard||'-')}</td></tr></tbody></table></section>`;
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
  let rows='';
  for(let col=0;col<40;col++){
   const real=col<actual,cell=v=>real?esc(v||'-'):'';
   rows+=`<tr><th>${col+1}</th><td>${real&&tol?fmtDimSafe(tol[0],2):''}</td><td>${cell(measAt(x,'width',headIdx,col))}</td><td>${cell(measAt(x,'width',tailIdx,col))}</td><td>${real&&tol?fmtDimSafe(tol[1],2):''}</td><td>${cell(measAt(x,'lateral',headIdx,col))}</td><td>${cell(measAt(x,'lateral',tailIdx,col))}</td><td>${cell(measAt(x,'burr',headIdx,col))}</td><td>${cell(measAt(x,'burr',tailIdx,col))}</td><td>${cell(measAt(x,'offset',tailIdx,col))}</td><td>${cell(measAt(x,'telescope',tailIdx,col))}</td><td>${cell(measAt(x,'flatness',tailIdx,col))}</td><td>${cell(measAt(x,'comments',tailIdx,col))}</td></tr>`;
  }
  return `<section class="rp-section"><h3>測定データ（板幅・ラテラルボー・バリ・巻ずれ・テレスコープ）</h3><p class="rp-note">巻ずれ・テレスコープは ${esc(tailLabel)} のデータのみ対象です。横割数（${actual}条）を超える行は控え欄として空欄にしています。</p><div class="rp-wide-wrap"><table class="rp-dim-table rp-wide-table"><thead><tr><th rowspan="2">コイル№</th><th colspan="4">板幅</th><th colspan="2">ラテラルボー</th><th colspan="2">バリ</th><th>巻ずれ</th><th>テレスコープ</th><th rowspan="2">フラットネス</th><th rowspan="2">備考</th></tr><tr><th>範囲下限</th><th>${esc(headLabel)}</th><th>${esc(tailLabel)}</th><th>範囲上限</th><th>${esc(headLabel)}</th><th>${esc(tailLabel)}</th><th>${esc(headLabel)}</th><th>${esc(tailLabel)}</th><th>${esc(tailLabel)}</th><th>${esc(tailLabel)}</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
 }
 /* 丈(1..N)別の長さ・肉厚・揃い判定。旧帳票の「丈」テーブル（長さ/肉厚/揃い/外観/備考）に対応。
    「外観」列は旧帳票でも実データが書き込まれない控え欄のため、空欄のまま残す。
    丈数(N)が増えても縦方向を圧迫しないよう、丈を列に、指標を行に転置する
    （測定データ（板厚）のOS/CL/DS表と同じ考え方）。行数は常に固定5行。
    列数も丈数（最大9）に関わらず常に9列固定とし、丈数が変わるたびに
    レイアウト幅が変化しないようにする（板幅40行表と同じ「固定枠+控え欄」方式）。 */
 function productRowsSection(x){
  const rows=x.product?.rows||[],actual=Math.max(1,Math.min(9,+x.settings?.verticalCount||1)),cols=Array.from({length:9},(_,i)=>i+1);
  const metricRow=(label,fn)=>`<tr><th>${esc(label)}</th>${cols.map((_,i)=>`<td>${i<actual?fn(rows[i]||{},i):''}</td>`).join('')}</tr>`;
  const body=metricRow('長さ',r=>esc(r.productLength||'-'))
   +metricRow('肉厚',r=>esc(r.wallThickness||'-'))
   +metricRow('揃い',r=>{const j=judgeAlignmentCode(r.alignmentCode);return j?`<span class="product-judge${j==='OK'?' ok':' ng'}">${esc(j)}</span>`:''})
   +metricRow('外観',()=>'')
   +metricRow('備考',r=>esc(r.note||'-'));
  return `<section class="rp-section"><h3>丈別データ（長さ・肉厚・揃い）</h3><p class="rp-note">丈数（${actual}丈）を超える列は控え欄として空欄にしています。</p><div class="rp-wide-wrap"><table class="rp-dim-table rp-product-table"><thead><tr><th>丈</th>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div></section>`;
 }
 /* 作業班構成: オペレータ・検査員は既存データから、梱包員は現状データ未実装
    のため常に「-」表示。旧帳票の梱包員欄に相当する表示エリアだけ先に確保する。 */
 function crewSection(x){
  const s=x.settings||{};
  return reportSection('作業班構成',[['オペレータ',s.operator],['検査員',s.inspector],['梱包員',s.packer],['作業人数',s.crewSize?`${s.crewSize}名班`:'-']]);
 }

 function renderReport(x){
  const b=x.basic||{},s=x.settings||{},w=x.workTime||{};
  const equipment=s.registeredEquipment||x.registeredEquipment||x.snapshot?.registeredEquipment||'-';
  const dur=w.startAt&&w.endAt?formatDuration(new Date(w.endAt)-new Date(w.startAt)):(w.startAt?'作業中':'未計測');
  const isDimensional=s.measureType==='板厚/板幅';
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
    <div class="rp-stack">${reportSection('コース情報',[['設計コース',b.designCourse],['実績コース',b.course],['残コース',b.residualCourse]])}${dimensionSection(b)}</div>
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
   ${isDimensional?widthMeasurementSection(x):''}
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
  fitPage();
 }

 function printReport(){
  if(!rpState.selectedId)return;
  const x=rpState.items.find(i=>i.id===rpState.selectedId),prevTitle=document.title;
  document.title=`測定帳票_${x?.basic?.lotNo||x?.id||'lot'}`;
  window.print();
  setTimeout(()=>{document.title=prevTitle},500);
 }

 async function openReportView(){
  document.body.classList.remove('qa-mode','qa-view-raw');
  document.getElementById('dashboardPanel')?.setAttribute('hidden','');
  document.body.classList.remove('db-mode');
  document.getElementById('openDashboard')?.classList.remove('active');
  document.body.classList.add('rp-mode');
  document.querySelectorAll('#nav button.db').forEach(b=>b.classList.remove('active'));
  $id('openReportList')?.classList.add('active');
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

 queueMicrotask(ensureNavButton);
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
 function crewLabel(size){return size?`${size}名班`:'人数未設定'}
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
   crewSize:s.crewSize?String(s.crewSize):'',
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
  const nav=document.querySelector('.local-nav');if(!nav||$id('openDashboard'))return;
  const b=document.createElement('button');b.type='button';b.id='openDashboard';b.className='db local-dashboard-btn';
  b.innerHTML='<span>ダッシュボード</span>';b.title='端末保存済みの測定データからKPI（設備別効率・人数別内訳・品種別作業時間など）を集計します';
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
  document.body.classList.remove('qa-mode','qa-view-raw');
  document.getElementById('reportPanel')?.setAttribute('hidden','');
  document.body.classList.remove('rp-mode');
  document.getElementById('openReportList')?.classList.remove('active');
  document.body.classList.add('db-mode');
  document.querySelectorAll('#nav button.db').forEach(b=>b.classList.remove('active'));
  $id('openDashboard')?.classList.add('active');
  const panel=ensurePanel();panel.hidden=false;
  if(!panel.dataset.inited){panel.dataset.inited='1';applyPreset('equipEfficiency');applyPeriod('thisMonth')}
  else{toggleBucket();runDashboard()}
 }

 queueMicrotask(ensureNavButton);
})();
