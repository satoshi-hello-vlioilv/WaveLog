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

   **版を消す**（§9.584、利用者の指示「版を消すこともできるように」）。消すのは「版を整理する」を押した
   **整理中だけ**——ふだんの表の行には「この版を配る」だけを置き、取り消せない「消す」を主要動線に並べない
   （§CLAUDE 5）。整理中は「この版を配る」を伏せ、配っている版の行には消せない理由を字で書く。表の頭は
   置いてある版の数と合計の量を言う（消す前に、どれだけ溜まっているかが見える）。配っている版を断るのは
   サーバー（`app_update.delete_version()`）。
   ============================================================ */
(function(){
 'use strict';
 window.WL=window.WL||{};
 const MB=b=>(Number(b||0)/1048576).toFixed(1)+' MB';
 const POLL_MS=400;
 /* 置いている最中の1本（この画面から送った物、または開き直したときにサーバーが「置いている」と答えた物） */
 let busy=null;
 /* 整理中か（「版を整理する」を押した間だけ、行に「消す…」を出す）。消せる版が無くなったら自分で終える。 */
 let tidy=false;
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
 function sectionHtml(v,K){
  /* 1行＝名前｜欄｜状態（共通設定の他の段と同じ部品・§9.583）。説明は ⓘ。届くかは欄の右（状態の席）で
     言う（`paintDir()`）。道の字を欄の下にもう一度書かない（§CLAUDE 8）。 */
  return `<div class="pc-rows au-col">${K.row('update_dir','版の置き場',K.path('update_dir','dir','空欄なら既定の置き場'),{state:'<span class="pc-when">確かめています…</span>',
    tip:'空欄なら既定の置き場を使います。**変えると全PCに効きます**（開いている PC は10分以内に控え、次の起動から新しい置き場を見ます）。'})}</div>
   <p class="au-dir-note au-col" id="auDirNote" hidden></p>
   <div class="au au-col" id="appUpdate" aria-live="polite"><p class="au-empty">更新の状態を読んでいます…</p></div>`;
 }
 /* 置き場の欄の添え書き: 既定の字・いま効いている置き場の出どころ（共有の設定／既定／この PC だけの上書き）。 */
 const DIR_FROM={shared:'共有の設定',install:'この PC を入れた元の置き場',default:'既定',local:'この PC の config\\local.json（この PC だけの上書き）'};
 function paintDir(st){
  /* いま見ている置き場は空欄の欄の薄い字が言う（下にもう1行足さない・§9.610）。書いてあればその字が答え。 */
  const inp=/** @type {HTMLInputElement|null} */(document.querySelector('[data-pc-field="update_dir"]'));
  if(inp&&st.dir)inp.placeholder=st.dirSource==='local'||st.dirSource==='default'||!st.dirSource
   ?`空欄なら既定: ${st.defaultDir||st.dir}`:`空欄 → ${st.dir}（${DIR_FROM[st.dirSource]}）`;
  const cell=document.querySelector('[data-pc-state="update_dir"]');
  if(cell){
   cell.innerHTML=st.reachable?'<span class="pc-chip is-ok">届いています</span>':'<span class="pc-chip is-bad">届きません</span>';
   cell.title=`いま見ている置き場: ${st.dir||''}（${DIR_FROM[st.dirSource]||'既定'}）`;
  }
  /* この PC だけの上書きがあるときだけ言う（**欄の値がこの PC に効いていない**——知らないと直したのに変わらない）。 */
  const note=document.getElementById('auDirNote');
  if(note){
   note.hidden=st.dirSource!=='local';
   if(!note.hidden)note.innerHTML='この PC は <code>config\\local.json</code> の <code>update_dir</code> で上書きしています。'
    +'この欄の値は<b>ほかの PC</b>に効きます（この PC は local.json を消すと欄の値を使います）。';
  }
 }
 /* 札の一言（§9.583）。**段が自分で名乗る**——配る版・この PC が次の起動でそろうか・届くか。 */
 function paintTab(st){
  const panel=document.getElementById('appUpdate')&&document.getElementById('appUpdate').closest('.mm-tabpanel');
  const form=panel&&panel.closest('form');if(!panel)return;
  const rel=st&&st.release&&st.release.version;
  panel.dataset.tabSum=!st?'状態を読めません':!st.reachable?'置き場に届きません':(rel?`配る版 ${rel}`:'配る版 未定')+(st.pending?'・次の起動で更新':'');
  const bad=!st||!st.reachable;
  if(bad){panel.dataset.tabBadge='!';panel.dataset.tabTone='bad';panel.dataset.tabBadgeTitle='要対応 更新の置き場に届きません'}
  else{delete panel.dataset.tabBadge;delete panel.dataset.tabTone;delete panel.dataset.tabBadgeTitle}
  /* 左の一覧の状態の札（§9.598 1h）。配る版が未定なのは「決めること」（橙）。次の起動でそろう「更新待ち」は
     待てば済むので中立（§9.609・琥珀は推奨の更新の色に取っておく）。 */
  panel.dataset.tabState=!st?'読めません':!st.reachable?'届きません':!rel?'未定':(st.pending?'更新待ち':'正常');
  panel.dataset.tabStateTone=bad?'bad':!rel?'warn':'';
  if(form&&typeof form.__mmPaintTabs==='function')form.__mmPaintTabs();
 }
 /* ① → ② → ③ と新しい PC は「1行＝名前｜値」（共通設定のほかの段と同じ形・§9.610、E の手順で選んだ V1）。数はここと表の頭で
    1回ずつ（この PC の版は表の札だけが言う）。説明の文は ⓘ へ畳み、本文には値と次の一手だけを置く。 */
 const tip=t=>WL.mm.tipHtml(t);   /* ⓘ は共通の1つ（`WL.popMenu.tips()`・§9.583） */
 const lineHtml=(k,body)=>`<div class="au-row"><b>${k}</b><span>${body}</span></div>`;
 function stepsHtml(st){
  const rel=st.release&&st.release.version;
  const put=busy?'<small>置いています（下の表の先頭の行）</small>'
   :st.canRelease?`<label class="au-btn au-pick"><input type="file" accept=".zip,application/zip" id="auZip" hidden><i class="fa-solid fa-file-zipper" aria-hidden="true"></i>ZIP から版を置く</label>`
     +`<small>GitHub の「Download ZIP」で落とした ZIP</small>${tip(`入るのは ${st.payload.join('・')} です（db・config は入れません）。同じ版はもう一度置けません。`)}`
   :`<small>版を置く・配るのは開発者・メンテナンス者だけです（この端末は「${esc(st.role)}」）</small>`;
  const give=rel?howHtml(st):'<small>配る版をまだ決めていません。下の表の「この版を配る」で決めます</small>';
  const sp=rel&&st.spread&&st.spread.total>0?`<small class="au-nw">古い版の PC ${Number(st.spread.behind)}台 / ${Number(st.spread.total)}台</small>`:'';
  const each=rel?`次の起動で配る版にそろう${sp}${tip('起動のとき、アプリを起こす前に配る版へそろえます。データ（db）と設定（config）はそのままです。台数は接続の記録から数えます（開発者の端末は数えません）。')}`
   :'<small>配る版が決まるまで、各 PC はいまの版のまま</small>';
  return `<div class="au-rows">${lineHtml('① 版を置く',put)}${lineHtml(rel?'② 配り方':'② 配る版',give)}${lineHtml('③ 各 PC',each)}${entryHtml(st)}</div>`;
 }
 /* 配り方（通常｜★ 推奨の更新）。**区別の意味を札の字そのものが言う**（利用者の指示「通常の更新として配る場合は控えめな通知も
    出ない、推奨の更新の場合は通知が出る」）。部品は2〜4択の`.mm-seg`。押すと付け外し（付けるときは知らせに添える一言を聞く）。
    変えられない端末・置いている最中は押せない形。 */
 function howHtml(st){
  const rel=st.release.version,on=!!(st.versions.find(v=>v.version===rel)||{}).recommend;
  const say='通常＝知らせず、各 PC は次の起動でそろいます。★ 推奨の更新＝あわせて、古い版で使っている PC のヘッダーに控えめな札を出します（押すと開き直して更新）。';
  const b=(k,label,sub)=>`<button type="button" role="radio" aria-checked="${k===on}"${k===on?' class="is-on"':''} data-au-recommend="${esc(rel)}" data-au-on="${k?1:0}"`
   +`${!st.canRelease||busy?' disabled':''}>${label}<small>${sub}</small></button>`;
  return `<span class="mm-seg au-how" role="radiogroup" aria-label="配り方">${b(false,'通常','知らせない')}${b(true,'★ 推奨の更新','使っている PC に知らせる')}</span>${tip(say)}`;
 }
 /* 消せる版（配っている版のほかの全部）。整理の入口を出すか・整理を終えるかはこの答えから決める。 */
 const deletable=st=>st.versions.filter(v=>v.version!==(st.release&&st.release.version));
 const sumBytes=vs=>vs.reduce((n,v)=>n+Number(v.bytes||0),0);
 /* 版を数として比べる（サーバーの`version_key()`と同じ読み方）。 */
 const vkey=v=>String(v||'').split(/[.-]/).map(x=>/^\d+$/.test(x)?Number(x):0);
 const vcmp=(a,b)=>{const x=vkey(a),y=vkey(b);for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d)return d}return 0};
 /* 状態の札（淡い地に濃い字・字で言う）。並びは 配っている → 前に配った → 推奨 → この PC。 */
 const chip=(t,c,title)=>`<span class="au-chip ${c}"${title?` title="${esc(title)}"`:''}>${t}</span>`;
 function tagsHtml(v,st){
  const rel=st.release&&st.release.version,prev=st.release&&st.release.previous,r=v.recommend;
  return [v.version===rel?chip('配っている','is-live'):'',v.version===prev?chip('前に配った','is-prev'):'',
   r&&v.version!==rel?chip('★ 推奨の更新','is-rec',`推奨の更新（${r.setAt||''} ${r.setBy||''}）${r.note?'：'+r.note:''}`):'',
   v.version===st.local?chip('この PC','is-me'):''].join('');
 }
 /* 行の操作。新しい版は塗りの「この版を配る」、古い版は縁取りの「この版に戻す」（LotScope と同じ言い分け）。
    どちらも ▾ で「推奨の更新として配る」を選べる。配っている版の行は操作を持たない（配り方は②の切り替え）。 */
 function actHtml(v,st){
  const rel=st.release&&st.release.version;
  if(tidy)return v.version===rel?'<span class="au-muted">配っている版は消せません</span>'
   :`<button type="button" class="au-btn au-del" data-au-delete="${esc(v.version)}">消す…</button>`;
  if(!st.canRelease||busy||v.version===rel)return '';
  const up=!rel||vcmp(v.version,rel)>0;
  return `<span class="au-split"><button type="button" class="au-btn${up?' is-go':''}" data-au-release="${esc(v.version)}">${up?'この版を配る':'この版に戻す'}</button>`
   +`<button type="button" class="au-btn${up?' is-go':''} au-more" data-au-more="${esc(v.version)}" aria-haspopup="menu" title="配り方を選ぶ">▾</button></span>`;
 }
 /* 置いている版の行（表の先頭・進み具合は共通の帯`WL.progress`を行の中で横1列に）。 */
 const busyRowHtml=()=>`<tr class="au-busy"><td class="au-ver" id="auBusyVer">—</td><td colspan="4">${WL.progress.html({cls:'au-progress',title:STAGE.send})}</td>`
  +'<td class="au-act"><small class="au-muted">置き終わると配れます</small></td></tr>';
 function rowsHtml(st){
  const rel=st.release&&st.release.version;
  const free=deletable(st),canTidy=st.canRelease&&free.length>0;
  if(!canTidy||busy)tidy=false;
  /* 整理の入口は置いている最中も場所を残す（押せない形・表を動かさない）。 */
  const tidyBtn=canTidy?`<button type="button" class="au-btn au-ghost" data-au-tidy${busy?' disabled title="置き終わってから整理できます"':''}>${tidy?'整理を終える':'版を整理する…'}</button>`:'';
  const head=`<div class="au-list-head"><b>置いてある版</b><small>${st.versions.length} 版・${MB(sumBytes(st.versions))}</small>${
   tidy?`<small class="au-tidy-note">整理中: 消す版の「消す…」を押します（消せるのは ${free.length} 版・${MB(sumBytes(free))}）</small>`:''}<span class="au-sp"></span>${tidyBtn}</div>`;
  if(!st.versions.length&&!busy)return `${head}<p class="au-empty">まだ版を置いていません。上の「ZIP から版を置く」で置きます。</p>`;
  return `${head}<div class="au-wrap"><table class="au-table"><colgroup><col class="au-c-ver"><col><col class="au-c-at"><col class="au-c-zip"><col class="au-c-mb"><col class="au-c-act"></colgroup>`
   +`<thead><tr><th>版</th><th>状態</th><th>置いた日時・人</th><th>元の ZIP</th><th class="au-num">大きさ</th><th></th></tr></thead><tbody>${busy?busyRowHtml():''}${
   st.versions.map(v=>`<tr${v.version===rel?' class="is-live"':''}><td class="au-ver" title="${esc(`コミット ${v.commit||'—'}・${v.files} ファイル`)}">${esc(v.version)}</td>
     <td><span class="au-tags">${tagsHtml(v,st)}</span></td>
     <td>${esc(v.placedAt)}<span class="au-by">${esc(v.placedBy)}</span></td><td class="au-mono">${esc(v.source)}</td>
     <td class="au-num">${MB(v.bytes)}</td><td class="au-act">${actHtml(v,st)}</td></tr>`).join('')}</tbody></table></div>`;
 }
 let last=null;   /* 最後に描いた状態（置き始めたその場で描き直すため） */
 function render(host,st){
  last=st;paintDir(st);
  if(!st.reachable){
   host.innerHTML=`<div class="au-bad"><b>置き場に届きません。</b>${esc(st.why)}<br>
     ネットワーク（共有フォルダ）に届くか確かめてください。置き場は上の「版の置き場」の欄で変えられます。各PCは届かない間、いまの版のまま起動します。</div>`;
   return;
  }
  host.innerHTML=stepsHtml(st)+rowsHtml(st);
 }
 /* 新しい PC へ渡すもの（§9.559、利用者の指示「初回に配布する際に、ショートカット(アドレス)だけ渡す」）。
    配る入口のアドレスと、初回に写る共有のマスタの置き場。どちらも配る版を決めたときにサーバーが置く。
    行は「アドレス＋コピー」だけ、渡し方と初回に写る物は ⓘ（§9.610）。渡していない物があるときだけ字で言う。 */
 function entryHtml(st){
  const e=st.entry;
  if(!e)return '';
  if(!e.exists)return lineHtml('新しい PC へ','<small>配る版を決めると、渡すアドレス（置き場の直下の入口の exe）が出ます</small>');
  const seed=e.seed&&e.seed.master_db_path;
  const say=`このアドレスだけを渡し、ダブルクリックしてもらいます。アプリは %USERPROFILE%\\WaveLog へ写り、デスクトップの起動アイコンは作るかを聞きます。`
   +(seed?`初回に写る共有のマスタ: ${seed}`:'');
  return lineHtml('新しい PC へ',`<code class="au-path">${esc(e.path)}</code><button type="button" class="au-btn au-ghost au-sm" data-au-copy="${esc(e.path)}">コピー</button>${tip(say)}`
   +(seed?'':'<em class="au-warn">共有のマスタの置き場をまだ渡していません</em>'+tip('config\\local.json に master_db_path を持つ PC で「この版を配る」を押すと渡せます。')));
 }
 /* 状態＋古い版の PC の台数（数えるのは接続の記録・§9.609）。台数が読めない（区分で断られた・記録が無い）
    ときは`spread`を空のまま描く（台数を言わない・0台と言わない）。 */
 async function loadState(){
  const st=await api('/api/app/update');
  st.spread=null;
  if(st.release&&st.release.version){
   try{st.spread=(await api('/api/presence/release-spread?version='+encodeURIComponent(st.release.version))).spread||null}
   catch(e){WL.quiet.note('古い版の端末を数えられない（台数を出さない）',e)}
  }
  return st;
 }
 async function refresh(){
  const host=document.getElementById('appUpdate');if(!host)return;
  try{
   const st=await loadState();
   /* 開き直したとき、この PC がまだ置いている最中なら進み具合へ戻る（送った人の画面が消えても続いている） */
   if(st.publishing&&!busy){busy={name:'',size:0,stage:'check'};watch()}
   render(host,st);paintProgress();paintTab(st);
  }catch(e){host.innerHTML=`<div class="au-bad">更新の状態を読めません: ${esc(e.message)}</div>`;paintTab(null)}
 }
 /* ---- 置いている間の進み具合（表の先頭の行・共通の帯`WL.progress`） ----
    押したその場で描き直す（状態を取り直してから描くと、共有に届くかの確かめのぶん反応が遅れる）。
    置いている間は配る・戻す・配り方・整理を押せない（表と行の場所は動かさない）。 */
 function showBusy(){
  const host=document.getElementById('appUpdate');
  if(host&&last)render(host,last);
  paintProgress();
 }
 function paintProgress(){
  const root=document.querySelector('#appUpdate .au-progress');if(!root||!busy)return;   /* 版の番号は行の頭（#auBusyVer）が言う */
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
  WL.progress.paint(root,{title:STAGE[stage]||STAGE.check,pct,meta:meta.replace(/^版 [^・]+・/,'')});
  const ver=document.getElementById('auBusyVer');if(ver)ver.textContent=p.version||'—';
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
  const cur=st.release&&st.release.version,up=!cur||vcmp(version,cur)>0;
  const ok=await confirmModal({confirmLabel:up?'配る':'戻す',title:up?`版 ${version} を配りますか？`:`配る版を ${version} に戻しますか？`,
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
 /* 推奨の更新の札（§9.609、利用者の指示「配布する版に推奨アップデートの札を付けられるように」）。
    札のある版を配っていると、古い版で使っている PC に「開き直して更新」を控えめに知らせる（判定はサーバーの
    `notice_of()`）。付けるときは知らせに添える一言を聞く（なぜ更新してほしいか）。外すのは1手（取り返せる）。 */
 const post=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const behindWord=st=>st.spread&&st.spread.total>0?`古い版で使っている PC（${st.spread.behind}台）`:'古い版で使っている PC';
 const askNote=(title,message,label)=>promptModal({title,message,label:'知らせに添える一言（任意）',maxLength:80,
  placeholder:'例: 測定表の公差の図のずれを直しました',hint:'使っている人の知らせにそのまま出ます（80字まで）。',confirmLabel:label});
 async function recommend(version,on,st){
  try{
   if(!on){
    await post('/api/app/update/recommend',{version,on:false,note:''});
    showToast&&showToast(`版 ${version} の推奨を外しました`,'使っている PC への知らせは次のハートビート（1分以内）で消えます。',5000);
    return refresh();
   }
   const note=await askNote(`版 ${version} を推奨の更新にしますか？`,
    `${behindWord(st)}に、画面の上の札で「開き直して更新」を控えめに知らせます。作業は止めません。`,'推奨にする');
   if(note===null)return;
   await post('/api/app/update/recommend',{version,on:true,note});
   showToast&&showToast(`版 ${version} を推奨の更新にしました`,'使っている PC には1分以内に知らせが出ます。',5000);
  }catch(e){await alertModal({title:'推奨の札を変えられませんでした',message:e.message})}
  refresh();
 }
 /* 「推奨の更新として配る」＝配る版を決めて、同じ版に推奨の札を付ける（1回の確かめで2つ）。 */
 async function releaseRecommended(version,st){
  const cur=st.release&&st.release.version;
  const note=await askNote(`版 ${version} を推奨の更新として配りますか？`,
   `全PCが次の起動で ${version} にそろいます${cur?`（いま配っている版は ${cur}）`:''}。\n`
    +`あわせて${behindWord(st)}に、画面の上の札で「開き直して更新」を控えめに知らせます。`,'推奨として配る');
  if(note===null)return;
  try{
   const j=await post('/api/app/update/release',{version});
   await post('/api/app/update/recommend',{version,on:true,note});
   showToast&&showToast(`版 ${j.version} を推奨の更新として配りました`,'使っている PC には1分以内に知らせが出ます。',5000);
   if(j.notes&&j.notes.length)await alertModal({title:'新しい PC へ渡すものに注意があります',message:j.notes.join('\n')});
  }catch(e){await alertModal({title:'配る版を決められませんでした',message:e.message})}
  refresh();
 }
 /* ▾ の配り方の面（器は`.wl-menu`の1つ・置き方と閉じ方は`WL.popMenu`・§9.448）。 */
 function openMore(btn,version,st){
  const up=!(st.release&&st.release.version)||vcmp(version,st.release.version)>0;
  const el=document.createElement('div');
  el.className='wl-menu au-menu';
  el.innerHTML=`<button type="button" data-au-pick="plain"><b>${up?'この版を配る':'この版に戻す'}</b><small>次の起動でそろう（知らせない）</small></button>`
   +`<button type="button" data-au-pick="rec"><b>★ 推奨の更新として配る</b><small>使っている PC に「開き直して更新」を知らせる</small></button>`;
  document.body.append(el);
  btn.setAttribute('aria-expanded','true');
  el.addEventListener('click',e=>{const k=e.target.closest('[data-au-pick]');if(!k)return;
   WL.popMenu.close();(k.dataset.auPick==='rec'?releaseRecommended:release)(version,st)});
  WL.popMenu.open(el,{anchor:btn,owner:btn,onClose:()=>{el.remove();btn.setAttribute('aria-expanded','false')}});
 }
 /* 版を消す（§9.584）。何が消え・何が残り・戻す道はあるかを先に言ってから聞く（取り消せない）。 */
 async function remove(version,st){
  const v=st.versions.find(x=>x.version===version);if(!v)return refresh();
  const prev=st.release&&st.release.previous;
  const why=[`置き場から版 ${version}（${v.files} ファイル・${MB(v.bytes)}）を消します。取り消せません。`,
   version===prev?'前に配った版です。消すと、ここで選び直してこの版へ戻すことはできなくなります。':'',
   version===st.local?'この PC はこの版で動いていますが、手元の写しで動いているので、消しても動き続けます。':'',
   '各 PC の手元の版には触りません。同じ版の ZIP をもう一度置けば戻せます。'].filter(Boolean);
  const ok=await confirmModal({title:`版 ${version} を消しますか？`,message:why.join('\n'),confirmLabel:'削除する',danger:true});
  if(!ok)return;
  try{
   const j=await api('/api/app/update/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version})});
   showToast&&showToast(`版 ${j.version} を消しました`,`置き場が ${MB(j.bytes)} 空きました。`,5000);
   if(j.notes&&j.notes.length)await alertModal({title:'消した版に注意があります',message:j.notes.join('\n')});
  }catch(e){await alertModal({title:'版を消せませんでした',message:e.message})}
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
  if(ev.target.closest('[data-au-tidy]')){ev.preventDefault();tidy=!tidy;refresh();return}
  const d=ev.target.closest('[data-au-delete]'),m=ev.target.closest('[data-au-more]'),r=ev.target.closest('[data-au-recommend]');
  if(r&&(r.classList.contains('is-on')||r.disabled))return;   /* いまの配り方を押し直しても何も変えない */
  const b=d||m||r||ev.target.closest('[data-au-release]');if(!b)return;
  ev.preventDefault();
  /* 押した時点の状態で確かめる（表を描いたあとに別の PC が配る版を変えているかもしれない） */
  try{const st=await loadState();
   if(d)remove(d.dataset.auDelete,st);
   else if(m)openMore(m,m.dataset.auMore,st);
   else if(r)recommend(r.dataset.auRecommend,r.dataset.auOn==='1',st);
   else release(b.dataset.auRelease,st)}
  catch(e){await alertModal({title:'更新の状態を読めません',message:e.message})}
 }
 WL.appUpdate={sectionHtml,refresh,wire};
})();
