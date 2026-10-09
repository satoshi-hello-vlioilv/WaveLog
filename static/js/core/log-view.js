"use strict";
/* log-view.js: ログ・診断（ログビュワー）
   ============================================================
   何のための画面か
   ------------------------------------------------------------
   「起動しない」「一覧が出ない」「固まった」と言われたとき、調べる材料は
   %LOCALAPPDATA%\WaveLog\logs にある。**現場の端末では誰もそこを開かない**
   ので、アプリの中から読める場所を用意する。

   3つの段に分ける（§9.510、利用者の指示）
   ------------------------------------------------------------
   「何かあったときは、ここのログからコピーして開発に戻せば状況が解析できる
     ように。ライトユーザーにこそ報告用に使ってもらわないといけないため、
     見た目はシンプルに、階層をしっかり分けて…」

   来る人は2種類で、**することが違う**。1枚に全部を並べると（前は操作21個・
   削除ボタン3つが既定の画面に出ていた）、報告しに来た人が探すことになる。

     ① 報告する   … 既定。書く（任意）→ コピー の2手。材料は自動で集める
     ② ログを見る … 開発・保守が読む。問題のまとめ＋時間順の一覧
     ③ 点検と整理 … 起動の状況・接続の診断・ログの整理（**消す操作はここだけ**）

   読ませ方の方針（この画面が守っていること）
   ------------------------------------------------------------
   1. **報告は1手で全部。** 画面の失敗（`WL.feedback`・足あとつき）と、
      サーバーがまとめた起動の状況・エラーのまとめを**1つの文章**にする。
      写すのは**見えているプレビューそのもの**（見たものと送るものを違えない）。
   2. **1行ではなく1件で扱う。** トレースバックは日時を持たない行が何行も
      続くので、サーバー側(backend/routes/logs.py)が直前の件へ畳んでいる。
      画面でも「＋N行」で開き、コピー・削除も畳んだぶんごと動かす。
   3. **起動セッションでまとめる。** 最新の起動が上で、最初から開いている。
   4. **絞り込み・まとめ方はサーバーだけが持つ。** 画面側にも同じ判定を
      置くと、片方だけ直した状態が作れる。
   5. **消す操作は整理の段にだけ置き、必ず確認する。** editモード以外では
      押せなくして理由を書く（サーバーも断る・`'logs':{'edit'}`）。

   書き方の約束（§9.96 / tests/test_globallint.js の対象）
   ------------------------------------------------------------
   **素のグローバルを1つも作らない**。関数はすべてIIFEの中の`const`で、
   外へ出すのは`WL.logView`だけ。
   ============================================================ */
