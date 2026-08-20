/* measure-opdata.js: 操業データ（§9.215、利用者の指示）
   ============================================================
   「条の設計 — 子ロットの内訳の部分には、『操業データ』という項目にして、
    『入力の準備』のエリアとカード統合(2×3にする)。名前は『操業データ』に
    変更する。必要なデータを追加しすべて記録できるようにします。」
   「項目自体をマスタ化し他の設備でも使えるように設備ごとに持たせ、変更
    できるようにする、設定値も必要に応じてマスタ化して関連付け。各項目ごと、
    入力方式や入力上限値、入力データの型を選べるようにする」

   ここが持つのは**器だけ**。何を記録するかは`操業データ項目マスタ`が決める
   ので、**項目名をこのファイルへ書かない**——書くと設備を1つ足すたびに
   ここを直すことになる。

   値は`S.measure.settings.opData`（項目名→文字列）。**鍵は日本語の項目名**
   （§9.162と同じ約束）——英字キーにすると、マスタを触る人と記録を読む人が
   別の名前で同じものを指すことになる。レコードの中なので、共有DBへも
   帳票へも一緒に運ばれる。

   **打った時点でレコードへ入れる**（§9.208 ②）。`collect()`は保存のときしか
   走らないので、そこだけに任せると「入力したのに数えられない」が起きる。
   ============================================================ */
(function(){
 const $=s=>document.querySelector(s);
 const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>(
   {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

 /* 設備ごとの定義。**開いた設備が変わるまで使い回す**——測定を開くたびに
    引き直すと、ロットを開く速さがマスタの往復に引きずられる。 */
 let defs=[],defsFor=null,loading=null;

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
   }catch(e){
    /* **読めなくても測定は開ける**（fail-open）。入力欄が出ないことは
       画面に書く——黙って空にすると「項目が無い設備」と区別が付かない。 */
    console.warn('操業データの項目を読めませんでした',e);
    defs=[];
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
  document.querySelectorAll('#opData [data-op]').forEach(el=>{
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

 function fieldHtml(def,i){
  const id='opf'+i;
  const unit=def.unit?`<em class="opf-unit">${esc(def.unit)}</em>`:'';
  const range=[];
  if(def.min!==null&&def.min!==undefined)range.push(`${def.min} 以上`);
  if(def.max!==null&&def.max!==undefined)range.push(`${def.max} 以下`);
  /* **入る形を先に書く**（§CLAUDE 6「出どころ・単位・根拠を画面に出す」）
     ——打ってから断られるより、打つ前に分かるほうが速い。 */
  const hint=def.type==='選択'?'':(isInteger(def.type)?'整数':`小数${def.decimals==null?1:def.decimals}桁`)
    +(isPositive(def.type)?'・0以上':'')+(range.length?`・${range.join('／')}`:'');
  let control;
  if(def.type==='選択'){
   const opts=['<option value=""></option>']
     .concat((def.choices||[]).map(v=>`<option value="${esc(v)}">${esc(v)}</option>`)).join('');
   control=`<select id="${id}" data-op="${esc(def.name)}">${opts}</select>`;
  }else if(isNumeric(def.type)){
   /* `type=number`にしない（§9.208 ③）——`.5`のような途中の形が
      **黙って消える**。文字として受けて自分で整える。 */
   control=`<input id="${id}" class="numeric-input" type="text" inputmode="decimal"
     data-op="${esc(def.name)}" autocomplete="off">`;
  }else{
   control=`<input id="${id}" type="text" data-op="${esc(def.name)}" autocomplete="off">`;
  }
  return `<label class="opf" data-opfield="${esc(def.name)}">`
   +`<span class="opf-name">${esc(def.name)}</span>`
   +`<span class="opf-ctl">${control}${unit}</span>`
   +(hint?`<small class="opf-hint">${esc(hint)}</small>`:'')
   +(def.choiceMissing?`<small class="opf-warn">選択肢「${esc(def.choice)}」が見つかりません（マスタ管理 &gt; 操業データ選択肢 で登録してください）</small>`:'')
   +`<small class="opf-note" hidden></small></label>`;
 }

 function render(){
  const host=$('#opData');if(!host)return;
  if(!defs.length){
   /* **無いことを書く**（§4）。「まだ読んでいない」と「登録が無い」を
      分けて言う——どちらも空欄では、設定すべきかどうかが分からない。 */
   host.innerHTML='<p class="op-empty">'
    +(defsFor===null?'操業データの項目を読み込んでいます…'
      :'この設備の操業データの項目は登録されていません。'
       +'<br>マスタ管理 &gt; 操業データ項目 で登録すると、ここへ入力欄が出ます。')
    +'</p>';
   return;
  }
  const groups=[];
  defs.forEach(d=>{
   const name=d.group||'その他';
   let g=groups.find(x=>x.name===name);
   if(!g){g={name,items:[]};groups.push(g)}
   g.items.push(d);
  });
  let n=0;
  host.innerHTML=groups.map(g=>{
   const body=g.items.map(d=>fieldHtml(d,n++)).join('');
   return `<section class="op-group" data-opgroup="${esc(g.name)}">`
    +`<b class="op-group-head">${esc(g.name)}<span class="op-group-count">${g.items.length}項目</span></b>`
    +`<div class="op-fields">${body}</div></section>`;
  }).join('');
  bind();
  apply();
 }

 function bind(){
  defs.forEach(def=>{
   const el=document.querySelector(`#opData [data-op="${CSS.escape(def.name)}"]`);
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
  document.querySelectorAll('#opData [data-op]').forEach(el=>{
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

 /* 記録した件数（③確認の「記録した値」に出す）。 */
 function filled(){
  const v=values();
  return {filled:Object.keys(v).length,total:defs.length};
 }

 async function refresh(equipment){
  await load(equipment);
  render();
 }

 window.WL=window.WL||{};
 WL.opData={load,render,refresh,apply,collect,values,filled,
            defs:()=>defs.slice(),
            /* 設備が変わったら次に開くとき読み直す（マスタ管理で足した直後）。 */
            forget:()=>{defs=[];defsFor=null;loading=null}};
})();
