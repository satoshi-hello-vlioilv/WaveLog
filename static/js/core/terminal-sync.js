/* terminal-sync.js: 端末の控え（§9.545・docs/DESKTOP_MIGRATION_DESIGN.md §8）。
   **どの画面よりも先に読む**（core.py の JS_FILES の先頭）——画面のJSが localStorage を
   読む前に、控えの設定を当てておくため。

   ブラウザの保存領域は「どこから開いたか（オリジン）」と「どのブラウザか」で分かれる。
   ブラウザ版（Edge・127.0.0.1:5029）とデスクトップ版（WebView2・wavelog.localhost）は
   互いの中身を見られないので、**両方から届く Python（端末の手元の控え）を介して**揃える。
   1回きりの引き継ぎではない——移行のあいだは同じ PC で両方を行き来する（併存）。

   設定: 控えの中身はサーバーが画面のHTMLへ埋めて渡す（`window.__wlTerminal`）。
     ・控えで最後に揃えた番号より後に変わった名前を当てる——ただし**手元の値が最後に揃えてから
       変わっていない**ときだけ（手元で変えてまだ送れていない値は手元が勝つ）。
     ・初めて揃える画面では、手元に在る名前はすべて**手元が正**（前の版から使い込んだ設定）。
     ・そのあと、変わった名前だけを5秒ごと・閉じるときに送る（丸ごと送らない——同時に開いた
       もう1つの窓の新しい値を、古い全体で消さないため）。
   記録: 測定の記録の運び役だけをここが持つ（`putRecords`／`deleteRecords`／`index`／`records`）。
     どれを新しいとみなすかは記録の持ち主（records-store.js の`reconcileTerminal()`）が決める。 */