(function(){
 if(typeof $!=='function')return;
 const $id=id=>document.getElementById(id);
 /* 段の顔ぶれは1箇所（札・器・既定が同じ並びを見る）。 */
 const STEPS=[
  {key:'report',label:'報告する',icon:'fa-paper-plane',tip:'困ったことを開発へ送る文章を作ります'},
  {key:'logs',label:'ログを見る',icon:'fa-list-ul',tip:'この端末の記録を時間順に読みます'},
  {key:'check',label:'点検と整理',icon:'fa-stethoscope',tip:'起動の状況・接続の診断・ログの整理'},
 ];
 const STEP_DEFAULT='report';
 const LEVELS=[['all','すべて'],['problem','警告とエラー'],['error','エラー'],
               ['warning','警告'],['info','情報']];
 const DAYS=[['0','すべて'],['1','1日'],['3','3日'],['7','7日'],['30','30日']];
 const DEL_DAYS=[['1','1日'],['7','7日'],['30','30日'],['90','90日']];
 const LIMITS=['500','1500','3000','5000'];
 const SRC_LABEL={app:'本体',launcher:'起動'};
 const LEVEL_WORD={error:'エラー',warning:'警告',info:'情報',debug:'詳細'};
 const AUTO_MS=5000;
 const FAIL_LIST=10;              // 報告に並べる「画面の失敗」の件数

 const state={step:STEP_DEFAULT,files:[],records:[],groups:[],picked:new Set(),
              auto:false,timer:0,loading:false,info:null,level:'all',
              logsLoaded:false,problems:null};
 const bootState={last:null,busy:false};
 const diagState={last:null,ran:false};

 const debounce=(fn,ms)=>{let t=0;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}};
 const num=n=>Number(n||0).toLocaleString();
 const pad=n=>String(n).padStart(2,'0');
 const stamp=(d=new Date())=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} `
  +`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
 const editable=()=>!window.accessMode||window.accessMode.mode==='edit';
 const MODE_WORD={edit:'編集',view:'閲覧',schedule:'スケジュール'};

 /* ---------- コピー・保存 ---------- */
 const fallbackCopy=text=>{
  const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
  document.body.append(ta);ta.select();
  try{return document.execCommand('copy')}
  catch(e){WL.quiet.note('隠し欄からも写せない（手で選んで写してもらう）',e);return false}
  finally{ta.remove()}
 };
 const copyText=async text=>{
  try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return true}}
  catch(e){WL.quiet.note('クリップボードAPIが使えない（隠し欄から写す）',e)}
  return fallbackCopy(text);
 };
 const copyLines=async(lines,msg)=>{
  const text=(lines||[]).join('\n');
  if(!text.trim())return showToast('コピーするものがありません','件を選ぶか、絞り込みを変えてください。');
  if(await copyText(text))showToast(msg,`${num(lines.length)}行`);
  else showToast('コピーできませんでした','手動で選択してコピーしてください。',5200);
 };
 const saveText=(text,name)=>WL.base.saveBlob(new Blob([text],{type:'text/plain;charset=utf-8'}),name);

 /* ====================================================================
    ① 報告する
    ==================================================================== */
 /* 報告の文章。**材料の組み立てはそれぞれの持ち主**——起動の状況とエラーの
    まとめはサーバー（`/api/boot-report`・§9.163）、画面の失敗は
    `WL.feedback.reportText()`。ここは並べるだけ。機械で読む1行（WLFB1）が
    最後に来るよう、画面の失敗の詳しい1通は末尾に置く。 */
 const failures=()=>(WL.feedback&&WL.feedback.log?WL.feedback.log():[]).slice().reverse();
 const failLine=f=>`${stamp(new Date(f.at))}  ${f.what||'（不明）'}${f.why?` — ${f.why}`:''}${f.status?`（HTTP ${f.status}）`:''}`;
 const reportText=()=>{
  const memo=($id('lgMemo')?.value||'').trim();
  const fails=failures();
  const L=['==== WaveLog 開発への報告 ====',`作成: ${stamp()}`,'',
           '---- 何が起きたか（利用者のメモ） ----',memo||'（書かれていません）','',
           '---- 画面で起きた失敗（この端末に残っている記録・新しい順） ----'];
  if(fails.length){
   fails.slice(0,FAIL_LIST).forEach(f=>L.push('  '+failLine(f)));
   if(fails.length>FAIL_LIST)L.push(`  （ほかに ${fails.length-FAIL_LIST}件）`);
  }else L.push('  記録なし');
  L.push('');
  const b=bootState.last;
  L.push(b&&b.text?b.text:'（起動の状況を読めませんでした。「点検と整理」で取り直せます）');
  if(fails.length&&WL.feedback.reportText){
   L.push('','---- 直近の失敗の詳しい記録 ----',WL.feedback.reportText(fails[0]));
  }
  return L.join('\n');
 };
 const refreshPreview=()=>{
  const box=$id('lgPreview');if(!box)return;
  box.value=reportText();
  const size=$id('lgPreviewSize');if(size)size.textContent=`${num(box.value.length)}字`;
  /* 直近の失敗に「そのときのサーバーの記録」がまだ無ければ、届いてから描き直す（§9.578）。 */
  const f=failures()[0];
  if(f&&!f.server&&WL.feedback&&WL.feedback.ready)WL.feedback.ready(f).then(()=>{if(f.server&&$id('lgPreview'))box.value=reportText()});
 };

 /* 「報告に入るもの」。状態は**語で**言い（色だけにしない）、直す先の段へ
    1手で行ける（探させない）。 */
 const fact=(label,st,word,detail,go)=>`<div class="lg-fact"><dt>${esc(label)}</dt>
   <dd>${word?`<b class="lg-st is-${st}">${esc(word)}</b>`:''}<span>${esc(detail||'')}</span>
   ${go?`<button type="button" class="lg-link" data-goto="${go[0]}">${esc(go[1])}</button>`:''}</dd></div>`;
 const renderFacts=()=>{
  const box=$id('lgFacts');if(!box)return;
  const b=bootState.last,e=(b&&b.env)||{};
  const fails=failures();
  const rows=[];
  rows.push(fact('この端末','','',b?`VER${e.version||'?'} ・ ${e.pcName||'?'} ／ ${e.loginId||'?'} ・ ${MODE_WORD[e.mode]||e.mode||'?'}モード`
                 :(bootState.busy?'読んでいます…':'読めませんでした')));
  rows.push(fails.length
   ?fact('画面の失敗','warn',`${fails.length}件`,`最新 ${stamp(new Date(fails[0].at)).slice(5,16)}「${fails[0].what||'不明'}」`)
   :fact('画面の失敗','ok','なし','この端末に失敗の記録はありません'));
  const pr=b&&b.problems;
  if(pr){
   const c=pr.counts||{},k=pr.kinds||{};
   const st=c.error?'ng':c.warning?'warn':'ok';
   rows.push(fact('ログの問題',st,c.error?'エラーあり':c.warning?'警告のみ':'なし',
    `エラー ${num(c.error)}件（${k.error||0}種類）・警告 ${num(c.warning)}件（${k.warning||0}種類）`,
    (c.error||c.warning)?['logs','ログを見る']:null));
  }else rows.push(fact('ログの問題','','',bootState.busy?'読んでいます…':'読めませんでした'));
  if(b){
   const first=(b.records||[])[0];
   rows.push(fact('直近の起動','','',`${(first&&first.ts)||e.startedAt||'?'}（${num((b.records||[]).length)}件の記録）`));
   const bad=(b.places||[]).filter(p=>p.bad);
   rows.push(bad.length
    ?fact('置き場','ng',`${bad.length}か所 要確認`,bad.map(p=>p.label).join('・'),['check','点検と整理で見る'])
    :fact('置き場','ok','異常なし',`${(b.places||[]).length}か所を確かめました`));
  }
  box.innerHTML=rows.join('');
 };
 const copyReport=async()=>{
  const f=failures()[0];
  if(f&&WL.feedback&&WL.feedback.ready)await WL.feedback.ready(f);
  refreshPreview();
  const text=$id('lgPreview').value;
  const ok=await copyText(text);
  const done=$id('lgReportDone');
  if(done){
   done.textContent=ok?`コピーしました（${num(text.length)}字）。メールやチャットへそのまま貼ってください。`
                      :'コピーできませんでした。右の「送る内容」を選んで写すか、「ファイルに保存」を使ってください。';
   done.className='lg-done '+(ok?'is-ok':'is-ng');
  }
  WL.feedback?.step?.('ログ・診断','報告をコピー');
 };
 const saveReport=()=>{
  refreshPreview();
  saveText($id('lgPreview').value,`WaveLog報告-${stamp().replace(/[-: ]/g,'').replace(/^(\d{8})/,'$1-')}.txt`);
 };
 const runBoot=async()=>{
  if(bootState.busy)return;
  bootState.busy=true;renderFacts();
  const body=$id('lgBootBody');
  if(body)body.innerHTML='<div class="lg-empty">まとめています…</div>';
  try{bootState.last=await api('/api/boot-report')}
  catch(err){
   bootState.last=null;
   if(body)body.innerHTML=`<div class="lg-empty">まとめられませんでした: ${esc(err.message||err)}</div>`;
  }finally{bootState.busy=false}
  if(bootState.last&&body)body.innerHTML=bootHtml(bootState.last);
  renderFacts();refreshPreview();
 };

 /* ====================================================================
    ② ログを見る
    ==================================================================== */
 /* 起動セッションでまとめる。`--- 起動 ---`(launcher.logのlog_environment)で
    切る。最初の起動より前にあった件は「これより前」としてまとめる——捨てない。 */
 const groupByBoot=records=>{
  const groups=[];let cur=null;
  records.forEach(r=>{
   if(r.boot||!cur){cur={boot:!!r.boot,at:r.ts||'',records:[]};groups.push(cur)}
   cur.records.push(r);
  });
  groups.forEach((g,i)=>{g.no=i+1});
  return groups.reverse();          // 最新の起動を上に
 };
 const currentFile=()=>$id('lgFile')?.value||'app.log';

 const updateSummary=()=>{
  const s=$id('lgSummary'),d=state.info;
  if(s&&d){
   /* 件数の書き方は一覧と同じ（「n件 / 全 N件」・§9.507）。エラー・警告の
      数は左の「問題のまとめ」が言う（同じ数を2箇所に出さない）。 */
   const base=d.matched===d.total?`全 ${num(d.total)}件`:`${num(d.matched)}件 / 全 ${num(d.total)}件`;
   s.textContent=base+(d.shown<d.matched?`（新しい ${num(d.shown)}件を表示）`:'')+(d.clipped?'・末尾のみ':'');
   s.title=`${d.dir||''}\n読み取りの窓: ${Math.round((d.windowBytes||0)/1024/1024)}MB`;
  }
  const n=state.picked.size;
  const ps=$id('lgPickState');if(ps)ps.textContent=`選んだ ${num(n)}件`;
  ['lgCopyPicked','lgPickNone'].forEach(id=>{const b=$id(id);if(b)b.disabled=!n});
  renderMaint();
 };

 const lineHtml=r=>{
  const time=(r.ts||'').slice(11)||'—';
  const n=(r.extra||[]).length;
  return `<div class="lg-line is-${esc(r.level)}">
   <input class="lg-pick" type="checkbox" data-key="${esc(r.key)}"${state.picked.has(r.key)?' checked':''} aria-label="この件を選ぶ">
   <span class="lg-time" title="${esc(r.ts||'')}">${esc(time)}</span>
   <span class="lg-badge">${esc(LEVEL_WORD[r.level]||'情報')}</span>
   <span class="lg-src">${esc(SRC_LABEL[r.source]||r.source||'')}</span>
   <span class="lg-text">${esc(r.text)}</span>
   ${n?`<button type="button" class="lg-more" data-n="${n}" title="続きの行（トレースバック）を開きます">＋${n}行</button>`:''}
  </div>${n?`<pre class="lg-extra" hidden>${esc((r.extra||[]).join('\n'))}</pre>`:''}`;
 };

 const render=()=>{
  const tree=$id('lgTree');if(!tree)return;
  if(!state.records.length){
   tree.innerHTML='<div class="lg-empty">該当するログがありません。検索・重要度・期間を広げてください。</div>';
   updateSummary();return;
  }
  tree.innerHTML=state.groups.map((g,gi)=>{
   const err=g.records.filter(r=>r.level==='error').length;
   const warn=g.records.filter(r=>r.level==='warning').length;
   const title=g.boot?`起動 ${g.no}`:'これより前';
   const allPicked=g.records.every(r=>state.picked.has(r.key));
   return `<details class="lg-group${allPicked?' is-picked':''}" data-gi="${gi}"${gi===0?' open':''}>
    <summary>
     <b>${esc(title)}</b>
     <span class="lg-group-time">${esc(g.at||'')}</span>
     <span class="lg-group-meta">${num(g.records.length)}件${err?`<em class="is-ng">エラー ${err}</em>`:''}${warn?`<em class="is-warn">警告 ${warn}</em>`:''}</span>
     <span class="lg-group-acts">
      <button type="button" data-act="pick" data-gi="${gi}">${allPicked?'選択を外す':'この起動を選ぶ'}</button>
      <button type="button" data-act="copy" data-gi="${gi}">この起動をコピー</button>
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

 const fileOptions=(withAll)=>{
  const current=state.files.filter(f=>f.current).map(f=>f.name);
  return (withAll?[`<option value="${esc(current.join(','))}">すべて（起動入口＋本体）</option>`]:[])
   .concat(state.files.map(f=>`<option value="${esc(f.name)}">${esc(f.streamLabel)}`
     +`${f.current?'':`（${f.generation}世代前）`} — ${esc(f.name)}</option>`)).join('');
 };
 const fillSelect=(id,html)=>{
  const sel=$id(id);if(!sel)return;
  const keep=sel.value;sel.innerHTML=html;
  if(keep&&[...sel.options].some(o=>o.value===keep))sel.value=keep;
 };
 const loadFiles=async()=>{
  try{
   const d=await api('/api/logs/files');
   state.files=d.files||[];
   /* 既定は「両方」。調べたいのは1回の起動で何が起きたかで、それは
      起動入口(launcher.log)とアプリ本体(app.log)にまたがる。 */
   fillSelect('lgFile',fileOptions(true));
   fillSelect('lgMaintFile',fileOptions(true));
   renderFiles();
  }catch(e){WL.quiet.note('一覧が取れなくても本読みは試す(理由はそちらで出る)',e)}
 };

 const load=async()=>{
  if(state.loading)return;
  state.loading=true;
  const tree=$id('lgTree');
  try{
   const p=new URLSearchParams({files:currentFile(),q:$id('lgQuery')?.value||'',
    level:state.level,days:$id('lgDays')?.value||'0',limit:$id('lgLimit')?.value||'1500'});
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

 /* 問題のまとめ（§9.510）。同じ内容は1つ・エラーが先。押すとその件で絞る
    ——**検索語はサーバーが決める**（`query`。数字の手前まで）。 */
 const loadProblems=async()=>{
  const box=$id('lgProblems');if(!box)return;
  try{state.problems=await api('/api/logs/problems')}
  catch(e){box.innerHTML=`<div class="lg-empty">まとめを読めませんでした。${esc(e.message||String(e))}</div>`;return}
  const d=state.problems,c=d.counts||{},k=d.kinds||{};
  const head=$id('lgProblemsCount');
  if(head)head.textContent=`エラー ${num(c.error)}件（${k.error||0}種類）・警告 ${num(c.warning)}件（${k.warning||0}種類）`;
  if(!(d.items||[]).length){box.innerHTML='<div class="lg-empty">エラー・警告はありません。</div>';return}
  box.innerHTML=(d.items||[]).map((g,i)=>`<button type="button" class="lg-problem is-${esc(g.level)}" data-i="${i}"
     title="${esc(g.text)}&#10;最初 ${esc(g.first||'—')}&#10;最後 ${esc(g.last||'—')}">
    <span class="lg-problem-head"><b class="lg-st is-${g.level==='error'?'ng':'warn'}">${esc(LEVEL_WORD[g.level])}</b>
     <span class="lg-problem-n">×${num(g.count)}</span><span class="lg-problem-at">${esc((g.last||'').slice(5,16))}</span></span>
    <span class="lg-problem-text">${esc(g.text)}</span></button>`).join('')
   +(d.more?`<div class="lg-note">ほかに ${num(d.more)}種類。重要度・検索で絞って読めます。</div>`:'');
  box.querySelectorAll('.lg-problem').forEach(b=>{
   b.onclick=()=>{
    const g=(state.problems.items||[])[Number(b.dataset.i)];if(!g)return;
    $id('lgQuery').value=g.query||'';
    setLevel(g.level);
    box.querySelectorAll('.lg-problem').forEach(x=>x.classList.toggle('is-on',x===b));
    load();
   };
  });
 };
 const setLevel=v=>{
  state.level=v;
  document.querySelectorAll('#lgLevel button').forEach(b=>{
   const on=b.dataset.v===v;b.classList.toggle('is-on',on);b.setAttribute('aria-checked',on?'true':'false');
  });
 };

 const stopTimer=()=>{if(state.timer){clearInterval(state.timer);state.timer=0}};
 const stopAuto=()=>{state.auto=false;stopTimer();const c=$id('lgAuto');if(c)c.checked=false};
 const startAuto=()=>{
  state.auto=true;stopTimer();
  state.timer=setInterval(()=>{
   if(document.body.classList.contains('lg-mode')&&state.step==='logs')load();
  },AUTO_MS);
 };

 /* ====================================================================
    ③ 点検と整理
    ==================================================================== */
 const bootHtml=d=>{
  const e=d.env||{};
  const mism=e.readyMismatch||[];
  const kv=(k,v,st)=>`<div class="lg-fact"><dt>${esc(k)}</dt><dd>${st?`<b class="lg-st is-${st[0]}">${esc(st[1])}</b>`:''}<span>${esc(v)}</span></dd></div>`;
  const env=[kv('版',`VER${e.version||'?'}`),
   kv('端末',`${e.pcName||'?'} ／ ログインID ${e.loginId||'?'} ／ ${MODE_WORD[e.mode]||e.mode||'?'}モード`),
   kv('起動',e.startedAt||'?'),
   kv('Python',`${e.pythonVersion||'?'}  ${e.python||''}`),
   kv('ポート',String(e.port||'?')),
   kv('起動前確認',mism.length?mism.join(' / '):'刻印あり',mism.length?['warn','要確認']:['ok','済み'])];
  /* 状態は**語で**言う（§CLAUDE 3）。直すべきかの答えは`p.bad`（サーバーの
     1箇所）。無いのがふつうの置き場は薄く「無し（ふつう）」。 */
  const rows=(d.places||[]).map(p=>{
   const st=p.bad?['ng',p.exists===false?'無い':p.exists===null?'確かめられず':'読めない']
    :p.exists===false?['off','無し（ふつう）']:['ok','あり'];
   const size=p.size==null?'':`${num(p.size)} バイト`;
   const sub=p.error||p.note||'';
   return `<tr class="${p.bad?'is-bad':''}" data-place="${esc(p.label||'')}">
     <td><b class="lg-st is-${st[0]}">${esc(st[1])}</b></td>
     <td>${esc(p.label||'')}</td>
     <td class="lg-path">${esc(p.path||'')}${sub?`<small>${esc(sub)}</small>`:''}</td>
     <td class="lg-num">${esc(size)}</td><td class="lg-num">${esc(p.mtime||'')}</td></tr>`;
  }).join('');
  return `<dl class="lg-facts">${env.join('')}</dl>
   <table class="lg-table"><thead><tr>
     <th>状態</th><th>置き場</th><th>実際のパス</th><th>大きさ</th><th>更新</th>
    </tr></thead><tbody>${rows}</tbody></table>
   <p class="lg-note">直近の起動のログ ${num((d.records||[]).length)}件`
   +`${d.bootMarkFound?'':'（起動の区切りが見つからないので末尾を出しています）'}は、報告の文章に入ります。</p>`;
 };

 /* 接続の診断(§9.101)。別端末でだけ起きる接続不良は、エラーの文言だけでは
    「パスの解決」「存在確認(os.stat)」「実際の接続」のどれで転んだのか
    分からない。**読むだけ**で設定は一切変えない。**点検の段を開くまで
    共有へ触らない**（ログを読みに来ただけの人を待たせない）。 */
 const renderDiag=d=>{
  const box=$id('lgDiagBody'),verdict=$id('lgDiagVerdict');
  if(!box)return;
  if(!d){box.innerHTML='';if(verdict)verdict.textContent='';return}
  /* **「走った」と「答えが是」は別物**。存在確認は例外を出さなければ
     ok=true だが、値が False なら「無い」という答え。 */
  const answerNo=s=>s.ok&&String(s.value)==='False';
  const firstBad=(d.steps||[]).find(s=>!s.ok||answerNo(s));
  if(verdict){
   verdict.textContent=d.ok?'すべて成功':(firstBad?`「${firstBad.name.replace(/\s*\(.*$/,'')}」で止まった`:'失敗あり');
   verdict.className='lg-st lg-diag-verdict is-'+(d.ok?'ok':'ng');
  }
  const head=[['読み込み先',d.path||''],['絶対パス',d.is_absolute?'はい':'いいえ'],['共有パス(UNC)',d.is_unc?'はい':'いいえ']]
   .map(([k,v])=>`<div class="lg-fact lg-diag-kv"><dt>${esc(k)}</dt><dd><span>${esc(v)}</span></dd></div>`).join('');
  /* **最初に転んだ段階が原因**で、その先は道連れ。原因だけを強く出し、
     以降は薄くする(全部を赤くすると、どれを見ればよいか分からなくなる)。 */
  let broken=false;
  const rows=(d.steps||[]).map(s=>{
   const no=answerNo(s),bad=!s.ok||no;
   const cls=!bad?'is-ok':(broken?'is-after':(no?'is-no':'is-ng'));
   if(bad)broken=true;
   const detail=s.ok?(no?'ありません':(s.value||'')):((s.error||'')+(s.winerror?` (WinError ${s.winerror})`:''));
   return `<div class="lg-diag-step ${cls}">
    <span class="lg-diag-mark">${!s.ok?'×':no?'−':'✓'}</span>
    <span class="lg-diag-name">${esc(s.name)}</span>
    <span class="lg-diag-detail">${esc(detail)}</span></div>`;
  }).join('');
  box.innerHTML=`<dl class="lg-facts">${head}</dl><div class="lg-diag-steps">${rows}</div>`;
 };
 const diagText=d=>{
  if(!d)return '';
  const lines=[`接続の診断: ${d.db}`,`読み込み先: ${d.path}`,`結果: ${d.ok?'すべて成功':'失敗あり'}`,''];
  (d.steps||[]).forEach(s=>lines.push(
   `${s.ok?'OK  ':'NG  '}${s.name}: ${s.ok?(s.value||''):(s.error||'')}`+(s.winerror?` (WinError ${s.winerror})`:'')));
  return lines.join('\n');
 };
 /* 選択肢はサーバーが返した接続先から作る。**決め打ちにしない**。 */
 const fillDiagTargets=list=>{
  const sel=$id('lgDiagDb');
  if(!sel||!Array.isArray(list)||!list.length||sel.dataset.filled==='1')return;
  fillSelect('lgDiagDb',list.map(t=>`<option value="${esc(t.key)}">${esc(t.label)}（${esc(t.key)}）</option>`).join(''));
  sel.dataset.filled='1';
 };
 const runDiag=async()=>{
  diagState.ran=true;
  const box=$id('lgDiagBody');
  const key=$id('lgDiagDb')?.value||'';
  if(box)box.innerHTML='<div class="lg-empty">試しています…</div>';
  try{
   const d=await api('/api/db-diagnose?db='+encodeURIComponent(key));
   diagState.last=d;fillDiagTargets(d.targets);renderDiag(d);
  }catch(e){
   diagState.last=null;
   if(box)box.innerHTML=`<div class="lg-empty">診断できませんでした。${esc(e.message||String(e))}</div>`;
  }
 };

 /* ログの整理。ファイルごとの大きさと保存（そのままの1本）。 */
 const renderFiles=()=>{
  const box=$id('lgFiles');if(!box)return;
  box.innerHTML=`<table class="lg-table"><thead><tr><th>種類</th><th>ファイル</th><th>大きさ</th><th>更新</th><th></th></tr></thead><tbody>`
   +state.files.map(f=>`<tr><td>${esc(f.streamLabel)}${f.current?'':`<small>（${f.generation}世代前）</small>`}</td>
     <td>${esc(f.name)}</td><td class="lg-num">${num(Math.round(f.size/1024))} KB</td><td class="lg-num">${esc(f.mtime||'')}</td>
     <td><a class="lg-link" href="/api/logs/download?file=${encodeURIComponent(f.name)}" data-log-save title="このログをそのままファイルとして保存します">保存</a></td></tr>`).join('')
   +'</tbody></table>';
  /* 保存は`WL.base.saveFrom()`の1本（§9.551。ページを移す形だと、断られたとき画面が JSON に置き換わる）。 */
  box.onclick=e=>{
   const a=e.target.closest('[data-log-save]');if(!a)return;
   e.preventDefault();
   WL.base.saveFrom(a.getAttribute('href'),'wavelog.log')
    .then(n=>showToast('ログを保存しました',n+'（「ダウンロード」フォルダ）'))
    .catch(err=>showToast('ログを保存できませんでした',err.message,5200));
  };
 };
 /* 押せるかは**モードと選んだ件数**で決まる。押せないときは理由を字で
    （押しても何も起きないボタンを残さない・§CLAUDE 4）。 */
 const renderMaint=()=>{
  const ok=editable();
  const note=$id('lgMaintNote');
  if(note){
   note.hidden=ok;
   note.textContent=ok?'':`区切る・消すは編集モードのときだけ使えます（いまは${MODE_WORD[window.accessMode?.mode]||'別の'}モード）。`;
  }
  ['lgRotate','lgDelOld','lgClear'].forEach(id=>{const b=$id(id);if(b)b.disabled=!ok});
  const del=$id('lgDelPicked');
  if(del){
   const n=state.picked.size;
   del.disabled=!ok||!n;
   del.textContent=n?`選んだ ${num(n)}件を消す`:'選んだ件を消す';
   del.title=n?'「ログを見る」で選んだ件を消します':'「ログを見る」で件を選ぶと押せます';
  }
 };

 const postJson=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},
                                     body:JSON.stringify(body)});
 const maintFiles=()=>($id('lgMaintFile')?.value||'').split(',').filter(Boolean);
 const pickedRecords=()=>state.records.filter(r=>state.picked.has(r.key));
 /* 削除の宛先は**その件が居たファイル**。2つのファイルにまたがるので、
    ファイルごとに分けて送る。 */
 const byFile=records=>{
  const map=new Map();
  records.forEach(r=>{if(!map.has(r.file))map.set(r.file,[]);map.get(r.file).push(...r.lines)});
  return map;
 };
 const afterChange=async()=>{await loadFiles();if(state.logsLoaded){await load();await loadProblems()}};
 const deletePicked=async()=>{
  const recs=pickedRecords();
  if(!recs.length)return showToast('削除する件が選ばれていません','「ログを見る」で行のチェックか「この起動を選ぶ」で選んでください。');
  const rows=recs.reduce((a,r)=>a+r.lines.length,0);
  if(!await confirmModal({message:`選んだ${recs.length}件（${rows}行）を削除します。元に戻せません。`,danger:true}))return;
  let removed=0;
  try{
   for(const [file,lines] of byFile(recs))removed+=(await postJson('/api/logs/delete-lines',{file,lines})).removed||0;
  }catch(e){return showToast('削除できませんでした',e.message||String(e),5200)}
  state.picked.clear();
  showToast('ログを削除しました',`${removed}行`);
  await afterChange();
 };
 const deleteOld=async()=>{
  const days=Number($id('lgDelDays')?.value||30);
  const files=maintFiles();
  if(!await confirmModal({message:`${files.join('・')}から、${days}日より前のログを削除します。元に戻せません。`,danger:true}))return;
  let removed=0;
  try{for(const file of files)removed+=(await postJson('/api/logs/delete-old',{file,days})).removed||0}
  catch(e){return showToast('削除できませんでした',e.message||String(e),5200)}
  showToast('古いログを削除しました',`${removed}件`);
  await afterChange();
 };
 const clearAll=async()=>{
  const files=maintFiles();
  // 「区切る」との違いを押す前に言う。区切りは古い内容が1世代前へ残るが、
  // 消去は残らない。取り違えると調べる材料ごと失う。
  if(!await confirmModal({message:`${files.join('・')}の中身を空にします。**1世代前にも残りません。**\n`
             +'古い内容を取っておきたいときは「ここで区切る」を使ってください。',danger:true}))return;
  try{for(const file of files)await postJson('/api/logs/clear',{file})}
  catch(e){return showToast('消去できませんでした',e.message||String(e),5200)}
  state.picked.clear();
  showToast('ログを消去しました',files.join('・'));
  await afterChange();
 };
 const rotate=async()=>{
  const files=maintFiles();
  if(!await confirmModal(`${files.join('・')}を1つ古い世代へ送り、新しいログを始めます。`))return;
  try{for(const file of files)await postJson('/api/logs/rotate',{file})}
  catch(e){return showToast('区切れませんでした',e.message||String(e),5200)}
  showToast('ログを区切りました','ここから新しいログが始まります。');
  await afterChange();
 };

 /* ====================================================================
    段の切り替えと組み立て
    ==================================================================== */
 const showStep=async key=>{
  if(!STEPS.some(s=>s.key===key))key=STEP_DEFAULT;
  state.step=key;
  document.querySelectorAll('#lgHead .lg-step').forEach(b=>{
   const on=b.dataset.step===key;b.classList.toggle('active',on);b.setAttribute('aria-selected',on?'true':'false');
  });
  document.querySelectorAll('#logPanel .lg-page').forEach(p=>{p.hidden=p.dataset.page!==key});
  if(key!=='logs')stopAuto();       // 見ていない一覧を裏で読み直さない
  if(key==='report'){renderFacts();refreshPreview()}
  if(key==='logs'&&!state.logsLoaded){
   state.logsLoaded=true;
   await loadFiles();await Promise.all([load(),loadProblems()]);
  }
  if(key==='check'){
   renderMaint();
   if(!state.files.length)loadFiles();
   if(!bootState.last&&!bootState.busy)runBoot();
   if(!diagState.ran)runDiag();
  }
 };

 const wire=()=>{
  document.querySelectorAll('#lgHead .lg-step').forEach(b=>{b.onclick=()=>showStep(b.dataset.step)});
  $id('logPanel').addEventListener('click',e=>{
   const go=e.target.closest('[data-goto]');if(go)showStep(go.dataset.goto);
  });
  // ① 報告する
  $id('lgMemo').addEventListener('input',debounce(refreshPreview,150));
  $id('lgReportCopy').onclick=copyReport;
  $id('lgReportSave').onclick=saveReport;
  // ② ログを見る
  $id('lgReload').onclick=()=>{load();loadProblems()};
  $id('lgFile').onchange=()=>load();
  // 打っている途中で毎回投げない(1文字ごとに末尾2MBを読み直させない)
  $id('lgQuery').addEventListener('input',debounce(()=>{
   document.querySelectorAll('#lgProblems .lg-problem.is-on').forEach(x=>x.classList.remove('is-on'));
   load();
  },260));
  ['lgDays','lgLimit'].forEach(id=>$id(id).addEventListener('change',()=>load()));
  document.querySelectorAll('#lgLevel button').forEach(b=>{b.onclick=()=>{setLevel(b.dataset.v);load()}});
  $id('lgAuto').onchange=e=>{e.target.checked?startAuto():stopAuto()};
  $id('lgPickAll').onclick=()=>{state.records.forEach(r=>state.picked.add(r.key));render()};
  $id('lgPickNone').onclick=()=>{state.picked.clear();render()};
  $id('lgCopyPicked').onclick=()=>copyLines(pickedRecords().flatMap(r=>r.lines),'選んだ件をコピーしました');
  $id('lgCopyShown').onclick=()=>copyLines(state.records.flatMap(r=>r.lines),'表示中のログをコピーしました');
  $id('lgExpand').onclick=()=>document.querySelectorAll('#lgTree details').forEach(d=>d.open=true);
  $id('lgCollapse').onclick=()=>document.querySelectorAll('#lgTree details').forEach(d=>d.open=false);
  // ③ 点検と整理
  $id('lgBootRun').onclick=runBoot;
  /* **文章はサーバーが作る**（§9.163）——画面で組み立て直すと、貼られた
     内容と画面の見え方が食い違う。 */
  $id('lgBootCopy').onclick=()=>{
   const t=(bootState.last||{}).text;
   if(!t){showToast('まだまとめていません','「取り直す」を押してからコピーしてください。');return}
   copyLines(t.split('\n'),'起動の状況をコピーしました（そのまま貼れます）');
  };
  $id('lgDiagRun').onclick=runDiag;
  $id('lgDiagCopy').onclick=()=>copyLines(diagText(diagState.last).split('\n'),'診断の結果をコピーしました');
  $id('lgRotate').onclick=rotate;
  $id('lgDelPicked').onclick=deletePicked;
  $id('lgDelOld').onclick=deleteOld;
  $id('lgClear').onclick=clearAll;
 };

 /* カードは1つの型（見出し＋補足＋右端の操作）。`note`は字、または
    あとから書き換える器（{id,text}）。 */
 const card=(cls,title,note,body,acts)=>{
  const n=typeof note==='string'?{text:note}:note;
  return `<section class="lg-card ${cls}">
   <header class="lg-card-head"><h3>${esc(title)}</h3>${n?`<span class="lg-card-note"${n.id?` id="${n.id}"`:''}>${esc(n.text||'')}</span>`:''}
    ${acts?`<span class="lg-card-acts">${acts}</span>`:''}</header>${body}</section>`;
 };
 const opts=(list,sel)=>list.map(([v,t])=>`<option value="${v}"${v===sel?' selected':''}>${t}</option>`).join('');

 const ensurePanel=()=>{
  let panel=$id('logPanel');if(panel)return panel;
  panel=document.createElement('section');panel.className='lg-panel';panel.id='logPanel';panel.hidden=true;
  const head=`<div class="lg-head-tools" id="lgHead">
    <div class="lg-steps" role="tablist" aria-label="ログ・診断の段">
     ${STEPS.map(s=>`<button type="button" class="lg-step" role="tab" data-step="${s.key}" title="${esc(s.tip)}">
       <i class="fa-solid ${s.icon}" aria-hidden="true"></i>${esc(s.label)}</button>`).join('')}
    </div></div>`;
  const report=`<div class="lg-page lg-page-report" data-page="report" hidden>
    ${card('lg-send','開発へ報告する',null,`
     <p class="lg-lead">困ったことが起きたら、ここから開発へ送ってください。この端末の記録を集めて、1つの文章にまとめます。</p>
     <ol class="lg-flow">
      <li><span class="lg-flow-no">1</span><div class="lg-flow-body">
        <label class="lg-flow-title" for="lgMemo">何が起きたかを書く<small>任意</small></label>
        <textarea id="lgMemo" rows="4" placeholder="例）測定画面で「保存」を押したら固まった。10時ごろから、2回続けて。"></textarea></div></li>
      <li><span class="lg-flow-no">2</span><div class="lg-flow-body">
        <span class="lg-flow-title">コピーして、メールやチャットへ貼る</span>
        <div class="lg-flow-acts">
         <button type="button" class="lg-primary" id="lgReportCopy"><i class="fa-solid fa-copy" aria-hidden="true"></i>報告をコピー</button>
         <button type="button" id="lgReportSave" title="貼り付けでは崩れるときや、長いときに"><i class="fa-solid fa-download" aria-hidden="true"></i>ファイルに保存</button>
        </div>
        <p class="lg-done" id="lgReportDone" aria-live="polite"></p></div></li>
     </ol>
     <h4 class="lg-sub">報告に入るもの（自動で集めます）</h4>
     <dl class="lg-facts" id="lgFacts"></dl>`)}
    ${card('lg-preview','送る内容',{id:'lgPreviewSize',text:''},
     '<textarea id="lgPreview" readonly spellcheck="false" aria-label="送る内容（コピーされる文章そのもの）"></textarea>')}
   </div>`;
  const logs=`<div class="lg-page lg-page-logs" data-page="logs" hidden>
    ${card('lg-problems','問題のまとめ',null,
     '<p class="lg-note"><b class="lg-count" id="lgProblemsCount"></b>同じ内容は1つにまとめています。押すと、その件だけに絞ります。</p><div class="lg-problem-list" id="lgProblems"></div>')}
    <section class="lg-card lg-reader">
     <div class="lg-bar">
      <label class="lt-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
       <input id="lgQuery" type="search" placeholder="ログを検索（語・例外名）"></label>
      <div class="lg-seg" id="lgLevel" role="radiogroup" aria-label="重要度">
       ${LEVELS.map(([v,t])=>`<button type="button" role="radio" data-v="${v}">${t}</button>`).join('')}</div>
      <label class="lg-field"><span>期間</span><select id="lgDays">${opts(DAYS,'0')}</select></label>
      <label class="lg-field"><span>対象</span><select id="lgFile"></select></label>
      <span class="lg-bar-end">
       <label class="lg-check" title="開いている間、${AUTO_MS/1000}秒ごとに読み直します"><input type="checkbox" id="lgAuto">自動更新</label>
       <button type="button" id="lgReload" title="いまのログを読み直します"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i>再読込</button>
      </span>
     </div>
     <div class="lg-bar">
      <span class="lg-count" id="lgSummary">読み込んでいます…</span>
      <span class="lg-sep" aria-hidden="true"></span>
      <span class="lg-count" id="lgPickState">選んだ 0件</span>
      <button type="button" id="lgPickAll">表示中をすべて選ぶ</button>
      <button type="button" id="lgPickNone">選択を外す</button>
      <button type="button" id="lgCopyPicked">選んだ件をコピー</button>
      <button type="button" id="lgCopyShown">表示中をコピー</button>
      <span class="lg-bar-end">
       <button type="button" id="lgExpand">すべて開く</button>
       <button type="button" id="lgCollapse">すべて畳む</button>
       <label class="lg-field" title="新しいほうから何件まで読むか"><span>表示</span><select id="lgLimit">${LIMITS.map(x=>`<option value="${x}"${x==='1500'?' selected':''}>${x}件</option>`).join('')}</select></label>
      </span>
     </div>
     <div class="lg-tree" id="lgTree"><div class="lg-empty">読み込んでいます…</div></div>
    </section>
   </div>`;
  const check=`<div class="lg-page lg-page-check" data-page="check" hidden>
    ${card('lg-boot','起動の状況','いま見に行っている置き場と、この起動の素性（読むだけ）',
     '<div class="lg-card-body" id="lgBootBody"></div>',
     '<button type="button" id="lgBootRun">取り直す</button><button type="button" id="lgBootCopy">この内容をコピー</button>')}
    <div class="lg-stack">
     ${card('lg-diag','接続の診断','データベースを開くまでを1段ずつ試します（読むだけ）',`
      <div class="lg-bar">
       <label class="lg-field"><span>対象</span><select id="lgDiagDb"></select></label>
       <button type="button" id="lgDiagRun">診断する</button>
       <button type="button" id="lgDiagCopy">結果をコピー</button>
       <b class="lg-st lg-diag-verdict" id="lgDiagVerdict"></b>
      </div>
      <div class="lg-card-body" id="lgDiagBody"></div>`)}
     ${card('lg-maint','ログの整理','この端末のログファイル',`
      <div class="lg-card-body" id="lgFiles"></div>
      <div class="lg-bar">
       <label class="lg-field"><span>対象</span><select id="lgMaintFile"></select></label>
       <button type="button" id="lgRotate" title="いまのログを1つ古い世代へ送り、新しいログを始めます（古い内容は残ります）">ここで区切る</button>
      </div>
      <div class="lg-danger-zone">
       <span class="lg-danger-title">消す（元に戻せません）</span>
       <button type="button" class="lg-danger" id="lgDelPicked">選んだ件を消す</button>
       <span class="lg-join"><select id="lgDelDays" aria-label="残す日数">${opts(DEL_DAYS,'30')}</select>
        <button type="button" class="lg-danger" id="lgDelOld">より前を消す</button></span>
       <button type="button" class="lg-danger" id="lgClear" title="選んだログの中身を空にします。1世代前にも残りません">中身をすべて消す</button>
      </div>
      <p class="lg-note" id="lgMaintNote" hidden></p>`)}
    </div>
   </div>`;
  panel.innerHTML=head+report+logs+check;
  (document.querySelector('main')||document.body).append(panel);
  setLevel('all');
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
 /* 開くのは**いつも「報告する」**——この画面へ来る人のいちばん多い用件で、
    端末は人をまたいで使われる（前の人が見ていた段で開くと、報告しに来た人が
    探すことになる）。`step`を渡せば別の段で開ける。 */
 const openLogView=async(step)=>{
  WL.enterView('logs');
  ensurePanel().hidden=false;
  WL.syncViewToolbar('logs');       // 操作列(#lgHead)はパネル生成後にヘッダーへ載せる
  const s=typeof step==='string'?step:STEP_DEFAULT;
  await showStep(s);
  /* **開いた時点でまとめておく**（探させない）——読むだけなので安い。 */
  if(!bootState.last)await runBoot();
  else{renderFacts();refreshPreview()}
 };
 const ensureNavButton=()=>{
  const nav=document.querySelector('#adminNav');if(!nav||$id('openLogView'))return;
  const b=document.createElement('button');b.type='button';b.id='openLogView';
  b.className='db nav-item nav-item--admin';
  b.innerHTML='<svg class="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg><span>ログ・診断</span>';
  b.title='困ったことを開発へ報告する・この端末の記録を読む・起動と接続を点検する';
  b.onclick=()=>openLogView();nav.append(b);
 };

 WL.registerView({key:'logs',bodyClass:'lg-mode',nav:'openLogView',toolbar:'#lgHead',compactToolbar:true,
  header:['ログ・診断','開発への報告・この端末の記録・起動と接続の点検'],exit:exitLogView});

 window.WL=window.WL||{};
 WL.logView={open:openLogView,showStep,load,loadProblems,groupByBoot,reportText,state,bootState,runBoot};

 queueMicrotask(()=>{ensureNavButton()});
})();
