/* ============================================================
   rule-table.js: 判定表の部品（§9.524 保持方式 → §9.529 で刃のカテゴリ・刃厚と共有）

   利用者の指示（§9.529）:「条件テーブルは『保持方式』の選択マスタみたいな条件テーブルの作りが
   好ましいです。自由に条件設定ができ、他マスタで設定した項目(例えば板押さえ)も条件に加えられる
   ようにしたいです。条件式の書き方はわかりやすく、サジェスト機能もつけて使いやすく再設計して
   ください。」

   **判定表**（Excel の判定表と同じ読み方）:
     ・列＝データ（前の表の答え・材料の計算値・1本目のコイルの値・仕掛の列）、行＝1つの決まり、
       右端＝答え。**上から順に見て、最初に当たった行**の答え。最後の行は「どれにも当てはまらない
       とき」で消せない
     ・セルの書き方: `< 0.6`・`0.6〜1.0`・`>= 20`・`SUS`・`!= X`・`*SUS*`（含む）。**空欄＝問わない**
     ・セルに入ると**候補**が出る（この列の値＋書き方の見本。↑↓・Enter）。書いた決まりは
       表の下の1行が**文で読み上げる**（「板厚が 0.6 より小さい かつ … → フィンガー」）
     ・見出しのすぐ下の「試す」行に値を入れると、当たる行が光り、セルごとに○×が付く。
       「試す」の値は**同じ画面の表どうしで共有**する（刃のカテゴリと刃厚を同じ作業で試す）

   判定は**書かない**。`blade-core.js` の `firstRule()`／`condHits()` をそのまま呼ぶ——盤と刃組
   ガイダンスで判定が食い違うと、「盤では当たるのに現場では当たらない」という最も分かりにくい形で
   壊れる（§9.379）。表は1枚として編集し、保存は丸ごと（`save(rows)`は呼ぶ側が持つ）。
   ============================================================ */
