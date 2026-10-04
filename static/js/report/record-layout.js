/* record-layout.js: 段組の配置——1件ぶんを「段×横24マス」の盤に置く（§9.553、利用者の指示）
   ============================================================
   「操業データ表の2段組の繰り返し部分のリスト表示の方法について使うデータを選んで、
    表示位置を細かくカスタム出来るように作り込んで欲しいです。紙への印刷はもちろんのこと、
    通常のリスト表示も切り替えて2段組みリスト表示も出来るようにして下さい。」

   5案を見本で比べて**案4「配置の盤」**を選んだ（`docs/mockups/opsheet-stack/`・§9.553）。
   1件ぶんの繰り返し部分を**段 × 横UNITSマス**の盤とみなし（既定は2段＝2段組・項目が多ければ
   最大LINES段まで足せる）、項目ごとに
   「どの段の・何マス目から・何マスぶん」を置く。**上の段と同じ縦線にそろう**ので、
   ある項目を別の項目の真下へ置ける（以前の「段:2」の印では決められなかった）。

   このファイルが持つのは3つ:
    1. `plan()`  … 置いた位置と自動の位置を合わせた**答え**（紙と一覧が同じ答えを読む）
    2. `gridHtml()` … 画面の2段組の一覧（CSS grid）。紙は`opsheet-print.js`が同じ`segments()`で表に組む
    3. `board()` … 配置の盤（使うデータを選ぶ・掴んで置く・数で直す）
   **どの列があるか・値・見出しは知らない**（呼ぶ側が`src`で渡す）——段組を使う紙や一覧が
   増えても、ここは書き換えない。

   配置の保存は列レイアウトマスタの`places`（`{列名:{line,col,span}}`・サーバーの
   `normalize_place()`が盤に収まる形へ整える）。**盤の寸法はサーバーの
   `PLACE_UNITS`/`PLACE_LINES`と同じ値**（網`test_recordlayout`が突き合わせる）。
   ============================================================ */
