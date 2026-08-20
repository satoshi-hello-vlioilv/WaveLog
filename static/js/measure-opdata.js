/* measure-opdata.js: 操業データ（§9.215／§9.216 ②）
   ============================================================
   利用者の指示（§9.215）:
     「項目自体をマスタ化し他の設備でも使えるように設備ごとに持たせ、変更
      できるようにする、設定値も必要に応じてマスタ化して関連付け。各項目ごと、
      入力方式や入力上限値、入力データの型を選べるようにする」
   利用者の指示（§9.216 ②）:
     「既存のオペレータ、検査員、作業人数、内径、スプール、縦割数、横割数、
      板厚測定器、板幅測定器、巻出し方向、など、準備で入力させている情報の
      すべてを操業データとして、入力している項目を汎用化したい。一部の必須
      入力事項もマスタで設定可能とし、今あるデータ設定も汎用化、描画可能な
      エリア(縦2×横3のカード)内の中でレイアウトも含めてマスタ上で視覚的に
      調整D&Dで並び替え編集ができる汎用設定機能」

   ここが持つのは**器と割り付け**だけ。何を記録するかは`操業データ項目マスタ`
   が決めるので、**項目名をこのファイルへ書かない**。

   ------------------------------------------------------------
   **作り直さず、割り付けだけを差配する。**
   ------------------------------------------------------------
   準備の入力欄（オペレータ・内径・横割数…）は`index.html`に既にあり、
   それぞれが仕掛由来のプリセット（§9.204の内径）・条数の上限（§9.210 ⑤）・
   171人ぶんを測った幅（§9.130）といった仕掛けを持っている。マスタの定義から
   作り直すと、それを全部書き直すことになる。だからここでするのは
     ・並び（`order`）
     ・カードの中で何列ぶんか（`grid-column: span N`）
     ・群（見出し）と、その群を畳むかどうか
     ・出す／出さない
     ・どちらのカードへ出すか（準備 / ②の入力内容）
   の5つだけで、**DOMは動かさない**（§9.122／§9.125。受信欄の制約と
   `.selectors>*`の規則を壊さないため）。自由項目だけはここが作るが、
   置き場は同じ`.selectors`の直下——**組み込みと同じ器・同じ文字**にする
   ことが、見た目をそろえるいちばん確実な方法（§9.216 ⑤）。

   値は`S.measure.settings.opData`（項目名→文字列）。**鍵は日本語の項目名**
   （§9.162と同じ約束）。組み込みの欄はそれぞれ元からの保存先を持っている
   ので、こちらへは入れない（同じ値を2箇所に持たない・§8）。

   **打った時点でレコードへ入れる**（§9.208 ②）。`collect()`は保存のときしか
   走らないので、そこだけに任せると「入力したのに数えられない」が起きる。
   ============================================================ */
