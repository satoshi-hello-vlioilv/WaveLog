/* master-update.js: アプリの更新（§9.555、利用者の指示）
   ============================================================
   「更新の仕組みを作りたいです。…バージョンごとのデータをこの場所に保存し、
    アップデートを行う機能を組み込みたいです。」
   選んだ形: ①各PCは手元へ写して動かす ②ZIP を選んで置く ③配る版を指定→起動時に自動

   共通設定の段「アプリの更新」。**判定はサーバー**（`backend/app_update.py`の`status()`）で、
   ここは答えを並べるだけ。並びは作業の順（左→右）——
     ① 版を置く（ZIP）→ ② 配る版を選ぶ → ③ 各PCは次の起動でそろう
   置く・配るは開発者・メンテナンス者だけ（`canRelease`）。できない端末には**ボタンを出さず理由を書く**。
   各PCをそろえるのは窓（`desktop/src/update.rs`）の役目で、この画面からは何も入れ替えない。

   **置いている間は進み具合を出す**（§9.556、利用者の指摘「時間がかかっている間、ユーザーへの反応が
   ないのでわかりにくい」）。共有へ写すのに時間がかかる（数百ファイル・十数MB）。答えはサーバーの
   `progress()`（受け取る→確かめる→写す n/N→仕上げ）で、ここは問い合わせて共通の帯`WL.progress`へ描く。
   置いている最中に×で閉じるときは確かめる（`WL.closeGuard`）。閉じても書きかけは配られず、
   次に開いたときに片付く（`app_update.sweep_partial()`）。
   ============================================================ */
