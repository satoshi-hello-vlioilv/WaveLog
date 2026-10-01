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
     ・セルの書き方: `< 0.6`・`0.6〜1.0`・`>= 20`・`SUS`・`!= X`・`*SUS*`（含む）・`SUS*`（で始まる）・`*304`（で終わる）・
       `≠ *H5*`（含まない）・`空`・`/正規表現/`。1つのセルに `かつ`／`または` で組み合わせられる（§9.533）。**空欄＝問わない**
     ・セルに入ると**候補**が出る（この列の値＋書き方の見本。↑↓・Enter）。書いた決まりは
       表の下の1行が**文で読み上げる**（「板厚が 0.6 より小さい かつ … → フィンガー」）
     ・**行も列も後から並べ替えられる**（§9.530）——行は左の番号、列は見出しの「⠿」を掴んで運ぶ
       （キーなら ↑↓／←→）。列の並びは表の設定として保存する（条件の出てくる順から起こさない）
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

 /* ---------- セルの字 ⇔ 条件 ----------
    **書き方は`blade-core.js`の1組**（`parseCell`／`cellText`／`cellSay`・§9.533）。刃組の説明の字も同じ1組を使う。
    1つのセルに「かつ／または」で組み合わせて書ける（`<0.6 または >0.9`）。 */
 const parseCell=(t,k)=>BS().parseCell(t,k);
 const cellText=terms=>BS().cellText(terms);
 const sayCell=(terms,label)=>`${label}が ${BS().cellSay(terms)}`;

 /* 書き方の見本（候補の後半）。[入れる字, 説明, 続きを打つ, 値を使わない, 見本の字]。`v`＝いま打っている値。字の列は前方一致・後方一致・含む・否定・空・正規表現まで
    （§9.533「前方一致、や後方一致など様々な種類」）。組み合わせの見本は数の列・字の列とも最後に。 */
 const TEMPLATES={
  num:[[v=>`＜ ${v}`,'より小さい'],[v=>`≦ ${v}`,'以下'],[v=>`≧ ${v}`,'以上'],[v=>`＞ ${v}`,'より大きい'],
       [v=>`${v}〜`,'範囲（両端を含む）',1,0,v=>`${v}〜上限`],[v=>`≠ ${v}`,'以外'],
       [v=>`＜ ${v} または ＞ `,'どちらかに当たれば（または）',1,0,v=>`＜ ${v} または ＞ 値2`],
       [v=>`≧ ${v} かつ ＜ `,'両方に当たれば（かつ）',1,0,v=>`≧ ${v} かつ ＜ 値2`]],
  text:[[v=>v,'と同じ'],[v=>`${v}*`,'で始まる（前方一致）'],[v=>`*${v}`,'で終わる（後方一致）'],[v=>`*${v}*`,'を含む'],
        [v=>`≠ ${v}`,'以外'],[v=>`≠ *${v}*`,'を含まない'],[v=>`≠ ${v}*`,'で始まらない'],
        [v=>`${v} または `,'ほかの値でもよい（または）',1,0,v=>`${v} または 値2`],[()=>'空','空欄のとき',0,1],[()=>'空でない','何か入っているとき',0,1],
        [v=>`/${v}/`,'正規表現に合う']],
 };

 /* 表1枚。**状態（行・列・保存の印）と呼ぶ側の差し込み口（`o`）を持つ組**——盤は答えの列と保存先だけを
    渡す（保持方式・刃のカテゴリ・刃厚が同じ組を使う）。描く・読む・触るは短いメソッドに分ける（§9.522）。 */
 class RuleTable{
  constructor(o){
   this.o=o;
   Object.assign(this,{key:o.key,label:o.label,rows:[],cols:[],stored:false,dirty:false,read:-1,busy:false});
  }
  fields(){return this.o.fields()||[]}
  fieldOf(f){return this.fields().find(x=>x.field===f)||null}
  colLabel(f){return isSrc(f)?String(f).slice(SRC.length):((this.fieldOf(f)||{}).label||f)}
  kindOf(f){return ((this.fieldOf(f)||{}).kind)||(isSrc(f)?'auto':'text')}
  /* その列のセルの条件（並びのまま・`or`つき）。空の配列＝問わない。 */
  condsOf(row,f){return (row.conditions||[]).filter(c=>c.field===f)}
  /* 既定の行＝条件の無い行。**足したばかりで条件をまだ書いていない行**（`fresh`）は違う。 */
  isDefault(r){return !(r.conditions||[]).length&&!r.fresh}
  kinds(){return Object.fromEntries(this.fields().map(f=>[f.field,f.kind]))}
  groupWord(f){const g=isSrc(f)?'source':(this.fieldOf(f)||{}).group;return ((this.o.groups()||[]).find(x=>x.key===g)||{}).label||''}

  /* ---------- 読む（呼ぶ側の答えを表にする） ---------- */
  setData(rows,stored,cols){
   this.rows=(rows||[]).map(r=>Object.assign({},r,{conditions:(r.conditions||[]).map(x=>Object.assign({},x))}));
   this.stored=!!stored;this.dirty=false;this.read=-1;
   /* 列＝**保存した並び**（§9.530・サーバーの`table_cols()`）。条件にあって並びに無い列は後ろへ。
      何も無ければ呼ぶ側の既定の列。 */
   const list=(cols||[]).slice();
   this.rows.forEach(r=>(r.conditions||[]).forEach(x=>{if(!list.includes(x.field))list.push(x.field)}));
   this.cols=list.length?list:(this.o.defaultCols||[]).slice();
   this.sortConds();
  }
  /* 行の条件を列の並びへそろえる（保存しても読み直しても同じ並びになるように）。 */
  sortConds(){this.rows.forEach(r=>(r.conditions||[]).sort((a,b)=>this.cols.indexOf(a.field)-this.cols.indexOf(b.field)))}

  /* ---------- 試す（同じ画面の表どうしで値を共有する） ---------- */
  probeCtx(){
   const c={};
   /* **見えている列の値だけ**を読む——消した列の値が裏で効くと、画面に無い条件で答えが変わる。 */
   this.cols.forEach(f=>{
    const v=this.o.probe[f];
    if(v===undefined||String(v).trim()==='')return;
    c[f]=this.kindOf(f)==='num'?Number(v):String(v);
   });
   return c;
  }
  probeFilled(){return this.cols.some(f=>String(this.o.probe[f]??'').trim()!=='')}
  probeHit(){
   if(!this.probeFilled())return null;
   /* 書きかけの行（条件なし）は当てない——既定の行と取り違えないように。番号は表の並びのまま。 */
   return BS().firstRule(this.rows.map(r=>r.fresh&&!(r.conditions||[]).length?Object.assign({},r,{enabled:false}):r),this.probeCtx(),this.fields(),true);
  }
  cellMark(terms){
   if(!terms.length||!this.probeFilled())return '';
   return BS().rowHits(terms,this.probeCtx(),this.kinds())?'is-hit':'is-miss';
  }

  /* ---------- 文で読む（表の下の1行） ---------- */
  sentence(i){
   const r=this.rows[i];if(!r)return '';
   /* 列どうしは「かつ」。セルの中に「または」があれば括弧で包む（かつ と取り違えない）。 */
   const cs=BS().condGroups(r.conditions).map(g=>{const t=g.terms,s=BS().cellSay(t);
    return `${this.colLabel(g.field)}が ${t.some(c=>c.or)?`（${s}）`:s}`});
   const head=this.isDefault(r)?'どれにも当てはまらないとき':(cs.length?cs.join(' かつ '):'（まだ条件がありません）');
   return `${this.isDefault(r)?'既定':`${i+1}行目`}: ${head} → ${this.o.answerLabel(r)}`;
  }

  /* ---------- 描く ---------- */
  headHtml(){
   const o=this.o;
   const st=this.dirty?'<span class="rt-state is-dirty">保存していない変更があります</span>'
    :this.stored?'<span class="rt-state">登録済み</span>':`<span class="rt-state is-seed">未登録——${o.seedNote}</span>`;
   return `<header class="rt-h"><h3>${esc(o.label)}</h3>${st}
    <span class="rt-acts"><select class="rt-addcol" aria-label="列（データ）を足す">${this.addColOptions()}</select>
     <button type="button" class="mm-btn-ghost sm" data-rt="addrow">＋ 決まりを足す</button>
     ${this.stored?`<button type="button" class="mm-btn-ghost sm" data-rt="reset" title="この表の登録を消し、${esc(o.seedNote)}へ戻します">未登録に戻す</button>`:''}
     <button type="button" class="mm-btn-primary sm" data-rt="save"${this.dirty&&!this.busy?'':' disabled'}>保存</button></span></header>`;
  }
  leadHtml(){return this.o.lead?`<p class="rt-lead">${this.o.lead}</p>`:''}
  addColOptions(){
   const used=new Set(this.cols);
   const groups=(this.o.groups()||[]).map(g=>{
    const opts=g.key==='source'
     ?(this.o.sourceCols()||[]).filter(n=>!used.has(SRC+n)).map(n=>`<option value="${esc(SRC+n)}">${esc(n)}</option>`).join('')
     :this.fields().filter(f=>f.group===g.key&&!used.has(f.field)).map(f=>`<option value="${esc(f.field)}">${esc(f.label)}</option>`).join('');
    return opts?`<optgroup label="${esc(g.label)}">${opts}</optgroup>`:'';
   }).join('');
   return '<option value="">＋ 列（データ）を足す</option>'+groups;
  }
  colHeadHtml(f,ci){
   return `<th class="rt-col" data-g="${esc((this.fieldOf(f)||{}).group||(isSrc(f)?'source':''))}">`
    +`<span class="rt-cn">${this.gripHtml('col',ci,`${this.colLabel(f)}の列`)}<b>${esc(this.colLabel(f))}</b>`
    +`<button type="button" class="rt-x" data-rt="delcol" data-c="${ci}" title="この列を消す" aria-label="${esc(this.colLabel(f))}の列を消す">×</button></span>`
    +`<small>${esc(this.groupWord(f))}</small></th>`;
  }
  probeRowHtml(hit){
   const ans=!this.probeFilled()?'<span class="is-idle">値を入れると、当たる行が光ります</span>'
    :hit?`<b>${esc(this.o.answerLabel(hit.row))}</b>（${this.isDefault(hit.row)?'既定の行':`${hit.index+1}行目`}に当たる）`:'<span class="is-idle">当たる行がありません</span>';
   return `<tr class="rt-try"><th class="rt-no">試す</th>${this.cols.map(f=>`<td>${this.probeInput(f)}</td>`).join('')}<td class="rt-ans" colspan="3">${ans}</td></tr>`;
  }
  tableHtml(){
   const hit=this.probeHit();
   const head=`<tr><th class="rt-no">#</th>${this.cols.map((f,ci)=>this.colHeadHtml(f,ci)).join('')}
    <th class="rt-out">→ ${esc(this.o.answerHead)}</th><th class="rt-note">備考</th><th class="rt-ops"></th></tr>`;
   const body=this.rows.map((r,i)=>this.rowHtml(r,i,hit)).join('');
   const ri=this.read>=0&&this.read<this.rows.length?this.read:(hit?hit.index:0);
   return `<div class="rt-wrap"><table class="rt-table"><thead>${head}${this.probeRowHtml(hit)}</thead><tbody>${body}</tbody></table></div>
    <p class="rt-read" aria-live="polite"><s>読み</s>${esc(this.sentence(ri))}</p>`;
  }
  probeInput(f){
   const fd=this.fieldOf(f),v=this.o.probe[f]??'';
   if(fd&&fd.kind==='choice')return `<select class="rt-p" data-p="${esc(f)}">${['<option value="">（問わない）</option>']
    .concat((fd.options||[]).map(x=>`<option value="${esc(x)}"${x===v?' selected':''}>${esc(x)}</option>`)).join('')}</select>`;
   return `<input class="rt-p" data-p="${esc(f)}" type="${this.kindOf(f)==='num'?'number':'text'}" step="any" value="${esc(v)}" placeholder="値">`;
  }
  /* セル1つ。読めなかった字は**直すまでそのまま残す**（描き直しで消すと、受け付けたと読める）。 */
  cellHtml(r,i,f){
   const c=this.condsOf(r,f),mk=this.cellMark(c),bad=(r.bad||{})[f];
   if(bad)return `<td class="rt-cell"><input class="rt-c is-bad" data-r="${i}" data-f="${esc(f)}" value="${esc(bad.text)}"`
    +` title="${esc(bad.why)}" aria-invalid="true"><small class="rt-why">${esc(bad.why)}</small></td>`;
   return `<td class="rt-cell ${mk}"><input class="rt-c" data-r="${i}" data-f="${esc(f)}" value="${esc(cellText(c))}"`
    +` placeholder="問わない"${c.length?` title="${esc(sayCell(c,this.colLabel(f)))}"`:''}>`
    +(mk?`<i class="rt-mk" aria-hidden="true">${mk==='is-hit'?'○':'×'}</i>`:'')+'</td>';
  }
  opsHtml(i){
   return `<button type="button" class="rt-x" data-rt="delrow" data-r="${i}" title="この決まりを消す" aria-label="この決まりを消す">×</button>`;
  }
  /* 掴む札（§9.530）。行は番号の横、列は見出しの名前の前。運ぶのは札だけ（欄を掴んで字を選べなくしない）。 */
  gripHtml(kind,i,what){
   const keys=kind==='row'?'↑↓':'←→';
   return `<span class="rt-grip" draggable="true" tabindex="0" role="button" data-grip="${kind}" data-i="${i}"`
    +` title="掴んで動かす（${keys}キーでも動きます）" aria-label="${esc(what)}を動かす（${keys}キー）">⠿</span>`;
  }
  rowHtml(r,i,hit){
   const o=this.o,def=this.isDefault(r),won=hit&&hit.index===i;
   const cells=def?`<td class="rt-any" colspan="${Math.max(1,this.cols.length)}">どれにも当てはまらないとき</td>`
    :this.cols.map(f=>this.cellHtml(r,i,f)).join('');
   const cur=o.answerOf(r);
   const sel=`<select class="rt-ansel" data-r="${i}" aria-label="${esc(o.answerHead)}">${o.answers(r).map(a=>
    `<option value="${esc(a.v)}"${a.v===cur?' selected':''}>${esc(a.label)}</option>`).join('')}</select>`;
   const no=def?'既定':`${this.gripHtml('row',i,`${i+1}行目の決まり`)}${i+1}`;
   return `<tr class="rt-row${def?' is-default':''}${won?' is-won':''}" data-r="${i}"><th class="rt-no">${no}</th>${cells}`
    +`<td class="rt-out">${sel}</td><td class="rt-note"><input class="rt-n" data-r="${i}" value="${esc(r.note||'')}" placeholder="—" aria-label="備考"></td>`
    +`<td class="rt-ops">${def?'':this.opsHtml(i)}</td></tr>`;
  }
  /* 描き直しても**焦点と字の位置を戻す**（試す・セルを打つたびに表を作り直すため）。 */
  render(){
   const host=this.o.host();if(!host)return;
   const a=document.activeElement,mine=a&&host.contains(a);
   const grip=this.refocus;this.refocus=null;
   const key=grip?`.rt-grip[data-grip="${grip.kind}"][data-i="${grip.i}"]`:mine?(a.dataset.p!==undefined?`[data-p="${CSS.escape(a.dataset.p)}"]`
    :a.dataset.f!==undefined&&a.dataset.r!==undefined?`.rt-c[data-r="${a.dataset.r}"][data-f="${CSS.escape(a.dataset.f)}"]`
    :a.classList.contains('rt-n')?`.rt-n[data-r="${a.dataset.r}"]`:''):'';
   const pos=mine&&typeof a.selectionStart==='number'?a.selectionStart:null;
   host.innerHTML=this.headHtml()+this.leadHtml()+this.tableHtml();
   this.wire(host);
   const el=key&&host.querySelector(key);
   if(el){el.focus();if(pos!=null)try{el.setSelectionRange(pos,pos)}catch(_e){WL.quiet.note('数の欄は字の位置を戻せない（焦点だけ戻す）',_e)}}
  }

  /* ---------- 候補（セルに入ると出る・§9.529「サジェスト機能」） ----------
     「この列の値」（候補から選ぶ項目の顔ぶれ・仕掛の見本・表に書いた値）＋「書き方」の見本。
     **↑↓で選ぶまで何も選ばない**（`pick:false`）——打ち終えた字を Tab で離れても置き換えない。 */
  suggestFor(inp){
   const f=inp.dataset.f,kind=this.kindOf(f),fd=this.fieldOf(f);
   const typed=inp.value;
   /* 「かつ／または」の後ろは**続きの条件**として候補を出す（前の条件は残し、末尾に足す）。 */
   const cont=typed.match(/^(.*(?:かつ|または|＆|&|｜|\|))\s*([^]*)$/);
   const head=cont?cont[1].replace(/\s*$/,' '):'',last=(cont?cont[2]:typed).trim();
   const p=parseCell(last,kind),c=p.conds&&p.conds[0];
   /* 書き終えた条件（記号・範囲・含む…）には候補を出さない（読み上げは表の下の1行が言う）。 */
   if(c&&c.op!=='eq'&&last)return null;
   const bare=c?c.value:last.replace(/^[<>=!≦≧＜＞≠＝*]+/,'').replace(/\*$/,'');
   const items=this.valueItems(f,fd,bare,last).map(it=>it.head?it:Object.assign(it,{ins:head+it.ins}));
   const choice=fd&&fd.kind==='choice';
   const tm=TEMPLATES[kind==='num'?'num':'text'].filter(([mk])=>!choice||/^(≠ )?v?$/.test(mk('v')));
   const v=bare||'値';
   items.push({head:true,label:'書き方（押すと入ります）'});
   tm.forEach(([mk,say,open,fixed,lab])=>{
    const ins=head+mk(bare||'');
    items.push({ins,label:(lab||mk)(v),note:fixed?say:`${v} ${say}`,back:/^\*.*\*$/.test(mk('x'))&&!/^≠/.test(mk('x'))?1:0,
                commit:(!!bare||!!fixed)&&!open});
   });
   return {items,from:0,to:inp.value.length,pick:false};
  }
  valueItems(f,fd,bare,typed){
   const vals=[...new Set([].concat((fd&&fd.options)||[],this.o.valuesOf?this.o.valuesOf(f):[],
     this.rows.flatMap(r=>this.condsOf(r,f)).flatMap(c=>c.op==='between'?[c.value,c.value2]:[c.value])).map(String))]
    .filter(v=>v&&(!bare||v.toLowerCase().includes(bare.toLowerCase())||typed===''))
    .slice(0,8);
   if(!vals.length)return [];
   return [{head:true,label:`${this.colLabel(f)}の値`}].concat(vals.map(v=>({ins:v,label:v,note:`${this.colLabel(f)}が ${v}`,commit:true})));
  }

  /* ---------- 触る ---------- */
  touch(){this.dirty=true;this.o.onChange&&this.o.onChange()}
  wire(host){
   host.querySelectorAll('[data-rt]').forEach(b=>{b.onclick=()=>this.act(b.dataset.rt,+b.dataset.r,+b.dataset.c)});
   const addc=host.querySelector('.rt-addcol');
   if(addc)addc.onchange=()=>{if(addc.value&&!this.cols.includes(addc.value)){this.cols.push(addc.value);this.touch();this.render()}};
   host.querySelectorAll('.rt-c').forEach(el=>{
    WL.popMenu.suggest(el,inp=>this.suggestFor(inp),{onFocus:true});
    el.onchange=()=>this.setCell(+el.dataset.r,el.dataset.f,el.value);
    el.onfocus=()=>{this.read=+el.dataset.r;this.paintRead(host)};
   });
   host.querySelectorAll('.rt-row').forEach(tr=>{tr.onmouseenter=()=>{this.read=+tr.dataset.r;this.paintRead(host)}});
   host.querySelectorAll('.rt-ansel').forEach(el=>{el.onchange=()=>{this.o.setAnswer(this.rows[+el.dataset.r],el.value);this.touch();this.render()}});
   host.querySelectorAll('.rt-n').forEach(el=>{el.oninput=()=>this.setNote(host,+el.dataset.r,el.value)});
   this.wireGrips(host);
   host.querySelectorAll('.rt-p').forEach(el=>{
    const set=()=>{this.o.probe[el.dataset.p]=el.value;this.o.onProbe?this.o.onProbe():this.render()};
    if(el.tagName==='SELECT')el.onchange=set;else el.oninput=set;
   });
  }
  /* 備考は打つそばから写す（表は作り直さない＝打っている欄の焦点を奪わない）。頭の「保存」だけ押せる形へ。 */
  setNote(host,ri,v){
   this.rows[ri].note=v;
   if(!this.dirty){this.dirty=true;const h=host.querySelector('.rt-h');if(h){h.outerHTML=this.headHtml();this.wire(host)}}
   this.o.onChange&&this.o.onChange(true);
  }
  paintRead(host){const p=host.querySelector('.rt-read');if(p)p.innerHTML=`<s>読み</s>${esc(this.sentence(this.read))}`}
  /* セルを書いたら条件へ直す。**読めない字はそのセルに理由を出して、前の条件を残す**。 */
  setCell(ri,f,text){
   const r=this.rows[ri];if(!r)return;
   const p=parseCell(text,this.kindOf(f));
   if(p.error){r.bad=Object.assign(r.bad||{},{[f]:{text,why:p.error}});this.touch();this.render();return}
   if(r.bad){delete r.bad[f];if(!Object.keys(r.bad).length)delete r.bad}
   r.conditions=(r.conditions||[]).filter(c=>c.field!==f);
   p.conds.forEach(c=>r.conditions.push(Object.assign({field:f},c)));
   r.conditions.sort((a,b)=>this.cols.indexOf(a.field)-this.cols.indexOf(b.field));
   delete r.fresh;this.read=ri;
   this.touch();this.render();
  }
  act(a,ri,ci){
   const moves={
    addrow:()=>this.addRow(),
    delrow:()=>{this.rows.splice(ri,1);this.read=-1;this.touch();this.render()},
    delcol:()=>this.delCol(ci),
    save:()=>this.save(),reset:()=>this.reset(),
   };
   return moves[a]&&moves[a]();
  }
  addRow(){
   const at=this.rows.length-1;
   this.rows.splice(at,0,Object.assign(this.o.blankRow(),{conditions:[],note:'',fresh:true}));
   this.read=at;this.touch();this.render();
   const el=this.o.host().querySelector(`.rt-c[data-r="${at}"]`);if(el)el.focus();
  }
  /* ---------- 並べ替え（§9.530） ----------
     行: 既定の行は動かさない（いつも最後）。列: 動かしたら各行の条件も列の並びへそろえる。 */
  moveRow(from,to){
   const last=this.rows.length-1;
   to=Math.max(0,Math.min(to,last-1));
   if(from===to||from<0||from>=last)return false;
   const [r]=this.rows.splice(from,1);this.rows.splice(to,0,r);
   this.read=to;this.touch();return true;
  }
  moveCol(from,to){
   to=Math.max(0,Math.min(to,this.cols.length-1));
   if(from===to||from<0||from>=this.cols.length)return false;
   const [f]=this.cols.splice(from,1);this.cols.splice(to,0,f);
   this.sortConds();this.touch();return true;
  }
  /* 運んだ先の位置。行は縦の中ほど、列は見出しの横の中ほどで前後を決める。 */
  dropIndex(host,kind,ev){
   const els=kind==='row'?[...host.querySelectorAll('.rt-row:not(.is-default)')]:[...host.querySelectorAll('.rt-col')];
   const at=els.findIndex(el=>{const r=el.getBoundingClientRect();return kind==='row'?ev.clientY<r.top+r.height/2:ev.clientX<r.left+r.width/2});
   return at<0?els.length:at;
  }
  paintDrop(host,kind,at){
   host.querySelectorAll('.is-drop-before,.is-drop-after').forEach(el=>el.classList.remove('is-drop-before','is-drop-after'));
   if(at==null)return;
   const els=kind==='row'?[...host.querySelectorAll('.rt-row:not(.is-default)')]:[...host.querySelectorAll('.rt-col')];
   if(at<els.length)els[at].classList.add('is-drop-before');else if(els.length)els[els.length-1].classList.add('is-drop-after');
  }
  /* 確定は`dragend`（§9.201: 最後の`dragover`が断った場所で離すと`drop`は起きない）。動いていなければ何もしない。 */
  wireGrips(host){
   const table=host.querySelector('.rt-table');if(!table)return;
   host.querySelectorAll('.rt-grip').forEach(g=>{
    const kind=g.dataset.grip,i=+g.dataset.i;
    g.ondragstart=e=>{this.drag={kind,from:i,to:i};e.dataTransfer.effectAllowed='move';
     try{e.dataTransfer.setData('text/plain',kind+i)}catch(_e){WL.quiet.note('運ぶ物の字を渡せない（並べ替えはそのまま動く）',_e)}
     (kind==='row'?g.closest('tr'):g.closest('th')).classList.add('is-dragging')};
    g.ondragend=()=>this.endDrag(host);
    g.onkeydown=e=>this.gripKey(e,kind,i);
   });
   table.ondragover=e=>{
    const d=this.drag;if(!d)return;
    e.preventDefault();e.dataTransfer.dropEffect='move';
    const at=this.dropIndex(host,d.kind,e);
    d.to=at>d.from?at-1:at;this.paintDrop(host,d.kind,at);
   };
   table.ondrop=e=>{if(this.drag){e.preventDefault();this.endDrag(host)}};
  }
  endDrag(host){
   const d=this.drag;this.drag=null;
   if(!d)return;
   this.paintDrop(host,d.kind,null);
   const moved=d.kind==='row'?this.moveRow(d.from,d.to):this.moveCol(d.from,d.to);
   if(moved)this.refocus={kind:d.kind,i:d.to};
   this.render();
  }
  gripKey(e,kind,i){
   const step={row:{ArrowUp:-1,ArrowDown:1},col:{ArrowLeft:-1,ArrowRight:1}}[kind][e.key];
   if(!step)return;
   e.preventDefault();
   const to=i+step,moved=kind==='row'?this.moveRow(i,to):this.moveCol(i,to);
   if(!moved)return;
   this.refocus={kind,i:to};this.render();
  }
  async delCol(ci){
   const f=this.cols[ci],n=this.rows.filter(r=>this.condsOf(r,f).length).length;
   if(n&&!await confirmModal({title:'列を消す',eyebrow:this.o.label,
     bodyHtml:`<p class="confirm-modal-message">「${esc(this.colLabel(f))}」の条件 ${n}個も一緒に消えます。</p>`,
     confirmLabel:'消す',cancelLabel:'やめる'}))return;
   this.cols.splice(ci,1);
   this.rows.forEach(r=>{r.conditions=(r.conditions||[]).filter(c=>c.field!==f)});
   this.touch();this.render();
  }
  /* 保存できる行（書きかけ・読めないセルを断ってから）。 */
  async save(){
   const bad=this.rows.filter(r=>r.bad).length;
   if(bad)return void alertModal(`読めないセルが ${bad}行にあります。赤い枠のセルを直してから保存してください（セルの下に理由が出ています）。`);
   const empty=this.rows.filter(r=>r.fresh&&!(r.conditions||[]).length).length;
   if(empty&&!await confirmModal({title:'条件の無い決まり',eyebrow:this.o.label,
     bodyHtml:`<p class="confirm-modal-message">条件が1つも無い決まりが ${empty}行あります。条件の無い行は既定の行と同じ意味になるので、保存では落とします。</p>`,
     confirmLabel:'落として保存する',cancelLabel:'やめる'}))return;
   const last=this.rows[this.rows.length-1];
   const rows=this.rows.filter(r=>(r.conditions||[]).length||r===last)
    .map(r=>Object.assign(this.o.rowOut(r),{conditions:r.conditions||[],note:r.note||''}));
   this.busy=true;this.render();
   try{await this.o.save(rows,this.cols.slice());this.dirty=false}
   catch(e){await alertModal('保存できませんでした：'+(e&&e.message?e.message:e))}
   finally{this.busy=false;this.render();this.o.onChange&&this.o.onChange()}
  }
  async reset(){
   if(!await confirmModal({title:'未登録に戻す',eyebrow:this.o.label,
     bodyHtml:`<p class="confirm-modal-message">「${esc(this.o.label)}」の表の登録を消します。以後は${esc(this.o.seedNote)}で決めます。</p>`,
     confirmLabel:'未登録に戻す',cancelLabel:'やめる'}))return;
   try{await this.o.reset()}catch(e){await alertModal('戻せませんでした：'+(e&&e.message?e.message:e))}
  }
 }
 const create=o=>new RuleTable(o);

 WL.ruleTable={create,parseCell,cellText,sayCell};
})();