(function(){
 const $=s=>document.querySelector(s);
 const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>(
   {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

 /* 設備ごとの定義。**開いた設備が変わるまで使い回す**——測定を開くたびに
    引き直すと、ロットを開く速さがマスタの往復に引きずられる。 */
 let defs=[],builtinOff=[],gridCols=6,defsFor=null,loading=null;
 /* 畳んでいる群。**この端末の覚え**（読み方の好みなのでPCごとに違ってよい。
    §9.199の`childBadge`と同じ考え方）。 */
 const FOLD_KEY='MeasureOpFoldV2';
 /* 群名→true(畳む)/false(開く)。**既定は「条件があるかどうか」で決まる**
    ので、覚えるのは**触ったものだけ**（触っていない群は既定に追随する）。 */
 let foldPref=new Map();
 try{foldPref=new Map(Object.entries(JSON.parse(localStorage.getItem(FOLD_KEY)||'{}')))}catch(e){}
 const rememberFold=()=>{
  try{localStorage.setItem(FOLD_KEY,JSON.stringify(Object.fromEntries(foldPref)))}catch(e){}
 };

 const PLACE_PREP='準備',PLACE_INPUT='入力内容';

 function equipmentNow(){
  try{
   return String(localStorage.getItem('AccessMeasurementConfiguredEquipment')||'').trim();
  }catch(e){return ''}
 }

 async function load(equipment){
  const eq=String(equipment||equipmentNow()||'').trim();
  if(defsFor===eq&&Array.isArray(defs))return defs;
  if(loading&&loading.eq===eq)return loading.p;
  const p=(async()=>{
   try{
    const r=await api('/api/operation-form?equipment='+encodeURIComponent(eq));
    defs=Array.isArray(r.items)?r.items:[];
    builtinOff=Array.isArray(r.builtinOff)?r.builtinOff:[];
    gridCols=Number(r.gridCols)>0?Number(r.gridCols):6;
   }catch(e){
    /* **読めなくても測定は開ける**（fail-open）。入力欄が出ないことは
       画面に書く——黙って空にすると「項目が無い設備」と区別が付かない。
       **組み込みの欄はそのまま**にする（読めなかったことを理由に、今まで
       使えていた入力欄を消さない）。 */
    console.warn('操業データの項目を読めませんでした',e);
    defs=[];builtinOff=[];
   }
   defsFor=eq;loading=null;return defs;
  })();
  loading={eq,p};
  return p;
 }

 /* 型ごとの入れ物。**型は6つだけ**（サーバーの`ITEM_TYPES`と同じ）。 */
 const isNumeric=t=>['整数','正の整数','数値','正の数'].includes(t);
 const isPositive=t=>['正の整数','正の数'].includes(t);
 const isInteger=t=>['整数','正の整数'].includes(t);

 /* いま画面に出ている値。**入力欄から読む**——`settings.opData`は
    打った時点で書いているが、開いた直後は空なので画面が正。 */
 function values(){
  const out={};
  document.querySelectorAll('[data-op]').forEach(el=>{
   const k=el.dataset.op;const v=String(el.value==null?'':el.value).trim();
   if(v!=='')out[k]=v;
  });
  return out;
 }

 /* **`window.S`で参照しないこと。** `S`は`base.js`の**トップレベルの
    `const`**で、`window`のプロパティにはならない（`window.S`は常に
    `undefined`）。素の`S`なら別のスクリプトからも見える。 */
 const state=()=>(typeof S!=='undefined'&&S)?S:null;
 function store(){
  const m=state()&&S.measure;if(!m)return null;
  if(!m.settings||typeof m.settings!=='object')return null;
  if(!m.settings.opData||typeof m.settings.opData!=='object')m.settings.opData={};
  return m.settings.opData;
 }

 /* 打った値をその場でレコードへ入れる（§9.208 ②）。 */
 function remember(key,value){
  const bag=store();if(!bag)return;
  const v=String(value==null?'':value).trim();
  if(v==='')delete bag[key];else bag[key]=v;
  if(typeof markDirty==='function')markDirty();
 }

 /* 型に合わない文字はその場で落とす。**打っている最中に断らない**
    ——「-」や「1.」は途中の形として通し、外れたときに整える。 */
 function sanitize(el,def){
  const t=def.type;
  if(!isNumeric(t))return;
  let v=String(el.value||'');
  v=v.replace(/[０-９．＋－]/g,c=>'0123456789.+-'['０１２３４５６７８９．＋－'.indexOf(c)]);
  v=v.replace(/[^0-9.\-]/g,'');
  if(isPositive(t))v=v.replace(/-/g,'');
  else v=v.replace(/(?!^)-/g,'');
  if(isInteger(t))v=v.replace(/\./g,'');
  else{const i=v.indexOf('.');if(i>=0)v=v.slice(0,i+1)+v.slice(i+1).replace(/\./g,'')}
  if(el.value!==v)el.value=v;
 }

 /* 欄から離れたときに桁と上下限へそろえる。**直したことを画面に書く**
    （§CLAUDE 6）——黙って値が変わると、打ち間違いに気づけない。 */
 function settle(el,def,note){
  if(!isNumeric(def.type)){remember(def.name,el.value);return}
  const raw=String(el.value||'').trim();
  if(raw===''||raw==='-'||raw==='.'){el.value='';remember(def.name,'');say(note,'');return}
  let n=Number(raw);
  if(!Number.isFinite(n)){el.value='';remember(def.name,'');say(note,'数字として読めなかったので消しました');return}
  const msgs=[];
  if(isPositive(def.type)&&n<0){n=Math.abs(n);msgs.push('マイナスは入りません')}
  const dec=isInteger(def.type)?0:(Number.isFinite(Number(def.decimals))?Number(def.decimals):1);
  const fixed=isInteger(def.type)?String(Math.round(n)):n.toFixed(dec);
  if(def.min!==null&&def.min!==undefined&&Number(fixed)<Number(def.min)){
   n=Number(def.min);msgs.push(`下限 ${def.min} まで戻しました`);
  }else if(def.max!==null&&def.max!==undefined&&Number(fixed)>Number(def.max)){
   n=Number(def.max);msgs.push(`上限 ${def.max} まで戻しました`);
  }else{
   n=Number(fixed);
  }
  const out=isInteger(def.type)?String(Math.round(n)):Number(n).toFixed(dec);
  if(out!==raw&&!msgs.length)msgs.push(`小数${dec}桁へそろえました`);
  el.value=out;
  remember(def.name,out);
  say(note,msgs.join(' ／ '));
 }
 function say(note,text){
  if(!note)return;
  note.textContent=text||'';
  note.hidden=!text;
 }

 /* ---------- 自由項目の入れ物 ----------
    **組み込みの欄と同じ形にする**（§9.216 ⑤、利用者の指摘「操業データの
    カード内の文字サイズがバラバラ」）。以前は`.opf`という独自の器を別の
    カードへ置いていたため、名前・値・注記がそれぞれ別の大きさになっていた。
    `<label data-f>`＝準備の入力欄と同じ器にすれば、文字も高さも余白も
    ①のCSSがそのまま当たる（規格を守らせる仕組みの中に入れる・§9.127）。 */
 function fieldEl(def,i){
  const label=document.createElement('label');
  label.className='opf';
  label.dataset.opgen='1';
  label.dataset.f='op:'+def.name;
  label.dataset.opfield=def.name;
  const unit=def.unit?`<em class="opf-unit">${esc(def.unit)}</em>`:'';
  const range=[];
  if(def.min!==null&&def.min!==undefined)range.push(`${def.min} 以上`);
  if(def.max!==null&&def.max!==undefined)range.push(`${def.max} 以下`);
  /* **入る形を先に書く**（§CLAUDE 6「出どころ・単位・根拠を画面に出す」）
     ——打ってから断られるより、打つ前に分かるほうが速い。器が狭いので
     `title`にも同じことを入れる。 */
  const hint=def.type==='選択'?'':(isInteger(def.type)?'整数':`小数${def.decimals==null?1:def.decimals}桁`)
    +(isPositive(def.type)?'・0以上':'')+(range.length?`・${range.join('／')}`:'');
  let control;
  const id='opf'+i;
  if(def.type==='選択'){
   const opts=['<option value=""></option>']
     .concat((def.choices||[]).map(v=>`<option value="${esc(v)}">${esc(v)}</option>`)).join('');
   control=`<select id="${id}" data-op="${esc(def.name)}">${opts}</select>`;
  }else if(isNumeric(def.type)){
   /* `type=number`にしない（§9.208 ③）——`.5`のような途中の形が
      **黙って消える**。文字として受けて自分で整える。 */
   control=`<input id="${id}" class="numeric-input" type="text" inputmode="decimal"`
     +` data-op="${esc(def.name)}" autocomplete="off">`;
  }else{
   control=`<input id="${id}" type="text" data-op="${esc(def.name)}" autocomplete="off">`;
  }
  label.title=[def.name,def.unit?`単位 ${def.unit}`:'',hint,def.note||''].filter(Boolean).join('｜');
  label.innerHTML=`<span class="opf-name">${esc(def.name)}`
   +(def.required?'<b class="opf-req" title="入力が要ります">必須</b>':'')+'</span>'
   +control+unit
   +(def.choiceMissing?`<small class="opf-warn">選択肢「${esc(def.choice)}」が未登録です</small>`:'')
   +'<small class="opf-note" hidden></small>';
  return label;
 }

 /* ---------- 群にまとめる ---------- */
 function groupsFor(place){
  const out=[];
  defs.filter(d=>(d.place||PLACE_PREP)===place).forEach(d=>{
   const name=d.group||'その他';
   let g=out.find(x=>x.name===name);
   /* 群を畳むかは**行が持つ**（群そのものの表は作らない・マスタを増やさない）。
      **1つでも「畳む」と言っていれば畳む**——群の中で食い違ったときに
      「どちらが正か」を決められる形にしておく（マスタ管理の画面は群単位で
      書き換えるので、ふつうは食い違わない）。 */
   if(!g){g={name,items:[],fold:false,showWhen:new Set()};out.push(g)}
   g.items.push(d);
   if(d.fold)g.fold=true;
   (d.showWhen||[]).forEach(x=>g.showWhen.add(String(x).trim()));
  });
  return out;
 }

 /* 畳んだ群を自動で開く条件（§9.216 ③、利用者の指示「条入力時に展開され
    共通項目になります」）。**空なら畳んだまま**（条件の無い群を勝手に
    開かない）。 */
 function autoOpen(g){
  if(!g.showWhen.size)return false;
  const t=(typeof WL!=='undefined'&&WL.measureItem)
    ?WL.measureItem.normalize($('#measureType')?.value)
    :($('#measureType')?.value||'');
  return g.showWhen.has(String(t||'').trim());
 }
 /* **既定は「条件があるかどうか」で決まる。**
      条件つき（条の入力）… 畳んで待ち、当たったら開く（§9.216 ③）
      条件なし（いつもと同じ設定）… 開いておく（§9.133「入力させる項目は
        全部見せる」。畳むかどうかは触った人が決める）
    どちらも押せば手で開閉でき、触ったぶんだけ覚える。 */
 const defaultFolded=g=>g.showWhen.size>0;
 function isFolded(g){
  if(!g.fold)return false;
  if(autoOpen(g))return false;
  const p=foldPref.get(g.name);
  return p===undefined?defaultFolded(g):!!p;
 }

 /* 畳んだままでも値は読めること（§9.125）。見出しに現在値を並べる。 */
 function summaryOf(g){
  return g.items.map(d=>{
   const el=controlOf(d);if(!el)return '';
   const v=(el.selectedOptions&&el.selectedOptions[0]?el.selectedOptions[0].text:el.value)||'';
   return String(v).trim();
  }).filter(v=>v&&v!=='-').join('・');
 }

 /* その定義に対応する入力欄。組み込みは画面が持っているものを引き当てる。 */
 function controlOf(def){
  if(def.builtin)return document.getElementById(def.builtin);
  return document.querySelector(`[data-op="${CSS.escape(def.name)}"]`);
 }
 function hostOf(def){
  if(def.builtin){
   const el=document.querySelector(`.selectors>[data-f="${CSS.escape(def.builtin)}"]`);
   return el||null;
  }
  return document.querySelector(`.selectors>[data-opfield="${CSS.escape(def.name)}"]`);
 }

 /* ---------- 割り付け ----------
    `.selectors`は**6列のグリッド**（§9.135「細かくするのはカードの内側だけ」）。
    見出しは`1/-1`で1行を占め、項目は`span N`で流れる。位置を1つずつ明示
    しないのは、マスタで並べ替えるたびに行番号を計算し直すことになるため
    ——**見出しが行を切る**ので、自動配置でも群の境目と行の境目はずれない。 */
 function layout(){
  const box=document.querySelector('.selectors');
  if(!box)return;
  /* 前回の割り付けを外してから始める（§9.210 ④と同じ約束——付いたまま
     測る・置くと、1回変えた形が二度と戻らない）。 */
  box.querySelectorAll('[data-opgen]').forEach(el=>el.remove());
  box.querySelectorAll('[data-f]').forEach(el=>{
   el.classList.remove('op-off','op-folded','op-required');
   el.style.order='';el.style.gridColumn='';
   delete el.dataset.opplace;delete el.dataset.opgroup;
  });
  box.style.setProperty('--op-cols',String(gridCols));
  /* **マスタが名指ししている組み込みの欄だけを差配する。** 作業時間・
     丈位置・入力内容はマスタに載せていない（②で使う道具・③で記録する
     もの）ので、今までどおりCSSの見せ分けに任せる。 */
  const off=new Set(builtinOff||[]);
  off.forEach(key=>{
   const el=document.querySelector(`.selectors>[data-f="${CSS.escape(key)}"]`);
   if(el)el.classList.add('op-off');
  });
  let seq=0,missing=[];
  [PLACE_PREP,PLACE_INPUT].forEach(place=>{
   groupsFor(place).forEach(g=>{
    const fold=isFolded(g);
    const head=document.createElement(g.fold?'button':'b');
    head.className='prep-head'+(g.fold?' prep-fold':'');
    head.dataset.opgen='1';head.dataset.opgroup=g.name;head.dataset.opplace=place;
    head.style.order=String(seq++);
    head.style.gridColumn='1/-1';
    /* **先頭の見出しには上の線を引かない。** 並びは`order`で決まるので
       `:first-of-type`では当たらない（DOMの順ではない）。ここで印を付ける。 */
    if(!box.querySelector(`[data-opgen][data-opplace="${place}"][data-opfirst]`))
     head.dataset.opfirst='1';
    if(g.fold){
     head.type='button';
     head.setAttribute('aria-expanded',fold?'false':'true');
     head.title=fold?`「${g.name}」を開きます`:`「${g.name}」を畳みます`;
     head.innerHTML=`<span class="prep-fold-name">${esc(g.name)}</span>`
      +`<span class="prep-sum">${esc(fold?summaryOf(g):'')}</span>`
      +`<span class="prep-chev" aria-hidden="true"></span>`;
     head.addEventListener('click',()=>{
      foldPref.set(g.name,!isFolded(g));
      rememberFold();layout();
     });
    }else{
     head.textContent=g.name;
    }
    box.appendChild(head);
    g.items.forEach(d=>{
     let el=hostOf(d);
     if(!el&&!d.builtin){el=fieldEl(d,seq);box.appendChild(el)}
     if(!el){missing.push(d.name);return}
     el.dataset.opplace=place;el.dataset.opgroup=g.name;
     el.style.order=String(seq++);
     el.style.gridColumn='span '+Math.max(1,Math.min(gridCols,Number(d.span)||2));
     el.classList.toggle('op-folded',fold);
     el.classList.toggle('op-required',!!d.required);
    });
   });
  });
  /* **無いものは無いと書く**（§4）。組み込みキーの綴りが変わった・画面から
     消えた欄をマスタが名指ししていると、黙って1つ欠けるだけになる。 */
  const note=document.getElementById('opDataNote');
  if(note){
   const msgs=[];
   if(!defs.length){
    msgs.push(defsFor===null?'操業データの項目を読み込んでいます…'
     :'この設備の操業データの項目は登録されていません（マスタ管理 &gt; 操業データ項目）。');
   }
   if(missing.length)msgs.push(`画面に無い項目を${missing.length}件飛ばしました: ${esc(missing.slice(0,4).join('、'))}`);
   note.innerHTML=msgs.join('<br>');
   note.hidden=!msgs.length;
  }
  bind();
  bindMeasureType();
  apply();
  foldSig=currentFoldSig();
  /* **入れ物の大きさは中身から決める**（§9.130／§9.131）。作り替えた直後に
     測り直さないと、自由項目はCSSの受け皿(`--w-md`)のままで並び、
     `alignColumnWidths()`が同じ列の1〜2桁の欄まで引き上げる。
     **名前空間付きで呼ぶこと**——素の`fitControlWidths`は`measure-steps.js`の
     IIFEの中なので、外からは見えない。 */
  if(window.WL&&WL.measureSteps&&WL.measureSteps.fitWidths)WL.measureSteps.fitWidths();
 }

 function bind(){
  defs.forEach(def=>{
   if(def.builtin)return;                 // 組み込みの欄は元の配線のまま
   const el=document.querySelector(`[data-op="${CSS.escape(def.name)}"]`);
   if(!el||el.dataset.opWired)return;
   el.dataset.opWired='1';
   const note=el.closest('.opf')&&el.closest('.opf').querySelector('.opf-note');
   if(el.tagName==='SELECT'){
    el.addEventListener('change',()=>remember(def.name,el.value));
   }else{
    el.addEventListener('input',()=>{sanitize(el,def);remember(def.name,el.value)});
    el.addEventListener('blur',()=>settle(el,def,note));
   }
  });
 }

 /* 記録されている値を欄へ戻す。**選択肢に無い値も残す**（§9.203と同じ罠）
    ——`select.value`へ無い値を入れると空文字になり、記録が黙って消える。 */
 function apply(){
  const bag=(state()&&S.measure&&S.measure.settings&&S.measure.settings.opData)||{};
  document.querySelectorAll('[data-op]').forEach(el=>{
   const k=el.dataset.op,v=String(bag[k]==null?'':bag[k]);
   if(el.tagName==='SELECT'&&v&&![...el.options].some(o=>o.value===v)){
    const o=document.createElement('option');
    o.value=v;o.textContent=v+'（選択肢に無い記録）';el.appendChild(o);
   }
   el.value=v;
  });
 }

 /* 保存のときにまとめて回収する。**打った時点でも入れている**ので、
    ここは念のための取りこぼし防止。 */
 function collect(){
  const bag=store();if(!bag)return {};
  const v=values();
  Object.keys(bag).forEach(k=>{if(!(k in v))delete bag[k]});
  Object.keys(v).forEach(k=>{bag[k]=v[k]});
  return bag;
 }

 /* 記録した件数（③確認の「記録した値」に出す）。自由項目だけを数える
    ——組み込みの欄はそれぞれ元からの置き場で数えられている（§8）。 */
 function filled(){
  const free=defs.filter(d=>!d.builtin);
  const v=values();
  return {filled:free.filter(d=>v[d.name]!=null&&v[d.name]!=='').length,total:free.length};
 }

 /* **必須はマスタが決める**（§9.216 ②、利用者の指示「一部の必須入力事項も
    マスタで設定可能とし」）。以前は`activeRequiredControls()`が
    `['operator','inspector']`と直に書いており、設備ごとに変えられなかった。
    **答えられないときはnull**——読めなかったことを「必須は無い」と同じに
    扱うと、完了前の確認が黙って緩くなる（§9.211 ②のfail-openと逆向きの
    判断。ここは「元の2つ」へ戻すのが安全）。 */
 function requiredControls(){
  if(!defs.length)return null;
  const out=[];
  defs.forEach(d=>{
   if(!d.required)return;
   /* 畳んでいる群の中の欄は数えない——押しても行けない場所を「未入力」と
      言われても直しようがない。自動で開く群（条の入力）は開いていれば数える。 */
   const host=hostOf(d);
   if(host&&(host.classList.contains('op-off')||host.classList.contains('op-folded')))return;
   const el=controlOf(d);
   if(el)out.push({el,label:d.name});
  });
  return out;
 }

 /* 条件つきの群は`#measureType`で開閉が変わる（§9.216 ③）。
    **形が変わったときだけ描き直す**——毎回作り直すと、打っている最中に
    入力欄が入れ替わる（§9.122の「測定中はDOMを作り直さない」と同じ考え方。
    受信欄そのものは`.selectors`の外なので転送は止まらないが、
    自由項目に打っている最中に消えるのは同じくらい困る）。 */
 let foldSig='';
 function currentFoldSig(){
  return [PLACE_PREP,PLACE_INPUT]
   .map(pl=>groupsFor(pl).map(g=>g.name+(isFolded(g)?':1':':0')).join(','))
   .join('|');
 }
 function syncAutoOpen(){
  if(!defs.length)return;
  if(currentFoldSig()===foldSig)return;
  layout();
 }
 function bindMeasureType(){
  const el=$('#measureType');
  if(!el||el.dataset.opFoldWired)return;
  el.dataset.opFoldWired='1';
  el.addEventListener('change',syncAutoOpen);
 }

 async function refresh(equipment){
  await load(equipment);
  layout();
 }

 window.WL=window.WL||{};
 WL.opData={load,layout,render:layout,refresh,apply,collect,values,filled,requiredControls,
            syncAutoOpen,
            defs:()=>defs.slice(),
            /* 設備が変わったら次に開くとき読み直す（マスタ管理で足した直後）。 */
            forget:()=>{defs=[];builtinOff=[];defsFor=null;loading=null}};
})();