(function(){
 'use strict';
 window.WL=window.WL||{};
 const MB=b=>(Number(b||0)/1048576).toFixed(1)+' MB';
 const POLL_MS=400;
 /* 置いている最中の1本（この画面から送った物、または開き直したときにサーバーが「置いている」と答えた物） */
 let busy=null;
 /* 段ごとの題（何をしているか）。割合が分からない段は棒を往復させる（`WL.progress`）。 */
 const STAGE={
  send:'ZIP を送っています',
  check:'ZIP の中身を確かめています',
  copy:'共有の置き場へ写しています',
  finish:'目録を書いて仕上げています'
 };
 WL.closeGuard&&WL.closeGuard.hold('app-update',()=>busy
  ?'版を置いている最中です。閉じると置きかけの版は配られません（次に開いたときに片付けます）':'');

 /* 段の骨組み（中身は`refresh()`が埋める）。**置き場の欄だけは描き直さない**（打っている途中の字を
    消さない）——共通設定の保存（`[data-pc-field]`）に載り、パス設定マスタの`update_dir`（共有の設定）へ入る（§9.557）。 */
 function sectionHtml(v){
  return `<div class="au-dir"><label class="mm-field au-dir-field"><span>置き場</span>
    <input data-pc-field="update_dir" type="text" value="${esc((v&&v.update_dir)||'')}" autocomplete="off" spellcheck="false"
     placeholder="空欄なら既定の置き場"></label>
    <small class="au-dir-note" id="auDirNote">空欄なら既定の置き場を使います。変えると全PCに効きます（開いている PC は10分以内に控え、次の起動から新しい置き場を見ます）。</small></div>
   <div class="au" id="appUpdate" aria-live="polite"><p class="au-empty">更新の状態を読んでいます…</p></div>`;
 }
 /* 置き場の欄の添え書き: 既定の字・いま効いている置き場の出どころ（共有の設定／既定／この PC だけの上書き）。 */
 const DIR_FROM={shared:'共有の設定',install:'この PC を入れた元の置き場',default:'既定',local:'この PC の config\\local.json（この PC だけの上書き）'};
 function paintDir(st){
  const inp=document.querySelector('[data-pc-field="update_dir"]');
  if(inp&&st.defaultDir)inp.placeholder=`空欄なら既定: ${st.defaultDir}`;
  const note=document.getElementById('auDirNote');
  if(note&&st.dirSource==='local')note.innerHTML='この PC は <code>config\\local.json</code> の <code>update_dir</code> で上書きしています。'
   +'この欄の値は<b>ほかの PC</b>に効きます（この PC は local.json を消すと欄の値を使います）。';
 }
 /* ① → ② → ③ の流れ。いまの値を各段に書く（図と字を結ぶ）。 */
 function flowHtml(st){
  const rel=st.release&&st.release.version;
  const here=st.local;
  const step3=!rel?'配る版が決まるまで、各PCはいまの版のまま'
   :(st.pending?`この PC は次の起動で <b>${esc(here)} → ${esc(rel)}</b> にそろいます`
                :`この PC は配る版（<b>${esc(rel)}</b>）と同じです`);
  return `<ol class="au-flow" aria-label="更新の流れ">
   <li class="au-step"><b>① 版を置く</b><span>${st.versions.length} 版を置いてあります</span>
    <small>GitHub の「Download ZIP」で落とした ZIP を選ぶ</small></li>
   <li class="au-arrow" aria-hidden="true"></li>
   <li class="au-step${rel?' is-set':''}"><b>② 配る版を選ぶ</b><span>${rel?`配る版 <b>${esc(rel)}</b>`:'まだ決めていません'}</span>
    <small>${rel?esc(`${st.release.setAt||''} ${st.release.setBy||''}`.trim())+(st.release.previous?`・前は ${esc(st.release.previous)}`:''):'一覧の「この版を配る」で決める'}</small></li>
   <li class="au-arrow" aria-hidden="true"></li>
   <li class="au-step${st.pending?' is-pending':''}"><b>③ 各PCがそろう</b><span>${step3}</span>
    <small>起動のとき、Python を起こす前にそろえます（db・config は触りません）</small></li>
  </ol>`;
 }
 function rowsHtml(st){
  const rel=st.release&&st.release.version,prev=st.release&&st.release.previous;
  if(!st.versions.length)return `<p class="au-empty">まだ版を置いていません。上の「ZIP から版を置く…」で置いてください。</p>`;
  return `<table class="au-table"><thead><tr><th>版</th><th>状態</th><th>置いた日時・人</th><th>元の ZIP</th><th>コミット</th><th class="au-num">中身</th><th></th></tr></thead><tbody>${
   st.versions.map(v=>{
    const state=v.version===rel?'<em class="au-tag is-live">配っている</em>'
     :(v.version===prev?'<em class="au-tag">前に配った</em>':'');
    const act=(st.canRelease&&!busy&&v.version!==rel)
     ?`<button type="button" class="mm-btn-ghost" data-au-release="${esc(v.version)}">この版を配る</button>`:'';
    return `<tr${v.version===rel?' class="is-live"':''}><td><b>${esc(v.version)}</b>${v.version===st.local?' <small>この PC</small>':''}</td><td>${state}</td>
     <td>${esc(v.placedAt)} ${esc(v.placedBy)}</td><td>${esc(v.source)}</td><td><code>${esc(v.commit||'—')}</code></td>
     <td class="au-num">${v.files} ファイル・${MB(v.bytes)}</td><td>${act}</td></tr>`;
   }).join('')}</tbody></table>`;
 }
 function render(host,st){
  paintDir(st);
  const where=`置き場 <code>${esc(st.dir)}</code> <span class="au-from">（${esc(DIR_FROM[st.dirSource]||'既定')}）</span>`;
  if(!st.reachable){
   host.innerHTML=`<p class="au-where">${where}</p>
    <div class="au-bad"><b>置き場に届きません。</b>${esc(st.why)}<br>
     ネットワーク（共有フォルダ）に届くか確かめてください。置き場は上の「置き場」の欄で変えられます。各PCは届かない間、いまの版のまま起動します。</div>`;
   return;
  }
  const put=busy?progressHtml()
   :st.canRelease
   ?`<label class="mm-btn-ghost au-pick"><input type="file" accept=".zip,application/zip" id="auZip" hidden>ZIP から版を置く…</label>
     <small>入るのは ${st.payload.map(esc).join('・')}（db・config は入れません）。同じ版はもう一度置けません。</small>`
   :`<small>版を置く・配る版を決めるのは、開発者・メンテナンス者だけです（この端末は「${esc(st.role)}」）。</small>`;
  host.innerHTML=`<p class="au-where">${where} <span class="au-ok">届いています</span></p>
   ${flowHtml(st)}
   ${entryHtml(st)}
   <div class="au-put${busy?' is-busy':''}">${put}</div>
   ${rowsHtml(st)}`;
 }
 /* 新しい PC へ渡すもの（§9.559、利用者の指示「初回に配布する際に、ショートカット(アドレス)だけ渡す」）。
    配る入口のアドレスと、初回に写る共有のマスタの置き場。どちらも配る版を決めたときにサーバーが置く。 */
 function entryHtml(st){
  const e=st.entry;
  if(!e)return '';
  if(!e.exists)return `<p class="au-new"><b>新しい PC へ</b><span>配る版を決めると、ここに渡すアドレスが出ます（置き場の直下に入口の exe を置きます）。</span></p>`;
  const seed=e.seed&&e.seed.master_db_path
   ?`初回に写る共有のマスタ: <code>${esc(e.seed.master_db_path)}</code>`
   :'<em class="au-warn">共有のマスタの置き場をまだ渡していません。config\\local.json に master_db_path を持つ PC で「この版を配る」を押してください。</em>';
  return `<p class="au-new"><b>新しい PC へ</b><span>このアドレスを渡し、ダブルクリックしてもらいます: <code>${esc(e.path)}</code>
   <button type="button" class="mm-btn-ghost" data-au-copy="${esc(e.path)}">アドレスをコピー</button><br><small>${seed}。アプリは %USERPROFILE%\\WaveLog へ写り、デスクトップの起動アイコンは作るかを聞きます。</small></span></p>`;
 }
 async function refresh(){
  const host=document.getElementById('appUpdate');if(!host)return;
  try{
   const st=await api('/api/app/update');
   /* 開き直したとき、この PC がまだ置いている最中なら進み具合へ戻る（送った人の画面が消えても続いている） */
   if(st.publishing&&!busy){busy={name:'',size:0,stage:'check'};watch()}
   render(host,st);paintProgress();
  }catch(e){host.innerHTML=`<div class="au-bad">更新の状態を読めません: ${esc(e.message)}</div>`}
 }
 /* ---- 置いている間の進み具合（共通の帯`WL.progress`） ---- */
 function progressHtml(){
  return WL.progress.html({cls:'au-progress',title:STAGE.send})
   +`<small class="au-progress-note">置き終わるまで、この画面のままお待ちください。途中で閉じても、置きかけの版は配られません。</small>`;
 }
 /* 押したその場で帯へ替える（状態を取り直してから描くと、共有に届くかの確かめのぶん反応が遅れる）。
    置いている間は「この版を配る」も伏せる（置き終わってから選ぶ）。 */
 function showBusy(){
  const put=document.querySelector('#appUpdate .au-put');
  if(put){put.classList.add('is-busy');put.innerHTML=progressHtml()}
  document.querySelectorAll('#appUpdate [data-au-release]').forEach(b=>b.remove());
  paintProgress();
 }
 function paintProgress(){
  const root=document.querySelector('#appUpdate .au-progress');if(!root||!busy)return;
  /* 送っている間は前の回の答え（終わった回の段・経過）を読まない */
  const p=busy.stage==='send'?{}:(busy.p||{});
  const stage=busy.stage==='send'?'send':(p.stage||'check');
  const secs=p.elapsed!=null?`・経過 ${Math.round(p.elapsed)} 秒`:'';
  const what=busy.name?`${busy.name}（${MB(busy.size)}）`:'';
  let pct=null,meta=what;
  if(stage==='copy'&&p.totalBytes){
   pct=p.bytes/p.totalBytes*100;
   meta=`${p.version?'版 '+p.version+'・':''}${p.done||0} / ${p.total||0} ファイル・${MB(p.bytes)} / ${MB(p.totalBytes)}${secs}`;
  }else if(stage==='finish'){pct=100;meta=`${p.version?'版 '+p.version+'・':''}${p.total||0} ファイルを写しました${secs}`}
  else if(secs)meta=(what?what:'')+secs;
  WL.progress.paint(root,{title:STAGE[stage]||STAGE.check,pct,meta});
 }
 let timer=0;
 function watch(){
  clearTimeout(timer);
  const tick=async()=>{
   if(!busy)return;
   try{
    const p=await api('/api/app/update/progress',{quiet:true});
    if(busy){busy.p=p;if(p.state==='running'&&busy.stage==='send')busy.stage='server';paintProgress()}
    /* 送った画面が答えを受け取るのを待つ。開き直した画面（送っていない）は、終わったら描き直す */
    if(p.state!=='running'&&busy&&!busy.mine){busy=null;refresh();return}
   }catch(e){WL.quiet.note('進み具合を読めない（次の問い合わせで読み直す）',e)}
   timer=setTimeout(tick,POLL_MS);
  };
  timer=setTimeout(tick,POLL_MS);
 }
 async function publish(file){
  if(busy||!file)return;
  busy={name:file.name,size:file.size,stage:'send',mine:true};
  showBusy();watch();
  try{
   const r=await fetch('/api/app/update/publish?name='+encodeURIComponent(file.name),
     {method:'POST',headers:{'Content-Type':'application/zip'},body:file});
   const j=await r.json().catch(()=>({error:`置けませんでした（${r.status}）`}));
   if(!r.ok||!j.ok)throw new Error(j.error||`置けませんでした（${r.status}）`);
   showToast&&showToast(`版 ${j.version} を置きました`,`${j.files} ファイル・${MB(j.bytes)}。配るときは一覧の「この版を配る」を押してください。`,6000);
  }catch(e){
   await alertModal({title:'版を置けませんでした',message:e.message});
  }finally{busy=null;clearTimeout(timer);refresh()}
 }
 async function release(version,st){
  const cur=st.release&&st.release.version;
  const ok=await confirmModal({title:`版 ${version} を配りますか？`,
   message:`全PCが次の起動で ${version} にそろいます${cur?`（いま配っている版は ${cur}）`:''}。\n`
     +'起動中のPCは、閉じて開き直したときにそろいます。前の版へ戻すときも、ここで選び直すだけです。'});
  if(!ok)return;
  try{
   const j=await api('/api/app/update/release',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version})});
   showToast&&showToast(`配る版を ${j.version} にしました`,'各PCは次の起動でそろいます。',5000);
   /* 配る版は決まったが、新しい PC へ渡すもの（入口・設定）が置けなかったときは理由を言う */
   if(j.notes&&j.notes.length)await alertModal({title:'新しい PC へ渡すものに注意があります',message:j.notes.join('\n')});
  }catch(e){await alertModal({title:'配る版を決められませんでした',message:e.message})}
  refresh();
 }
 /* 配線は器に1回（委譲）。中身は描き直しても器は同じ。 */
 function wire(form){
  form.addEventListener('change',onChange);
  form.addEventListener('click',onClick);
 }
 function onChange(ev){
  if(ev.target&&ev.target.id==='auZip'){publish(ev.target.files&&ev.target.files[0]);ev.target.value=''}
 }
 async function onClick(ev){
  const cp=ev.target.closest('[data-au-copy]');
  if(cp){ev.preventDefault();WL.base.copyText(cp.dataset.auCopy).then(()=>showToast&&showToast('アドレスをコピーしました',cp.dataset.auCopy,3600));return}
  const b=ev.target.closest('[data-au-release]');if(!b)return;
  ev.preventDefault();
  try{release(b.dataset.auRelease,await api('/api/app/update'))}
  catch(e){await alertModal({title:'更新の状態を読めません',message:e.message})}
 }
 WL.appUpdate={sectionHtml,refresh,wire};
})();