(function(){
 'use strict';
 window.WL=window.WL||{};
 const UNITS=24;
 /* 段の数の上限。**既定は2段**（2段組）——操業データの項目は設備によって50を超え、2段×24マスに
    入りきらないので、盤で段を足せる（足した段も紙と一覧が同じに読む）。 */
 const LINES=4;
 const DEFAULT_LINES=2;
 /* 段の呼び名。2段までは「上段／下段」（現場の言い方）、3段以上は「1段目…」。 */
 function lineName(line,lines){return (lines||DEFAULT_LINES)<=2?(['上段','下段'][line-1]||`${line}段目`):`${line}段目`}

 function validPlace(p){
  return !!p&&Number.isInteger(p.line)&&Number.isInteger(p.col)&&Number.isInteger(p.span)
   &&p.line>=1&&p.line<=LINES&&p.col>=0&&p.span>=1&&p.col+p.span<=UNITS;
 }
 /* 幅の比でマスを配る（合計は`units`ちょうど・各1マス以上）。端数は大きい順に1マスずつ足す。 */
 function spansFromWidths(ws,units){
  const n=ws.length;if(!n)return [];
  if(n>=units)return ws.map(()=>1);
  const total=ws.reduce((s,v)=>s+Math.max(1,v),0);
  const raw=ws.map(v=>Math.max(1,v)*(units-n)/total);
  const out=raw.map(v=>1+Math.floor(v));
  let left=units-out.reduce((s,v)=>s+v,0);
  const order=raw.map((v,i)=>({i,f:v-Math.floor(v)})).sort((a,b)=>b.f-a.f);
  for(let j=0;left>0&&j<order.length;j++,left--)out[order[j].i]++;
  return out;
 }
 /* 置いていないときの段の分け方: 紙の幅に入るなら1段、入らなければ左から詰めて溢れたぶんを次の段へ。
    以前の印（書式のパターンの「段:1」「段:2」・§9.205）は**手がかり**として読む（古い設定を捨てない）。 */
 function autoLines(keys,o){
  const px=k=>Math.max(1,o.naturalPx(k));
  const hint=k=>(o.lineHint?o.lineHint(k):0)||0;
  const lines=Array.from({length:LINES},()=>[]);
  const forced=keys.filter(k=>hint(k));
  const free=keys.filter(k=>!hint(k));
  const total=keys.reduce((s,k)=>s+px(k),0);
  if(!forced.length&&total<=o.usablePx&&keys.length<=UNITS){lines[0]=keys.slice();return lines}
  forced.forEach(k=>lines[Math.min(LINES,hint(k))-1].push(k));
  /* 使う段の数＝2段（2段組）。**項目の数が2段の席を超えるときだけ**増やす（上限LINES）。
     1段の目安＝紙の幅か、全体を段の数で割った幅の大きいほう（どの段にも寄り過ぎない）。
     **1段は UNITS 個まで**（1項目に1マスは要る）。 */
  const n=Math.min(LINES,Math.max(DEFAULT_LINES,Math.ceil(keys.length/UNITS)));
  const per=Math.max(o.usablePx,total/n);
  let at=0,acc=lines[0].reduce((s,k)=>s+px(k),0);
  free.forEach(k=>{
   const w=px(k);
   const full=lines[at].length>=UNITS||(lines[at].length&&acc+w>per&&at<n-1);
   if(full&&at<LINES-1){at++;acc=lines[at].reduce((s,x)=>s+px(x),0)}
   lines[at].push(k);acc+=w;
  });
  if(!lines[0].length){const i=lines.findIndex(l=>l.length);if(i>0)lines[0]=lines[i].splice(0,1)}
  return lines;
 }
 /* ---------- 答え ----------
    `keys`＝出す列（並び順）。`o.placeOf(k)`＝置いた位置（無ければnull）、`o.naturalPx(k)`＝その列の
    ふだんの幅、`o.usablePx`＝紙の刷れる幅（px換算）、`o.lineHint(k)`＝古い「段:N」の印。
    戻り値 `{cells:[{k,line,col,span,auto}], lines, conflicts, overflow}`:
     ・置いた位置が重なったら**後から来たほうを自動へ回して名指す**（`conflicts`）
     ・盤に入りきらない列は名指す（`overflow`・紙にも一覧にも出ない）——黙って落とさない */
 function plan(keys,o){
  const occ=Array.from({length:LINES},()=>Array(UNITS).fill(null));
  const free=(line,col,span)=>{for(let u=col;u<col+span;u++)if(occ[line-1][u])return false;return true};
  const take=(k,line,col,span)=>{for(let u=col;u<col+span;u++)occ[line-1][u]=k};
  const cells=[],conflicts=[],overflow=[];
  const placed=[],rest=[];
  keys.forEach(k=>{const p=o.placeOf?o.placeOf(k):null;(validPlace(p)?placed:rest).push([k,p])});
  placed.forEach(([k,p])=>{
   if(free(p.line,p.col,p.span)){take(k,p.line,p.col,p.span);cells.push({k,line:p.line,col:p.col,span:p.span,auto:false})}
   else{conflicts.push(k);rest.push([k,null])}
  });
  const restKeys=rest.map(([k])=>k);
  if(!cells.length){
   autoLines(restKeys,o).forEach((list,i)=>{
    if(list.length>UNITS){overflow.push(...list.slice(UNITS));list=list.slice(0,UNITS)}
    const spans=spansFromWidths(list.map(k=>o.naturalPx(k)),UNITS);
    let at=0;
    list.forEach((k,j)=>{take(k,i+1,at,spans[j]);cells.push({k,line:i+1,col:at,span:spans[j],auto:true});at+=spans[j]});
   });
  }else{
   /* 置いた位置の残りへ自動の列を入れる。**使う段は「入りきる最小の段数」**（置いた段・既定の2段より
      減らさない）、ふだんの幅から欲しいマス数を出し、**空きより多ければ比で縮める**（1列1マスまで）——
      縮めずに先着で配ると、広い列が空きを食って後ろの列が盤からあふれる（§9.553で踏んだ）。 */
   const freeIn=n=>occ.slice(0,n).reduce((s,row)=>s+row.filter(x=>!x).length,0);
   let n=Math.max(DEFAULT_LINES,...cells.map(c=>c.line));
   while(n<LINES&&freeIn(n)<restKeys.length)n++;
   const wants=restKeys.map(k=>Math.max(1,Math.min(UNITS,Math.round(o.naturalPx(k)/Math.max(1,o.usablePx)*UNITS))));
   const room=freeIn(n),need=wants.reduce((s,v)=>s+v,0);
   const scaled=need>room?wants.map(v=>Math.max(1,Math.floor(v*room/need))):wants;
   restKeys.forEach((k,i)=>{
    const want=scaled[i];
    const runs=[];
    for(let line=1;line<=n;line++){
     let s=-1;
     for(let u=0;u<=UNITS;u++){
      const empty=u<UNITS&&!occ[line-1][u];
      if(empty&&s<0)s=u;
      if(!empty&&s>=0){runs.push({line,col:s,len:u-s});s=-1}
     }
    }
    const fit=runs.find(r=>r.len>=want)||runs.sort((a,b)=>b.len-a.len)[0];
    if(!fit){overflow.push(k);return}
    const span=Math.min(want,fit.len);
    take(k,fit.line,fit.col,span);cells.push({k,line:fit.line,col:fit.col,span,auto:true});
   });
  }
  const lines=Math.max(1,...cells.map(c=>c.line));
  return {cells,lines,conflicts,overflow};
 }
 /* 段ごとの並び（左から）。空いたマスは`k:null`の切れ目として返す——紙は空のセル、画面は何も置かない。 */
 function segments(p,line){
  const row=p.cells.filter(c=>c.line===line).sort((a,b)=>a.col-b.col);
  const out=[];let at=0;
  row.forEach(c=>{if(c.col>at)out.push({k:null,col:at,span:c.col-at});out.push(c);at=c.col+c.span});
  if(at<UNITS)out.push({k:null,col:at,span:UNITS-at});
  return out;
 }
 /* 置いた位置を全部の列について書き出す（盤を初めて触ったとき・§9.553「触ったら固める」）。
    **自動のままだと1つ動かすたびに残りが詰め直されて跳ぶ**ので、最初の1手で今の見た目を固める。 */
 function freeze(p){
  const out={};p.cells.forEach(c=>{out[c.k]={line:c.line,col:c.col,span:c.span}});return out;
 }

 /* ---------- 画面の2段組（一覧） ----------
    `src`: {plan, head:k=>見出しのHTML, rows:[{key,attrs,lead,tail,cell:k=>{html,cls,title}}], leadHead, tailHead}
    1件＝1つの`.rl-rec`（段ぶんの行を持つ grid）。**先頭（選ぶ印）と末尾（操作）は段をまたぐ**。 */
 function gridHtml(src){
  const p=src.plan,L=p.lines;
  const col=c=>`grid-column:${c.col+2}/span ${c.span};grid-row:${c.line}`;
  const lead=h=>`<span class="rl-lead" style="grid-row:1/span ${L}">${h||''}</span>`;
  const tail=h=>`<span class="rl-tail" style="grid-row:1/span ${L}">${h||''}</span>`;
  const head=`<div class="rl-rec rl-head" style="--rl-lines:${L}">`+lead(src.leadHead)
   +p.cells.map(c=>`<span class="rl-c rl-l${c.line}" style="${col(c)}" title="${esc(src.title?src.title(c.k):'')}">${src.head(c.k)}</span>`).join('')
   +tail(src.tailHead)+`</div>`;
  const body=(src.rows||[]).map(r=>`<div class="rl-rec${r.cls?' '+r.cls:''}" style="--rl-lines:${L}"${r.attrs||''}>`+lead(r.lead)
   +p.cells.map(c=>{const v=r.cell(c.k)||{};
     return `<span class="rl-c rl-l${c.line}${v.cls?' '+v.cls:''}" data-col="${esc(c.k)}" style="${col(c)}" title="${esc(v.title||'')}">${v.html||''}</span>`}).join('')
   +tail(r.tail)+`</div>`).join('');
  return `<div class="rl-grid" style="--rl-units:${UNITS}">${head}${body}</div>`;
 }

 /* ---------- 配置の盤 ----------
    `src`: {
      target, keys():候補の全列, labelOf(k), groupOf(k):群の名前, naturalPx(k), usablePx(), lineHint(k),
      mmPerUnit():1マスが紙で何mmか, onDraft(layout):下書きを当てる, onSave(body):保存, onClose()
    }
    盤の中身は**下書き**（`places`/`hidden`）。保存を押すまで保存済みは変わらない（§9.212 ③）。 */
 function board(host,src){
  const st={places:{},hidden:new Set(),frozen:false,sel:'',drag:null,msg:'',query:'',lanes:DEFAULT_LINES};
  const l0=WL.columnLayout.get(src.target)||{};
  st.places=JSON.parse(JSON.stringify(l0.places||{}));
  st.frozen=Object.keys(st.places).length>0;
  st.hidden=new Set(src.initialHidden?src.initialHidden():(l0.hidden||[]));
  const keys=()=>src.keys();
  const visible=()=>keys().filter(k=>!st.hidden.has(k));
  const cur=()=>plan(visible(),{placeOf:k=>st.places[k]||null,naturalPx:src.naturalPx,
   usablePx:src.usablePx(),lineHint:st.frozen?null:src.lineHint});
  const push=()=>src.onDraft({places:{...st.places},hidden:[...st.hidden]});
  /* 盤に出す段の数＝足した段か、使っている段の多いほう（使っている段は消さない）。 */
  const lanes=pl=>Math.max(st.lanes,(pl||cur()).lines);
  const nm=(line,pl)=>lineName(line,lanes(pl));
  /* 最初の1手で今の見た目を固める（自動のままだと残りが詰め直されて跳ぶ）。 */
  const freezeNow=()=>{if(!st.frozen){st.places=freeze(cur());st.frozen=true}};
  const overlapOf=(k,p)=>{
   const pl=cur();
   return pl.cells.find(c=>c.k!==k&&c.line===p.line&&c.col<p.col+p.span&&p.col<c.col+c.span)||null;
  };
  /* 位置を変える答えは1本（掴む・矢印キー・数の欄が同じ道を通る）。
     **重なった項目は押し出して空いた所へ回す**（自動の位置・点線になる）——盤が埋まっていても
     並べ替えられるように。押し出した先が無い（盤に入らない）ときだけ置かずに理由を言う。 */
  function move(k,p){
   freezeNow();
   const q={line:Math.min(LINES,Math.max(1,p.line)),span:Math.min(UNITS,Math.max(1,p.span)),col:0};
   q.col=Math.min(UNITS-q.span,Math.max(0,p.col));
   const before=cur();
   const hits=before.cells.filter(c=>c.k!==k&&c.line===q.line&&c.col<q.col+q.span&&q.col<c.col+c.span).map(c=>c.k);
   const keep={...st.places};
   hits.forEach(h=>{delete st.places[h]});
   st.places[k]=q;
   /* **新しく盤からあふれる項目が出るときだけ**断る（もともと入りきらない項目は数えない）。 */
   const lost=cur().overflow.filter(x=>!before.overflow.includes(x));
   if(lost.length){
    st.places=keep;
    st.msg=`ここへ置くと「${lost.map(h=>src.labelOf(h)).join('・')}」の入る所が盤に残りません（${nm(q.line)}の${q.col+1}〜${q.col+q.span}マス目）。段を足すか、使わない項目を外してください。`;
    paint();return false;
   }
   st.msg=hits.length?`「${hits.map(h=>src.labelOf(h)).join('・')}」を押し出して空いた所へ回しました（点線＝自動の位置）。`:'';
   push();paint();return true;
  }
  function setUse(k,on){
   if(on){st.hidden.delete(k);}
   else{st.hidden.add(k);delete st.places[k];if(st.sel===k)st.sel=''}
   push();paint();
  }
  function paint(){
   const pl=cur();
   const placedAt={};pl.cells.forEach(c=>{placedAt[c.k]=c});
   const q=st.query.trim();
   const groups=new Map();
   keys().filter(k=>!q||String(src.labelOf(k)).includes(q)||String(k).includes(q)).forEach(k=>{
    const g=src.groupOf(k)||'その他';if(!groups.has(g))groups.set(g,[]);groups.get(g).push(k);
   });
   const where=k=>{
    if(st.hidden.has(k))return '<i class="rl-st is-off">使わない</i>';
    const c=placedAt[k];
    if(!c)return pl.overflow.includes(k)?'<i class="rl-st is-bad">盤に入らない</i>':'';
    return `<i class="rl-st${c.auto?' is-auto':''}">${nm(c.line,pl)} ${c.col+1}〜${c.col+c.span}${c.auto?'（自動）':''}</i>`;
   };
   host.querySelector('.rl-pal-list').innerHTML=[...groups].map(([g,list])=>
    `<div class="rl-grp">${esc(g)}<small>${list.filter(k=>!st.hidden.has(k)).length} / ${list.length}</small></div>`
    +list.map(k=>`<label class="rl-pal-item${st.sel===k?' is-sel':''}" data-k="${esc(k)}"><input type="checkbox" data-use="${esc(k)}"${st.hidden.has(k)?'':' checked'}>`
     +`<span>${esc(src.labelOf(k))}</span>${where(k)}</label>`).join('')).join('')
    ||'<p class="rl-empty">当たる項目がありません。</p>';
   const bd=host.querySelector('.rl-board');
   const L=lanes(pl);
   bd.style.setProperty('--rl-lines',String(L));
   const ln=host.querySelector('.rl-lanes');
   ln.style.setProperty('--rl-lines',String(L));
   ln.innerHTML=Array.from({length:L},(_,i)=>`<span>${nm(i+1,pl)}</span>`).join('');
   const add=host.querySelector('[data-rl="lane"]');
   if(add){add.disabled=L>=LINES;add.title=L>=LINES?`段は${LINES}段までです`:`段を1つ足します（いま${L}段・最大${LINES}段）`}
   bd.innerHTML=pl.cells.map(c=>`<button type="button" class="rl-chip${c.auto?' is-auto':''}${st.sel===c.k?' is-sel':''}" data-k="${esc(c.k)}"`
    +` style="grid-column:${c.col+1}/span ${c.span};grid-row:${c.line}" title="${esc(src.labelOf(c.k))}（${nm(c.line,pl)} ${c.col+1}〜${c.col+c.span}マス目${c.auto?'・自動':''}）　掴んで動かす／右端を引いて幅／矢印キーで1マス・Shift＋←→で幅">`
    +`<span>${esc(src.labelOf(c.k))}</span><i class="rl-grip" data-grip="${esc(c.k)}" aria-hidden="true"></i></button>`).join('')
    +(st.drag?`<span class="rl-ghost${st.drag.bad?' is-bad':''}" style="grid-column:${st.drag.p.col+1}/span ${st.drag.p.span};grid-row:${st.drag.p.line}"></span>`:'');
   const n=pl.cells.length,auto=pl.cells.filter(c=>c.auto).length;
   const notes=[];
   if(pl.conflicts.length)notes.push(`<b class="rl-bad">重なっていた ${pl.conflicts.length}項目を空いた所へ回しました</b>（${pl.conflicts.map(k=>esc(src.labelOf(k))).join('・')}）`);
   if(pl.overflow.length)notes.push(`<b class="rl-bad">盤に入らない ${pl.overflow.length}項目は紙にも一覧にも出ません</b>（${pl.overflow.map(k=>esc(src.labelOf(k))).join('・')}）。項目を減らすか幅を詰めてください。`);
   if(st.msg)notes.push(`<b class="rl-bad">${esc(st.msg)}</b>`);
   host.querySelector('.rl-note').innerHTML=notes.join('<br>')
    ||`${n}項目を置いています${auto?`（うち自動 ${auto}・点線）。掴んで動かすとその場所で固まります`:''}。1マスは紙で約${src.mmPerUnit().toFixed(1)}mmです。`;
   paintInspector(pl);
  }
  function paintInspector(pl){
   const box=host.querySelector('.rl-insp');
   const c=pl.cells.find(x=>x.k===st.sel);
   if(!c){box.innerHTML='<h4>選んだ項目</h4><p class="rl-empty">盤の項目を押すと、ここで段・位置・幅を数で直せます。</p>';return}
   box.innerHTML=`<h4>選んだ項目</h4><dl>
    <dt>項目</dt><dd><b>${esc(src.labelOf(c.k))}</b>${c.auto?' <small>（自動の位置）</small>':''}</dd>
    <dt>段</dt><dd><span class="rl-seg">${Array.from({length:lanes(pl)},(_,i)=>`<button type="button" data-line="${i+1}" class="${c.line===i+1?'is-on':''}">${nm(i+1,pl)}</button>`).join('')}</span></dd>
    <dt>位置</dt><dd><input type="number" min="1" max="${UNITS}" value="${c.col+1}" data-num="col"> マス目から</dd>
    <dt>幅</dt><dd><input type="number" min="1" max="${UNITS}" value="${c.span}" data-num="span"> マス（紙 約${Math.round(c.span*src.mmPerUnit())}mm）</dd>
   </dl><button type="button" class="rl-btn" data-off="${esc(c.k)}">この項目を使わない</button>`;
   box.querySelectorAll('[data-line]').forEach(b=>b.onclick=()=>move(c.k,{line:Number(b.dataset.line),col:c.col,span:c.span}));
   box.querySelectorAll('[data-num]').forEach(inp=>inp.onchange=()=>{
    const v=Math.round(Number(inp.value)||1);
    move(c.k,inp.dataset.num==='col'?{line:c.line,col:v-1,span:c.span}:{line:c.line,col:c.col,span:v});
   });
   box.querySelector('[data-off]').onclick=()=>setUse(c.k,false);
  }
  /* 盤の上の位置（マス・段）。**器の内寸**で測る（枠と余白を引く）。 */
  function cellAt(ev){
   const bd=host.querySelector('.rl-board'),r=bd.getBoundingClientRect(),cs=getComputedStyle(bd);
   const pl=parseFloat(cs.paddingLeft)||0,pt=parseFloat(cs.paddingTop)||0;
   const w=(r.width-pl-(parseFloat(cs.paddingRight)||0))/UNITS;
   const L=lanes();
   const h=(r.height-pt-(parseFloat(cs.paddingBottom)||0))/L;
   return {u:Math.floor((ev.clientX-r.left-pl)/w),line:1+Math.max(0,Math.min(L-1,Math.floor((ev.clientY-r.top-pt)/h))),w};
  }
  function wire(){
   host.querySelector('.rl-search').oninput=e=>{st.query=e.target.value;paint()};
   host.querySelector('.rl-pal-list').addEventListener('click',e=>{
    const cb=e.target.closest('[data-use]');
    if(cb){setUse(cb.dataset.use,cb.checked);return}
    const it=e.target.closest('[data-k]');
    if(it&&!st.hidden.has(it.dataset.k)){st.sel=it.dataset.k;paint()}
   });
   const bd=host.querySelector('.rl-board');
   bd.addEventListener('pointerdown',e=>{
    const chip=e.target.closest('.rl-chip');if(!chip)return;
    const k=chip.dataset.k,pl=cur(),c=pl.cells.find(x=>x.k===k);if(!c)return;
    st.sel=k;
    const at=cellAt(e);
    st.drag={k,mode:e.target.closest('[data-grip]')?'span':'move',grab:at.u-c.col,from:{...c},p:{line:c.line,col:c.col,span:c.span},bad:false,moved:false};
    try{bd.setPointerCapture(e.pointerId)}catch(err){WL.quiet.note('掴めない（掴まなくても動かせる）',err)}
    e.preventDefault();paint();
   });
   bd.addEventListener('pointermove',e=>{
    const d=st.drag;if(!d)return;
    const at=cellAt(e);
    const p=d.mode==='span'?{line:d.from.line,col:d.from.col,span:Math.max(1,Math.min(UNITS-d.from.col,at.u-d.from.col+1))}
                           :{line:at.line,col:Math.max(0,Math.min(UNITS-d.from.span,at.u-d.grab)),span:d.from.span};
    if(p.line===d.p.line&&p.col===d.p.col&&p.span===d.p.span)return;
    d.p=p;d.moved=true;d.bad=!!overlapOf(d.k,p);paint();   // 重なる所は縁の色で言う（離すと押し出す）
   });
   const drop=()=>{
    const d=st.drag;if(!d)return;st.drag=null;
    if(d.moved)move(d.k,d.p);else paint();
   };
   bd.addEventListener('pointerup',drop);
   bd.addEventListener('pointercancel',()=>{st.drag=null;paint()});
   bd.addEventListener('keydown',e=>{
    const chip=e.target.closest('.rl-chip');if(!chip)return;
    const c=cur().cells.find(x=>x.k===chip.dataset.k);if(!c)return;
    const k=c.k;let p=null;
    if(e.key==='ArrowLeft')p=e.shiftKey?{...c,span:c.span-1}:{...c,col:c.col-1};
    else if(e.key==='ArrowRight')p=e.shiftKey?{...c,span:c.span+1}:{...c,col:c.col+1};
    else if(e.key==='ArrowUp')p={...c,line:c.line-1};
    else if(e.key==='ArrowDown')p={...c,line:c.line+1};
    else if(e.key==='Delete'){e.preventDefault();setUse(k,false);return}
    if(!p)return;
    e.preventDefault();st.sel=k;move(k,p);
    host.querySelector(`.rl-chip[data-k="${CSS.escape(k)}"]`)?.focus();
   });
   host.querySelector('[data-rl="auto"]').onclick=()=>{st.places={};st.frozen=false;st.msg='';st.lanes=DEFAULT_LINES;push();paint()};
   host.querySelector('[data-rl="lane"]').onclick=()=>{st.lanes=Math.min(LINES,lanes()+1);paint()};
   host.querySelector('[data-rl="save"]').onclick=()=>src.onSave({places:{...st.places},hidden:[...st.hidden]});
   host.querySelector('[data-rl="close"]').onclick=()=>src.onClose();
  }
  host.innerHTML=`<div class="rl-wrap">
    <aside class="rl-pal"><h4>使うデータ<small>チェックで盤へ置く</small></h4>
     <input type="search" class="rl-search" placeholder="項目を探す" aria-label="項目を探す">
     <div class="rl-pal-list"></div></aside>
    <section class="rl-main"><header class="rl-head"><h4>1件ぶんの配置<small>横${UNITS}マス。掴んで動かす・右端を引いて幅・矢印キーで1マス（Shift＋←→で幅）・重なった項目は空いた所へ押し出す</small></h4>
      <span class="rl-grow"></span>
      <button type="button" class="rl-btn" data-rl="lane">＋ 段を足す</button>
      <button type="button" class="rl-btn" data-rl="auto" title="置いた位置を全部捨てて、幅から自動で並べ直します">すべて自動に戻す</button>
      <button type="button" class="rl-btn" data-rl="close" title="保存せずに盤を閉じます（下書きは捨てます）">やめる</button>
      <button type="button" class="rl-btn rl-btn--primary" data-rl="save">この配置を保存</button></header>
     <div class="rl-lanes"></div>
     <div class="rl-board" role="group" aria-label="1件ぶんの配置の盤"></div>
     <p class="rl-note" role="status"></p></section>
    <aside class="rl-insp"></aside></div>`;
  wire();paint();
  return {paint,state:st,plan:cur};
 }

 WL.recordLayout={UNITS,LINES,DEFAULT_LINES,lineName,validPlace,spansFromWidths,autoLines,plan,segments,freeze,gridHtml,board};
})();
