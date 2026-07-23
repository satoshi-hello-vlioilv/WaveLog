"use strict";
/* base.js: 共有基盤 — グローバル状態(S)・API呼び出し・共通ユーティリティ・
   フィールド別名(aliases)・端末設定(使用設備/ユーザーID)。
   読込順の先頭に置き、画面固有の処理はここへ置かない。 */
const LENGTH_SLOTS=12;const $=s=>document.querySelector(s),S={db:null,table:null,catalog:[],tables:[],columns:[],rows:[],page:1,count:0,current:null,measure:null};
const api=async(u,o)=>{let r;try{r=await fetch(u,{cache:'no-store',...(o||{})})}catch(error){throw Error('サーバーへ接続できません。Flaskアプリが起動中か、ポート5029で開いているか確認してください。詳細: '+(error?.message||String(error)))}const text=await r.text();let j={};try{j=text?JSON.parse(text):{}}catch(_){j={error:text}}if(!r.ok)throw Error(j.error||('HTTP '+r.status));return j},esc=v=>{const d=document.createElement('div');d.textContent=v??'';return d.innerHTML};
const aliases={lotNo:['ロット番号','ﾛｯﾄ番号','LTNO'],inspectionNo:['検査番号','KNNO'],orderNo:['オーダー番号','JUON','JUNO'],castingNo:['鋳造番号','CYNO'],allocationNo:['引当番号','HKNO'],orderMaterial:['オーダー材質','JUA'],orderTemper:['オーダー調質','JUB'],orderThickness:['オーダー板厚','JUX'],orderWidth:['オーダー板幅','JUY'],orderLength:['オーダー板丈','JUZ'],mfgMaterial:['製造材質','LTA'],mfgTemper:['製造調質','LTB'],mfgThickness:['製造板厚','LTX'],mfgWidth:['製造板幅','LTY'],mfgLength:['製造板丈','LTZ'],purposeCode:['用途コード','用途ｺｰﾄﾞ','YOTOC'],purposeName:['用途名','YOTON'],customer:['取引先','TOKUNA'],delivery:['納入先','NONNA'],designCourse:['設計_設備ｺｰｽ','設計_設備コース'],course:['実績_設備ｺｰｽ','実績_設備コース','実績コース'],residualCourse:['残仕掛設備ｺｰｽ','残仕掛設備コース','ZANMC'],equipment:['BOX設計_設備名','設備'],originalWidth:['BOX実績_板幅'],boxHorizontalCount:['BOX設計_横割数'],boxVerticalCount:['BOX設計_縦割数']};
function pick(row,key){for(const n of aliases[key]||[])if(row[n]!==undefined&&row[n]!==null)return String(row[n]);return ''}
function lotKey(r){return [pick(r,'equipment'),pick(r,'lotNo'),pick(r,'inspectionNo'),pick(r,'castingNo')].join('|')}
/* 基本情報タブの寸法表示整形。板厚=小数2桁 / 板幅・板丈=小数1桁。数値でない・空欄はそのまま。 */
function fmtDim(value,digits){const raw=String(value??'').trim();if(raw==='')return '';const n=Number(raw);return Number.isFinite(n)?n.toFixed(digits):raw}
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
function setState(x){$('#localState').textContent=x}
/* 保存されていない変更があるかどうかを追跡する。×ボタン/背景クリックで
   閉じようとした際、破棄してよいか確認するために使う。renderMeasurement()
   でデータを新規に読み込んだ時と、保存が成功した時にリセットする。 */
let measureDirty=false;
function markDirty(){measureDirty=true;setState('未保存')}
function bindTabs(group,panel){document.querySelectorAll(`[data-${group}tab]`).forEach(btn=>btn.onclick=()=>{document.querySelectorAll(`[data-${group}tab]`).forEach(x=>x.classList.toggle('active',x===btn));document.querySelectorAll(`[data-${group}panel]`).forEach(x=>x.hidden=x.dataset[group+'panel']!==btn.dataset[group+'tab'])})}
function optionFill(id,items,current='-'){const el=$('#'+id);if(!el)return;const vals=['-',...new Set(items||[])];el.innerHTML=vals.map(v=>`<option>${esc(v)}</option>`).join('');if(vals.includes(current))el.value=current}
function qualityText(items){if(!items?.length)return '異常情報なし';return items.slice(0,4).map((q,i)=>`(${i+1}) ${q['発生設備']||''} ${q['登録日時']||''} ${q['異常内容']||''}\nコメント：${q['コメント']||''}\n最終処置：${q['最終処置']||''}\n保留設定日：${q['保留設定日']||''}　保留解除日：${q['保留解除']||''}`).join('\n\n')}
function widthSequence(max,order,dir){let a=Array.from({length:max},(_,i)=>i);if(order==='奇数条優先')a=[...a.filter(i=>i%2===0),...a.filter(i=>i%2===1)];if(order==='偶数条優先')a=[...a.filter(i=>i%2===1),...a.filter(i=>i%2===0)];if(dir==='降順')a=a.reverse();return a}
function lengthIndex(){const el=$('#lengthPos');if(!el)return 0;const opts=[...el.options],idx=opts.findIndex(o=>o.value===el.value);return Math.max(0,Math.min(LENGTH_SLOTS-1,idx>=0?idx:0))}
/* 自動転送中に、日本語IME等の影響で数字・記号が全角へ変換され、Tabまでの
   間に解析不能な文字列になる不具合への対策。全角英数記号(U+FF01-FF5E)と
   全角スペースを半角へ強制変換する。自動転送(auto)時のみ適用し、
   手動入力(manual)時は自由に入力できるよう変換しない。 */
