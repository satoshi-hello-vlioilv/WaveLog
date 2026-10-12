/* ============================================================
   master-stoprule.js: 設備停止の挿入条件の盤（§9.588 → §9.590 で作り直した）

   利用者の指示:
   「判定条件は設備停止マスタの設備停止ごとに持たせ、…その設備停止の挿入数、挿入すべきそれぞれの時間と自動挿入か、
    警告のみか選べるようにします。」（§9.588）
   「設備停止挿入条件が作りにくく使いにくいです。一覧表にある表示列の『この列の作り方』のような条件入力ができると
    やりやすい。別リポジトリの LotScope の表示列の UI の配置などを参考に」（§9.590）

   作り（7案→組合せ7案から H1）: 設備停止マスタの右の段「挿入の条件」の中身。
    ・左＝**決まりの札**（上から順に・最初に当たった1枚）。札は「もし 製造材質 が変わる なら → 1本・45分・自動で入れる」と
      文で読める。押した札がその場で開き、**組み立てる｜式を書く**（LotScope の「この列の作り方」と同じ2つの札）と答えの欄。
    ・右＝**いまの予定の境目で試した結果**（どの境目にどの札が当たるか・足りないか）。保存の前に結果が見える。
   式は一覧の式（`WL.formula`）と同じ書き方・名前は `[前.列]`／`[後.列]`。組み立ての部品は`core/formula-builder.js`、
   見方の語彙と判定は`schedule/stop-rules.js`（`HOWS`・`ruleHit()`——予定の判定と同じ1本）。
   ============================================================ */
