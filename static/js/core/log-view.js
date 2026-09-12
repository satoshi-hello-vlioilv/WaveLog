"use strict";
/* log-view.js: ログ・診断（ログビュワー）
   ============================================================
   何のための画面か
   ------------------------------------------------------------
   「起動しない」「一覧が出ない」「固まった」と言われたとき、調べる材料は
   %LOCALAPPDATA%\WaveLog\logs にある。**現場の端末では誰もそこを開かない**
   ので、アプリの中から読める場所を用意する。

   読ませ方の方針（この画面が守っていること）
   ------------------------------------------------------------
   1. **1行ではなく1件で扱う。** トレースバックは日時を持たない行が何行も
      続くので、サーバー側(backend/routes/logs.py)が直前の件へ畳んでいる。
      画面でも「＋N行」で開き、コピー・削除も畳んだぶんごと動かす。
      見出しだけ消えて中身が残る、が起きない。
   2. **起動セッションでまとめる。** 知りたいのは「その起動のとき何が
      起きたか」で、これは launcher.log と app.log にまたがる。サーバーが
      1本の時間軸へ並べたものを、`--- 起動 ---` の位置で切って畳む。
      **最新の起動が上**で、最初から開いている(いま困っていることが多い)。
   3. **絞り込みはサーバーだけが持つ。** 画面側にも同じ判定を置くと、
      片方だけ直した状態が作れる。条件を変えたら取り直す(ログは1MB級なので
      往復してよい)。検索は打ち終わってから1回だけ投げる。
   4. **消す操作は必ず確認する。** ログは消えると二度と戻らない。

   書き方の約束（§9.96 / tests/test_globallint.js の対象）
   ------------------------------------------------------------
   新しく足すファイルなので、**素のグローバルを1つも作らない**。関数は
   すべてIIFEの中の`const`で、外へ出すのは`WL.logView`だけ。
   ============================================================ */