function toHalfWidth(str){return String(str??'').replace(/[！-～]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0xFEE0)).replace(/　/g,' ')}
function normalizedLot(value){return String(value||'').normalize('NFKC').replace(/[\s　_-]/g,'').toUpperCase()}
/* 画面右下に一時通知(トースト)を表示する。 */
function showToast(title, detail='', duration=3400){
 const area=$('#toastArea'); if(!area)return;
 const item=document.createElement('div'); item.className='toast';
 item.innerHTML=`<b>${esc(title)}</b>${detail?`<small>${esc(detail)}</small>`:''}`;
 area.append(item); setTimeout(()=>{item.classList.add('out');setTimeout(()=>item.remove(),220)},duration);
}
function sourceValue(names){const r=S.measure?.source||S.measure?.snapshot?.source||{};for(const n of names){if(r[n]!==undefined&&r[n]!==null&&String(r[n]).trim()!=='')return String(r[n])}return ''}
// Database field normalization supports half-width/full-width variants such as ﾌﾟﾗｽ / プラス.
function normalizedFieldName(name){return String(name||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase()}
/* 複数の候補ソース(S.current/S.measure.source/スナップショット等)を横断して
   フィールド値を探す。全角半角ゆれはnormalizedFieldNameで吸収する。 */
function sourceField(names){
 const sources=[S.current,S.measure?.source,S.measure?.snapshot?.source,S.measure?.snapshot?.basic,S.measure?.basic].filter(x=>x&&typeof x==='object');
 for(const wanted of names){const wn=normalizedFieldName(wanted);for(const source of sources){for(const [key,value] of Object.entries(source)){if(normalizedFieldName(key)===wn&&value!==undefined&&value!==null&&String(value).trim()!=='')return String(value)}}}
 return '';
}
// Waiting feedback on the initial navigation. Yield one frame so acknowledgement appears immediately.
function nextPaint(){return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))}
function databaseLabel(key){return key==='SIKALOTNOW'?'仕掛一覧':key==='SIKALOTDEF'?'品質データ':key==='MASTER'?'マスタ':'データ'}
// Application equipment setting and design-course guard.
const APP_EQUIPMENT_KEY='AccessMeasurementConfiguredEquipment';
function currentConfiguredEquipment(){return String(localStorage.getItem(APP_EQUIPMENT_KEY)||'').trim()}
/* 更新対象者（ユーザーID）の管理。マスタ更新時にサーバーへ送信し記録する。 */
const USER_ID_KEY='AccessMeasurementUserId';
function currentUserId(){return String(localStorage.getItem(USER_ID_KEY)||'').trim()}
function setUserId(id){id=String(id||'').trim().slice(0,50);if(id)localStorage.setItem(USER_ID_KEY,id);return id}
/* ユーザーIDはこの端末を動かしているWindowsのログインIDを自動取得して
   使う(入力を求めない)。起動直後に一度だけ/api/whoamiへ問い合わせて
   キャッシュする。取得できるまでの短い間にマスタ更新が走った場合は、
   記録が空欄のまま残る(手入力プロンプトへは戻さない)。 */
async function fetchWhoami(){try{const r=await api('/api/whoami');return String(r.username||'').trim()}catch(_){return ''}}
queueMicrotask(async()=>{if(!currentUserId()){const name=await fetchWhoami();if(name)setUserId(name)}});
function ensureUserId(){return currentUserId()}
function withUserId(body){return Object.assign({},body||{},{user_id:ensureUserId()})}
function designCourseValue(){return sourceField(['設計_設備ｺｰｽ','設計_設備コース'])}
function actualCourseValue(){return sourceField(['実績_設備ｺｰｽ','実績_設備コース'])}
function residualCourseValue(){return sourceField(['残仕掛設備ｺｰｽ','残仕掛設備コース'])}
function normalizeCourseText(v){return String(v||'').normalize('NFKC').toUpperCase().replace(/[\s　]+/g,'')}
function equipmentIsInDesignCourse(equipment,course){const e=normalizeCourseText(equipment),c=normalizeCourseText(course);return !!e&&!!c&&c.includes(e)}
document.title='測定伝送システム';
function durationMs(record){const a=record?.workTime?.startAt,b=record?.workTime?.endAt;if(!a||!b)return null;const ms=new Date(b)-new Date(a);return Number.isFinite(ms)&&ms>=0?ms:null}
function formatDuration(ms){if(ms===null||ms===undefined)return '-';const sec=Math.floor(ms/1000),h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return `${h}時間 ${m}分 ${s}秒`}
/* Measurement precision and zero-order-tolerance correction. */
function measurementDigits(key){return key==='thickness'?3:key==='width'?1:null}
function fixedMeasurementValue(key,value){const raw=String(value??'').trim(),digits=measurementDigits(key);if(raw===''||digits===null)return raw;const n=Number(raw);return Number.isFinite(n)?n.toFixed(digits):raw}
function fixedToleranceValue(kind,value){const n=Number(value);if(!Number.isFinite(n))return '-';return n.toFixed(kind==='thickness'?3:1)}
/* Final title guard for delayed initialization and browser history restoration. */
function enforceApplicationTitle(){if(document.title!=='測定伝送システム')document.title='測定伝送システム'}
enforceApplicationTitle();window.addEventListener('pageshow',enforceApplicationTitle);document.addEventListener('visibilitychange',()=>{if(!document.hidden)enforceApplicationTitle()});