(function(){
 "use strict";
 const META_KEY='WaveLogTerminalSyncV1';
 /* 控えへ送らない名前（理由を書けるものだけ）。 */
 const EXCLUDE=new Set([
  META_KEY,                      // この控えの印そのもの（画面ごとに違ってよい）
  'MeasurementLocalMirrorV31',   // 測定の記録の写し。記録は別の道（putRecords）で1件ずつ控える
  'listTablesCacheV1',           // 一覧の取り置き。開けば作り直せる
 ]);
 const FLUSH_MS=5000;
 /* 捨てる理由を残す（base.js の WL.quiet はこの時点でまだ無い）。 */
 function quiet(why,e){console.debug('[端末の控え] '+why,e&&e.message||e)}
 /* 閉じる瞬間の送り（keepalive）は本文が64KBまで。超えるぶんは普通に送る（閉じる前に届けば残る）。 */
 const KEEPALIVE_MAX=60*1024;

 function ls(){try{return window.localStorage}catch(e){quiet('localStorage を使えない（控えなしで続ける）',e);return null}}
 function readMeta(st){
  try{const v=JSON.parse(st.getItem(META_KEY)||'null');return v&&typeof v==='object'?v:null}
  catch(e){quiet('控えの印を読めない（初回として揃える）',e);return null}
 }
 function writeMeta(st,meta){try{st.setItem(META_KEY,JSON.stringify(meta))}catch(e){quiet('控えの印を書けない（次に開いたとき初回扱いになるだけ）',e)}}
 function snapshot(st){
  const out={};
  for(let i=0;i<st.length;i++){const k=st.key(i);if(k!=null&&!EXCLUDE.has(k))out[k]=st.getItem(k)}
  return out;
 }
 function diff(prev,now){
  const out={};let n=0;
  for(const k in now)if(prev[k]!==now[k]){out[k]=now[k];n++}
  for(const k in prev)if(!(k in now)){out[k]=null;n++}
  return n?out:null;
 }
 function post(url,data,keepalive){
  const body=JSON.stringify(data);
  return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body,cache:'no-store',
                    keepalive:!!keepalive&&body.length<=KEEPALIVE_MAX})
   .then(r=>r.ok?r.json():Promise.reject(Object.assign(new Error('控えへ送れませんでした（'+r.status+'）'),{status:r.status})));
 }

 /* 値の指紋（印に覚えるのは指紋だけ——値そのものを持つと印が設定の倍の大きさになる）。 */
 function fp(v){
  if(v==null)return '-';
  let h=0x811c9dc5;
  for(let i=0;i<v.length;i++){h^=v.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0}
  return v.length.toString(36)+':'+h.toString(36);
 }
 function fps(snap){const out={};for(const k in snap)out[k]=fp(snap[k]);return out}

 /* ---- 設定: 開いた瞬間に当てる（同期。画面のJSより先） ----
    印（META_KEY）には「最後に控えと揃えた番号」と、そのときの**値の指紋**を覚える。
    控えの値を当てるのは、手元の値が**最後に揃えてから変わっていない**名前だけ
    （手元に無く、揃えた覚えも無い名前を含む）。手元で変えてまだ送れていない値
    （閉じる直前の変更・読み直しの往復と行き違った変更）は**手元が勝ち**、開いた直後に送る。
    初めて揃える画面は覚えが空なので、手元に在る名前はすべて手元が正になる
    （前の版から使い込んだ設定を、控えで上書きしない）。 */
 const embedded=window.__wlTerminal||null;
 const st=ls();
 const state={enabled:!!(embedded&&st),first:false,applied:0,pushedAtStart:0,snap:{},rev:0};
 function remember(snap){writeMeta(st,{rev:state.rev,origin:location.origin,seen:fps(snap)})}
 if(state.enabled){
  const meta=readMeta(st);
  state.first=!meta;
  const seen=(meta&&meta.seen)||{},since=Number(meta&&meta.rev||0);
  const values=embedded.values||{},revs=embedded.revs||{};
  for(const k in values){
   if(EXCLUDE.has(k)||!(Number(revs[k])>since))continue;
   const mine=st.getItem(k);
   const untouched=k in seen?fp(mine)===seen[k]:mine===null;
   if(!untouched||mine===values[k])continue;
   try{values[k]==null?st.removeItem(k):st.setItem(k,values[k]);state.applied++}
   catch(e){quiet('設定を当てられない（容量超え等。次に開いたとき試す）',e)}
  }
  /* 送る: 手元の値が覚え（最後に揃えた指紋）と違い、控えの値とも違う名前。 */
  const now=snapshot(st),pending={};
  for(const k in now)if(fp(now[k])!==seen[k]&&values[k]!==now[k])pending[k]=now[k];
  for(const k in seen)if(!(k in now)&&!EXCLUDE.has(k)&&values[k]!=null)pending[k]=null;
  state.rev=Number(embedded.rev||0);
  state.snap=now;
  remember(now);
  /* 初回は「この画面が控えを使った」ことも残す（中身が空でも送る＝引き継ぎの印）。 */
  if(state.first||Object.keys(pending).length){
   state.pushedAtStart=Object.keys(pending).length;
   post('/api/terminal/settings',{values:pending,origin:location.origin})
    .catch(e=>{console.warn('端末の設定を控えへ送れませんでした（5秒後にもう一度）',e);state.snap={}});
  }
 }

 /* ---- 設定: 変わった名前だけを送る ---- */
 let flushing=false;
 function flushSettings(keepalive){
  if(!state.enabled||flushing)return Promise.resolve(false);
  const now=snapshot(st),changes=diff(state.snap,now);
  if(!changes)return Promise.resolve(false);
  flushing=true;
  const sent=state.snap;state.snap=now;          // 先に進める（送っている間の変更は次の回が拾う）
  return post('/api/terminal/settings',{values:changes,origin:location.origin},keepalive)
   .then(()=>{remember(now);return true},
         e=>{state.snap=sent;console.warn('端末の設定を控えへ送れませんでした（次の回にもう一度）',e);return false})
   .finally(()=>{flushing=false});
 }
 if(state.enabled){
  setInterval(()=>{flushSettings(false)},FLUSH_MS);
  window.addEventListener('pagehide',()=>{flushSettings(true)});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushSettings(true)});
 }

 /* ---- 記録の運び役 ---- */
 function putRecords(records){
  if(!state.enabled||!records||!records.length)return Promise.resolve(null);
  return post('/api/terminal/records/put',{records,origin:location.origin});
 }
 function deleteRecords(ids,deletedAt){
  if(!state.enabled||!ids||!ids.length)return Promise.resolve(null);
  return post('/api/terminal/records/delete',{ids,deletedAt:deletedAt||new Date().toISOString(),origin:location.origin});
 }
 /* 控えの見出し（id・更新時刻・消した時刻）。中身は運ばない。 */
 function index(){
  if(!state.enabled)return Promise.resolve(null);
  return fetch('/api/terminal/records',{cache:'no-store'})
   .then(r=>r.ok?r.json():Promise.reject(new Error('控えを読めませんでした（'+r.status+'）')))
   .then(j=>j.items||[]);
 }
 /* 指定した記録の中身。 */
 function records(ids){
  if(!state.enabled||!ids||!ids.length)return Promise.resolve([]);
  return post('/api/terminal/records/get',{ids}).then(j=>j.items||[]);
 }

 window.WL=window.WL||{};
 WL.terminalStore={
  enabled:()=>state.enabled,
  /* 開いた瞬間に何をしたか（網・調べ物用）。first＝この画面が初めて控えと揃えた */
  status:()=>({enabled:state.enabled,first:state.first,applied:state.applied,pushedAtStart:state.pushedAtStart,rev:state.rev}),
  flushSettings,putRecords,deleteRecords,index,records,
  EXCLUDE,
 };
})();
