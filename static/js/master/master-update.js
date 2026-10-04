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
   ============================================================ */
(function(){
 'use strict';
 window.WL=window.WL||{};
 const MB=b=>(Number(b||0)/1048576).toFixed(1)+' MB';
 let busy=false;

 /* 段の骨組み（中身は`refresh()`が埋める）。 */
 function sectionHtml(){
  return `<div class="au" id="appUpdate" aria-live="polite"><p class="au-empty">更新の状態を読んでいます…</p></div>`;
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
  if(!st.versions.length)return `<p class="au-empty">まだ版を置いていません。下の「ZIP から版を置く」で置いてください。</p>`;
  return `<table class="au-table"><thead><tr><th>版</th><th>状態</th><th>置いた日時・人</th><th>元の ZIP</th><th>コミット</th><th class="au-num">中身</th><th></th></tr></thead><tbody>${
   st.versions.map(v=>{
    const state=v.version===rel?'<em class="au-tag is-live">配っている</em>'
     :(v.version===prev?'<em class="au-tag">前に配った</em>':'');
    const act=(st.canRelease&&v.version!==rel)
     ?`<button type="button" class="mm-btn-ghost" data-au-release="${esc(v.version)}">この版を配る</button>`:'';
    return `<tr${v.version===rel?' class="is-live"':''}><td><b>${esc(v.version)}</b>${v.version===st.local?' <small>この PC</small>':''}</td><td>${state}</td>
     <td>${esc(v.placedAt)} ${esc(v.placedBy)}</td><td>${esc(v.source)}</td><td><code>${esc(v.commit||'—')}</code></td>
     <td class="au-num">${v.files} ファイル・${MB(v.bytes)}</td><td>${act}</td></tr>`;
   }).join('')}</tbody></table>`;
 }
 function render(host,st){
  if(!st.reachable){
   host.innerHTML=`<p class="au-where">置き場 <code>${esc(st.dir)}</code></p>
    <div class="au-bad"><b>置き場に届きません。</b>${esc(st.why)}<br>
     ネットワーク（共有フォルダ）に届くか確かめてください。置き場を変えるときは、アプリのフォルダの
     <code>config\\local.json</code> に <code>"update_dir"</code> を書きます。各PCは届かない間、いまの版のまま起動します。</div>`;
   return;
  }
  const put=st.canRelease
   ?`<label class="mm-btn-ghost au-pick"><input type="file" accept=".zip,application/zip" id="auZip" hidden>ZIP から版を置く…</label>
     <small>入るのは ${st.payload.map(esc).join('・')}（db・config は入れません）。同じ版はもう一度置けません。</small>`
   :`<small>版を置く・配る版を決めるのは、開発者・メンテナンス者だけです（この端末は「${esc(st.role)}」）。</small>`;
  host.innerHTML=`<p class="au-where">置き場 <code>${esc(st.dir)}</code> <span class="au-ok">届いています</span></p>
   ${flowHtml(st)}
   <div class="au-put">${put}</div>
   ${rowsHtml(st)}`;
 }
 async function refresh(){
  const host=document.getElementById('appUpdate');if(!host)return;
  try{render(host,await api('/api/app/update'))}
  catch(e){host.innerHTML=`<div class="au-bad">更新の状態を読めません: ${esc(e.message)}</div>`}
 }
 async function publish(file){
  if(busy||!file)return;
  busy=true;
  showToast&&showToast('版を置いています',`${file.name}（${MB(file.size)}）を確かめて置き場へ写しています…`,4000);
  try{
   const r=await fetch('/api/app/update/publish?name='+encodeURIComponent(file.name),
     {method:'POST',headers:{'Content-Type':'application/zip'},body:file});
   const j=await r.json().catch(()=>({error:`置けませんでした（${r.status}）`}));
   if(!r.ok||!j.ok)throw new Error(j.error||`置けませんでした（${r.status}）`);
   showToast&&showToast(`版 ${j.version} を置きました`,`${j.files} ファイル・${MB(j.bytes)}。配るときは一覧の「この版を配る」を押してください。`,6000);
  }catch(e){
   await alertModal({title:'版を置けませんでした',message:e.message});
  }finally{busy=false;refresh()}
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
  const b=ev.target.closest('[data-au-release]');if(!b)return;
  ev.preventDefault();
  try{release(b.dataset.auRelease,await api('/api/app/update'))}
  catch(e){await alertModal({title:'更新の状態を読めません',message:e.message})}
 }
 WL.appUpdate={sectionHtml,refresh,wire};
})();