(function(){
 const BS=()=>WL.bladeSet;
 const SRC='source.';
 const isSrc=f=>String(f).startsWith(SRC);

 /* ---------- セルの字 ⇔ 条件（書き方は1箇所で読む） ----------
    **読めない字は条件にしない**（理由を字で返す）——黙って落とすと「書いたのに当たらない」になる。 */
 const OP_SIGNS=[[/^(>=|≧|=>)/,'ge'],[/^(<=|≦|=<)/,'le'],[/^(!=|≠|<>)/,'ne'],
                 [/^(>|＞)/,'gt'],[/^(<|＜)/,'lt'],[/^(=|＝)/,'eq']];
 const OP_TEXT={ge:'>= ',le:'<= ',ne:'!= ',gt:'> ',lt:'< ',eq:''};
 /* 読み上げの言い方（「0.6 より小さい」）。候補の説明と表の下の1文が同じ字を使う。 */
 const OP_SAY={eq:v=>`${v}`,ne:v=>`${v} 以外`,ge:v=>`${v} 以上`,gt:v=>`${v} より大きい`,
               le:v=>`${v} 以下`,lt:v=>`${v} より小さい`,between:(a,b)=>`${a}〜${b}（両端を含む）`,contains:v=>`「${v}」を含む`};
 function parseCell(text,kind){
  const t=String(text||'').trim();
  if(!t)return {cond:null};
  const numOnly=kind==='num';
  const range=t.match(/^(.+?)\s*[〜~～]\s*(.+)$/);
  if(range){
   const a=Number(range[1]),b=Number(range[2]);
   if(!isFinite(a)||!isFinite(b))return {error:'範囲は「0.6〜1.0」のように数で書いてください'};
   return {cond:{op:'between',value:String(a),value2:String(b)}};
  }
  const like=t.match(/^\*(.+)\*$/);
  if(like){
   if(numOnly)return {error:'この列は数なので「含む」は使えません'};
   return {cond:{op:'contains',value:like[1].trim()}};
  }
  let op='eq',v=t;
  for(const [re,o] of OP_SIGNS){const m=t.match(re);if(m){op=o;v=t.slice(m[0].length).trim();break}}
  if(!v)return {error:'比べる値を書いてください'};
  if((numOnly||/^(ge|le|gt|lt)$/.test(op))&&!isFinite(Number(v)))return {error:'この比べ方は数で書いてください'};
  return {cond:{op,value:v}};
 }
 function cellText(c){
  if(!c)return '';
  if(c.op==='between')return `${c.value}〜${c.value2}`;
  if(c.op==='contains')return `*${c.value}*`;
  return (OP_TEXT[c.op]??'')+c.value;
 }
 const sayCond=(c,label)=>`${label}が ${c.op==='between'?OP_SAY.between(c.value,c.value2):(OP_SAY[c.op]||(v=>v))(c.value)}`;

 /* 書き方の見本（候補の後半）。数の列は大小・範囲、字の列は同じ・含む・以外。 */
 const TEMPLATES={
  num:[['lt','< ','より小さい'],['le','<= ','以下'],['ge','>= ','以上'],['gt','> ','より大きい'],['between','〜','範囲（両端を含む）'],['ne','!= ','以外']],
  text:[['eq','','と同じ'],['contains','*','を含む'],['ne','!= ','以外']],
 };

 function create(o){
  const t={key:o.key,label:o.label,rows:[],cols:[],stored:false,dirty:false,read:-1,busy:false};
  const fields=()=>o.fields()||[];
  const fieldOf=f=>fields().find(x=>x.field===f)||null;
  const colLabel=f=>isSrc(f)?String(f).slice(SRC.length):((fieldOf(f)||{}).label||f);
  const kindOf=f=>((fieldOf(f)||{}).kind)||(isSrc(f)?'auto':'text');
  const condOf=(row,f)=>(row.conditions||[]).find(c=>c.field===f)||null;
  /* 既定の行＝条件の無い行。**足したばかりで条件をまだ書いていない行**（`fresh`）は違う。 */
  const isDefault=r=>!(r.conditions||[]).length&&!r.fresh;
  const kinds=()=>Object.fromEntries(fields().map(f=>[f.field,f.kind]));

  /* ---------- 読む（呼ぶ側の答えを表にする） ---------- */
  function setData(rows,stored){
   t.rows=(rows||[]).map(r=>Object.assign({},r,{conditions:(r.conditions||[]).map(x=>Object.assign({},x))}));
   t.stored=!!stored;t.dirty=false;t.read=-1;
   /* 列＝表に書いてある項目（上の行・左の条件から順に）。何も無ければ呼ぶ側の既定の列。 */
   const cols=[];t.rows.forEach(r=>(r.conditions||[]).forEach(x=>{if(!cols.includes(x.field))cols.push(x.field)}));
   t.cols=cols.length?cols:(o.defaultCols||[]).slice();
  }

  /* ---------- 試す（同じ画面の表どうしで値を共有する） ---------- */
  function probeCtx(){
   const c={};
   /* **見えている列の値だけ**を読む——消した列の値が裏で効くと、画面に無い条件で答えが変わる。 */
   t.cols.forEach(f=>{
    const v=o.probe[f];
    if(v===undefined||String(v).trim()==='')return;
    c[f]=kindOf(f)==='num'?Number(v):String(v);
   });
   return c;
  }
  const probeFilled=()=>t.cols.some(f=>String(o.probe[f]??'').trim()!=='');
  function probeHit(){
   if(!probeFilled())return null;
   /* 書きかけの行（条件なし）は当てない——既定の行と取り違えないように。番号は表の並びのまま。 */
   return BS().firstRule(t.rows.map(r=>r.fresh&&!(r.conditions||[]).length?Object.assign({},r,{enabled:false}):r),probeCtx(),fields(),true);
  }
  function cellMark(c){
   if(!c||!probeFilled())return '';
   return BS().condHits(c,probeCtx(),kinds())?'is-hit':'is-miss';
  }

  /* ---------- 文で読む（表の下の1行） ---------- */
  function sentence(i){
   const r=t.rows[i];if(!r)return '';
   const cs=(r.conditions||[]).map(c=>sayCond(c,colLabel(c.field)));
   const head=isDefault(r)?'どれにも当てはまらないとき':(cs.length?cs.join(' かつ '):'（まだ条件がありません）');
   return `${isDefault(r)?'既定':`${i+1}行目`}: ${head} → ${o.answerLabel(r)}`;
  }

  /* ---------- 描く ---------- */
  function headHtml(){
   const st=t.dirty?'<span class="rt-state is-dirty">保存していない変更があります</span>'
    :t.stored?'<span class="rt-state">登録済み</span>':`<span class="rt-state is-seed">未登録——${o.seedNote}</span>`;
   return `<header class="rt-h"><span class="rt-step">${esc(o.step||'')}</span><h3>${esc(o.label)}</h3>${st}
    <span class="rt-acts"><select class="rt-addcol" aria-label="列（データ）を足す">${addColOptions()}</select>
     <button type="button" class="mm-btn-ghost sm" data-rt="addrow">＋ 決まりを足す</button>
     ${t.stored?`<button type="button" class="mm-btn-ghost sm" data-rt="reset" title="この表の登録を消し、${esc(o.seedNote)}へ戻します">未登録に戻す</button>`:''}
     <button type="button" class="mm-btn-primary sm" data-rt="save"${t.dirty&&!t.busy?'':' disabled'}>保存</button></span></header>
    ${o.lead?`<p class="rt-lead">${o.lead}</p>`:''}`;
  }
  function addColOptions(){
   const used=new Set(t.cols);
   const groups=(o.groups()||[]).map(g=>{
    const opts=g.key==='source'
     ?(o.sourceCols()||[]).filter(n=>!used.has(SRC+n)).map(n=>`<option value="${esc(SRC+n)}">${esc(n)}</option>`).join('')
     :fields().filter(f=>f.group===g.key&&!used.has(f.field)).map(f=>`<option value="${esc(f.field)}">${esc(f.label)}</option>`).join('');
    return opts?`<optgroup label="${esc(g.label)}">${opts}</optgroup>`:'';
   }).join('');
   return '<option value="">＋ 列（データ）を足す</option>'+groups;
  }
  function tableHtml(){
   const hit=probeHit();
   const head=`<tr><th class="rt-no">#</th>${t.cols.map((f,ci)=>`<th class="rt-col" data-g="${esc((fieldOf(f)||{}).group||(isSrc(f)?'source':''))}">`
    +`<span class="rt-cn"><b>${esc(colLabel(f))}</b>`
    +`<button type="button" class="rt-x" data-rt="delcol" data-c="${ci}" title="この列を消す" aria-label="${esc(colLabel(f))}の列を消す">×</button></span>`
    +`<small>${esc(groupWord(f))}</small></th>`).join('')}
    <th class="rt-out">→ ${esc(o.answerHead)}</th><th class="rt-note">備考</th><th class="rt-ops"></th></tr>`;
   const probe=`<tr class="rt-try"><th class="rt-no">試す</th>${t.cols.map(f=>`<td>${probeInput(f)}</td>`).join('')}
    <td class="rt-ans" colspan="3">${!probeFilled()?'<span class="is-idle">値を入れると、当たる行が光ります</span>'
     :hit?`<b>${esc(o.answerLabel(hit.row))}</b>（${isDefault(hit.row)?'既定の行':`${hit.index+1}行目`}に当たる）`:'<span class="is-idle">当たる行がありません</span>'}</td></tr>`;
   const body=t.rows.map((r,i)=>rowHtml(r,i,hit)).join('');
   const ri=t.read>=0&&t.read<t.rows.length?t.read:(hit?hit.index:0);
   return `<div class="rt-wrap"><table class="rt-table">${'<thead>'+head+probe+'</thead>'}<tbody>${body}</tbody></table></div>
    <p class="rt-read" aria-live="polite"><s>読み</s>${esc(sentence(ri))}</p>`;
  }
  const groupWord=f=>{const g=isSrc(f)?'source':(fieldOf(f)||{}).group;return ((o.groups()||[]).find(x=>x.key===g)||{}).label||''};
  function probeInput(f){
   const fd=fieldOf(f),v=o.probe[f]??'';
   if(fd&&fd.kind==='choice')return `<select class="rt-p" data-p="${esc(f)}">${['<option value="">（問わない）</option>']
    .concat((fd.options||[]).map(x=>`<option value="${esc(x)}"${x===v?' selected':''}>${esc(x)}</option>`)).join('')}</select>`;
   return `<input class="rt-p" data-p="${esc(f)}" type="${kindOf(f)==='num'?'number':'text'}" step="any" value="${esc(v)}" placeholder="値">`;
  }
  function rowHtml(r,i,hit){
   const def=isDefault(r),won=hit&&hit.index===i;
   const last=t.rows.length-2;
   const cells=def?`<td class="rt-any" colspan="${Math.max(1,t.cols.length)}">どれにも当てはまらないとき</td>`
    :t.cols.map(f=>{const c=condOf(r,f),mk=cellMark(c),bad=(r.bad||{})[f];
      /* 読めなかった字は**直すまでそのまま残す**（描き直しで消すと、受け付けたと読める）。 */
      if(bad)return `<td class="rt-cell"><input class="rt-c is-bad" data-r="${i}" data-f="${esc(f)}" value="${esc(bad.text)}"`
       +` title="${esc(bad.why)}" aria-invalid="true"><small class="rt-why">${esc(bad.why)}</small></td>`;
      return `<td class="rt-cell ${mk}"><input class="rt-c" data-r="${i}" data-f="${esc(f)}" value="${esc(cellText(c))}"`
       +` placeholder="問わない"${c?` title="${esc(sayCond(c,colLabel(f)))}"`:''}>`
       +(mk?`<i class="rt-mk" aria-hidden="true">${mk==='is-hit'?'○':'×'}</i>`:'')+'</td>'}).join('');
   const cur=o.answerOf(r);
   const sel=`<select class="rt-ansel" data-r="${i}" aria-label="${esc(o.answerHead)}">${o.answers(r).map(a=>
    `<option value="${esc(a.v)}"${a.v===cur?' selected':''}>${esc(a.label)}</option>`).join('')}</select>`;
   const ops=def?'':`<button type="button" class="rt-mv" data-rt="up" data-r="${i}" title="1つ上へ" aria-label="1つ上へ"${i===0?' disabled':''}>▲</button>`
    +`<button type="button" class="rt-mv" data-rt="down" data-r="${i}" title="1つ下へ" aria-label="1つ下へ"${i>=last?' disabled':''}>▼</button>`
    +`<button type="button" class="rt-x" data-rt="delrow" data-r="${i}" title="この決まりを消す" aria-label="この決まりを消す">×</button>`;
   return `<tr class="rt-row${def?' is-default':''}${won?' is-won':''}" data-r="${i}"><th class="rt-no">${def?'既定':i+1}</th>${cells}`
    +`<td class="rt-out">${sel}</td><td class="rt-note"><input class="rt-n" data-r="${i}" value="${esc(r.note||'')}" placeholder="—" aria-label="備考"></td>`
    +`<td class="rt-ops">${ops}</td></tr>`;
  }
  /* 描き直しても**焦点と字の位置を戻す**（試す・セルを打つたびに表を作り直すため）。 */
  function render(){
   const host=o.host();if(!host)return;
   const a=document.activeElement,mine=a&&host.contains(a);
   const key=mine?(a.dataset.p!==undefined?`[data-p="${CSS.escape(a.dataset.p)}"]`
    :a.dataset.f!==undefined&&a.dataset.r!==undefined?`.rt-c[data-r="${a.dataset.r}"][data-f="${CSS.escape(a.dataset.f)}"]`
    :a.classList.contains('rt-n')?`.rt-n[data-r="${a.dataset.r}"]`:''):'';
   const pos=mine&&typeof a.selectionStart==='number'?a.selectionStart:null;
   host.innerHTML=headHtml()+tableHtml();
   wire(host);
   if(key){const el=host.querySelector(key);if(el){el.focus();if(pos!=null)try{el.setSelectionRange(pos,pos)}catch(_e){WL.quiet.note('数の欄は字の位置を戻せない（焦点だけ戻す）',_e)}}}
  }

  /* ---------- 候補（セルに入ると出る・§9.529「サジェスト機能」） ---------- */
  function suggestFor(inp){
   const f=inp.dataset.f,kind=kindOf(f),fd=fieldOf(f);
   const typed=inp.value.trim();
   const p=parseCell(typed,kind);
   const bare=p.cond?(p.cond.op==='between'?p.cond.value:p.cond.value):typed.replace(/^[<>=!≦≧＜＞≠＝*]+/,'').replace(/\*$/,'');
   const vals=[...new Set([].concat((fd&&fd.options)||[],o.valuesOf?o.valuesOf(f):[],
     t.rows.map(r=>condOf(r,f)).filter(Boolean).flatMap(c=>c.op==='between'?[c.value,c.value2]:[c.value])).map(String))]
    .filter(v=>v&&(!bare||v.toLowerCase().includes(bare.toLowerCase())||typed===''))
    .slice(0,8);
   const items=[];
   if(vals.length){items.push({head:true,label:`${colLabel(f)}の値`});
    vals.forEach(v=>items.push({ins:v,label:v,note:`${colLabel(f)}が ${v}`,commit:true}))}
   const tm=TEMPLATES[kind==='num'?'num':'text'].filter(([op])=>!(fd&&fd.kind==='choice'&&!/^(eq|ne)$/.test(op)));
   const v=bare||'値';
   items.push({head:true,label:'書き方（押すと入ります）'});
   tm.forEach(([op,sign,say])=>{
    const ins=op==='between'?`${bare||''}〜`:op==='contains'?`*${bare||''}*`:`${sign}${bare||''}`;
    items.push({ins,label:op==='between'?`${v}〜上限`:op==='contains'?`*${v}*`:`${sign}${v}`,
     note:op==='between'?`${v} から上限まで（両端を含む）`:`${v} ${say}`,back:op==='contains'?1:0,commit:!!bare&&op!=='between'});
   });
   return {items,from:0,to:inp.value.length};
  }

  /* ---------- 触る ---------- */
  function touch(){t.dirty=true;o.onChange&&o.onChange()}
  function wire(host){
   host.querySelectorAll('[data-rt]').forEach(b=>{b.onclick=()=>act(b.dataset.rt,+b.dataset.r,+b.dataset.c)});
   const addc=host.querySelector('.rt-addcol');
   if(addc)addc.onchange=()=>{if(addc.value&&!t.cols.includes(addc.value)){t.cols.push(addc.value);touch();render()}};
   host.querySelectorAll('.rt-c').forEach(el=>{
    WL.popMenu.suggest(el,suggestFor,{onFocus:true});
    el.onchange=()=>setCell(+el.dataset.r,el.dataset.f,el.value);
    el.onfocus=()=>{t.read=+el.dataset.r;paintRead(host)};
   });
   host.querySelectorAll('.rt-row').forEach(tr=>{tr.onmouseenter=()=>{t.read=+tr.dataset.r;paintRead(host)}});
   host.querySelectorAll('.rt-ansel').forEach(el=>{el.onchange=()=>{o.setAnswer(t.rows[+el.dataset.r],el.value);touch();render()}});
   host.querySelectorAll('.rt-n').forEach(el=>{el.oninput=()=>{t.rows[+el.dataset.r].note=el.value;if(!t.dirty){t.dirty=true;paintHead(host)}o.onChange&&o.onChange(true)}});
   host.querySelectorAll('.rt-p').forEach(el=>{
    const set=()=>{o.probe[el.dataset.p]=el.value;o.onProbe?o.onProbe():render()};
    if(el.tagName==='SELECT')el.onchange=set;else el.oninput=set;
   });
  }
  function paintRead(host){const p=host.querySelector('.rt-read');if(p)p.innerHTML=`<s>読み</s>${esc(sentence(t.read))}`}
  function paintHead(host){const h=host.querySelector('.rt-h');if(h)h.outerHTML=headHtml().replace(/<p class="rt-lead">[\s\S]*$/,'');wire(host)}
  /* セルを書いたら条件へ直す。**読めない字はそのセルに理由を出して、前の条件を残す**。 */
  function setCell(ri,f,text){
   const r=t.rows[ri];if(!r)return;
   const p=parseCell(text,kindOf(f));
   if(p.error){r.bad=Object.assign(r.bad||{},{[f]:{text,why:p.error}});touch();render();return}
   if(r.bad){delete r.bad[f];if(!Object.keys(r.bad).length)delete r.bad}
   r.conditions=(r.conditions||[]).filter(c=>c.field!==f);
   if(p.cond)r.conditions.push(Object.assign({field:f},p.cond));
   r.conditions.sort((a,b)=>t.cols.indexOf(a.field)-t.cols.indexOf(b.field));
   delete r.fresh;t.read=ri;
   touch();render();
  }
  async function act(a,ri,ci){
   if(a==='addrow'){t.rows.splice(t.rows.length-1,0,Object.assign(o.blankRow(),{conditions:[],note:'',fresh:true}));t.read=t.rows.length-2;touch();render();
    const el=o.host().querySelector(`.rt-c[data-r="${t.rows.length-2}"]`);if(el)el.focus();return}
   if(a==='up'||a==='down'){
    const j=ri+(a==='up'?-1:1);
    if(j<0||j>=t.rows.length-1)return;
    [t.rows[ri],t.rows[j]]=[t.rows[j],t.rows[ri]];t.read=j;touch();render();return;
   }
   if(a==='delrow'){t.rows.splice(ri,1);t.read=-1;touch();render();return}
   if(a==='delcol'){
    const f=t.cols[ci],n=t.rows.filter(r=>condOf(r,f)).length;
    if(n&&!await confirmModal({title:'列を消す',eyebrow:o.label,
      bodyHtml:`<p class="confirm-modal-message">「${esc(colLabel(f))}」の条件 ${n}個も一緒に消えます。</p>`,
      confirmLabel:'消す',cancelLabel:'やめる'}))return;
    t.cols.splice(ci,1);
    t.rows.forEach(r=>{r.conditions=(r.conditions||[]).filter(c=>c.field!==f)});
    touch();render();return;
   }
   if(a==='save')return void save();
   if(a==='reset')return void reset();
  }
  /* 保存できる行（書きかけ・読めないセルを断ってから）。 */
  async function save(){
   const bad=t.rows.filter(r=>r.bad).length;
   if(bad)return void alertModal(`読めないセルが ${bad}行にあります。赤い枠のセルを直してから保存してください（セルの下に理由が出ています）。`);
   const empty=t.rows.filter(r=>r.fresh&&!(r.conditions||[]).length).length;
   if(empty&&!await confirmModal({title:'条件の無い決まり',eyebrow:o.label,
     bodyHtml:`<p class="confirm-modal-message">条件が1つも無い決まりが ${empty}行あります。条件の無い行は既定の行と同じ意味になるので、保存では落とします。</p>`,
     confirmLabel:'落として保存する',cancelLabel:'やめる'}))return;
   const rows=t.rows.filter(r=>(r.conditions||[]).length||r===t.rows[t.rows.length-1])
    .map(r=>Object.assign(o.rowOut(r),{conditions:r.conditions||[],note:r.note||''}));
   t.busy=true;render();
   try{await o.save(rows);t.dirty=false}
   catch(e){await alertModal('保存できませんでした：'+(e&&e.message?e.message:e))}
   finally{t.busy=false;render();o.onChange&&o.onChange()}
  }
  async function reset(){
   if(!await confirmModal({title:'未登録に戻す',eyebrow:o.label,
     bodyHtml:`<p class="confirm-modal-message">「${esc(o.label)}」の表の登録を消します。以後は${esc(o.seedNote)}で決めます。</p>`,
     confirmLabel:'未登録に戻す',cancelLabel:'やめる'}))return;
   try{await o.reset()}catch(e){await alertModal('戻せませんでした：'+(e&&e.message?e.message:e))}
  }

  return Object.assign(t,{setData,render,probeHit,sentence,isDefault});
 }

 WL.ruleTable={create,parseCell,cellText,sayCond};
})();
