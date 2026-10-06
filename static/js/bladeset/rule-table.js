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
   壊れる（§9.379）。表は1枚として編集し、保存は丸ごと（送り先と読み直しは呼ぶ側が渡す・`send()`）。
   ============================================================ */
(function(){
 const BS=()=>WL.bladeSet;
 /* 列（データ）の幅（利用者の指示「入力した文字数が多い場合もあるので条件テーブルの列幅を変化させられるように」）。
    **この端末の見え方**なので端末に覚える（表の決まりではない＝保存して他の端末へ配らない）。鍵は表と列の名前。 */
 const WIDTH_KEY='wl.ruleTable.widths';
 const widthsAll=()=>{try{return JSON.parse(localStorage.getItem(WIDTH_KEY)||'{}')||{}}catch(e){WL.quiet.note('列幅の覚えを読めない（既定の幅で出す）',e);return {}}};
 const widthOf=(table,f)=>{const w=+((widthsAll()[table]||{})[f]||0);return w>0?w:0};
 function setWidth(table,f,w){
  const all=widthsAll(),t=Object.assign({},all[table]||{});
  if(w>0)t[f]=Math.round(w);else delete t[f];
  all[table]=t;
  try{localStorage.setItem(WIDTH_KEY,JSON.stringify(all))}catch(e){WL.quiet.note('列幅の覚えを書けない（次に開くと既定の幅）',e)}
 }
 /* 幅を決めた列のセルの`style`（見出し・試す・条件のセルで同じ）。 */
 const widthStyle=w=>w?` style="width:${w}px;min-width:${w}px;max-width:${w}px"`:'';
 const SRC='source.';
 const isSrc=f=>String(f).startsWith(SRC);

 /* ---------- セルの字 ⇔ 条件 ----------
    **書き方は`blade-core.js`の1組**（`parseCell`／`cellText`／`cellSay`・§9.533）。刃組の説明の字も同じ1組を使う。
    1つのセルに「かつ／または」で組み合わせて書ける（`<0.6 または >0.9`）。 */
 const parseCell=(t,k)=>BS().parseCell(t,k);
 /* 答えの色の並び（記号の色から。赤は最後——異常と読まれる）。 */
 const ANS_TONES=[0,2,4,6,3,5,7,1];
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

 /* 数直線の図（§9.534）。範囲は条件に出てくる数の両側へ4割ずつ広げる。`set`＝`numSet()`の区間の並び。
    端の●は含む・○は含まない。数の無い組（字の列）は null。 */
 function numDomain(terms){
  const v=terms.flatMap(c=>[c.value,c.value2]).filter(x=>x!=null&&x!==''&&isFinite(+x)).map(Number);
  if(!v.length||terms.some(c=>!BS().numSet(c)))return null;
  const lo=Math.min(...v),hi=Math.max(...v),pad=(hi-lo||Math.abs(hi)||1)*0.4;
  return [lo-pad,hi+pad,[...new Set(v)].sort((a,b)=>a-b)];
 }
 function lineFig(rows,dom,o={}){
  const W=340,LW=64,X0=LW+8,X1=W-8,RH=22,H=(rows.length+(o.none?1:0))*RH+24;
  const x=v=>v<=dom[0]?X0:v>=dom[1]?X1:X0+(v-dom[0])/(dom[1]-dom[0])*(X1-X0);
  const end=(v,inc,y)=>isFinite(v)&&v>dom[0]&&v<dom[1]?`<circle cx="${x(v).toFixed(1)}" cy="${y}" r="4" class="${inc?'is-in':'is-out'}"/>`:'';
  const band=(set,y,cls)=>set.map(s=>`<g class="rt-lb ${cls||''}"><path d="M${x(s.lo).toFixed(1)} ${y}H${x(s.hi).toFixed(1)}"/>${end(s.lo,s.li,y)}${end(s.hi,s.hi2,y)}</g>`).join('');
  let b=rows.map((r,i)=>{const y=12+i*RH;return `<text x="${LW}" y="${y+4}" text-anchor="end" class="rt-lt">${esc(r.label)}</text>${band(r.set,y,r.cls)}`}).join('');
  if(o.none){const y=12+rows.length*RH;
   b+=`<text x="${LW}" y="${y+4}" text-anchor="end" class="rt-lt is-none">両方</text><text x="${X0}" y="${y+4}" class="rt-lt is-none">重なり無し——どの値も当たらない</text>`;}
  const ay=H-16;
  b+=`<path d="M${X0} ${ay}H${X1}" class="rt-ax"/>`+dom[2].map(v=>`<path d="M${x(v).toFixed(1)} ${ay-3}V${ay+3}" class="rt-ax"/>`
   +`<text x="${x(v).toFixed(1)}" y="${ay+13}" text-anchor="middle" class="rt-lt">${esc(String(v))}</text>`).join('');
  return `<svg class="rt-line" viewBox="0 0 ${W} ${H}" role="img" aria-label="数直線">${b}</svg>`;
 }

 /* 字の列の図（§9.534）。条件1つ＝輪1つ（当たる字の集まり）。`none`＝輪が離れて重ならない（かつ が成り立たない）、
    `or`＝どの輪に入っても当たる（または）、`all`＝枠ぜんたい（空欄＝問わない）。 */
 function setFig(labels,mode){
  const W=340,H=116,cy=54,n=Math.max(1,labels.length),R=Math.min(28,(W-24)/(n*2.6));
  const gap=mode==='none'?R*0.9:R*0.2,span=n*2*R+(n-1)*gap,x0=(W-span)/2+R;
  let b=`<rect x="4" y="4" width="${W-8}" height="${H-8}" rx="6" class="rt-sv-u${mode==='all'?' is-ok':''}"/>`
   +`<text x="12" y="18" class="rt-lt">${mode==='all'?'すべての値が当たる':'すべての値'}</text>`;
  labels.forEach((l,i)=>{const cx=x0+i*(2*R+gap);
   b+=`<circle cx="${cx.toFixed(1)}" cy="${cy}" r="${R.toFixed(1)}" class="rt-sv-c${mode==='or'?' is-ok':''}"/>`
    +`<text x="${cx.toFixed(1)}" y="${cy+4}" text-anchor="middle" class="rt-lt rt-sv-t">${esc(l)}</text>`;
   if(mode==='none'&&i)b+=`<text x="${(cx-R-gap/2).toFixed(1)}" y="${cy+4}" text-anchor="middle" class="rt-lt is-none">∅</text>`;});
  if(mode==='none')b+=`<text x="${W/2}" y="${H-10}" text-anchor="middle" class="rt-lt is-none">輪が重ならない——両方に当てはまる値なし</text>`;
  return `<svg class="rt-line" viewBox="0 0 ${W} ${H}" role="img" aria-label="当たる値の集まり">${b}</svg>`;
 }

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
  /* この列の値の見本（§9.574 で盤ごとの写しを1つへ）。仕掛の列は実データの見本（`loadSource()`の20行から3つまで）、
     材料の字の列（材質・調質）は名前にその字を含む仕掛の列の見本。 */
  sampleValues(f){
   const s=(this.o.samples&&this.o.samples())||{};
   if(isSrc(f))return s[String(f).slice(SRC.length)]||[];
   const fd=this.fieldOf(f);
   if(!fd||fd.group!=='material')return [];
   return Object.entries(s).filter(([n])=>n.includes(fd.label)).flatMap(([,v])=>v);
  }

  /* ---------- 読む（呼ぶ側の答えを表にする） ---------- */
  setData(rows,stored,cols){
   this.rows=(rows||[]).map(r=>Object.assign({},r,{conditions:(r.conditions||[]).map(x=>Object.assign({},x))}));
   this.stored=!!stored;this.dirty=false;this.read=-1;
   /* 列＝**保存した並び**（§9.530・サーバーの`table_cols()`）。条件にあって並びに無い列は後ろへ。
      何も無ければ**列なし**（§9.574、利用者の指示「デフォルトは条件テーブル空に」——前は呼ぶ側の既定の列を足していた）。 */
   const list=(cols||[]).slice();
   this.rows.forEach(r=>(r.conditions||[]).forEach(x=>{if(!list.includes(x.field))list.push(x.field)}));
   this.cols=list;
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
    /* 数の列は全角の数字も読む（字の欄なので打てる）。 */
    c[f]=this.kindOf(f)==='num'?Number(WL.base.toHalfWidth(String(v)).trim()):String(v);
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

  /* ---------- 当たり得ない条件（§9.534、利用者の指示「ありえない条件は代替案と登録した場合、どうなるかも含めて
     視覚化表現があると良いです」） ----------
     判じるのは`blade-core.js`の`cellDead()`の1箇所（判定と同じ意味）。表の下の盤は左から「いまの条件（数直線）→
     このまま保存すると（この行を素通りして下の行で決まる）→ 直す案（案ごとの当たる範囲・押すとセルが置き換わる）」。 */
  deadOf(r,f){const c=this.condsOf(r,f);return c.length>1?BS().cellDead(c,this.kindOf(f)):null}
  deadCells(r){
   if(!r||this.isDefault(r))return [];
   return this.cols.map(f=>({f,d:this.deadOf(r,f)})).filter(x=>x.d&&(x.d.dead||x.d.part));
  }
  rowDead(r){return this.deadCells(r).some(x=>x.d.dead)}
  /* 盤に出す行: いま読んでいる行が当たらない組を持てばその行、無ければ最初の行。 */
  deadRow(){
   return this.deadCells(this.rows[this.read]).length?this.read:this.rows.findIndex(r=>this.deadCells(r).length);
  }
  deadHtml(){
   const ri=this.deadRow();if(ri<0)return '';
   const r=this.rows[ri],{f,d}=this.deadCells(r)[0],ch=d.chains.find(x=>x.dead),label=this.colLabel(f);
   const dom=numDomain(d.chains.flatMap(x=>x.terms));
   const fig=ch.num&&dom?lineFig(ch.terms.map(c=>({label:cellText([c]),set:BS().numSet(c)})),dom,{none:true})
    :setFig(ch.terms.map(c=>cellText([c])),'none');
   return `<section class="rt-dead" data-r="${ri}" data-f="${esc(f)}" aria-live="polite">
    <header><b>${ri+1}行目の「${esc(label)}」は${d.dead?'どの値にも当たりません':'一部の組が当たりません'}</b><small>${esc(ch.why)}</small></header>
    <div class="rt-dead-b"><figure><figcaption>いまの条件</figcaption>${fig}</figure>
    <div><h4>このまま保存すると</h4>${this.afterHtml(ri,d)}</div>
    <div><h4>直す案<small>押すとセルが置き換わります</small></h4>${d.alts.map((a,i)=>this.altHtml(r,f,a,i,dom)).join('')}</div></div></section>`;
  }
  /* 保存したらどうなるか。行ごと当たらないなら**この行を素通りして下の行で決まる**流れを、行の並びのまま描く。 */
  afterHtml(ri,d){
   const ans=this.o.answerLabel(this.rows[ri]);
   if(!d.dead){
    const live=d.chains.filter(x=>!x.dead).flatMap(x=>x.terms).map((c,i)=>Object.assign({},c,{or:i?true:undefined}));
    return `<p class="rt-then">当たらない組は無いのと同じです。このセルは <b>${esc(cellText(live))}</b> としてだけ当たり、答え「${esc(ans)}」は残ります。</p>`;
   }
   const tail=this.rows.slice(ri+1),shown=tail.length>4?tail.slice(0,3).concat([tail[tail.length-1]]):tail;
   const line=(r,skip)=>{const i=this.rows.indexOf(r),def=this.isDefault(r);
    return `<li class="${skip?'is-skip':def?'is-def':''}"><b>${def?'既定':`${i+1}行目`}</b><span title="${esc(def?'':BS().rowText(r.conditions,this.fields()))}">${esc(def?'どれにも当てはまらないとき':BS().rowText(r.conditions,this.fields()))}</span><em>→ ${esc(this.o.answerLabel(r))}</em></li>`};
   return `<ol class="rt-flow">${line(this.rows[ri],true)}${tail.length>shown.length?shown.slice(0,3).map(r=>line(r)).join('')+'<li class="is-gap">…</li>'+line(shown[3]):shown.map(r=>line(r)).join('')}</ol>`
    +`<p class="rt-then">どの作業もこの行を<b>素通り</b>して、下の行で決まります。答え「${esc(ans)}」は<b>使われません</b>。</p>`;
  }
  altHtml(r,f,a,i,dom){
   const set=a.terms.length?BS().cellNumSet(a.terms,this.kindOf(f)):[{lo:-Infinity,li:false,hi:Infinity,hi2:false}];
   const fig=set&&dom?lineFig([{label:'当たる',set,cls:'is-ok'}],dom)
    :setFig(a.terms.length?BS().cellDead(a.terms,this.kindOf(f)).chains.map(x=>cellText(x.terms)):[],a.terms.length?'or':'all');
   return `<button type="button" class="rt-alt" data-alt="${i}"><b>${esc(a.text||'（空欄＝問わない）')}</b><small>${esc(a.how)}</small>${fig}`
    +`<span>→ ${esc(this.colLabel(f))}が ${esc(a.say)} なら「${esc(this.o.answerLabel(r))}」</span></button>`;
  }
  /* 読んでいる行が変わったら盤も差し替える（同じ行なら触らない＝案を押そうとしている手を止めない）。 */
  paintDead(host){
   const old=host.querySelector('.rt-dead'),ri=this.deadRow();
   if(old&&+old.dataset.r===ri)return;
   const html=this.deadHtml();
   if(old)old.outerHTML=html;else{const rd=host.querySelector('.rt-read');if(rd)rd.insertAdjacentHTML('afterend',html)}
   this.wireDead(host);
  }
  wireDead(host){
   host.querySelectorAll('.rt-alt').forEach(b=>{b.onclick=()=>{
    const p=b.closest('.rt-dead'),ri=+p.dataset.r,f=p.dataset.f,d=this.deadOf(this.rows[ri],f);
    if(d&&d.alts[+b.dataset.alt])this.setCell(ri,f,d.alts[+b.dataset.alt].text);
   }});
  }

  /* ---------- 答えの地図と列の効き目（§9.535、利用者の選択「A-12 地図＋列の効き目」） ----------
     数え上げは`blade-core.js`の`ruleGrid()`／`ruleEffect()`の1箇所（判定と同じ）。表が区別できる区間（条件に書いた境目）の
     組み合わせを全部試し、軸は**効き目の大きい2列**・残りの列は重ねる。割れるマスは「どの列で割れるか」を字で言い、
     効き目の棒の「軸にする」で軸を替える。マスを押すと試す行へ入る。覆われて一度も当たらない行は名指しする。 */
  gridRows(){return this.rows.map(r=>r.fresh&&!(r.conditions||[]).length?Object.assign({},r,{enabled:false}):r)}
  grid(){
   const key=JSON.stringify([this.rows.map(r=>[r.conditions,this.o.answerLabel(r),!!r.fresh]),this.cols]);
   if(this._g&&this._g.key===key)return this._g;
   const G=BS().ruleGrid(this.gridRows(),this.fields(),Object.fromEntries(this.cols.map(f=>[f,this.kindOf(f)])));
   const ans=q=>q.win<0?'':this.o.answerLabel(this.rows[q.win]);
   this._g={key,G,ans,eff:G.tooMany?[]:BS().ruleEffect(G,ans).sort((a,b)=>b.share-a.share)};
   return this._g;
  }
  shadowOf(i){return (this.grid().G.shadow||[]).find(s=>s.index===i)||null}
  rowWord(i){return i<0?'—':this.isDefault(this.rows[i])?'既定':`${i+1}行目`}
  shadowTag(i){const s=this.shadowOf(i);return s?`<small class="rt-deadtag">一度も当たらない（${this.rowWord(s.by)}が先に取る）</small>`:''}
  /* 軸: 自分で選んだ列 → 効き目の大きい順で2つまで（効き目0%の列も、ほかに無ければ使う）。 */
  mapAxes(){
   const {G,eff}=this.grid(),ax=(this.axes||[]).filter(f=>G.cols.some(c=>c.field===f));
   eff.forEach(e=>{if(ax.length<2&&!ax.includes(e.field))ax.push(e.field)});
   return ax.slice(0,2);
  }
  /* 答えの色。呼ぶ側が名乗れば（保持方式＝刃組図と同じ色）それ、無ければ表に出てくる順に記号の色から。 */
  toneOf(label){
   const r=this.rows.find(x=>this.o.answerLabel(x)===label);
   const own=r&&this.o.answerTone&&this.o.answerTone(r);if(own)return own;
   const seen=[...new Set(this.rows.map(x=>this.o.answerLabel(x)))],n=Math.max(0,seen.indexOf(label));
   return `var(--bs-badge-${ANS_TONES[n%ANS_TONES.length]})`;
  }
  mapHtml(){
   if(!this.cols.length)return '';
   const {G}=this.grid();if(!G.cols.length)return '';
   const head=`<summary><b>答えの地図と列の効き目</b><small>条件に書いた境目で区切った区間の組み合わせ ${G.size}通りを全部試した答え</small></summary>`;
   if(G.tooMany)return `<details class="rt-map" open>${head}<p class="rt-then">組み合わせが ${G.size}通りあり、多すぎるので数えません（${G.max}通りまで）。列か境目を減らすと出ます。</p></details>`;
   const [X,Y]=this.mapAxes(),cut=f=>{const c=G.cols.find(x=>x.field===f);return c&&c.num?JSON.stringify(c.iv.slice(1).map(x=>x.at)):'[]'};
   return `<details class="rt-map"${this.mapOpen===false?'':' open'} data-x="${esc(X)}" data-y="${esc(Y||'')}" data-bx='${cut(X)}' data-by='${Y?cut(Y):'[]'}'>${head}
    <div class="rt-map-b"><figure>${this.mapSvg(X,Y)}${this.legendHtml()}</figure><div class="rt-eff">${this.effHtml(X,Y)}${this.shadowHtml()}</div></div></details>`;
  }
  mapSvg(X,Y){
   const {G}=this.grid(),ci=G.cols.findIndex(c=>c.field===X),cj=Y?G.cols.findIndex(c=>c.field===Y):-1;
   const cx=G.cols[ci],cy=cj>=0?G.cols[cj]:{iv:[{label:''}]},ny=cy.iv.length;
   const W=720,L=Y?100:8,T=6,B=34,ch=Math.max(30,Math.min(64,260/ny)),H=T+B+ch*ny,cw=(W-L-4)/cx.iv.length;
   let g='';
   cx.iv.forEach((_,a)=>cy.iv.forEach((__,b)=>{g+=this.cellSvg(ci,cj,a,b,[L+a*cw,T+(ny-1-b)*ch,cw,ch],[X,Y])}));
   cx.iv.forEach((v,a)=>{g+=`<text x="${(L+a*cw+cw/2).toFixed(1)}" y="${H-B+15}" text-anchor="middle" class="rt-lt">${esc(v.label)}</text>`});
   if(Y)cy.iv.forEach((v,b)=>{g+=`<text x="${L-6}" y="${(T+(ny-1-b)*ch+ch/2+4).toFixed(1)}" text-anchor="end" class="rt-lt">${esc(v.label)}</text>`});
   g+=`<text x="${W-4}" y="${H-3}" text-anchor="end" class="rt-lt rt-lb">${esc(this.colLabel(X))} →</text>`+(Y?`<text x="2" y="${T+12}" class="rt-lt rt-lb">${esc(this.colLabel(Y))}</text>`:'');
   const hz=`rt-hz-${esc(this.key)}`;
   return `<svg class="rt-msvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="答えの地図"><defs><pattern id="${hz}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V7" class="rt-hzl"/></pattern></defs>${g.split('#HZ#').join(hz)}</svg>`;
  }
  /* マス1つ: 答えの割合で塗り分け、勝った行の番号、割れるなら「どの列で割れるか」（`ruleEffect()`をマスの中で）。 */
  cellSvg(ci,cj,a,b,[x0,y0,cw,ch],[X,Y]){
   const {G,ans}=this.grid(),qs=G.cases.filter(q=>q.ix[ci]===a&&(cj<0||q.ix[cj]===b));
   const cnt=new Map(),wins=new Set();qs.forEach(q=>{const k=ans(q);cnt.set(k,(cnt.get(k)||0)+1);wins.add(q.win)});
   const ks=[...cnt.keys()].sort((p,q)=>cnt.get(q)-cnt.get(p)),ws=[...wins].sort((p,q)=>(p<0)-(q<0)||p-q);
   let o='',off=0;
   ks.forEach(k=>{const w=cnt.get(k)/qs.length*cw;o+=`<rect x="${(x0+off).toFixed(1)}" y="${y0.toFixed(1)}" width="${(w+0.3).toFixed(1)}" height="${ch.toFixed(1)}" style="fill:${this.toneOf(k)}"/>`;off+=w});
   const split=ks.length>1?BS().ruleEffect(G,ans,qs).filter(e=>e.n&&e.field!==X&&e.field!==Y).map(e=>this.colLabel(e.field)):[];
   const say=ks.length>1?(split.length?`${split.join('・')}で割れる`:'境目の値で変わる'):'',lines=this.splitLines(say,split,cw,ch);
   const rows=ws.length>1?ws.map(i=>i<0?'—':this.isDefault(this.rows[i])?'既定':i+1).join('・'):this.rowWord(ws[0]);
   const cy=y0+ch/2+4-lines.length*7,xl=G.cols[ci].iv[a].label,yl=cj>=0?`・${G.cols[cj].iv[b].label}`:'';
   if(ks.length>1)o+=`<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" style="fill:url(#HZ#)"/>`;
   return `<g class="rt-mc" data-cx="${a}" data-cy="${cj<0?0:b}" data-w="${ws.join(',')}" tabindex="0" role="button">`
    +`<title>${esc(`${xl}${yl}: ${ks.join('／')}（${rows}）${say?`。${say}`:''}。押すと「試す」の行に入れます`)}</title>${o}`
    +`<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" class="rt-mcf"/>`
    +`<text x="${(x0+cw/2).toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" class="rt-mct">${esc(rows)}</text>`
    +lines.map((t,n)=>`<text x="${(x0+cw/2).toFixed(1)}" y="${(cy+14*(n+1)).toFixed(1)}" text-anchor="middle" class="rt-mcs">${esc(t)}</text>`).join('')+'</g>';
  }
  /* 「どの列で割れるか」の字をマスに収める（1行 → 列ごとに縦へ → 「N列で割れる」）。全部はマスの title が言う。 */
  splitLines(say,split,cw,ch){
   if(!say)return [];
   const fit=t=>t.length*11<=cw-8;
   if(fit(say))return [say];
   if(split.length>1&&ch>=14*(split.length+2)&&split.every(fit))return split.concat(['で割れる']);
   const n=`${split.length}列で割れる`;return [fit(n)?n:'割れる'];
  }
  legendHtml(){
   const {G,ans}=this.grid(),seen=[...new Set(G.cases.map(ans))];
   return `<p class="rt-mleg">${seen.map(k=>`<span><i style="background:${this.toneOf(k)}"></i>${esc(k||'（どれにも当たらない）')}</span>`).join('')}<span class="rt-mleg-h">斜線＝残りの列しだいで答えが変わる</span></p>`;
  }
  effHtml(X,Y){
   const {eff}=this.grid();
   const rows=eff.map(e=>{const pct=Math.round(e.share*100),on=e.field===X?'横軸':e.field===Y?'縦軸':'';
    return `<div class="rt-eff-r" data-eff="${esc(e.field)}"><b>${esc(this.colLabel(e.field))}</b><span class="rt-bar"><i style="width:${pct}%"></i></span><span>${pct}%</span>`
     +(on?`<em>${on}</em>`:`<button type="button" class="mm-btn-ghost sm rt-axbtn" data-axis="${esc(e.field)}">横軸にする</button>`)+'</div>'}).join('');
   const zero=eff.filter(e=>!e.n).map(e=>this.colLabel(e.field));
   return `<h4>列の効き目<small>その列の値だけを変えると答えが変わる割合</small></h4>${rows}`
    +(zero.length?`<p class="rt-then">${esc(zero.join('・'))}は、どの答えも変えていません（列を消しても答えは同じ）。</p>`:'');
  }
  shadowHtml(){
   const sh=this.grid().G.shadow||[];
   if(!sh.length)return '<p class="rt-then rt-ok">上の行に覆われて一度も当たらない行はありません。</p>';
   return `<h4>一度も当たらない行</h4><ul class="rt-shadow">${sh.map(s=>`<li data-shadow="${s.index}"><b>${s.index+1}行目</b>（→ ${esc(this.o.answerLabel(this.rows[s.index]))}）`
    +`——条件に入る場合は全部 <b>${this.rowWord(s.by)}</b> が先に取ります</li>`).join('')}</ul>`;
  }
  wireMap(host){
   host.querySelectorAll('.rt-axbtn').forEach(b=>{b.onclick=()=>{this.axes=[b.dataset.axis,this.mapAxes()[0]];this.render()}});
   host.querySelectorAll('.rt-mc').forEach(c=>{c.onclick=()=>this.probeCell(+c.dataset.cx,+c.dataset.cy);
    c.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this.probeCell(+c.dataset.cx,+c.dataset.cy)}}});
   const d=host.querySelector('.rt-map');if(d)d.ontoggle=()=>{this.mapOpen=d.open};
   this.paintMapRow(host);
  }
  /* 押したマスの区間の始まりの値を「試す」の行へ（字の組は実在の値のときだけ・形で作った字は入れない）。 */
  probeCell(a,b){
   const {G}=this.grid();
   this.mapAxes().forEach((f,n)=>{const c=G.cols.find(x=>x.field===f),iv=c&&c.iv[n?b:a];if(!iv)return;
    const rep=iv.reps[0];this.o.probe[f]=c.num?String(+(+rep).toFixed(4)):(iv.rank===0||iv.rank==null?rep:'')});
   this.o.onProbe?this.o.onProbe():this.render();
  }
  /* 読んでいる行が答えを決めるマスに印（表の行と地図を結ぶ）。 */
  paintMapRow(host){
   host.querySelectorAll('.rt-mc').forEach(c=>c.classList.toggle('is-row',this.read>=0&&c.dataset.w.split(',').includes(String(this.read))));
  }

  /* ---------- 描く ---------- */
  headHtml(){
   const o=this.o;
   const st=this.dirty?'<span class="rt-state is-dirty">保存していない変更があります</span>'
    :this.stored?'<span class="rt-state">登録済み</span>':`<span class="rt-state is-seed">未登録——${o.seedNote}</span>`;
   const nd=this.rows.filter((r,i)=>this.rowDead(r)||this.shadowOf(i)).length;
   return `<header class="rt-h"><h3>${esc(o.label)}</h3>${st}${nd?`<span class="rt-state is-warn">当たらない決まり ${nd}行</span>`:''}
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
   return `<th class="rt-col" data-f="${esc(f)}" data-g="${esc((this.fieldOf(f)||{}).group||(isSrc(f)?'source':''))}"${widthStyle(widthOf(this.o.key,f))}>`
    +`<span class="rt-cn">${this.gripHtml('col',ci,`${this.colLabel(f)}の列`)}<b>${esc(this.colLabel(f))}</b>`
    +`<button type="button" class="rt-x" data-rt="delcol" data-c="${ci}" title="この列を消す" aria-label="${esc(this.colLabel(f))}の列を消す">×</button></span>`
    +`<small>${esc(this.groupWord(f))}</small>`
    +`<span class="rt-wgrip" title="掴んで列の幅を変える（ダブルクリックで元の幅）" aria-hidden="true"></span></th>`;
  }
  probeRowHtml(hit){
   const ans=!this.probeFilled()?'<span class="is-idle">値を入れると、当たる行が光ります</span>'
    :hit?`<b>${esc(this.o.answerLabel(hit.row))}</b>（${this.isDefault(hit.row)?'既定の行':`${hit.index+1}行目`}に当たる）`:'<span class="is-idle">当たる行がありません</span>';
   return `<tr class="rt-try"><th class="rt-no">試す</th>${this.cols.map(f=>`<td data-f="${esc(f)}"${widthStyle(widthOf(this.o.key,f))}>${this.probeInput(f)}</td>`).join('')}<td class="rt-ans" colspan="3">${ans}</td></tr>`;
  }
  tableHtml(){
   const hit=this.probeHit();
   const head=`<tr><th class="rt-no">#</th>${this.cols.map((f,ci)=>this.colHeadHtml(f,ci)).join('')}
    <th class="rt-out">→ ${esc(this.o.answerHead)}</th><th class="rt-note">備考</th><th class="rt-ops"></th></tr>`;
   const body=this.rows.map((r,i)=>this.rowHtml(r,i,hit)).join('');
   const ri=this.read>=0&&this.read<this.rows.length?this.read:(hit?hit.index:0);
   return `<div class="rt-wrap"><table class="rt-table"><thead>${head}${this.probeRowHtml(hit)}</thead><tbody>${body}</tbody></table></div>
    <p class="rt-read" aria-live="polite"><s>読み</s>${esc(this.sentence(ri))}</p>${this.deadHtml()}${this.mapHtml()}`;
  }
  probeInput(f){
   const fd=this.fieldOf(f),v=this.o.probe[f]??'';
   if(fd&&fd.kind==='choice')return `<select class="rt-p" data-p="${esc(f)}">${['<option value="">（問わない）</option>']
    .concat((fd.options||[]).map(x=>`<option value="${esc(x)}"${x===v?' selected':''}>${esc(x)}</option>`)).join('')}</select>`;
   /* 数の列も`type=text`＋`inputmode="decimal"`（§9.574）。`type=number`は土台の決まりで右寄せになり、広い欄で
      「右から埋まる」と読まれた。日本語の入力も受けない。数かどうかは判定（`probeCtx()`）が読む。 */
   return `<input class="rt-p" data-p="${esc(f)}" type="text"${this.kindOf(f)==='num'?' inputmode="decimal"':''} value="${esc(v)}" placeholder="値">`;
  }
  /* セル1つ。読めなかった字は**直すまでそのまま残す**（描き直しで消すと、受け付けたと読める）。 */
  cellHtml(r,i,f){
   const c=this.condsOf(r,f),mk=this.cellMark(c),bad=(r.bad||{})[f],ws=widthStyle(widthOf(this.o.key,f));
   if(bad)return `<td class="rt-cell" data-f="${esc(f)}"${ws}><input class="rt-c is-bad" data-r="${i}" data-f="${esc(f)}" value="${esc(bad.text)}"`
    +` title="${esc(bad.why)}" aria-invalid="true"><small class="rt-why">${esc(bad.why)}</small></td>`;
   /* 当たり得ない組は字で言う（色だけにしない・§CLAUDE 3）。理由と直し方は表の下の盤（`deadHtml()`）。 */
   const d=this.isDefault(r)?null:this.deadOf(r,f),dw=d&&(d.dead?'当たらない':d.part?'一部当たらない':'');
   const why=dw?d.chains.filter(x=>x.dead).map(x=>x.why).join('／'):'';
   return `<td class="rt-cell ${mk}${dw?(d.dead?' is-dead':' is-deadpart'):''}" data-f="${esc(f)}"${ws}><input class="rt-c" data-r="${i}" data-f="${esc(f)}" value="${esc(cellText(c))}"`
    +` placeholder="問わない"${c.length?` title="${esc(sayCell(c,this.colLabel(f))+(why?`（${why}）`:''))}"`:''}>`
    +(mk?`<i class="rt-mk" aria-hidden="true">${mk==='is-hit'?'○':'×'}</i>`:'')+(dw?`<small class="rt-deadtag">${dw}</small>`:'')+'</td>';
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
    +`<td class="rt-out">${sel}${this.shadowTag(i)}</td><td class="rt-note"><input class="rt-n" data-r="${i}" value="${esc(r.note||'')}" placeholder="—" aria-label="備考"></td>`
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
   if(el){el.focus();if(pos!=null&&el.setSelectionRange)el.setSelectionRange(pos,pos)}
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
   /* 候補から選ぶ列（板押さえ方式・刃のカテゴリ…）も**字の列と同じ書き方を全部**出す——前は「＝／≠」だけで、
      保持方式の表と同じ条件（または・で始まる・含む・空…）が書けると分からなかった（利用者の指摘）。判定は前から字として比べる。 */
   const tm=TEMPLATES[kind==='num'?'num':'text'];
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
   const vals=[...new Set([].concat((fd&&fd.options)||[],this.sampleValues(f),
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
   this.wireGrips(host);this.wireWidths(host);this.wireDead(host);this.wireMap(host);
   host.querySelectorAll('.rt-p').forEach(el=>{
    const set=()=>{this.o.probe[el.dataset.p]=el.value;this.o.onProbe?this.o.onProbe():this.render()};
    /* 打つたびに表を作り直すので、**変換中は待つ**（`onTyped`・日本語が「kか」に割れる不具合）。 */
    if(el.tagName==='SELECT')el.onchange=set;else WL.base.onTyped(el,set);
   });
  }
  /* 列幅の取っ手（一覧と同じ道具`WL.columnWidthGrip`）。引いている間は見出しとその列のセルの幅だけ替え、
     離したら端末に覚えて描き直す。ダブルクリックで中身なりの幅へ戻す。 */
  wireWidths(host){
   if(typeof WL.columnWidthGrip!=='function')return;
   host.querySelectorAll('.rt-col .rt-wgrip').forEach(grip=>{
    const f=grip.closest('.rt-col').dataset.f;
    const cells=()=>[...this.o.host().querySelectorAll(`.rt-table [data-f="${CSS.escape(f)}"]:is(th,td)`)];
    WL.columnWidthGrip(grip,{
     startWidth:()=>{const th=cells().find(el=>el.tagName==='TH');return th?th.getBoundingClientRect().width:0},
     preview:w=>cells().forEach(el=>{el.style.width=el.style.minWidth=el.style.maxWidth=`${w}px`}),
     commit:w=>{setWidth(this.o.key,f,w);this.render()},
     reset:()=>{setWidth(this.o.key,f,0);this.render()},
    });
   });
  }
  /* 備考は打つそばから写す（表は作り直さない＝打っている欄の焦点を奪わない）。頭の「保存」だけ押せる形へ。 */
  setNote(host,ri,v){
   this.rows[ri].note=v;
   if(!this.dirty){this.dirty=true;const h=host.querySelector('.rt-h');if(h){h.outerHTML=this.headHtml();this.wire(host)}}
   this.o.onChange&&this.o.onChange(true);
  }
  paintRead(host){const p=host.querySelector('.rt-read');if(p)p.innerHTML=`<s>読み</s>${esc(this.sentence(this.read))}`;this.paintDead(host);this.paintMapRow(host)}
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
   const dead=this.rows.map((r,i)=>this.rowDead(r)||this.shadowOf(i)?i:-1).filter(i=>i>=0);
   if(dead.length&&!await confirmModal({title:'当たらない決まり',eyebrow:this.o.label,
     bodyHtml:`<p class="confirm-modal-message">${dead.map(i=>`${i+1}行目（→ ${esc(this.o.answerLabel(this.rows[i]))}）`).join('・')}は、`
      +`当たり得ない条件か、上の行に覆われているため<b>どの作業にも当たりません</b>。保存すると作業はこの行を素通りして下の行で決まり、この答えは使われません。</p>`
      +'<p class="confirm-modal-message">直す案は表の下に出ています。</p>',
     confirmLabel:'このまま保存する',cancelLabel:'やめて直す'}))return;
   const last=this.rows[this.rows.length-1];
   const rows=this.rows.filter(r=>(r.conditions||[]).length||r===last)
    .map(r=>Object.assign(this.o.rowOut(r),{conditions:r.conditions||[],note:r.note||''}));
   this.busy=true;this.render();
   try{
    const eq=this.o.payload().equipment||'';
    if(!await this.send({rows,cols:this.cols.slice()}))throw new Error('更新者IDが決まっていません');
    showToast&&showToast(`${this.label}の表を保存しました`,`${eq}・${rows.length}行`,2600);
   }
   catch(e){await alertModal('保存できませんでした：'+(e&&e.message?e.message:e))}
   finally{this.busy=false;this.render();this.o.onChange&&this.o.onChange()}
  }
  async reset(){
   if(!await confirmModal({title:'未登録に戻す',eyebrow:this.o.label,
     bodyHtml:`<p class="confirm-modal-message">「${esc(this.o.label)}」の表の登録を消します。以後は${esc(this.o.seedNote)}で決めます。</p>`,
     confirmLabel:'未登録に戻す',cancelLabel:'やめる'}))return;
   try{await this.send({reset:true})}catch(e){await alertModal('戻せませんでした：'+(e&&e.message?e.message:e))}
  }
  /* 書く段取り（更新者ID → 送る → 読み直す）は1つ（§9.574 で盤ごとの写しを1つへ）。盤は送り先（`endpoint`）・
     いつも載せる鍵（`payload()`＝設備・表の名前）・読み直し（`reload()`）だけを渡す。IDが決まらなければ送らずに偽。
     書けたらこの表は**読み直す前に**「変更なし」にする——同じ画面のほかの表の保存していない変更は、読み直しで捨てない
     （`reload()`は変更の残る表を飛ばす。前は刃のカテゴリを保存すると刃厚の表に足した列が消えた）。 */
  async send(extra){
   const uid=WL.mm.requireMaintUser();if(uid===null)return false;
   await WL.bsKit.post(this.o.endpoint,Object.assign({},this.o.payload(),extra,{user_id:uid}));
   this.dirty=false;
   await this.o.reload();
   return true;
  }
 }
 const create=o=>new RuleTable(o);
 /* 仕掛の列名と見本（条件の列の候補）。**読めなければ空**——計算値の列だけで組める。判定表を持つ盤はどれもここを呼ぶ。 */
 async function loadSource(){
  const db=WL.dataSource&&WL.dataSource.workKey&&WL.dataSource.workKey();
  if(!db)return {columns:[],samples:{}};
  try{const r=await api('/api/table-columns?samples=1&db='+encodeURIComponent(db),{quiet:true});
   return {columns:Array.isArray(r.columns)?r.columns:[],samples:r.samples||{}}}
  catch(e){WL.quiet.note('仕掛の列名を取れない（計算値の列だけで組める）',e);return {columns:[],samples:{}}}
 }

 WL.ruleTable={create,loadSource,parseCell,cellText,sayCell};
})();
