/* feedback.js: 失敗を「開発へ報告できる形」で残す（§9.373）
   ============================================================
   利用者の指示:
     「何か失敗した時に通知するだけでなく、開発へフィードバックができるように
       解析しやすい情報を組み込んだ開発フィードバック用ログを残せるように
       して、使用者からコピーボタンひとつでデータを報告できる仕組みを
       追加しておいて下さい」

   ------------------------------------------------------------
   決めたこと

   ① **記録するのは「利用者が見た失敗」だけ。** `WL.quiet`（§9.328）は
      「静かに見送った失敗」の置き場で、性格が違う——あちらは開発時の
      手掛かり、こちらは**現場から開発へ渡す1通**。混ぜると、報告が
      200件の見送りログに埋もれる。**ただし報告には`WL.quiet`の直近も
      添える**（「見えなかった失敗」こそ解析の材料になる）。

   ② **文脈は画面が名乗る**（登録表・§9.352）。この土台は設備名も編集権も
      知らないし、知るべきでもない。画面が`WL.feedback.provide(名前,関数)`で
      名乗り、報告を組むときに1度だけ呼ぶ。**土台に画面の知識を書かない。**

   ③ **1通は「人が読む形」＋「機械で読む形」。** 現場はメールやチャットへ
      貼るので、まず日本語で読めること。末尾にJSONを1行付けて、開発側は
      そこだけ見れば済むようにする（人向けの体裁を壊さずに機械可読）。

   ④ **コピーは1手。** 失敗のトーストに「報告用にコピー」を出す。
      トーストは消えるので、**あとからでも同じ1通を出せる**入口を残す
      （「ログ・診断」の「報告する」の段・§9.510）。

   ⑤ **端末に残す。** その場で報告できないこともあるので、直近は
      `localStorage`へ置く（1件ずつではなく、まとめて最大50件）。
      **個人を特定する材料は入れない**——ログインIDと端末名は運用上の
      名乗りなのでそのまま入れるが、入力値そのものは入れない（ロット番号の
      ような業務上の識別子は解析に要るので入れる）。

   §9.578（利用者の指示「問題が発生したときにしっかり分析できるように…さらに高性能でわかりやすく」）:
   ⑥ **書込は全部、土台が控える**（`api()`の1箇所から`request()`）。画面ごとの足あとだけでは、
      別の画面の操作（例: マスタの保存）が報告に出なかった——§9.576 はまさにそれが原因だった。
      本文は**識別子だけ**（`gist()`・鍵の名前と短い値。長い字は字数だけ）。
   ⑦ **失敗した問い合わせそのもの**（方法・宛先・本文の要点・かかった時間）を1通に入れる。
   ⑧ **そのときのサーバーの記録と共有の置き場の状態**を添える（`/api/feedback/context`）。
      取りに行くのは失敗を記録したときの1回（あとから開いても同じ材料）。
   ⑨ 1通の先頭に**要約の1行**（いつ・どこで・何が・何回）。読む人が最初の1行で見当を付けられる。
   ============================================================ */
