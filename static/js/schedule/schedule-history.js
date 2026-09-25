/* schedule-history.js: 作業スケジュールの過去履歴（§9.502、利用者の指示・案A）。
   ------------------------------------------------------------
   「過去履歴については、Aで対応し、設備停止も含んだ形で記録のすべてを残し、フィルタなども
    検索しやすいように実装してわかりやすく使いやすい形でUIUX設計をお願いします。」

   **段「履歴」**（全体・個別・刃組の隣）。見るだけの画面で、予定を直す操作は持たない。
     左 … 期間の送り（日・週・月・期間）／探す（この期間・全期間）／区分の札（件数つき）／
          現場歴の日付と直ごとに束ねた表
     右 … 月の暦（日ごとの記録の数）と、期間の時間の合計（出どころつき）
   **材料と規則はサーバーが持つ**（`backend/schedule_history.py`）——区分・時刻の出どころ・
   現場歴・探す規則を画面へ写さない。画面は返ってきた記録を並べ、区分の札で見せる／隠すだけ。
   スケジュール画面とは`WL.scheduleHistory.show(host, ctx)`の1つの口でつながる（`ctx`が
   設備・内容の列・表示名・値の取り出しを答える）。 */
(function(){
 'use strict';
 const PREF_KEY='wl.scheduleHistory.v1';
 const UNITS=[['day','日'],['week','週'],['month','月'],['range','期間']];
 const WEEK=['日','月','火','水','木','金','土'];
 /* 区分の札の色（**意味で選ぶ**・style.md「状態チップの色」）: 完了＝中立の濃い字／取消・外した＝
    薄める（起きなかったこと）／設備停止＝橙（作業以外で止まった）／申し送り＝青／計画外＝紫。 */
 const CAT_TONE={done:'done',cancel:'off',removed:'off',stop:'stop',comment:'note',unplanned:'extra'};

 let host=null,ctx=null;
 /* `anchor`が`null`＝「現場歴の今日」をサーバーに聞く（暦の今日ではない——3直の0時〜7時は
    前の日に入る。答えるのは`schedule_history.history()`の1箇所）。`today`はその答えの控え。 */
 const st={unit:'day',anchor:null,today:'',from:'',to:'',q:'',scope:'period',off:new Set(),
           data:null,error:'',seq:0,loading:false,cal:null,timer:0};

 /* ---------- 日付（**文字列のまま**組み立てる。`new Date('YYYY-MM-DD')`はUTCの0時になる） ---------- */
 const pad=n=>String(n).padStart(2,'0');
 const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
 const parse=s=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s||''));return m?new Date(+m[1],+m[2]-1,+m[3]):null};
 const addDays=(d,n)=>new Date(d.getFullYear(),d.getMonth(),d.getDate()+n);
 const md=d=>`${d.getMonth()+1}/${d.getDate()}`;
 const mdw=d=>`${md(d)}（${WEEK[d.getDay()]}）`;
 const hm=iso=>{if(!iso)return '';const d=new Date(iso);return Number.isNaN(d.getTime())?'':`${pad(d.getHours())}:${pad(d.getMinutes())}`};
 const dur=m=>(m===null||m===undefined||m==='')?'':WL.duration.text(Number(m));

 function loadPrefs(){
  try{
   const p=JSON.parse(localStorage.getItem(PREF_KEY)||'{}');
   if(UNITS.some(u=>u[0]===p.unit))st.unit=p.unit;
   if(Array.isArray(p.off))st.off=new Set(p.off.map(String));
   if(p.scope==='all'||p.scope==='period')st.scope=p.scope;
  }catch(e){WL.quiet.note('履歴の見せ方を読めない（既定で出す）',e)}
 }
 function savePrefs(){
  try{localStorage.setItem(PREF_KEY,JSON.stringify({unit:st.unit,off:[...st.off],scope:st.scope}))}
  catch(e){WL.quiet.note('履歴の見せ方を覚えられない（次は既定で出す）',e)}
 }

 /* いま見ている期間（両端を含む）。**答えはここ1箇所**——送り・見出し・暦の印が同じものを見る。 */
 function period(){
  const a=st.anchor||parse(st.today)||new Date();
  if(st.unit==='week'){const mon=addDays(a,-((a.getDay()+6)%7));return [mon,addDays(mon,6)]}
  if(st.unit==='month')return [new Date(a.getFullYear(),a.getMonth(),1),new Date(a.getFullYear(),a.getMonth()+1,0)];
  if(st.unit==='range'){
   const f=parse(st.from)||a,t=parse(st.to)||a;
   return f<=t?[f,t]:[t,f];
  }
  return [a,a];
 }
 function periodLabel(){
  const [f,t]=period();
  if(st.unit==='day')return mdw(f);
  if(st.unit==='month')return `${f.getFullYear()}年${f.getMonth()+1}月`;
  if(+f===+t)return mdw(f);
  /* 同じ月なら終わりの月を省く（「9/21（月）〜27（日）」）。見出しの幅を送っても変えないため。 */
  const end=f.getMonth()===t.getMonth()?`${t.getDate()}（${WEEK[t.getDay()]}）`:mdw(t);
  return `${mdw(f)}〜${end}`;
 }
 function step(dir){
  const a=st.anchor||parse(st.today)||new Date();
  if(st.unit==='week')st.anchor=addDays(a,7*dir);
  else if(st.unit==='month')st.anchor=new Date(a.getFullYear(),a.getMonth()+dir,1);
  else if(st.unit==='range'){
   const [f,t]=period();const n=Math.round((t-f)/86400000)+1;
   st.from=ymd(addDays(f,n*dir));st.to=ymd(addDays(t,n*dir));st.anchor=parse(st.to);
  }else st.anchor=addDays(a,dir);
  st.cal=null;
  reload();
 }

 /* ---------- 読み込み ---------- */
 async function reload(){
  if(!host||!ctx)return;
  const eq=ctx.equipment();
  if(!eq){st.data=null;st.error='';renderAll();return}
  /* 設備が替わったら前の設備の中身は捨てる（読み込み中に前の設備の行・暦・合計を見せない・§9.502の追補3）。 */
  if(st.data&&st.data.equipment!==eq){st.data=null;st.cal=null;renderAll()}
  const [f,t]=period();
  const seq=++st.seq;
  st.loading=true;renderBar();
  const q=new URLSearchParams({equipment:eq,keys:JSON.stringify(ctx.requestKeys())});
  /* 「今日」は**現場歴の今日**をサーバーに聞く。単位「期間」でも、期間をまだ決めていなければ聞く
     （聞かないとブラウザの暦の今日になり、3直の0〜7時に前の日の記録が出ない・§9.502の追補3）。 */
  const askToday=!st.anchor&&!(st.unit==='range'&&st.from&&st.to);
  if(!askToday){q.set('from',ymd(f));q.set('to',ymd(t))}
  if(st.q.trim()){q.set('q',st.q.trim());q.set('scope',st.scope)}
  try{
   const r=await api('/api/schedule/history?'+q.toString(),{quiet:true});
   if(seq!==st.seq)return;                 // 遅れて届いた古い答えは捨てる（§9.200）
   st.today=r.today||st.today;
   if(askToday){
    st.anchor=parse(r.today)||new Date();
    /* 週・月は「今日を含む期間」を取り直す（1回目は今日の1日ぶんしか来ていない）。 */
    if(st.unit!=='day'){st.loading=false;return reload()}
   }
   st.data=r;st.error='';
  }catch(e){
   if(seq!==st.seq)return;
   st.data=null;st.error=e&&e.message?e.message:String(e);
  }
  st.loading=false;
  renderAll();
 }

 /* ---------- 描画 ---------- */
 function shell(){
  host.innerHTML=`
  <div class="sh-main">
   <div class="sh-bar" id="shBar"></div>
   <div class="sh-cats" id="shCats" role="group" aria-label="区分で見せる／隠す"></div>
   <div class="sh-notes" id="shNotes"></div>
   <div class="sh-scroll" id="shScroll"></div>
  </div>
  <aside class="sh-side" id="shSide"></aside>`;
 }
 function renderAll(){
  if(!host)return;
  if(!host.querySelector('#shBar'))shell();
  renderBar();renderCats();renderNotes();renderTable();renderSide();
 }

 function renderBar(){
  const bar=host&&host.querySelector('#shBar');if(!bar)return;
  const active=document.activeElement;
  const typing=active&&active.id==='shQuery';
  if(!bar.firstChild){
   bar.innerHTML=`
   <div class="sh-nav">
    <button type="button" class="sh-btn" id="shPrev" title="前の期間"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>前</span></button>
    <b class="sh-period" id="shPeriod"></b>
    <button type="button" class="sh-btn" id="shNext" title="次の期間"><span>次</span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
    <button type="button" class="sh-btn" id="shToday" title="現場歴の今日（勤務の日付補正を当てた1日）を含む期間へ戻ります">今日</button>
   </div>
   <div class="sh-seg" id="shUnits" role="group" aria-label="期間の単位">${
    UNITS.map(([k,l])=>`<button type="button" class="sh-seg-btn" data-unit="${k}">${l}</button>`).join('')}</div>
   <span class="sh-range" id="shRange" hidden>
    <input type="date" id="shFrom" aria-label="期間の始め"><span>〜</span><input type="date" id="shTo" aria-label="期間の終わり">
   </span>
   <span class="sh-grow"></span>
   <label class="sh-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
    <input type="search" id="shQuery" placeholder="ロット番号・名称・担当" autocomplete="off" aria-label="履歴を探す"></label>
   <div class="sh-seg" id="shScope" role="group" aria-label="探す範囲">
    <button type="button" class="sh-seg-btn" data-scope="period" title="いま見ている期間の中だけで探します">この期間</button>
    <button type="button" class="sh-seg-btn" data-scope="all" title="期間を見ずに、残っている記録すべてから探します（新しい500件まで）">全期間</button>
   </div>`;
   bar.querySelector('#shPrev').onclick=()=>step(-1);
   bar.querySelector('#shNext').onclick=()=>step(1);
   bar.querySelector('#shToday').onclick=()=>{st.anchor=null;if(st.unit==='range'){st.unit='day'}st.cal=null;savePrefs();reload()};
   bar.querySelectorAll('[data-unit]').forEach(b=>b.onclick=()=>{
    const u=b.dataset.unit;if(u===st.unit)return;
    if(u==='range'){const [f,t]=period();st.from=ymd(f);st.to=ymd(t)}
    st.unit=u;savePrefs();reload();
   });
   const onRange=()=>{st.from=bar.querySelector('#shFrom').value;st.to=bar.querySelector('#shTo').value;st.anchor=parse(st.to)||st.anchor;reload()};
   bar.querySelector('#shFrom').onchange=onRange;bar.querySelector('#shTo').onchange=onRange;
   const qi=bar.querySelector('#shQuery');
   qi.oninput=()=>{st.q=qi.value;clearTimeout(st.timer);st.timer=setTimeout(reload,250)};
   qi.onkeydown=e=>{if(e.key==='Escape'&&qi.value){e.preventDefault();qi.value='';st.q='';reload()}};
   bar.querySelectorAll('[data-scope]').forEach(b=>b.onclick=()=>{st.scope=b.dataset.scope;savePrefs();if(st.q.trim())reload();else renderBar()});
  }
  bar.querySelector('#shPeriod').textContent=(st.q.trim()&&st.scope==='all')?'全期間から探しています':periodLabel();
  bar.querySelectorAll('[data-unit]').forEach(b=>b.classList.toggle('is-on',b.dataset.unit===st.unit));
  bar.querySelectorAll('[data-scope]').forEach(b=>b.classList.toggle('is-on',b.dataset.scope===st.scope));
  const rg=bar.querySelector('#shRange');rg.hidden=st.unit!=='range';
  if(st.unit==='range'){const [f,t]=period();bar.querySelector('#shFrom').value=ymd(f);bar.querySelector('#shTo').value=ymd(t)}
  if(!typing)bar.querySelector('#shQuery').value=st.q;
  const searchingAll=!!st.q.trim()&&st.scope==='all';
  ['#shPrev','#shNext','#shToday'].forEach(s=>{bar.querySelector(s).disabled=searchingAll});
  bar.classList.toggle('is-loading',st.loading);
 }

 function cats(){return (st.data&&st.data.cats)||[]}
 function visible(){
  const es=(st.data&&st.data.entries)||[];
  return es.filter(e=>!st.off.has(e.cat));
 }
 function renderCats(){
  const box=host.querySelector('#shCats');if(!box)return;
  const es=(st.data&&st.data.entries)||[];
  const n={};es.forEach(e=>{n[e.cat]=(n[e.cat]||0)+1});
  box.innerHTML=cats().map(c=>{
   const on=!st.off.has(c.key);
   return `<button type="button" class="sh-cat sh-tone-${CAT_TONE[c.key]||'done'}${on?' is-on':''}" data-cat="${esc(c.key)}"
    aria-pressed="${on}" title="${esc(c.note)}（押すと${on?'隠します':'出します'}）"><i class="sh-dot" aria-hidden="true"></i>${esc(c.label)}<b>${n[c.key]||0}</b></button>`;
  }).join('')+(st.off.size?`<button type="button" class="sh-btn sh-cat-all" id="shCatAll" title="隠している区分をすべて出します">すべて出す</button>`:'');
  box.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{
   const k=b.dataset.cat;if(st.off.has(k))st.off.delete(k);else st.off.add(k);
   savePrefs();renderCats();renderTable();renderSide();
  });
  const all=box.querySelector('#shCatAll');if(all)all.onclick=()=>{st.off.clear();savePrefs();renderCats();renderTable();renderSide()};
 }
 function renderNotes(){
  const box=host.querySelector('#shNotes');if(!box)return;
  const notes=[...((st.data&&st.data.notes)||[])];
  if(st.data&&st.data.undated)notes.push(`日時の分からない記録が${st.data.undated}件あります（期間では絞れないので、ここには出していません）。`);
  box.innerHTML=notes.map(n=>`<p class="sh-note">${esc(n)}</p>`).join('');
  box.hidden=!notes.length;
 }

 /* 表の列: 区分／時刻／所要／ロット番号・名称／内容の列（個別の段で出している項目）／記録（出どころ・誰が）。 */
 function columns(){return ctx.contentKeys().filter(k=>k!=='lotNo')}
 function timeText(e){
  if(e.cat==='stop')return `<span title="入れた日時 → 外した日時（設備停止は実際に止まった時刻を記録していません）">${hm(e.createdAt)} → ${hm(e.removedAt||e.at)}</span>`;
  if(e.start)return `${hm(e.start)}〜${e.end?hm(e.end):''}`;
  return hm(e.at);
 }
 function minutesText(e){
  /* 入れたときに分を持っていなかった行は、いまの予定と同じ見積で数える。**出どころを添える**（推測させない）。 */
  if(e.cat==='stop')return e.minutes!==null&&e.minutes!==undefined?`<span class="sh-est" title="見積の分（実際に止まった時間ではありません）${e.minutesSource?`\n入れたときに分を持っていなかった行です。出どころ: ${esc(e.minutesSource)}`:''}">見積 ${esc(dur(e.minutes))}${e.minutesSource?'<i class="sh-est-src">*</i>':''}</span>`:'';
  return esc(dur(e.minutes));
 }
 function nameText(e){
  if(e.cat==='stop')return `<b>${esc(e.title||'設備停止')}</b>${e.subText?`<small>${esc(e.subText)}</small>`:''}`;
  if(e.cat==='comment')return `<span class="sh-comment">${esc(e.title||'（空の申し送り）')}</span>`;
  const kids=(e.children||[]).length?`<small title="${esc(e.children.join('、'))}">子${e.children.length}</small>`:'';
  return `<b>${esc(e.lotNo||'（ロット番号なし）')}</b>${kids}`;
 }
 function recordText(e){
  const who=(name,pc)=>name?`${esc(name)}${pc?`<small>（${esc(pc)}）</small>`:''}`:'';
  if(e.cat==='done'||e.cat==='unplanned'){
   const src=e.atSource==='測定データの実績'?'測定データ':esc(e.atSource);
   return `${src}${e.who?`・${esc(e.who)}`:''}${e.removed?`<small class="sh-off">（予定からは ${hm(e.removedAt)} に外した）</small>`:''}`;
  }
  if(e.cat==='removed'||e.cat==='stop')return `外した ${who(e.updatedBy,e.updatedPc)}`;
  if(e.cat==='cancel')return `取消にした ${who(e.updatedBy,e.updatedPc)}`;
  if(e.cat==='comment')return `書いた ${who(e.createdBy,e.createdPc)}${e.removed?'<small class="sh-off">（外した）</small>':''}`;
  return esc(e.atSource);
 }
 function groups(list){
  const order=(st.data&&st.data.shifts)||[];
  const out=[];let cur=null;
  list.forEach(e=>{
   const key=(e.fieldDate||'')+'|'+(e.shift||'');
   if(!cur||cur.key!==key){cur={key,date:e.fieldDate,shift:e.shift||'',rows:[]};out.push(cur)}
   cur.rows.push(e);
  });
  const rank=s=>{const i=order.indexOf(s);return i<0?order.length:i};
  out.sort((a,b)=>(a.date||'').localeCompare(b.date||'')||rank(a.shift)-rank(b.shift));
  return out;
 }
 function groupSummary(rows){
  const sum=(pred,f)=>rows.filter(pred).reduce((a,e)=>a+(Number(f(e))||0),0);
  const work=sum(e=>e.cat==='done'||e.cat==='unplanned',e=>e.minutes);
  const stop=sum(e=>e.cat==='stop',e=>e.minutes);
  const parts=[];
  if(work)parts.push(`作業 ${dur(work)}`);
  if(stop)parts.push(`設備停止 見積 ${dur(stop)}`);
  return parts.join('・');
 }
 function renderTable(){
  const box=host.querySelector('#shScroll');if(!box)return;
  if(!ctx.equipment()){box.innerHTML='<div class="sh-empty">設備を選んでください。</div>';return}
  if(st.error){box.innerHTML=`<div class="sh-empty is-error"><b>履歴を読めませんでした</b><p>${esc(st.error)}</p><button type="button" class="sh-btn" id="shRetry">もう一度読む</button></div>`;
   box.querySelector('#shRetry').onclick=()=>reload();return}
  if(!st.data){box.innerHTML=`<div class="sh-empty">${WL.loader.html(16)}<b>履歴を読み込んでいます</b></div>`;return}
  const list=visible();
  if(!list.length){box.innerHTML=emptyHtml();bindEmpty(box);return}
  const cols=columns();
  const head=`<tr><th class="sh-c-cat">区分</th><th class="sh-c-time">時刻</th><th class="sh-c-min">所要</th><th class="sh-c-name">ロット番号・名称</th>${
  cols.map(k=>`<th>${esc(ctx.label(k))}</th>`).join('')}<th class="sh-c-rec">記録</th></tr>`;
  const span=5+cols.length;
  const body=groups(list).map(g=>{
   const d=parse(g.date);
   const n={};g.rows.forEach(e=>{n[e.cat]=(n[e.cat]||0)+1});
   const counts=cats().filter(c=>n[c.key]).map(c=>`${esc(c.label)} ${n[c.key]}`).join('・');
   const sum=groupSummary(g.rows);
   return `<tr class="sh-group"><th colspan="${span}"><span class="sh-g-date">${d?mdw(d):'日付不明'}</span>${
    g.shift?`<span class="sh-g-shift">${esc(g.shift)}</span>`:''}<span class="sh-g-count">${counts}</span>${
    sum?`<span class="sh-g-sum">${esc(sum)}</span>`:''}</th></tr>`+g.rows.map(e=>{
    const c=cats().find(x=>x.key===e.cat)||{label:e.cat,note:''};
    return `<tr class="sh-row sh-tone-${CAT_TONE[e.cat]||'done'}" data-id="${esc(String(e.id))}" data-cat="${esc(e.cat)}">
    <td class="sh-c-cat"><span class="sh-tag" title="${esc(c.note)}">${esc(c.label)}</span></td>
    <td class="sh-c-time" title="${esc(e.atSource)}">${timeText(e)}</td>
    <td class="sh-c-min">${minutesText(e)}</td>
    <td class="sh-c-name">${nameText(e)}${e.remark?`<small class="sh-remark" title="備考">${esc(e.remark)}</small>`:''}</td>
    ${cols.map(k=>`<td>${esc(String(ctx.valueOf(e.detail||{},k)??''))}</td>`).join('')}
    <td class="sh-c-rec">${recordText(e)}</td></tr>`;
   }).join('');
  }).join('');
  box.innerHTML=`<table class="sh-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
 }
 /* 0件のとき: **なぜ0件か**と**次の1手**を言う（§9.452の作法）。 */
 function emptyHtml(){
  const all=(st.data&&st.data.entries)||[];
  if(all.length)return `<div class="sh-empty"><b>隠している区分の記録だけです</b><p>${all.length}件あります。</p><button type="button" class="sh-btn" data-empty="cats">すべて出す</button></div>`;
  if(st.q.trim()){
   const next=st.scope==='period'?`<button type="button" class="sh-btn" data-empty="all">全期間から探す</button>`:'';
   return `<div class="sh-empty"><b>「${esc(st.q.trim())}」に当たる記録は${st.scope==='all'?'残っている記録の中に':'この期間に'}ありません</b>${next}</div>`;
  }
  const near=nearestDay();
  return `<div class="sh-empty"><b>${esc(periodLabel())}の記録はありません</b>${
  near?`<button type="button" class="sh-btn" data-empty="day" data-day="${near}">記録のある近くの日（${mdw(parse(near))}）へ</button>`:'<p>この設備の記録はまだありません。</p>'}</div>`;
 }
 function bindEmpty(box){
  box.querySelectorAll('[data-empty]').forEach(b=>b.onclick=()=>{
   const k=b.dataset.empty;
   if(k==='cats'){st.off.clear();savePrefs();renderCats();renderTable();renderSide()}
   else if(k==='all'){st.scope='all';savePrefs();reload()}
   else if(k==='day'){st.unit='day';st.anchor=parse(b.dataset.day);st.cal=null;savePrefs();reload()}
  });
 }
 function nearestDay(){
  const days=Object.keys((st.data&&st.data.days)||{}).sort();if(!days.length)return '';
  const [f]=period();const want=ymd(f);
  let best='',gap=Infinity;
  days.forEach(d=>{const g=Math.abs(parse(d)-parse(want));if(g<gap){gap=g;best=d}});
  return best;
 }

 /* ---------- 右: 月の暦と期間の合計 ---------- */
 function renderSide(){
  const box=host.querySelector('#shSide');if(!box)return;
  if(!ctx.equipment()){box.innerHTML='';return}
  const [f,t]=period();
  const m=st.cal||new Date(t.getFullYear(),t.getMonth(),1);
  const days=(st.data&&st.data.days)||{};
  const shown=d=>Object.entries(days[d]||{}).filter(([k])=>!st.off.has(k)).reduce((a,[,v])=>a+v,0);
  const first=new Date(m.getFullYear(),m.getMonth(),1),last=new Date(m.getFullYear(),m.getMonth()+1,0);
  const lead=(first.getDay()+6)%7;           // 月曜はじまり
  const max=Math.max(1,...Array.from({length:last.getDate()},(_,i)=>shown(ymd(new Date(m.getFullYear(),m.getMonth(),i+1)))));
  const today=st.today||ymd(new Date());
  let cells='';
  for(let i=0;i<lead;i++)cells+='<span class="sh-day is-pad"></span>';
  for(let i=1;i<=last.getDate();i++){
   const d=new Date(m.getFullYear(),m.getMonth(),i),k=ymd(d),n=shown(k);
   const lvl=n?Math.min(3,Math.ceil(n/max*3)):0;
   const inP=d>=f&&d<=t;
   cells+=`<button type="button" class="sh-day lv${lvl}${inP?' is-in':''}${k===today?' is-today':''}" data-day="${k}"
    title="${mdw(d)}：${n?`記録 ${n}件`:'記録なし'}${k===today?'（今日）':''}">${i}${n?`<small>${n}</small>`:''}</button>`;
  }
  const list=visible();
  const sum=(pred,f2)=>list.filter(pred).reduce((a,e)=>a+(Number(f2(e))||0),0);
  const work=sum(e=>e.cat==='done'||e.cat==='unplanned',e=>e.minutes);
  const workN=list.filter(e=>(e.cat==='done'||e.cat==='unplanned')&&e.minutes!==null&&e.minutes!==undefined).length;
  const stop=sum(e=>e.cat==='stop',e=>e.minutes);
  box.innerHTML=`
  <div class="sh-cal-head">
   <button type="button" class="sh-btn sh-ico" data-cal="-1" title="前の月"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
   <b>${m.getFullYear()}年${m.getMonth()+1}月</b>
   <button type="button" class="sh-btn sh-ico" data-cal="1" title="次の月"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
  </div>
  <div class="sh-cal">${['月','火','水','木','金','土','日'].map(w=>`<i>${w}</i>`).join('')}${cells}</div>
  <p class="sh-legend">日付の下の数＝その日の記録の数（出している区分だけ）。押すとその日を出します。</p>
  <dl class="sh-kpi">
   <div><dt>作業の時間</dt><dd>${work?esc(dur(work)):'—'}</dd><small>測定データの開始〜終了の合計（${workN}件）</small></div>
   <div><dt>設備停止</dt><dd>${stop?esc(dur(stop)):'—'}</dd><small>見積の分の合計（実際に止まった時間は記録していません）</small></div>
  </dl>
  <p class="sh-ro"><b>履歴は見るだけです。</b>並べ替え・外す・開始は「個別」でします。</p>
  <button type="button" class="sh-btn sh-back" id="shToSingle"><i class="fa-solid fa-list" aria-hidden="true"></i> 個別へ戻る</button>`;
  box.querySelectorAll('[data-cal]').forEach(b=>b.onclick=()=>{st.cal=new Date(m.getFullYear(),m.getMonth()+Number(b.dataset.cal),1);renderSide()});
  box.querySelectorAll('.sh-day[data-day]').forEach(b=>b.onclick=()=>{
   st.unit='day';st.anchor=parse(b.dataset.day);savePrefs();
   if(st.q.trim()&&st.scope==='all'){st.q='';}
   reload();
  });
  box.querySelector('#shToSingle').onclick=()=>ctx.toSingle();
 }

 WL.scheduleHistory={
  /* 段「履歴」を`host`へ出す。`c`はスケジュール画面が渡す口（設備・内容の列・表示名・値・戻り道）。 */
  show(h,c){
   const first=!host;
   host=h;ctx=c;
   if(first){loadPrefs();st.anchor=null}
   host.classList.add('sh-wrap');
   if(!host.querySelector('#shBar'))shell();
   renderAll();
   reload();
  },
  /* 設備が変わった・「再計算」を押した。期間と見せ方はそのまま、中身だけ取り直す。 */
  reload:()=>reload(),
  /* 網が読む口（画面の字を数えない）。 */
  state:()=>({unit:st.unit,period:period().map(ymd),q:st.q,scope:st.scope,off:[...st.off],
              equipment:(st.data&&st.data.equipment)||'',
              loading:st.loading,error:st.error,count:((st.data&&st.data.entries)||[]).length,visible:visible().length}),
 };
})();