(function(){
 'use strict';
 const WL=(window.WL=window.WL||{});
 const SR=()=>WL.stopRules;
 const st={stop:null,vocab:null,host:null,reload:null,rows:[],stored:false,cols:[],dirty:false,open:0,tab:{},
  cols0:[],equip:[],eq:'',plan:{eq:'',entries:[],err:''},msg:''};
 const hasCond=r=>SR().hasCond(r);
 const actionWord=a=>((((st.vocab||{}).actions||[]).find(x=>x.key===a)||{}).label||a);
 const minutesOf=r=>Array.from({length:+r.count||0},(_,i)=>(r.minutes||[])[i]||null);
 /* 答えを札の字に（「1本・45分・自動で入れる」）。空の時間は停止内容の標準所要分。 */
 function answerChips(r){
  const n=+r.count||0;
  if(!n)return '<i class="srb-chip">入れない</i>';
  const std=st.stop&&st.stop.standardMinutes;
  const ms=minutesOf(r).map(m=>(m?`${m}分`:(std?`標準${std}分`:'標準')));
  return `<i class="srb-chip t">${n}本</i><i class="srb-chip t">${esc(ms.join('＋'))}</i>`
   +`<i class="srb-chip${r.action==='auto'?' a':''}">${esc(actionWord(r.action||'warn'))}</i>`;
 }
 /* 札の文。組み立てた形があれば文で、手で書いた式はその式で。 */
 function sayOf(r){
  if(!hasCond(r))return '<span class="srb-mut">どれにも当てはまらないとき</span>';
  if(r.build&&(r.build.clauses||[]).length)return `もし <b>${esc(WL.formulaBuilder.read(r.build,SR().HOWS))}</b> <span class="srb-mut">なら</span>`;
  return `もし <code class="srb-fx">${esc(r.formula||'')}</code> <span class="srb-mut">なら</span>`;
 }
 /* 前の版のセルの条件は開いたときに式へ直す（意味は同じ・§9.590）。 */
 function fromStored(r){
  const row={formula:String(r.formula||''),build:r.build||null,count:+r.count||0,minutes:(r.minutes||[]).slice(),
   action:r.action||'warn',note:r.note||''};
  if(!row.formula&&(r.conditions||[]).length){const c=SR().fromCells(r.conditions);row.formula=c.formula;row.build=c.build}
  return row;
 }
 function setData(stop){
  st.stop=stop;
  const r=(stop&&stop.insertRule)||{rows:[],stored:false};
  const rows=(r.rows||[]).map(fromStored);
  if(!rows.length||hasCond(rows[rows.length-1]))rows.push({formula:'',build:null,count:0,minutes:[],action:'warn',note:''});
  st.rows=rows;st.stored=!!r.stored;st.dirty=false;st.open=rows.length>1?0:-1;st.tab={};st.msg='';
 }
 const ruleRows=()=>st.rows.slice(0,-1);
 /* 式が使ってよい名前（前.／後.＋仕掛の列）。候補にも出す。 */
 function names(){
  const pre=((st.vocab||{}).formulaPrefixes||[{prefix:'前.'},{prefix:'後.'}]).map(p=>p.prefix);
  return st.cols0.flatMap(c=>pre.map(p=>p+c));
 }
 function badNames(f){
  try{
   const cols=WL.formula.compile(f).columns;
   return cols.filter(n=>!/^(前|後)\./.test(n));
  }catch(e){return []}
 }
 function formulaState(r){
  const f=String(r.formula||'').trim();
  if(!f)return {ok:false,error:'条件を組み立てるか、式を書いてください'};
  const chk=WL.formula.check(f);
  if(!chk.ok)return chk;
  const bad=badNames(f);
  if(bad.length)return {ok:false,error:`名前の頭は「前.」か「後.」です: ${bad.join('、')}`};
  return {ok:true,columns:chk.columns};
 }
 /* ---------- 描く ---------- */
 function cardHtml(r,i){
  const def=i===st.rows.length-1,open=st.open===i;
  const fs=def?{ok:true}:formulaState(r);
  return `<li class="srb-rule${open?' is-on':''}${def?' is-def':''}${fs.ok?'':' is-ng'}" data-r="${i}">
    <div class="srb-head" data-open="${i}" role="button" tabindex="0" aria-expanded="${open}">
     <span class="srb-rk">${def?'既定':i+1}</span>
     <span class="srb-say">${sayOf(r)}${fs.ok?'':`<small class="srb-ng">${esc(fs.error)}</small>`}</span>
     <span class="srb-ans">${answerChips(r)}</span>
     ${def?'':`<span class="srb-tools"><button type="button" class="srb-ic" data-up="${i}" title="1つ上へ（上の決まりが先に当たります）"${i?'':' disabled'}>▲</button>`
      +`<button type="button" class="srb-ic" data-down="${i}" title="1つ下へ"${i<st.rows.length-2?'':' disabled'}>▼</button>`
      +`<button type="button" class="srb-ic danger" data-del="${i}" title="この決まりを外します">×</button></span>`}
    </div>
    ${open?`<div class="srb-edit">${def?'':condEditHtml(r,i)}${answerHtml(r,i)}</div>`:''}
   </li>`;
 }
 function condEditHtml(r,i){
  const tab=st.tab[i]||(r.build||!r.formula?'build':'text');
  const fs=formulaState(r);
  return `<div class="srb-tabs" role="tablist" aria-label="条件の入れ方">
     <button type="button" role="tab" data-tab="build" aria-selected="${tab==='build'}" class="${tab==='build'?'is-on':''}">組み立てる</button>
     <button type="button" role="tab" data-tab="text" aria-selected="${tab==='text'}" class="${tab==='text'?'is-on':''}">式を書く</button>
    </div>
    ${tab==='build'
     ?(r.build||!r.formula?'<div class="srb-builder" data-builder></div>'
       :`<p class="srb-note">この決まりは式で書いてあります（<code class="srb-fx">${esc(r.formula)}</code>）。`
        +'<button type="button" class="mm-btn-ghost sm" data-rebuild>組み立て直す</button>（いまの式は置き換わります）</p>')
     :`<textarea class="srb-text" data-formula rows="2" spellcheck="false" placeholder="例 [前.製造材質] <> [後.製造材質] and num([後.製造板幅]) - num([前.製造板幅]) >= 100">${esc(r.formula||'')}</textarea>
       <p class="srb-check${fs.ok?' is-ok':' is-ng'}" data-check>${esc(fs.ok?`使える式です（使っている列: ${fs.columns.join('・')}）`:fs.error)}</p>
       <p class="srb-note">名前は <code>[前.列]</code>（前のロット）・<code>[後.列]</code>（後ろのロット）。<b>[</b> を打つと列の候補、英字を打つと関数の候補が出ます。</p>`}`;
 }
 function answerHtml(r,i){
  const max=(st.vocab||{}).countMax||9,n=+r.count||0;
  const std=st.stop&&st.stop.standardMinutes;
  const opts=Array.from({length:max+1},(_,k)=>`<option value="${k}"${k===n?' selected':''}>${k?`${k}本`:'入れない'}</option>`).join('');
  const mins=minutesOf(r).map((m,k)=>`<input class="srb-min" data-min="${k}" value="${m==null?'':m}" inputmode="decimal"
     placeholder="${std?`標準${std}`:'分'}" aria-label="${k+1}本目の分" title="空欄はこの停止内容の標準所要分">`).join('<span class="srb-mut">＋</span>');
  const acts=((st.vocab||{}).actions||[]).map(a=>`<option value="${esc(a.key)}"${(r.action||'warn')===a.key?' selected':''}>${esc(a.label)}</option>`).join('');
  return `<div class="srb-answer" data-r="${i}"><span class="srb-w">なら</span>
    <select class="srb-sel" data-ak="count" aria-label="入れる本数">${opts}</select>
    ${n?`<span class="srb-w">入れる・時間</span>${mins}<span class="srb-w">分・入れ方</span><select class="srb-sel" data-ak="action" aria-label="入れ方">${acts}</select>`:''}
    <input class="srb-memo" data-ak="note" value="${esc(r.note||'')}" placeholder="覚え書き（任意）" aria-label="覚え書き" maxlength="200">
   </div>`;
 }
 function render(){
  const h=st.host;if(!h)return;
  if(!st.stop){h.innerHTML='<p class="mm-empty">左で停止内容を選ぶと、その<b>挿入の条件</b>（作業スケジュールの境目に自動で入れる・知らせる決まり）がここに出ます。</p>';return}
  const n=ruleRows().length;
  h.innerHTML=`<div class="srb">
    <div class="srb-main">
     <div class="srb-bar"><p class="srb-lead">ロットとロットの<b>境目</b>ごとに、上から<b>最初に当たった決まり</b>の本数だけ「${esc(st.stop.name)}」を入れます`
      +`（<b>知らせる</b>＝黄色の帯で提案／<b>自動で入れる</b>＝ロットを入れた・外した・並べ替えたときに入れる）。</p>
      <span class="srb-state${st.dirty?' is-dirty':''}" aria-live="polite">${esc(st.msg||(st.dirty?'保存していない変更があります':(st.stored?'保存済み':'まだ決まりがありません')))}</span>
      <button type="button" class="mm-btn-ghost sm" data-revert${st.dirty?'':' disabled'}>元に戻す</button>
      <button type="button" class="mm-btn-primary sm" data-save${st.dirty?'':' disabled'}>保存</button></div>
     <ol class="srb-list">${st.rows.map(cardHtml).join('')}</ol>
     <button type="button" class="srb-addrule" data-add>＋ 決まりを足す</button>
     ${n?'':'<p class="srb-note">まだ決まりがありません。「＋ 決まりを足す」で、例えば「製造材質 が変わる なら 1本・自動で入れる」を作れます。</p>'}
    </div>
    <aside class="srb-try" aria-label="いまの予定の境目で試した結果">${tryHtml()}</aside>
   </div>`;
  mountBuilder();
  wire();
 }
 /* ---------- 試した結果（いまの予定の境目） ---------- */
 function eqCandidates(){
  const own=((st.stop&&st.stop.equipmentList)||[]).filter(x=>x&&x!=='*');
  if(own.length)return own;
  const names=st.equip.map(x=>x.name).filter(Boolean);
  const cur=(WL.equipment&&WL.equipment.get())||'';
  return cur&&!names.includes(cur)?[cur,...names]:names;
 }
 function tryHtml(){
  const cands=eqCandidates();
  const eq=st.eq&&cands.includes(st.eq)?st.eq:(cands.includes((WL.equipment&&WL.equipment.get())||'')?WL.equipment.get():cands[0]||'');
  st.eq=eq;
  const head=`<div class="srb-try-head"><b>いまの予定の境目で試す</b>${cands.length>1
   ?`<select class="srb-sel" data-eq aria-label="試す設備">${cands.map(c=>`<option${c===eq?' selected':''}>${esc(c)}</option>`).join('')}</select>`
   :`<span class="srb-mut">${esc(eq||'')}</span>`}</div>`;
  if(!eq)return head+'<p class="srb-note">設備がまだありません。</p>';
  if(st.plan.eq!==eq){loadPlan(eq);return head+'<p class="srb-note">予定を読んでいます…</p>'}
  if(st.plan.err)return head+`<p class="srb-note is-ng">予定を読めませんでした: ${esc(st.plan.err)}</p>`;
  const valueOf=(WL.scheduleView&&WL.scheduleView.valueOf)||((e,k)=>(e&&e.detail||{})[k]);
  const bs=SR().boundaries(st.plan.entries);
  if(!bs.length)return head+'<p class="srb-note">この設備の予定に、ロットとロットの境目がまだありません（ロットを2本以上入れると試せます）。</p>';
  const okRows=st.rows.map(r=>(hasCond(r)&&!formulaState(r).ok?{formula:'',build:null,conditions:[{field:'__ng',op:'eq',value:'x'}],count:0}:r));
  const cols=[...new Set(st.rows.flatMap(r=>((r.build&&r.build.clauses)||[]).map(c=>c.col)).filter(Boolean))].slice(0,2);
  let hits=0,short=0;
  const items=bs.map(b=>{
   const hit=SR().ruleHit(okRows,[],[],b.prev,b.next,valueOf);
   const idx=hit?hit.index:-1,need=hit?+hit.row.count||0:0;
   const have=b.between.filter(e=>e.kind==='設備停止'&&String(e.title||'').trim()===String(st.stop.name||'').trim()).length;
   if(need)hits++;
   const lack=need>have&&b.next.state==='予定';
   if(lack)short++;
   const vals=cols.map(c=>`${esc(c)} ${esc(String(valueOf(b.prev,c)??'空'))}→${esc(String(valueOf(b.next,c)??'空'))}`).join('・');
   const on=idx>=0&&idx===st.open&&need;
   return `<li class="${need?'is-hit':''}${on?' is-on':''}" data-hit="${idx}"><b>${esc(b.prev.lotNo||'')} → ${esc(b.next.lotNo||'')}</b>
     <span class="srb-mut">${vals}</span>
     <span class="srb-hit">${need?`${idx===st.rows.length-1?'既定':`${idx+1}番`}・${need}本`:'—'}${lack?`<em>足りない ${need-have}</em>`:(need?'<em class="ok">入っている</em>':'')}</span></li>`;
  }).join('');
  return head+`<p class="srb-sum">境目 <b>${bs.length}</b> のうち当たる <b>${hits}</b>・足りない <b>${short}</b></p><ol class="srb-tries">${items}</ol>`
   +'<p class="srb-note">保存の前の決まりで数えています（作業スケジュールの黄色の帯と同じ判定）。</p>';
 }
 async function loadPlan(eq){
  st.plan={eq,entries:[],err:'',loading:true};
  try{
   const r=await api(`/api/schedule/plan?equipment=${encodeURIComponent(eq)}`);
   if(st.plan.eq!==eq)return;
   st.plan={eq,entries:r.entries||[],err:''};
  }catch(e){if(st.plan.eq===eq)st.plan={eq,entries:[],err:e.message||String(e)}}
  paintTry();
 }
 function paintTry(){const a=st.host&&st.host.querySelector('.srb-try');if(a){a.innerHTML=tryHtml();wireTry(a)}}
 /* ---------- 組み立て ---------- */
 function mountBuilder(){
  const el=st.host.querySelector('[data-builder]');
  if(!el||st.open<0)return;
  const r=st.rows[st.open];
  if(!r.build){const b={kind:'cond',clauses:[WL.formulaBuilder.blankClause(SR().HOWS,st.cols0)]};r.build=b;r.formula=WL.formulaBuilder.build(b,SR().HOWS)}
  WL.formulaBuilder.mount(el,{hows:SR().HOWS,columns:()=>st.cols0,spec:r.build,
   onChange:(spec,f)=>{r.build=spec;r.formula=f;touch(false);paintHead(st.open);paintTry()}});
 }
 /* 札の頭だけ描き直す（開いている中の欄は作り直さない＝打っている字が飛ばない）。 */
 function paintHead(i){
  const li=st.host.querySelector(`.srb-rule[data-r="${i}"]`);if(!li)return;
  const r=st.rows[i],fs=i===st.rows.length-1?{ok:true}:formulaState(r);
  li.classList.toggle('is-ng',!fs.ok);
  const say=li.querySelector('.srb-say');if(say)say.innerHTML=sayOf(r)+(fs.ok?'':`<small class="srb-ng">${esc(fs.error)}</small>`);
  const ans=li.querySelector('.srb-ans');if(ans)ans.innerHTML=answerChips(r);
 }
 function touch(full){
  st.dirty=true;st.msg='';
  const s=st.host.querySelector('.srb-state');if(s){s.textContent='保存していない変更があります';s.classList.add('is-dirty')}
  st.host.querySelectorAll('[data-save],[data-revert]').forEach(b=>{b.disabled=false});
  if(full)render();
 }
 /* ---------- 配線 ---------- */
 function wire(){
  const h=st.host;
  h.querySelectorAll('[data-open]').forEach(el=>{
   const go=e=>{if(e.target.closest('button'))return;const i=+el.dataset.open;st.open=st.open===i?-1:i;render()};
   el.onclick=go;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go(e)}};
  });
  h.querySelectorAll('[data-up],[data-down]').forEach(b=>{b.onclick=()=>{
   const i=+(b.dataset.up??b.dataset.down),j=b.dataset.up!=null?i-1:i+1;
   if(j<0||j>=st.rows.length-1)return;
   [st.rows[i],st.rows[j]]=[st.rows[j],st.rows[i]];
   if(st.open===i)st.open=j;else if(st.open===j)st.open=i;
   touch(true);
  }});
  h.querySelectorAll('[data-del]').forEach(b=>{b.onclick=()=>{
   const i=+b.dataset.del;st.rows.splice(i,1);st.open=-1;st.tab={};touch(true);
  }});
  const add=h.querySelector('[data-add]');
  if(add)add.onclick=()=>{
   const b={kind:'cond',clauses:[WL.formulaBuilder.blankClause(SR().HOWS,st.cols0)]};
   st.rows.splice(st.rows.length-1,0,{formula:WL.formulaBuilder.build(b,SR().HOWS),build:b,count:1,minutes:[],action:'warn',note:''});
   st.open=st.rows.length-2;st.tab={};touch(true);
  };
  h.querySelectorAll('[data-tab]').forEach(b=>{b.onclick=()=>{st.tab[st.open]=b.dataset.tab;render()}});
  const rb=h.querySelector('[data-rebuild]');
  if(rb)rb.onclick=()=>{const r=st.rows[st.open];r.build=null;r.formula='';st.tab[st.open]='build';touch(true)};
  const ta=h.querySelector('[data-formula]');
  if(ta){
   WL.formula.suggest(ta,{columns:names});
   ta.oninput=()=>{
    const r=st.rows[st.open];r.formula=ta.value;r.build=null;
    const fs=formulaState(r),c=h.querySelector('[data-check]');
    if(c){c.textContent=fs.ok?`使える式です（使っている列: ${fs.columns.join('・')}）`:fs.error;c.className='srb-check '+(fs.ok?'is-ok':'is-ng')}
    touch(false);paintHead(st.open);paintTry();
   };
  }
  h.querySelectorAll('.srb-answer').forEach(box=>{
   const r=st.rows[+box.dataset.r];
   box.querySelectorAll('[data-ak]').forEach(el=>{
    el.onchange=()=>{
     const k=el.dataset.ak;
     if(k==='count'){r.count=+el.value||0;r.minutes=minutesOf(r);touch(true);return}
     r[k]=el.value;touch(false);paintHead(+box.dataset.r);
    };
   });
   box.querySelectorAll('[data-min]').forEach(el=>{
    el.onchange=()=>{
     const v=WL.base.toHalfWidth(el.value).trim();
     const m=v===''?null:Math.max(1,Math.min((st.vocab||{}).minutesMax||1440,Math.round(+v)||0))||null;
     r.minutes=minutesOf(r);r.minutes[+el.dataset.min]=m;el.value=m==null?'':String(m);
     touch(false);paintHead(+box.dataset.r);
    };
   });
  });
  const sv=h.querySelector('[data-save]');if(sv)sv.onclick=save;
  const rv=h.querySelector('[data-revert]');if(rv)rv.onclick=()=>{setData(st.stop);render()};
  wireTry(h.querySelector('.srb-try'));
 }
 function wireTry(a){
  if(!a)return;
  const s=a.querySelector('[data-eq]');if(s)s.onchange=()=>{st.eq=s.value;paintTry()};
  a.querySelectorAll('[data-hit]').forEach(li=>{li.onclick=()=>{const i=+li.dataset.hit;if(i>=0&&i<st.rows.length-1){st.open=i;render()}}});
 }
 /* ---------- 保存 ---------- */
 async function save(){
  const bad=ruleRows().map((r,i)=>[i,formulaState(r)]).filter(([,f])=>!f.ok);
  if(bad.length){st.open=bad[0][0];st.msg=`${bad[0][0]+1}番の条件: ${bad[0][1].error}`;render();return}
  const uid=WL.mm.requireMaintUser();
  if(uid===null)return;
  const rows=st.rows.map(r=>({formula:hasCond(r)?String(r.formula||'').trim():'',build:hasCond(r)?r.build:null,conditions:[],
   count:+r.count||0,minutes:minutesOf(r),action:r.action||'warn',note:r.note||''}));
  st.msg='保存しています…';render();
  try{
   await api('/api/schedule/stop-rule',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({stopId:st.stop.id,rows,cols:[],user_id:uid})});
   st.dirty=false;st.msg='保存しました';
   showToast&&showToast('挿入の条件を保存しました',`${st.stop.name}（${st.stop.equipmentLabel||''}）`,2400);
   if(st.reload)await st.reload();
  }catch(e){st.msg=`保存できませんでした: ${e.message||String(e)}`;render()}
 }
 /* 選んだ停止内容の盤を描く。**同じ停止内容のまま描き直すときは、保存していない変更を捨てない**。 */
 async function mount(host,stop,vocab,reload){
  const same=st.stop&&stop&&Number(st.stop.id)===Number(stop.id);
  st.host=host;st.vocab=vocab||st.vocab;st.reload=reload;
  if(!(same&&st.dirty))setData(stop);
  else st.stop=Object.assign({},stop);
  if(!st.cols0.length&&WL.ruleTable){try{st.cols0=((await WL.ruleTable.loadSource())||{}).columns||[]}catch(e){WL.quiet&&WL.quiet.note('仕掛の列名を読めない（式は手で書ける）',e)}}
  if(!st.equip.length&&WL.records&&WL.records.loadEquipmentMaster){try{st.equip=((await WL.records.loadEquipmentMaster())||{}).items||[]}catch(e){WL.quiet&&WL.quiet.note('設備の一覧を読めない（試す設備は停止内容の設備だけ）',e)}}
  render();
 }
 /* 停止内容の一覧に出す一言（「条件 2・自動1」）。条件の無い既定だけ・未登録は出さない。 */
 function chipText(stop){
  const r=(stop&&stop.insertRule)||{};
  if(!r.stored)return '';
  const rows=(r.rows||[]).filter(x=>hasCond(x));
  const def=(r.rows||[]).find(x=>!hasCond(x));
  if(!rows.length&&!(def&&+def.count))return '';
  const auto=(r.rows||[]).filter(x=>+x.count&&x.action==='auto').length;
  return `条件 ${rows.length}${auto?`・自動${auto}`:''}`;
 }
 const dirty=()=>!!st.dirty;
 const forget=()=>{st.dirty=false};
 WL.stopRuleBoard={mount,chipText,dirty,forget,state:()=>st};
})();