(function(){
 const KEY='wlFeedbackLogV1';
 const MAX=50;            // 端末に残す件数
 const TRAIL=20;          // 足あと（直前の操作）
 const QUIET=8;           // 添える「静かに見送った失敗」
 const WRITES=15;         // 控える書込（画面を問わず・⑥）
 const GIST_MAX=400;      // 本文の要点の字数の上限
 const CONTEXT_WAIT_MS=3000; // コピーの前にサーバーの記録を待つ上限

 /* ---------- 版（解析の要なので、必ず埋まるようにする） ----------
    起動の覆いの刻印（`#bootVer`＝`VER2.264.0`）は**覆いごとDOMから消える**
    ので、読めるうちに1度だけ控える。消えたあとに開いた画面のために、
    取れなければサーバーへ1回だけ聞いて控える（`/api/build`）。
    **どちらも取れなくても報告は出す**——版が読めないことを理由に、
    報告そのものを止めない。 */
 let ver='';
 function version(){return ver||'（読めません）'}
 function graspVersion(){
  if(ver)return;
  const stamp=((document.getElementById('bootVer')||{}).textContent||'').trim();
  if(stamp){ver=stamp;return}
  fetch('/api/build').then(r=>r.json()).then(j=>{if(j&&j.version)ver='VER'+j.version})
   .catch(WL.quiet('版を聞けない（報告には「読めません」と入る）'));
 }
 graspVersion();
 document.addEventListener('DOMContentLoaded',graspVersion);

 /* ---------- 文脈の登録表（②） ---------- */
 const providers=new Map();
 function provide(name,fn){
  if(!name||typeof fn!=='function')return;
  providers.set(String(name),fn);
 }
 function collect(){
  const out={};
  providers.forEach((fn,name)=>{
   /* **1つが転んでも報告は出す**——文脈が欠けるより、報告が出ないほうが悪い。 */
   try{const v=fn();if(v&&typeof v==='object')out[name]=v}
   catch(e){out[name]={'__読めません':String(e&&e.message||e)}}
  });
  return out;
 }

 /* ---------- 足あと（直前の操作） ---------- */
 const trail=[];
 function step(what,how){
  trail.push({at:Date.now(),what:String(what||''),how:String(how||'')});
  while(trail.length>TRAIL)trail.shift();
 }

 /* ---------- 書込の控え（⑥⑦） ----------
    本文の要点は**識別子だけ**: 鍵の名前が識別子らしい（ID・番号・設備・種類…）短い値はそのまま、
    それ以外の字は字数だけ（メモや自由記述をそのまま報告へ出さない・⑤）。 */
 const ID_KEY=/(id|no|code|kind|op|mode|target|equipment|lot|type|key|設備|番号|種類|区分|対象)$/i;
 function gist(body){
  let v=body;
  if(typeof v==='string'){try{v=JSON.parse(v)}catch(_){return v?`（${v.length}字）`:''}}
  const out=[];
  const walk=(x,path,depth)=>{
   if(out.join(' ').length>GIST_MAX||depth>4)return;
   if(Array.isArray(x)){out.push(`${path}[${x.length}件]`);x.slice(0,3).forEach((y,i)=>walk(y,`${path}[${i}]`,depth+1));return}
   if(x&&typeof x==='object'){Object.keys(x).forEach(k=>walk(x[k],path?`${path}.${k}`:k,depth+1));return}
   if(x==null||x==='')return;
   const leaf=path.split('.').pop().replace(/\[\d+\]$/,'');
   const t=String(x);
   out.push(ID_KEY.test(leaf)&&t.length<=40?`${path}=${t}`:(typeof x==='string'?`${path}（${t.length}字）`:`${path}=${t}`));
  };
  walk(v,'',0);
  const text=out.join(' ');
  return text.length>GIST_MAX?text.slice(0,GIST_MAX)+'…':text;
 }
 const writes=[];
 /* `api()`が書込のたびに1回呼ぶ（成功も失敗も）。戻り値は控えた1件（失敗のErrorへ付ける）。 */
 function request(o){
  const u=String(o.url||'');
  const rec={at:Date.now(),method:String(o.method||'').toUpperCase(),path:u.replace(/^https?:\/\/[^/]+/,'').slice(0,160),
   status:o.status==null?null:o.status,ms:o.ms==null?null:Math.round(o.ms),gist:gist(o.body)};
  writes.push(rec);
  while(writes.length>WRITES)writes.shift();
  return rec;
 }

 /* ---------- そのときのサーバーの記録（⑧） ---------- */
 const pending=new WeakMap();
 function fetchContext(rec){
  const p=fetch(`/api/feedback/context?at=${rec.at}`,{cache:'no-store'})
   .then(r=>r.json()).then(j=>{if(j&&j.ok){rec.server={from:j.from,to:j.to,counts:j.counts,items:j.items,more:j.more,share:j.share};save()}})
   .catch(e=>{rec.server={error:String(e&&e.message||e)};save()});
  pending.set(rec,p);
  return p;
 }
 /* 報告を組む前に呼ぶ。サーバーの記録が届くのを待つ（上限つき・届かなくても報告は出す）。 */
 function ready(rec){
  if(!rec||rec.server)return Promise.resolve(rec);
  const p=pending.get(rec)||fetchContext(rec);
  return Promise.race([p,new Promise(r=>setTimeout(r,CONTEXT_WAIT_MS))]).then(()=>rec);
 }

 /* ---------- 失敗の記録（①） ---------- */
 let log=null;
 function load(){
  if(log)return log;
  try{const raw=JSON.parse(localStorage.getItem(KEY)||'null');log=Array.isArray(raw)?raw:[]}
  catch(e){WL.quiet.note('端末の報告ログを読めない（空から続ける）',e);log=[]}
  return log;
 }
 function save(){
  try{localStorage.setItem(KEY,JSON.stringify(load().slice(-MAX)))}
  catch(e){WL.quiet.note('報告ログを端末へ残せない（この画面のあいだは覚えている）',e)}
 }
 /* `what`＝何をしようとしたか（利用者の言葉）、`err`＝Error、
    `about`＝対象（設備・ID・ロット番号など、解析に要る識別子）。 */
 function note(what,err,about){
  const status=(err&&typeof err.status==='number')?err.status:null;
  /* **失敗そのものを先に足あとへ載せる**（§9.373）。あとから足すと、
     報告に付く足あとが「失敗の1つ手前まで」になり、**肝心の1行が抜ける**
     ——実際にそう書いて、足あとが空の報告が出た。**足あとは必ず失敗で終わる。** */
  step(what,'失敗'+(status?` ${status}`:''));
  const rec={
   at:Date.now(),
   what:String(what||''),
   why:(err&&(err.message||String(err)))||'',
   status,
   code:(err&&err.code)||'',
   about:about&&typeof about==='object'?about:{},
   req:(err&&err.req)||null,
   writes:writes.slice(),
   trail:trail.slice(),
   quiet:(WL.quiet&&WL.quiet.log?WL.quiet.log():[]).slice(-QUIET),
   ctx:collect(),
  };
  load().push(rec);
  while(log.length>MAX)log.shift();
  save();
  fetchContext(rec);
  return rec;
 }

 /* ---------- 1通に組む（③） ---------- */
 const pad=n=>String(n).padStart(2,'0');
 function stamp(ms){
  const d=new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} `
   +`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
 }
 const RULE='--------------------------------------------------';
 function pairs(obj,indent){
  const lines=[];
  Object.keys(obj||{}).forEach(k=>{
   const v=obj[k];
   if(v===null||v===undefined||v==='')return;
   lines.push(`${indent}${k}: ${typeof v==='object'?JSON.stringify(v):String(v)}`);
  });
  return lines;
 }
 /* 同じ失敗が足あとの中で何回あったか（⑨・繰り返すかどうかで疑う所が変わる）。 */
 function repeats(rec){
  const t=rec.trail||[];
  const fails=t.filter(x=>/^失敗/.test(x.how||''));
  return {same:fails.filter(x=>x.what===rec.what).length,fails:fails.length,steps:t.length};
 }
 function summary(rec){
  const env=(rec.ctx||{})['この端末']||{};
  const eq=(rec.about||{})['設備']||'';
  const r=repeats(rec);
  return `要約: ${stamp(rec.at)}${eq?` ${eq}`:''}（${env.モード||'?'}モード・${env.版||'?'}・${env.端末||'?'}）で`
   +`「${rec.what||'不明'}」${rec.status?` HTTP ${rec.status}`:''}${rec.why?` — ${String(rec.why).replace(/[。.]+$/,'')}`:''}`
   +(r.steps?`。直前${r.steps}操作のうち 同じ失敗 ${r.same}回`:'');
 }
 const WORD={error:'エラー',warning:'警告'};
 function serverLines(sv){
  const L=[];
  if(!sv){L.push('  （まだ届いていません・サーバーへ聞けませんでした）');return L}
  if(sv.error){L.push(`  （読めませんでした: ${sv.error}）`);return L}
  const c=sv.counts||{};
  L.push(`  ${sv.from} 〜 ${sv.to}: エラー ${c.error||0}件・警告 ${c.warning||0}件`);
  (sv.items||[]).forEach(g=>{
   L.push(`  [${WORD[g.level]||g.level}] ×${g.count}  ${g.first===g.last?g.last:`${g.first}〜${g.last.slice(11)}`}  [${g.logger}] ${g.text}`);
   /* トレースバックは**最後の4行**（例外の名前と起きた行は末尾にある）。 */
   if(g.level==='error')(g.lines||[]).slice(1).slice(-4).forEach(x=>L.push('      '+x));
  });
  if(sv.more)L.push(`  （ほかに ${sv.more}種類）`);
  return L;
 }
 function shareLines(sh){
  const L=[];
  if(!sh)return L;
  const m=sh.master||{},s=sh.schedule||{};
  if(m.error)L.push(`  共有のマスタ: 読めませんでした（${m.error}）`);
  else L.push(`  共有のマスタ: ${m.shared?'共有に置いている':'この端末に置いている'}・改訂 ${m.revision??'?'}`
   +`${m.pending?`・**書き出せていない変更あり**（${m.pending.at||''} ${m.pending.error||''}）`:'・書き出せていない変更なし'}`
   +`${m.lock&&m.lock.locked?`・錠 ${m.lock.holderLogin||'?'}／${m.lock.holderPc||'?'}`:''}`);
  if(s.error)L.push(`  共有の作業予定: 読めませんでした（${s.error}）`);
  else{
   const lk=s.lock||{},w=s.watch||{};
   L.push(`  共有の作業予定: ${lk.configured===false?'共有なし':`錠 ${lk.locked?`${lk.holderLogin||'?'}／${lk.holderPc||'?'}`:'なし'}`}`
    +`${w.revision!=null?`・改訂 ${w.revision}`:''}${w.lastError?`・最後の失敗 ${w.lastError}`:''}`);
  }
  return L;
 }
 function reportText(rec){
  if(!rec)return '';
  const L=[];
  L.push('WaveLog 不具合報告');
  L.push(summary(rec));
  L.push(`日時: ${stamp(rec.at)}`);
  L.push(RULE);
  L.push(`何をしようとしたか: ${rec.what||'（不明）'}`);
  if(rec.why)L.push(`起きたこと: ${rec.why}`);
  if(rec.status)L.push(`サーバーの返事: HTTP ${rec.status}${rec.code?`（${rec.code}）`:''}`);
  const about=pairs(rec.about,'  ');
  if(about.length){L.push('対象:');about.forEach(x=>L.push(x))}
  if(rec.req){
   const q=rec.req;
   L.push(`失敗した問い合わせ: ${q.method} ${q.path} → ${q.status==null?'返事なし':`HTTP ${q.status}`}${q.ms!=null?`（${q.ms}ms）`:''}`);
   if(q.gist)L.push(`  送った内容の要点: ${q.gist}`);
  }
  if(rec.writes&&rec.writes.length){
   L.push(RULE);
   L.push('直前の書込（画面を問わず・古い順）');
   rec.writes.forEach(w=>L.push(`  ${stamp(w.at)}  ${w.method} ${w.path} → ${w.status==null?'返事なし':w.status}`
    +`${w.ms!=null?` ${w.ms}ms`:''}${w.gist?`  ${w.gist}`:''}`));
  }
  L.push(RULE);
  L.push('そのときのサーバーの記録（失敗の前10分〜後2分の警告とエラー）');
  serverLines(rec.server).forEach(x=>L.push(x));
  const sh=shareLines(rec.server&&rec.server.share);
  if(sh.length){L.push(RULE);L.push('共有の置き場の状態（報告を作ったとき）');sh.forEach(x=>L.push(x))}
  L.push(RULE);
  L.push('そのときの画面の状態');
  Object.keys(rec.ctx||{}).forEach(name=>{
   L.push(`  [${name}]`);
   pairs(rec.ctx[name],'    ').forEach(x=>L.push(x));
  });
  if(rec.trail&&rec.trail.length){
   L.push(RULE);
   L.push('直前の足あと（古い順）');
   rec.trail.forEach(t=>L.push(`  ${stamp(t.at)}  ${t.what}  ${t.how}`));
  }
  if(rec.quiet&&rec.quiet.length){
   L.push(RULE);
   L.push('静かに見送った失敗（画面には出ていないもの）');
   rec.quiet.forEach(q=>L.push(`  ${stamp(q.at)}  ${q.why}${q.err?`  ← ${q.err}`:''}`));
  }
  L.push(RULE);
  L.push('（ここから下は開発が機械で読むぶんです。消さずに一緒に送ってください）');
  /* 機械で読む1行にトレースバックの行は入れない（上の人が読む形にあり、二重にすると1通が倍になる）。 */
  L.push('WLFB1 '+JSON.stringify(rec,(k,v)=>k==='lines'?undefined:v));
  return L.join('\n');
 }

 /* ---------- コピー（④） ---------- */
 async function copyText(text){
  try{
   if(navigator.clipboard&&navigator.clipboard.writeText){
    await navigator.clipboard.writeText(text);return true;
   }
  }catch(e){WL.quiet.note('クリップボードAPIが使えない（隠し欄から複写する）',e)}
  try{
   const ta=document.createElement('textarea');
   ta.value=text;ta.setAttribute('readonly','');
   ta.style.position='fixed';ta.style.left='-2000px';ta.style.top='0';
   document.body.append(ta);ta.select();
   const ok=document.execCommand('copy');ta.remove();return ok;
  }catch(e){WL.quiet.note('複写もできない（窓から手で選んで写せる）',e);return false}
 }
 async function copyLast(){
  const l=load();
  return copyReport(l.length?l[l.length-1]:null);
 }
 async function copyReport(rec){
  await ready(rec);
  const text=reportText(rec);
  if(!text){
   window.showToast&&showToast('報告できる記録がありません','まだ失敗は記録されていません',3000);
   return false;
  }
  const ok=await copyText(text);
  window.showToast&&showToast(ok?'報告用にコピーしました':'コピーできませんでした',
   ok?'メールやチャットへそのまま貼れます（開発が読む形が入っています）'
     :'ブラウザがコピーを許可していません。「ログ・診断」の「報告する」から手で選んで写せます',
   ok?3600:6000);
  return ok;
 }

 /* あとからでも同じ1通を出せる入口（④）は「ログ・診断」の「報告する」の段
    （§9.510）。そちらは画面の失敗に**起動の状況とログのまとめ**も添えて1通に
    するので、ここに2つ目の窓は持たない（同じ役目の物を2つ作らない）。 */
 /* **どの画面でも要る文脈は、この土台が名乗る**（版・端末・ブラウザ）。
    画面ごとに書き写すと、書き忘れた画面の報告だけが材料不足になる。
    版は起動の覆いが持っている（`#appBoot`の刻印）ので、そこから拾う
    ——**取れなくても報告は出す**（空欄にして先へ進む）。 */
 provide('この端末',()=>({
  版:version(),
  端末:(WL.terminal&&WL.terminal.pcName&&WL.terminal.pcName())||'',
  ログイン:(WL.terminal&&WL.terminal.loginId&&WL.terminal.loginId())||'',
  /* モードもDOMの札から読む（`#accessModeLabel`）。**土台に新しい口を
     増やさない**——`WL.terminal`のように公開してよい答えが既にあるものは
     そちらを使い、無いものは画面に出ている字をそのまま写す。 */
  モード:((document.getElementById('accessModeLabel')||{}).textContent||'').trim(),
  画面:`${window.innerWidth}×${window.innerHeight}`,
  表示サイズ:(document.documentElement.dataset||{}).uiSize||'',
  ブラウザ:(navigator.userAgent||'').slice(0,160),
  今:new Date().toString(),
 }));

 WL.feedback={note,provide,step,request,gist,ready,summary,copyLast,copyReport,
              reportText,log:()=>load().slice(),
              clear:()=>{log=[];save()}};
})();