(function(){
 if(typeof $!=='function')return;
 const $id=id=>document.getElementById(id);
 const LEVELS=[['all','すべて'],['problem','警告とエラー'],['error','エラー'],
               ['warning','警告'],['info','情報']];
 const DAYS=[['0','すべて'],['1','今日から1日'],['3','3日'],['7','7日'],['30','30日']];
 const LIMITS=['500','1500','3000','5000'];
 const SRC_LABEL={app:'本体',launcher:'起動'};
 const AUTO_MS=5000;

 const state={files:[],records:[],groups:[],picked:new Set(),
              auto:false,timer:0,loading:false,info:null};

 const currentFile=()=>$id('lgFile')?.value||'app.log';
 const debounce=(fn,ms)=>{
  if(!ms)return fn;
  let t=0;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)};
 };

 /* ---------- 起動セッションでまとめる ----------
    `--- 起動 ---`(launcher.logのlog_environment)で切る。最初の起動より前に
    あった件は「これより前」としてまとめる——捨てない(古い世代のログを
    開いたときは、区切りが1つも無いことがある)。 */
 const groupByBoot=records=>{
  const groups=[];let cur=null;
  records.forEach(r=>{
   if(r.boot||!cur){cur={boot:!!r.boot,at:r.ts||'',records:[]};groups.push(cur)}
   cur.records.push(r);
  });
  groups.forEach((g,i)=>{g.no=i+1});
  return groups.reverse();          // 最新の起動を上に
 };

 /* ---------- コピー ---------- */
 const fallbackCopy=(text,done)=>{
  const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
  document.body.append(ta);ta.select();
  try{document.execCommand('copy');done()}
  catch(e){showToast('コピーできませんでした','手動で選択してコピーしてください。')}
  finally{ta.remove()}
 };
 const copyLines=(lines,msg)=>{
  const text=(lines||[]).join('\n');
  if(!text.trim())return showToast('コピーするものがありません','件を選ぶか、絞り込みを変えてください。');
  const done=()=>showToast(msg,`${lines.length}行`);
  if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(done).catch(()=>fallbackCopy(text,done));
  else fallbackCopy(text,done);
 };

 /* ---------- 描画 ---------- */
 const updateSummary=()=>{
  const s=$id('lgSummary'),d=state.info;
  if(s&&d){
   const clip=d.clipped?'（末尾のみ）':'';
   s.textContent=`${d.shown}件を表示${clip}　該当${d.matched}件 / 全${d.total}件`
    +`　エラー${d.counts?.error||0} 警告${d.counts?.warning||0}　選択${state.picked.size}件`;
  }
  const size=$id('lgSize');
  if(size&&d){
   const total=Object.values(d.sizes||{}).reduce((a,b)=>a+b,0);
   size.textContent=`${Math.round(total/1024)}KB`;
   size.title=`${d.dir||''}\n読み取りの窓: ${Math.round((d.windowBytes||0)/1024/1024)}MB`;
  }
 };

 const lineHtml=r=>{
  const time=(r.ts||'').slice(11)||'—';
  const n=(r.extra||[]).length;
  const badge=r.level==='error'?'エラー':r.level==='warning'?'警告':'情報';
  return `<div class="lg-line is-${esc(r.level)}">
   <input class="lg-pick" type="checkbox" data-key="${esc(r.key)}"${state.picked.has(r.key)?' checked':''} aria-label="この件を選ぶ">
   <span class="lg-time" title="${esc(r.ts||'')}">${esc(time)}</span>
   <span class="lg-badge">${esc(badge)}</span>
   <span class="lg-src">${esc(SRC_LABEL[r.source]||r.source||'')}</span>
   <span class="lg-text">${esc(r.text)}</span>
   ${n?`<button type="button" class="lg-more" data-n="${n}" title="続きの行（トレースバック）を開きます">＋${n}行</button>`:''}
  </div>${n?`<pre class="lg-extra" hidden>${esc((r.extra||[]).join('\n'))}</pre>`:''}`;
 };

 const render=()=>{
  const tree=$id('lgTree');if(!tree)return;
  if(!state.records.length){
   tree.innerHTML='<div class="lg-empty">該当するログがありません。</div>';
   updateSummary();return;
  }
  tree.innerHTML=state.groups.map((g,gi)=>{
   const err=g.records.filter(r=>r.level==='error').length;
   const warn=g.records.filter(r=>r.level==='warning').length;
   const meta=[`${g.records.length}件`,err?`エラー${err}`:'',warn?`警告${warn}`:''].filter(Boolean).join(' / ');
   const title=g.boot?`起動 ${g.no}`:'これより前';
   const allPicked=g.records.every(r=>state.picked.has(r.key));
   return `<details class="lg-group${allPicked?' is-picked':''}" data-gi="${gi}"${gi===0?' open':''}>
    <summary>
     <b>${esc(title)}</b>
     <span class="lg-group-time">${esc(g.at||'')}</span>
     <span class="lg-group-meta">${esc(meta)}</span>
     <span class="lg-group-acts">
      <button type="button" data-act="pick" data-gi="${gi}">${allPicked?'選択解除':'この起動を選ぶ'}</button>
      <button type="button" data-act="copy" data-gi="${gi}">コピー</button>
     </span>
    </summary>
    ${g.records.map(lineHtml).join('')}
   </details>`;
  }).join('');
  tree.querySelectorAll('.lg-group-acts button').forEach(b=>{
   b.onclick=e=>{
    // summaryの中なので、押しただけで開閉させない
    e.preventDefault();e.stopPropagation();
    const g=state.groups[Number(b.dataset.gi)];if(!g)return;
    if(b.dataset.act==='copy')return copyLines(g.records.flatMap(r=>r.lines),'この起動のログをコピーしました');
    const on=!g.records.every(r=>state.picked.has(r.key));
    g.records.forEach(r=>on?state.picked.add(r.key):state.picked.delete(r.key));
    render();
   };
  });
  tree.querySelectorAll('.lg-pick').forEach(c=>{
   c.onchange=()=>{c.checked?state.picked.add(c.dataset.key):state.picked.delete(c.dataset.key);updateSummary()};
  });
  tree.querySelectorAll('.lg-more').forEach(b=>{
   b.onclick=()=>{
    const box=b.closest('.lg-line')?.nextElementSibling;
    if(!box||!box.classList.contains('lg-extra'))return;
    box.hidden=!box.hidden;b.textContent=(box.hidden?'＋':'−')+b.dataset.n+'行';
   };
  });
  updateSummary();
 };

 /* ---------- 読み込み ---------- */
 const loadFiles=async()=>{
  try{
   const d=await api('/api/logs/files');
   state.files=d.files||[];
   const sel=$id('lgFile');if(!sel)return;
   const keep=sel.value;
   /* 既定は「両方」。調べたいのは1回の起動で何が起きたかで、それは
      起動入口(launcher.log)とアプリ本体(app.log)にまたがる。 */
   const current=state.files.filter(f=>f.current).map(f=>f.name);
   sel.innerHTML=[`<option value="${esc(current.join(','))}">すべて（起動入口＋本体）</option>`]
    .concat(state.files.map(f=>`<option value="${esc(f.name)}">${esc(f.streamLabel)}`
      +`${f.current?'':`（${f.generation}世代前）`} — ${esc(f.name)}</option>`)).join('');
   if(keep&&[...sel.options].some(o=>o.value===keep))sel.value=keep;
  }catch(e){WL.quiet.note('一覧が取れなくても本読みは試す(理由はそちらで出る)',e)}
 };

 const load=async()=>{
  if(state.loading)return;
  state.loading=true;
  const tree=$id('lgTree');
  try{
   const p=new URLSearchParams({files:currentFile(),q:$id('lgQuery')?.value||'',
    level:$id('lgLevel')?.value||'all',days:$id('lgDays')?.value||'0',
    limit:$id('lgLimit')?.value||'1500'});
   const d=await api('/api/logs?'+p.toString());
   state.info=d;
   state.records=(d.records||[]).map((r,i)=>({...r,key:`${r.file}#${i}#${r.ts||''}${r.text.slice(0,40)}`}));
   // 消えた件の選択が残ると「選んだ件」の数だけが合わなくなる
   const alive=new Set(state.records.map(r=>r.key));
   [...state.picked].forEach(k=>{if(!alive.has(k))state.picked.delete(k)});
   state.groups=groupByBoot(state.records);
   render();
  }catch(e){
   if(tree)tree.innerHTML=`<div class="lg-empty">ログを読めませんでした。${esc(e.message||String(e))}</div>`;
  }finally{state.loading=false}
 };

 const stopTimer=()=>{if(state.timer){clearInterval(state.timer);state.timer=0}};
 const stopAuto=()=>{state.auto=false;stopTimer();const c=$id('lgAuto');if(c)c.checked=false};
 const startAuto=()=>{
  state.auto=true;stopTimer();
  state.timer=setInterval(()=>{if(document.body.classList.contains('lg-mode'))load()},AUTO_MS);
 };

 /* ---------- 消す ---------- */
 const pickedRecords=()=>state.records.filter(r=>state.picked.has(r.key));
 /* 削除の宛先は**その件が居たファイル**。「すべて（起動入口＋本体）」を見て
    いるときは2つのファイルにまたがるので、ファイルごとに分けて送る。 */
 const byFile=records=>{
  const map=new Map();
  records.forEach(r=>{
   if(!map.has(r.file))map.set(r.file,[]);
   map.get(r.file).push(...r.lines);
  });
  return map;
 };
 const postJson=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},
                                     body:JSON.stringify(body)});
 const deletePicked=async()=>{
  const recs=pickedRecords();
  if(!recs.length)return showToast('削除する件が選ばれていません','行のチェックか「この起動を選ぶ」で選んでください。');
  const rows=recs.reduce((a,r)=>a+r.lines.length,0);
  if(!await confirmModal({message:`選んだ${recs.length}件（${rows}行）を削除します。元に戻せません。`,danger:true}))return;
  let removed=0;
  try{
   for(const [file,lines] of byFile(recs))removed+=(await postJson('/api/logs/delete-lines',{file,lines})).removed||0;
  }catch(e){return showToast('削除できませんでした',e.message||String(e),5200)}
  state.picked.clear();
  showToast('ログを削除しました',`${removed}行`);
  await load();
 };
 const deleteOld=async()=>{
  const days=Number($id('lgDays')?.value||0);
  if(!days)return showToast('期間が「すべて」です','上の「期間」で残す日数を選んでから押してください。',4600);
  if(!await confirmModal({message:`${days}日より前のログを削除します。元に戻せません。`,danger:true}))return;
  let removed=0;
  try{
   for(const file of currentFile().split(',').filter(Boolean))
    removed+=(await postJson('/api/logs/delete-old',{file,days})).removed||0;
  }catch(e){return showToast('削除できませんでした',e.message||String(e),5200)}
  showToast('古いログを削除しました',`${removed}件`);
  await load();
 };
 const clearAll=async()=>{
  const files=currentFile().split(',').filter(Boolean);
  // 「区切る」との違いを押す前に言う。区切りは古い内容が1世代前へ残るが、
  // 消去は残らない。取り違えると調べる材料ごと失う。
  if(!await confirmModal({message:`${files.join('・')}の中身を空にします。**1世代前にも残りません。**\n`
             +'古い内容を取っておきたいときは「ここで区切る」を使ってください。',danger:true}))return;
  try{
   for(const file of files)await postJson('/api/logs/clear',{file});
  }catch(e){return showToast('消去できませんでした',e.message||String(e),5200)}
  state.picked.clear();
  showToast('ログを消去しました',files.join('・'));
  await loadFiles();await load();
 };
 const rotate=async()=>{
  if(!await confirmModal('いまのログを1つ古い世代へ送り、新しいログを始めます。'))return;
  try{
   for(const file of currentFile().split(',').filter(Boolean))await postJson('/api/logs/rotate',{file});
  }catch(e){return showToast('区切れませんでした',e.message||String(e),5200)}
  showToast('ログを区切りました','ここから新しいログが始まります。');
  await loadFiles();await load();
 };

 /* ---------- 接続の診断(§9.101) ----------
    別端末でだけ起きる接続不良は、エラーの文言だけでは「パスの解決」
    「存在確認(os.stat)」「実際の接続」のどれで転んだのか分からない。
    サーバー側(/api/db-diagnose)は前からあったが**画面が無く**、現地では
    URLを直打ちするしかなかった。ここが「ログ・診断」の診断の側。
    **読むだけ**で設定は一切変えない。 */
 const diagState={last:null};
 const renderDiag=d=>{
  const box=$id('lgDiagBody'),verdict=$id('lgDiagVerdict');
  if(!box)return;
  if(!d){box.innerHTML='';if(verdict)verdict.textContent='';return}
  /* **「走った」と「答えが是」は別物**。存在確認は例外を出さなければ
     ok=true だが、値が False なら「無い」という答え。✓を付けると
     見た人が成功と読んでしまう(実際に紛らわしかった)ので、印を分ける。 */
  const answerNo=s=>s.ok&&String(s.value)==='False';
  const firstBad=(d.steps||[]).find(s=>!s.ok||answerNo(s));
  if(verdict){
   verdict.textContent=d.ok?'すべて成功':(firstBad?`「${firstBad.name.replace(/\s*\(.*$/,'')}」で止まった`:'失敗あり');
   verdict.className='lg-diag-verdict '+(d.ok?'is-ok':'is-ng');
  }
  const head=[['読み込み先',d.path||''],
              ['絶対パス',d.is_absolute?'はい':'いいえ'],
              ['共有パス(UNC)',d.is_unc?'はい':'いいえ']]
   .map(([k,v])=>`<div class="lg-diag-kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
  /* **最初に転んだ段階が原因**。そこから先は道連れなので、見分けが
     つくように印を分ける(失敗 / それ以降 / 成功)。 */
  let broken=false;
  const rows=(d.steps||[]).map(s=>{
   /* **最初に転んだ段階が原因**で、その先は道連れ。原因だけを強く出し、
      以降は薄くする(全部を赤くすると、どれを見ればよいか分からなくなる)。 */
   const no=answerNo(s),bad=!s.ok||no;
   const cls=!bad?'is-ok':(broken?'is-after':(no?'is-no':'is-ng'));
   if(bad)broken=true;
   const detail=s.ok?(no?'ありません':(s.value||'')):((s.error||'')+(s.winerror?` (WinError ${s.winerror})`:''));
   return `<div class="lg-diag-step ${cls}">
    <span class="lg-diag-mark">${!s.ok?'×':no?'−':'✓'}</span>
    <span class="lg-diag-name">${esc(s.name)}</span>
    <span class="lg-diag-detail">${esc(detail)}</span></div>`;
  }).join('');
  box.innerHTML=`<div class="lg-diag-head">${head}</div>${rows}`;
 };
 const diagText=d=>{
  if(!d)return '';
  const lines=[`接続の診断: ${d.db}`,`読み込み先: ${d.path}`,
               `結果: ${d.ok?'すべて成功':'失敗あり'}`,''];
  (d.steps||[]).forEach(s=>lines.push(
   `${s.ok?'OK  ':'NG  '}${s.name}: ${s.ok?(s.value||''):(s.error||'')}`
   +(s.winerror?` (WinError ${s.winerror})`:'')));
  return lines.join('\n');
 };
 const runDiag=async()=>{
  const box=$id('lgDiagBody');
  const key=$id('lgDiagDb')?.value||'';
  if(box)box.innerHTML='<div class="lg-empty">試しています…</div>';
  try{
   const d=await api('/api/db-diagnose?db='+encodeURIComponent(key));
   diagState.last=d;
   fillDiagTargets(d.targets);
   renderDiag(d);
  }catch(e){
   diagState.last=null;
   if(box)box.innerHTML=`<div class="lg-empty">診断できませんでした。${esc(e.message||String(e))}</div>`;
  }
 };
 /* 選択肢はサーバーが返した接続先から作る。**決め打ちにしない**
    ——データソースを増やしたときに、画面だけ古いままにならないように。 */
 const fillDiagTargets=list=>{
  const sel=$id('lgDiagDb');
  if(!sel||!Array.isArray(list)||!list.length||sel.dataset.filled==='1')return;
  const keep=sel.value;
  sel.innerHTML=list.map(t=>`<option value="${esc(t.key)}">${esc(t.label)}（${esc(t.key)}）</option>`).join('');
  sel.dataset.filled='1';
  if(keep&&[...sel.options].some(o=>o.value===keep))sel.value=keep;
 };

 /* ---------- 起動の状況（§9.316、利用者の指示） ----------
    「ログの保存場所が難しいので、毎回htmlを手動クリックで起動しています。
      ログをアプリ上からコピーできるようにして、起動時の状況もアプリ上から
      取得できるようにしてください」

    起動の不具合は**起動した端末でしか分からない**のに、材料は
    `%LOCALAPPDATA%`の奥にある。**1回押せば、そのまま貼れる1つの文章**にする。
    中身を作るのは`/api/boot-report`の1箇所（§9.163）——画面はそれを出して
    コピーするだけで、判断も組み立ても持たない。 */
 const bootState={last:null,busy:false};
 const bootMark=v=>v===true?{t:'あり',c:'ok'}:v===false?{t:'無い',c:'ng'}
                          :{t:'確かめられず',c:'warn'};
 const bootHtml=d=>{
  if(!d)return '<div class="lg-empty">「取得」を押すと、いまの置き場と直近の起動のログをまとめます。</div>';
  const e=d.env||{};
  const rows=(d.places||[]).map(p=>{
   const m=bootMark(p.exists);
   /* **「在る」だけでは足りない**（§9.314）——隔離されて0バイト・読めない、が
      起こりうる。読めなかったものは在っても赤で言う。 */
   const bad=p.exists===false||p.readable===false;
   const size=p.size==null?'':`${Number(p.size).toLocaleString()} バイト`;
   return `<tr class="${bad?'is-bad':''}">
     <td><span class="lg-boot-mark lg-boot-${bad?'ng':m.c}">${esc(bad&&p.exists!==false?'読めない':m.t)}</span></td>
     <td>${esc(p.label||'')}</td>
     <td class="lg-boot-path">${esc(p.path||'')}</td>
     <td>${esc(size)}</td><td>${esc(p.mtime||'')}</td>
     <td>${esc(p.error||p.note||'')}</td></tr>`;
  }).join('');
  const mism=(e.readyMismatch||[]);
  return `<div class="lg-boot-env">
    <b>VER${esc(e.version||'?')}</b>
    <span>端末 ${esc(e.pcName||'?')} / ${esc(e.loginId||'?')}</span>
    <span>起動 ${esc(e.startedAt||'?')}</span>
    <span>Python ${esc(e.pythonVersion||'?')}</span>
    <span>ポート ${esc(e.port||'?')}</span>
    <span>${mism.length?'起動前確認: 要確認':'起動前確認: 済み'}</span>
   </div>
   <table class="lg-boot-table"><thead><tr>
     <th>状態</th><th>置き場</th><th>実際のパス</th><th>大きさ</th><th>更新</th><th>備考</th>
    </tr></thead><tbody>${rows}</tbody></table>
   <div class="lg-boot-note">直近の起動のログ ${(d.records||[]).length}件`
   +`${d.bootMarkFound?'':'（起動の区切りが見つからないので末尾を出しています）'}`
   +'　※「まとめてコピー」で、この表と起動のログを1つの文章にして写します。</div>';
 };
 const runBoot=async()=>{
  if(bootState.busy)return;
  bootState.busy=true;
  const body=$id('lgBootBody');
  if(body)body.innerHTML='<div class="lg-empty">まとめています…</div>';
  try{
   bootState.last=await api('/api/boot-report');
  }catch(err){
   bootState.last=null;
   if(body)body.innerHTML=`<div class="lg-empty">まとめられませんでした: ${esc(err.message||err)}</div>`;
   bootState.busy=false;return;
  }
  bootState.busy=false;
  if(body)body.innerHTML=bootHtml(bootState.last);
 };

 /* ---------- 画面の組み立て ---------- */
 const wire=()=>{
  $id('lgReload').onclick=()=>load();
  $id('lgFile').onchange=()=>load();
  ['lgQuery','lgLevel','lgDays','lgLimit'].forEach(id=>{
   const el=$id(id);if(!el)return;
   // 打っている途中で毎回投げない(1文字ごとに末尾2MBを読み直させない)
   el.addEventListener(id==='lgQuery'?'input':'change',debounce(()=>load(),id==='lgQuery'?260:0));
  });
  $id('lgAuto').onchange=e=>{e.target.checked?startAuto():stopAuto()};
  $id('lgPickAll').onclick=()=>{state.records.forEach(r=>state.picked.add(r.key));render()};
  $id('lgPickNone').onclick=()=>{state.picked.clear();render()};
  $id('lgCopyPicked').onclick=()=>copyLines(pickedRecords().flatMap(r=>r.lines),'選んだ件をコピーしました');
  $id('lgCopyShown').onclick=()=>copyLines(state.records.flatMap(r=>r.lines),'表示中のログをコピーしました');
  $id('lgDelPicked').onclick=deletePicked;
  $id('lgDelOld').onclick=deleteOld;
  $id('lgClear').onclick=clearAll;
  $id('lgExpand').onclick=()=>document.querySelectorAll('#lgTree details').forEach(d=>d.open=true);
  $id('lgCollapse').onclick=()=>document.querySelectorAll('#lgTree details').forEach(d=>d.open=false);
  $id('lgRotate').onclick=rotate;
  $id('lgDownload').onclick=()=>{location.href='/api/logs/download?file='+encodeURIComponent(currentFile().split(',')[0])};
  $id('lgBootRun').onclick=runBoot;
  /* **文章はサーバーが作る**（§9.163）——画面で組み立て直すと、貼られた
     内容と画面の見え方が食い違う。 */
  $id('lgBootCopy').onclick=()=>{
   const t=(bootState.last||{}).text;
   if(!t){showToast('まだまとめていません','「取得」を押してからコピーしてください。');return}
   copyLines(t.split('\n'),'起動の状況をコピーしました（そのまま貼れます）');
  };
  $id('lgDiagRun').onclick=runDiag;
  $id('lgDiagCopy').onclick=()=>copyLines(diagText(diagState.last).split('\n'),'診断の結果をコピーしました');
  // 開いた時点で1回だけ試す(開くまでは何もしない=画面を開くだけで共有を叩かない)
  $id('lgDiag').addEventListener('toggle',()=>{
   if($id('lgDiag').open&&!diagState.last)runDiag();
  });
 };

 const ensurePanel=()=>{
  let panel=$id('logPanel');if(panel)return panel;
  panel=document.createElement('section');panel.className='lg-panel';panel.id='logPanel';panel.hidden=true;
  panel.innerHTML=`
   <div class="lg-head-tools" id="lgHead">
    <label>対象<select id="lgFile"></select></label>
    <button type="button" id="lgReload" title="いまのログを読み直します">再読込</button>
    <label title="開いている間、数秒ごとに読み直します"><input type="checkbox" id="lgAuto"> 自動更新</label>
    <!-- 開発へ報告する（§9.373）。**不具合のときに人が来るのはこの画面**なので、
         入口をここに置く——知らせのボタンは消えてしまうが、ここは残る。 -->
    <button type="button" id="lgFeedback"
     title="直近の失敗を、開発が読める形にまとめてコピーします（何をしようとしたか・理由・そのときの画面の状態・直前の足あと）">開発へ報告</button>
   </div>
   <div class="lg-filterbar">
    <label class="lg-search">検索<input id="lgQuery" type="search" placeholder="メッセージ・例外名・処理名で絞り込み"></label>
    <label>レベル<select id="lgLevel">${LEVELS.map(x=>`<option value="${x[0]}">${x[1]}</option>`).join('')}</select></label>
    <label>期間<select id="lgDays">${DAYS.map(x=>`<option value="${x[0]}">${x[1]}</option>`).join('')}</select></label>
    <label>表示件数<select id="lgLimit">${LIMITS.map(x=>`<option value="${x}"${x==='1500'?' selected':''}>${x}件</option>`).join('')}</select></label>
    <span class="lg-summary" id="lgSummary">読み込んでいます…</span>
   </div>
   <div class="lg-commandbar">
    <span class="lg-act"><i>選択</i>
     <button type="button" id="lgPickAll">表示中をすべて</button>
     <button type="button" id="lgPickNone">解除</button></span>
    <span class="lg-act"><i>コピー</i>
     <button type="button" id="lgCopyPicked">選んだ件</button>
     <button type="button" id="lgCopyShown">表示中</button></span>
    <span class="lg-act is-danger"><i>削除</i>
     <button type="button" class="lg-danger" id="lgDelPicked">選んだ件</button>
     <button type="button" class="lg-danger" id="lgDelOld">指定期間より前</button>
     <button type="button" class="lg-danger" id="lgClear" title="このログの中身を空にします。1世代前にも残りません">すべて</button></span>
    <span class="lg-act"><i>表示</i>
     <button type="button" id="lgExpand">すべて開く</button>
     <button type="button" id="lgCollapse">畳む</button></span>
    <span class="lg-act">
     <span class="lg-size" id="lgSize">—</span>
     <button type="button" id="lgRotate" title="いまのログを1つ古い世代へ送り、新しいログを始めます">ここで区切る</button>
     <button type="button" id="lgDownload" title="このログをファイルとして保存します">保存</button></span>
   </div>
   <details class="lg-boot" id="lgBoot" open>
    <summary><b>起動の状況</b><span>いま見に行っている置き場と、直近の起動のログをまとめます（読むだけ）</span></summary>
    <div class="lg-diag-bar">
     <button type="button" id="lgBootRun">取得</button>
     <button type="button" id="lgBootCopy" class="lg-primary">まとめてコピー</button>
     <span class="lg-boot-hint">起動できないときは、これを押して貼り付けてください</span>
    </div>
    <div class="lg-boot-body" id="lgBootBody"></div>
   </details>
   <details class="lg-diag" id="lgDiag">
    <summary><b>接続の診断</b><span>データベースを開くまでを1段ずつ試します（読むだけ）</span></summary>
    <div class="lg-diag-bar">
     <label>対象<select id="lgDiagDb"></select></label>
     <button type="button" id="lgDiagRun">診断を実行</button>
     <button type="button" id="lgDiagCopy">結果をコピー</button>
     <span class="lg-diag-verdict" id="lgDiagVerdict"></span>
    </div>
    <div class="lg-diag-body" id="lgDiagBody"></div>
   </details>
   <div class="lg-tree" id="lgTree"><div class="lg-empty">読み込んでいます…</div></div>`;
  (document.querySelector('main')||document.body).append(panel);
  wire();
  return panel;
 };

 /* ---------- ナビ・ビュー排他制御 ---------- */
 const exitLogView=()=>{
  if(!document.body.classList.contains('lg-mode'))return;
  document.body.classList.remove('lg-mode');
  $id('openLogView')?.classList.remove('active');
  const panel=$id('logPanel');if(panel)panel.hidden=true;
  stopAuto();                       // 別の画面で裏読みを続けない
 };
 /* 「開発へ報告」の配線（§9.373）。**組み立てた直後に1度だけ**繋ぐ
    （器を作り直すたびに繋ぎ直すと、押すたびに何通も出る）。 */
 const wireFeedbackButton=()=>{
  const b=$id('lgFeedback');
  if(!b||b.dataset.wired)return;
  b.dataset.wired='1';
  b.onclick=()=>{
   if(WL.feedback&&WL.feedback.openReport)WL.feedback.openReport();
   else showToast&&showToast('報告の仕組みが読み込まれていません',
     'アプリを開き直してからもう一度お試しください',5000);
  };
 };
 const openLogView=async()=>{
  WL.enterView('logs');
  ensurePanel().hidden=false;
  wireFeedbackButton();
  WL.syncViewToolbar('logs');       // 操作列(#lgHead)はパネル生成後にヘッダーへ載せる
  await loadFiles();
  await load();
  /* **開いた時点でまとめておく**（§CLAUDE 2「探させない」）——起動の不具合で
     ここへ来た人に、もう一度ボタンを探させない。読むだけなので安い。 */
  runBoot();
 };
 const ensureNavButton=()=>{
  const nav=document.querySelector('#adminNav');if(!nav||$id('openLogView'))return;
  const b=document.createElement('button');b.type='button';b.id='openLogView';
  b.className='db nav-item nav-item--admin';
  b.innerHTML='<svg class="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg><span>ログ・診断</span>';
  b.title='この端末の記録（起動入口・アプリ本体）を読み、絞り込み・コピー・整理します';
  b.onclick=openLogView;nav.append(b);
 };

 WL.registerView({key:'logs',bodyClass:'lg-mode',nav:'openLogView',toolbar:'#lgHead',
  header:['ログ・診断','この端末の記録を読み、絞り込み・コピー・整理します'],exit:exitLogView});

 window.WL=window.WL||{};
 WL.logView={open:openLogView,load,groupByBoot,state,bootState,runBoot};

 queueMicrotask(()=>{ensureNavButton()});
})();
