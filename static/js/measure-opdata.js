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
 let defs=[],builtinOff=[],gridCols=12,defsFor=null,loading=null;
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
    gridCols=Number(r.gridCols)>0?Number(r.gridCols):12;
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
   /* **記録へ入るのは整える前の値**（§9.221 ⑦）。3桁区切り・ゼロ埋めは
      見せ方であって値ではない——`1,234`のまま記録へ入れると、次に欄を
      離れたときの`Number()`がNaNになって**打った値が黙って消える**。 */
   const k=el.dataset.op;const v=rawText(el,el.value).trim();
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

/* ---------- 値の見せ方（§9.221 ⑦、利用者の指示） ----------
    「データの表示方法、桁数、左詰め、右詰め、中央寄せなど、さらに
     カスタマイズできるように改良してください」

    **打っている最中は当てない。** 1文字ごとに桁区切りを入れると、
    カーソルが区切りの前後で飛ぶ（§9.117の「入力中に作り直さない」と
    同じ罠）。当てるのは**欄を離れたとき**と**記録から読み直したとき**の
    2つだけで、欄へ入った瞬間は整える前の値へ戻す。

    設定は**要素が持つ**（`data-opfmt`／`data-opdigits`）——`apply()`は
    定義ではなく`[data-op]`を順に見て回るので、定義を引き直す口を
    増やさずに済む。 */
 function fmtOf(el){return (el&&el.dataset&&el.dataset.opfmt)||''}
 /* 見せ方を外した「素の値」。記録へ入るのはこちら。 */
 function rawText(el,text){
  const t=String(text==null?'':text);
  const f=fmtOf(el);
  if(f==='3桁区切り')return t.replace(/,/g,'');
  if(f==='ゼロ埋め'){
   const m=t.match(/^(-?)0+(\d.*)$/);
   return m?m[1]+m[2]:t;
  }
  return t;
 }
 /* 画面に出す形。**読めない値はそのまま返す**（整形に失敗したら生の値を
    出すのが原則。§9.88と同じ約束）。 */
 function shownText(el,raw){
  const t=String(raw==null?'':raw).trim();
  if(t==='')return '';
  const f=fmtOf(el);
  if(f==='3桁区切り'){
   const m=t.replace(/,/g,'').match(/^(-?)(\d+)(\.\d*)?$/);
   if(!m)return t;
   return m[1]+Number(m[2]).toLocaleString('en-US')+(m[3]||'');
  }
  if(f==='ゼロ埋め'){
   const w=Number((el&&el.dataset&&el.dataset.opdigits)||0);
   if(!(w>0))return t;
   const m=t.match(/^(-?)(\d+)(\.\d*)?$/);
   if(!m)return t;
   return m[1]+m[2].padStart(w,'0')+(m[3]||'');
  }
  return t;
 }
 /* 欄へ値を入れる口。**`el.value=`を直に書かないこと**——見せ方を
    通さない代入が1つでもあると、そこだけ整わない欄ができる。 */
 function putValue(el,raw){
  const next=shownText(el,raw);
  if(el.value!==next)el.value=next;
 }

 /* 見せ方の配線は**この1本**（§9.221 ⑦）。設定窓の見本も測定画面も
    ここを通す——見本だけ整形しないと、設定画面で見えた形と実際の形が
    食い違う（§9.218 ①の約束が破れる）。`<select>`は値が選択肢そのもの
    なので整形しない。 */
 function attachFormat(el,onLeave){
  if(!el||el.tagName==='SELECT'||el.dataset.opFmtWired)return el;
  el.dataset.opFmtWired='1';
  /* 欄へ入ったら**整える前の値**へ戻す。桁区切りの入った文字の上で
     打たせると、`sanitize()`が区切りを消した瞬間にカーソルが飛ぶ。 */
  el.addEventListener('focus',()=>{const r=rawText(el,el.value);if(el.value!==r)el.value=r});
  el.addEventListener('blur',onLeave||(()=>putValue(el,rawText(el,el.value))));
  return el;
 }

 /* 欄から離れたときに桁と上下限へそろえる。**直したことを画面に書く**
    （§CLAUDE 6）——黙って値が変わると、打ち間違いに気づけない。 */
 function settle(el,def,note){
  /* **見本では記録へ書かない**（§9.221 ⑦）。設定窓は測定を開いたまま
     でも開けるので、素通しにすると見本へ打った値がそのロットの操業
     データとして残る。整え方（桁・上下限・見せ方）は同じ道を通す。 */
  const keep=v=>{if(!def.preview)remember(def.name,v)};
  if(!isNumeric(def.type)){keep(rawText(el,el.value));return}
  const raw=rawText(el,el.value).trim();
  if(raw===''||raw==='-'||raw==='.'){el.value='';keep('');say(note,'');return}
  let n=Number(raw);
  if(!Number.isFinite(n)){el.value='';keep('');say(note,'数字として読めなかったので消しました');return}
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
  /* **記録へ入るのは`out`（素の値）／画面に出るのは見せ方を当てた形**。 */
  putValue(el,out);
  keep(out);
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
 /* **入る形を1箇所で言う**（§CLAUDE 6「出どころ・単位・根拠を画面に出す」）
    ——打ってから断られるより、打つ前に分かるほうが速い。
    **マスタの設定窓も同じ関数を通す**（§9.219 ③）——見本用にもう1つ書くと、
    設定画面で見えた形と実際の形が食い違う（§9.176・§9.218 ①と同じ約束）。 */
 function ruleText(def){
  if(def.type==='選択')return '';
  if(!isNumeric(def.type))return '';
  const range=[];
  if(def.min!==null&&def.min!==undefined&&def.min!=='')range.push(`${def.min} 以上`);
  if(def.max!==null&&def.max!==undefined&&def.max!=='')range.push(`${def.max} 以下`);
  return (isInteger(def.type)?'整数':`小数${def.decimals==null?1:def.decimals}桁`)
    +(isPositive(def.type)?'・0以上':'')+(range.length?`・${range.join('／')}`:'');
 }
 function fieldEl(def,i){
  const label=document.createElement('label');
  label.className='opf';
  label.dataset.opgen='1';
  label.dataset.f='op:'+def.name;
  label.dataset.opfield=def.name;
  const hint=ruleText(def);
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
  const u=unitParts(def);
  label.innerHTML=`<span class="opf-name">${esc(def.name)}`
   +(def.required?'<b class="opf-req" title="入力が要ります">必須</b>':'')+'</span>'
   +u.top+control+u.inside+u.bottom
   +(def.choiceMissing?`<small class="opf-warn">選択肢「${esc(def.choice)}」が未登録です</small>`:'')
   +'<small class="opf-note" hidden></small>';
  applyPresentation(label,def);
  return label;
 }
 /* ---------- 単位の置き場（§9.221 ⑦、利用者の指示） ----------
    「単位を出す位置(外上左、外上中央、外上右、内部、外下左、外中央、
     外下右)、出し方…さらにカスタマイズできるように」

    **既定は`外下左`**——これが今までの見え方そのもの（欄の下に左詰めで
    小さく出ていた）。既定を変えると、設定を触っていない現場の画面が
    黙って変わる。
    `内部`は欄の中の右端へ重ねる。重ねられるのは箱が1つの欄だけなので、
    ラジオ・セグメント等では**サーバーが`外下左`へ落として返す**
    （判定は`operation_repo._row_to_item`の1箇所。画面に同じ判定を書かない）。 */
 function unitParts(def){
  const blank={top:'',inside:'',bottom:''};
  const text=String(def.unit||'').trim();
  const at=String(def.unitPlace||'外下左');
  if(!text||at==='出さない')return blank;
  const em=`<em class="opf-unit">${esc(text)}</em>`;
  if(at==='内部')return {top:'',inside:`<em class="opf-unit opf-unit-in" aria-hidden="true">${esc(text)}</em>`,bottom:''};
  const side=at.slice(-2)==='中央'?'中央':at.slice(-1);
  const line=`<span class="opf-unit-line" data-at="${esc(side)}">${em}</span>`;
  return at.indexOf('外上')===0?{top:line,inside:'',bottom:''}:{top:'',inside:'',bottom:line};
 }
 /* 寄せ・見せ方・単位の置き場は**器の属性**で持つ（§9.221 ⑦）。CSSは
    属性を見るだけになり、値そのものを持つ`<select>`/`<input>`には触らない
    ——組み込みの欄（オペレータ等）へも同じ関数で当てられる。 */
 function applyPresentation(host,def){
  if(!host)return;
  const at=String(def.unitPlace||'外下左');
  const align=String(def.align||'自動');
  const fmt=String(def.valueFormat||'そのまま');
  host.dataset.opunit=(def.unit||'')&&at!=='出さない'?at:'なし';
  host.dataset.opalign=align;
  /* 単位を重ねる幅は**文字数から**決める（`ch`は数字の幅なので、
     `mm`のような英字でも近い値になる）。器へ渡し、欄の右余白がこれを見る。 */
  host.style.setProperty('--opf-unit-w',String(Math.max(1,String(def.unit||'').length))+'ch');
  const el=valueEl(host);
  if(el){
   /* **`<select>`には見せ方を当てない。** 値が選択肢そのものなので、
      3桁区切りやゼロ埋めを掛けると`putValue()`が`1234`を`1,234`にし、
      どの`<option>`にも当たらず**`select.value`が空になる**——画面から
      記録が消え、そのまま保存すると空で上書きされる。`attachFormat()`は
      同じ理由で`SELECT`を外しているので、**書く側もここで揃える**
      （読む側`fmtOf()`に条件を足すと、当てない理由が2箇所に散る）。 */
   const plain=el.tagName==='SELECT';
   el.dataset.opfmt=(plain||fmt==='そのまま')?'':fmt;
   if(!plain&&def.digits)el.dataset.opdigits=String(def.digits);
   else delete el.dataset.opdigits;
  }
 }

/* 組み込みの欄（オペレータ・内径…）は画面が持っている`<label>`なので、
    単位の器はこちらから足す。**同じ値なら触らない**（§9.131。`innerHTML`を
    毎回書き換えると、その中の入力欄が作り直されてフォーカスが落ちる）。 */
 function syncBuiltinUnit(host,def){
  if(!host||!def.builtin)return;
  const u=unitParts(def);
  const want=u.top+u.inside+u.bottom;
  const now=[...host.querySelectorAll(':scope>.opf-unit-line,:scope>.opf-unit-in')];
  const sig=now.map(x=>x.outerHTML).join('');
  if(sig===want&&(want||!now.length))return;
  now.forEach(x=>x.remove());
  if(!want)return;
  const ctl=valueEl(host);
  if(u.top&&ctl)ctl.insertAdjacentHTML('beforebegin',u.top);
  if(u.inside&&ctl)ctl.insertAdjacentHTML('afterend',u.inside);
  if(u.bottom)host.insertAdjacentHTML('beforeend',u.bottom);
 }

 /* ---------- 選ばせ方（§9.218 ②、利用者の指示） ----------
    「プルダウンだけでなく、ラジオボタンやタブっぽいボタン、フローティング
     モーダルみたいに選択肢が多い時に説明付きで出ると選びやすいので、
     そのような選ばせるUIを選ぶ機能も追加実装してください」

    **値を持つのは今までどおり`<select>`**。ボタン側から`value`を書いて
    `change`を飛ばすだけにする——こうすると
      ・記録の読み書き（`values()`／`apply()`／`collect()`）
      ・必須の判定（`activeRequiredControls()`は`controlOf()`が返す部品を見る）
      ・仕掛由来のプリセット（内径・§9.204）や条数の上限（§9.210 ⑤）
    が**1つも書き換わらない**。組み込みの欄（オペレータ・作業人数…）にも
    同じ形で当てられるのはこのため。

    **selectを`display:none`にしないこと。** `focus()`が効かなくなり、
    未入力のときに「直す場所」へ連れて行けない（§9.122と同じ理由で、
    寸法ゼロの要素はフォーカスを持てない）。1pxの見えない器として残し、
    未入力・公差外の色は**兄弟セレクタ**（`select.validation-required~.opf-widget`）で
    ボタン側へ移す——`:has()`に頼らないのは、当たらなかったときに
    「色が付かない」ことに誰も気づけないから。 */
 const WIDGET_SELECT='プルダウン';
 function widgetOf(def){return String(def.widgetLive||def.widget||WIDGET_SELECT)}
 /* 選択肢の説明（`一覧`で出す）。**説明のある値だけ**サーバーが返す。 */
 const noteOf=(def,v)=>String((def.choiceNotes||{})[v]||'');
 /* selectの選択肢を「値と表示」の組で読む。**先頭の空を落とさない**
    ——「まだ選んでいない」へ戻せなくなる（§9.203と同じ罠）。 */
 /* **手打ちの席は候補に混ぜない**（§9.220 ③）。混ぜると、打った値が
    次の組み直しで「選択肢の1つ」としてボタンに並ぶ。 */
 function optionsOf(sel){
  return [...sel.options].filter(o=>o.dataset.opFree!=='1').map(o=>({v:o.value,t:o.text}));
 }
 /* **値を持つのは`<select>`とはかぎらない**（§9.219 ③）。数値の欄
    （縦割数・横割数や自由項目の数値）は`<input>`なので、器を被せる側は
    どちらでも引ける口から取る。**ここを1箇所にしておくこと**——2箇所で
    別々に引くと、片方だけ`<input>`に対応した状態が作れる。 */
 function valueEl(host){
  return host.querySelector(':scope>select')||host.querySelector(':scope>input:not([type=hidden])');
 }
 /* 数値の刻み。**マスタで決めていればそれ**（§9.220 ⑤、利用者の指示
    「ステップ入力に関して、ステップ量も決められるようにしてほしい」）。
    決めていなければ今までどおり——整数は1、小数は桁から作る（小数2桁なら
    0.01）。**0を「決めた」と読まないこと**（押しても動かない道具になる）
    ので、サーバーの`normalize_step()`が0と負をnullへ倒している。 */
 function stepOf(def){
  const fixed=Number(def&&def.step);
  if(Number.isFinite(fixed)&&fixed>0)return fixed;
  if(isInteger(def.type)||!isNumeric(def.type))return 1;
  const d=Number.isFinite(Number(def.decimals))?Number(def.decimals):1;
  return Math.pow(10,-Math.max(0,Math.min(4,d)));
 }
 /* **`null`・空欄を0と読まないこと**（§9.220 ⑤で判明した既存の不具合）。
    `Number(null)`も`Number('')`も**0で、しかも有限**なので、素の
    `Number.isFinite`だけで見ると「上下限を決めていない」が「上下限は0」に
    化ける。実害は2つ出ていた——①ステッパーが`Math.min(hi,v)`で必ず0へ
    丸められ**＋を押しても増えない** ②`lo===null||hi===null`が成立せず、
    上下限の無い項目でも**目盛0〜0のスライダー**が出る（「上下限を決めると
    スライダーになります」の案内が一度も出なかった）。
    §9.160の「空欄を0と読まないこと」と同じ罠。 */
 const numOr=(v,alt)=>{
  if(v===null||v===undefined||v==='')return alt;
  const n=Number(v);return Number.isFinite(n)?n:alt;
 };
 function widgetHost(host){
  let box=host.querySelector(':scope>.opf-widget');
  if(!box){box=document.createElement('div');box.className='opf-widget';host.appendChild(box)}
  return box;
 }
 /* 押した結果を`select`へ書いて`change`を飛ばす。**`input`も飛ばす**
    ——`updateValidationVisuals()`は両方をcaptureで拾っており、片方だけだと
    未入力の印が更新されない経路が残る。 */
 function setValue(sel,v){
  if(sel.value===v)return;
  sel.value=v;
  sel.dispatchEvent(new Event('input',{bubbles:true}));
  sel.dispatchEvent(new Event('change',{bubbles:true}));
 }
 /* いま選ばれているものに印を付け直す。**作り直さない**——押すたびに
    組み直すと、キーボードで辿っている途中でフォーカスが飛ぶ。 */
 function syncWidget(host){
  const sel=valueEl(host);
  const box=host.querySelector(':scope>.opf-widget');
  if(!sel||!box)return;
  const v=String(sel.value==null?'':sel.value);
  /* 数値・自由記述の器（§9.219 ③）。**作り直さずに値だけ合わせる**
     ——打っている最中に部品が入れ替わると、カーソルが飛ぶ。 */
  const rg=box.querySelector('.opf-range-in');
  if(rg&&rg.value!==v)rg.value=v;
  const ta=box.querySelector('.opf-memo-in');
  if(ta&&ta.value!==v)ta.value=v;
  const steps=box.querySelectorAll('[data-opstep]');
  if(steps.length){
   const lo=(sel.min===''||sel.min==null)?null:Number(sel.min);
   const hi=(sel.max===''||sel.max==null)?null:Number(sel.max);
   const n=Number(v);
   steps.forEach(b=>{
    const d=Number(b.dataset.opstep);
    b.disabled=!!(Number.isFinite(n)&&((d<0&&lo!==null&&n<=lo)||(d>0&&hi!==null&&n>=hi)));
   });
  }
  box.querySelectorAll('[data-opv]').forEach(b=>{
   const on=b.dataset.opv===v;
   b.classList.toggle('is-on',on);
   b.setAttribute('aria-checked',on?'true':'false');
   b.tabIndex=on?0:-1;
  });
  const cur=box.querySelector('.opf-pick-now');
  if(cur){
   const hit=[...sel.options].find(o=>o.value===v);
   cur.textContent=(hit?hit.text:v)||'選ぶ';
   cur.classList.toggle('is-empty',!v||v==='-');
  }
  /* ---- 手打ち（§9.226 ①、利用者の指示） ----
     「選択肢から選べるタイプの例外処理の候補にない値を入力するパターンは、
      外観のデザインを損なった設計になっているので、スマートに選択肢を出す
      ボックスをそのまま利用できるようにしてほしい」

     以前は**選ぶ器の下に打ち込み欄をもう1つ**足していた（`.opf-free`）。
     打つ場所と選ぶ場所が2つ並ぶので、どちらが効いているのか読めず、
     欄の高さも1つだけ2段になって並びが崩れていた。いまは
       ・プルダウン … **選ぶ器そのものが打てる**（`.opf-combo`。▾で候補）
       ・一覧       … 浮き窓の**絞り込み欄がそのまま**手打ちになる
       ・ボタン系   … 末尾の「その他」が**その場で入力欄に変わる**
     で、**どの形でも打つ場所は1つ**。 */
  const cb=box.querySelector('.opf-combo-in');
  if(cb&&document.activeElement!==cb){
   const hit=[...sel.options].find(o=>o.value===v&&o.dataset.opFree!=='1');
   const shown=hit?hit.text:v;
   if(cb.value!==shown)cb.value=(shown==='-'?'':shown);
  }
  const ox=box.querySelector('.opf-other-in');
  if(ox){
   const free=isFreeValue(sel,v);
   if(document.activeElement!==ox&&ox.value!==(free?v:''))ox.value=free?v:'';
   box.classList.toggle('is-other-on',free);
   const ob=box.querySelector('.opf-other-btn');
   if(ob){ob.classList.toggle('is-on',free);ob.setAttribute('aria-checked',free?'true':'false')}
  }
  /* 段階（§9.226 ①）。**選んだところまで塗る**——順番に意味がある選択肢
     なので、1つだけ光らせると「何段目か」を数えることになる。 */
  /* **「その他」の席を段として数えないこと**（§9.226 ①）。手打ちの席は
     見た目をそろえるため同じクラスを持つが、段ではない（`data-opv`が無い）
     ——数えると、手打ちを入にした瞬間に段が1つ増えて塗りがずれる。 */
  const stage=[...box.querySelectorAll('.opf-stage-btn[data-opv]')];
  if(stage.length){
   const at=stage.findIndex(b=>b.dataset.opv===v);
   stage.forEach((b,i)=>b.classList.toggle('is-fill',at>=0&&i<=at));
   const now=box.querySelector('.opf-stage-now');
   if(now)now.textContent=at>=0?`${at+1}/${stage.length}`:'—';
  }
  /* 入切（§9.226 ①）。**入＝先頭の値／切＝空**の1つのスイッチ。 */
  const sw=box.querySelector('.opf-switch-btn');
  if(sw){
   const on=!!v&&v!=='-';
   sw.classList.toggle('is-on',on);
   sw.setAttribute('aria-checked',on?'true':'false');
   const t=sw.querySelector('.opf-switch-text');
   if(t)t.textContent=on?(sw.dataset.opOnLabel||'入'):(sw.dataset.opOffLabel||'切');
  }
  /* 定型文（§9.226 ①）。**いま文の中にある語句に印を付ける**——押した
     ことが分からないと、2度押して同じ語句を並べてしまう。 */
  const words=[...box.querySelectorAll('[data-opw]')];
  if(words.length){
   const t=String(v||'');
   words.forEach(b=>b.classList.toggle('is-on',!!b.dataset.opw&&t.indexOf(b.dataset.opw)>=0));
  }
  /* メーター（§9.226 ①）。**打つ欄はそのまま**で、上下限のどこに居るかを
     帯で言う。外れているときは色と文字の両方で言う（§3）。 */
  const meter=box.querySelector('.opf-meter-fill');
  if(meter){
   const lo=Number(box.dataset.opLo),hi=Number(box.dataset.opHi),n=Number(v);
   const ok=Number.isFinite(n)&&Number.isFinite(lo)&&Number.isFinite(hi)&&hi>lo;
   const pct=ok?Math.max(0,Math.min(100,(n-lo)/(hi-lo)*100)):0;
   meter.style.width=pct.toFixed(2)+'%';
   const out=ok&&(n<lo||n>hi);
   box.classList.toggle('is-out',!!out);
   const note=box.querySelector('.opf-meter-note');
   if(note)note.textContent=!Number.isFinite(n)?'':(out?'範囲の外です':`${lo}〜${hi} の中`);
  }
 }
 /* 数値の器（§9.219 ③、利用者の指示「UIの種類を増やしたり」）。
    **素の欄は消さない**——選択肢のように「候補から選ぶ」のではなく「打つ」
    欄なので、打てる場所を残したまま押して決める道具を足すのが正しい
    （`.opf-native-off`にすると打てなくなる）。 */
 const NUM_WIDGETS=['ステッパー','スライダー','キーパッド','早見ボタン','メーター'];
 /* よく使う値を並べる（§9.223 ③）。上下限と刻みから作り、**多すぎるときは
    出さない**——20個も並ぶと「探す」作業になり、打ったほうが速い（§4）。 */
 const QUICK_MAX=12;
 function quickValues(def){
  const step=stepOf(def),lo=numOr(def.min,null),hi=numOr(def.max,null);
  if(lo===null||hi===null||!(step>0))return null;
  const n=Math.round((hi-lo)/step)+1;
  if(n<2||n>QUICK_MAX)return null;
  const dec=String(step).indexOf('.')>=0?String(step).split('.')[1].length:0;
  const out=[];
  for(let i=0;i<n;i++){const v=lo+i*step;out.push(dec?v.toFixed(dec):String(Math.round(v)))}
  return out;
 }
 function buildNumberWidget(def,host,kind){
  const el=valueEl(host);
  if(!el||el.tagName==='SELECT')return false;
  const step=stepOf(def),lo=numOr(def.min,null),hi=numOr(def.max,null);
  const sig=[kind,step,lo,hi].join('/');
  const box=widgetHost(host);
  if(box.dataset.sig===sig){syncWidget(host);return true}
  box.dataset.sig=sig;
  host.classList.add('opf-alt');
  const bump=d=>{
   const cur=numOr(el.value,numOr(lo,0));
   let v=cur+d*step;
   if(lo!==null)v=Math.max(lo,v);
   if(hi!==null)v=Math.min(hi,v);
   /* 浮動小数の誤差を持ち込まない（0.1+0.2の類）。桁は刻みから決まる。 */
   const dec=String(step).indexOf('.')>=0?String(step).split('.')[1].length:0;
   setValue(el,dec?v.toFixed(dec):String(Math.round(v)));
  };
  if(kind==='ステッパー'){
   box.className='opf-widget opf-step';
   box.innerHTML='<button type="button" class="opf-step-btn" data-opstep="-1" aria-label="1つ減らす">−</button>'
    +'<button type="button" class="opf-step-btn" data-opstep="1" aria-label="1つ増やす">＋</button>';
   box.querySelectorAll('[data-opstep]').forEach(b=>{
    b.onclick=e=>{e.preventDefault();bump(Number(b.dataset.opstep));syncWidget(host)};
   });
  }else if(kind==='スライダー'){
   box.className='opf-widget opf-range';
   /* **上下限が無ければ引けない**（どこからどこまでか決まらない）。
      押せるのに何も起きない道具を置かないので、理由を書いて出さない（§4）。 */
   if(lo===null||hi===null){
    box.innerHTML='<small class="opf-widget-note">上下限を決めるとスライダーになります（いまは打ち込みだけ）</small>';
   }else{
    box.innerHTML='<input type="range" class="opf-range-in" min="'+lo+'" max="'+hi+'" step="'+step+'">'
     +'<span class="opf-range-scale"><i>'+esc(String(lo))+'</i><i>'+esc(String(hi))+'</i></span>';
    const rg=box.querySelector('.opf-range-in');
    rg.oninput=()=>setValue(el,rg.value);
   }
  }else if(kind==='早見ボタン'){
   box.className='opf-widget opf-quick';
   const vs=quickValues(def);
   /* **作れないときは理由を書く**（§4）。上下限と刻みから並びを作るので、
      決まっていなければ並べようがない——押せるのに何も起きない道具を残さない。 */
   if(!vs){
    box.innerHTML='<small class="opf-widget-note">最小・最大・刻みを決めると早見ボタンになります'
     +'（いまは打ち込みだけ。'+QUICK_MAX+'個までのときに出ます）</small>';
   }else{
    box.innerHTML='<div class="opf-shape">'+vs.map(v=>
      '<button type="button" class="opf-quick-btn" data-opv="'+esc(v)+'">'
      +'<span class="opf-btn-text">'+esc(v)+'</span></button>').join('')+'</div>';
    box.querySelectorAll('[data-opv]').forEach(b=>{
     b.onclick=e=>{e.preventDefault();setValue(el,b.dataset.opv);syncWidget(host)};
    });
   }
  }else if(kind==='メーター'){
   /* メーター（§9.226 ①）。**打つ欄はそのまま**で、上下限のどこに居るかを
      帯で言う——「正確に打ちたいが規格の中かも見たい」ときの形。
      スライダーと違って**値は引いて決めない**（引くと桁が落ちる）。 */
   box.className='opf-widget opf-meter';
   if(lo===null||hi===null){
    box.innerHTML='<small class="opf-widget-note">上下限を決めるとメーターになります（いまは打ち込みだけ）</small>';
   }else{
    box.dataset.opLo=String(lo);box.dataset.opHi=String(hi);
    box.innerHTML='<span class="opf-meter-bar"><i class="opf-meter-fill"></i></span>'
     +'<span class="opf-meter-scale"><i>'+esc(String(lo))+'</i>'
     +'<b class="opf-meter-note"></b><i>'+esc(String(hi))+'</i></span>';
   }
  }else{
   box.className='opf-widget opf-pad';
   box.innerHTML='<button type="button" class="opf-pad-btn">キーで入れる</button>';
   box.querySelector('.opf-pad-btn').onclick=e=>{e.preventDefault();openKeypad(def,host,el)};
  }
  applyLayout(box,def);                      /* §9.226 ① 早見ボタンの並べ方 */
  applyLook(host,def);                       /* §9.223 ③ */
  if(!el.dataset.opWidgetWired){
   el.dataset.opWidgetWired='1';
   el.addEventListener('input',()=>syncWidget(host));
   el.addEventListener('change',()=>syncWidget(host));
  }
  syncWidget(host);
  return true;
 }
 /* 自由記述を複数行で書く（§9.219 ③）。**値を持つのは`<input>`のまま**で、
    `<textarea>`は写し——記録の読み書き・必須の判定は1つも書き換わらない。 */
 function buildMemoWidget(def,host,kind){
  const el=valueEl(host);
  if(!el||el.tagName==='SELECT')return false;
  /* 「1行」は**器を被せない**（§9.223 ③）——素の`<input>`がそのまま1行の
     入力欄なので、写しを作ると打つ場所が2つになる。意匠だけを当てる。 */
  const one=kind==='1行';
  const phrase=kind==='定型文';
  const words=phrase?(def.choices||[]).filter(Boolean):[];
  const box=widgetHost(host);
  const sig=one?'one':(phrase?'phrase|'+String(def.layout||'')+'|'+words.join('\u0002'):'memo');
  if(box.dataset.sig===sig){syncWidget(host);return true}
  box.dataset.sig=sig;
  host.classList.add('opf-alt');
  if(one){
   el.classList.remove('opf-native-off');el.removeAttribute('tabindex');
   box.className='opf-widget opf-oneline';
   box.innerHTML='';
   applyLook(host,def);
   syncWidget(host);
   return true;
  }
  if(phrase){
   /* 定型文（§9.226 ①）。**打つ欄はそのまま**で、よく使う語句を下に並べる。
      語句は**選択肢のまとまり**から取る——文字の項目にもまとまりを結び
      付けられるので、新しい置き場を作らない（§9.221 ②と同じ作法）。 */
   el.classList.remove('opf-native-off');el.removeAttribute('tabindex');
   box.className='opf-widget opf-phrase';
   box.innerHTML=words.length
     ?'<div class="opf-shape">'+words.map(w=>
        '<button type="button" class="opf-phrase-btn" data-opw="'+esc(w)+'"'
        +' title="この語句を入れます">'+esc(w)+'</button>').join('')+'</div>'
     :'<small class="opf-widget-note">「選択肢のまとまり」を選ぶと、その値が定型文のボタンとして並びます</small>';
   applyLayout(box,def);
   box.querySelectorAll('[data-opw]').forEach(b=>{
    b.onclick=e=>{
     e.preventDefault();
     /* **置き換えではなく足す**——複数の語句をつないで1文にすることが多い。
        既に同じ語句が入っているときは足さない（2度押しの取り消し）。 */
     const cur=String(el.value||'');
     const w=b.dataset.opw;
     setValue(el,cur.indexOf(w)>=0?cur.replace(w,'').replace(/\s{2,}/g,' ').trim()
                                  :(cur?cur+' '+w:w));
     syncWidget(host);
    };
   });
   applyLook(host,def);
   if(!el.dataset.opWidgetWired){
    el.dataset.opWidgetWired='1';
    el.addEventListener('input',()=>syncWidget(host));
    el.addEventListener('change',()=>syncWidget(host));
   }
   syncWidget(host);
   return true;
  }
  el.classList.add('opf-native-off');
  el.setAttribute('tabindex','-1');
  box.className='opf-widget opf-memo';
  box.innerHTML='<textarea class="opf-memo-in" rows="3"></textarea>';
  const ta=box.querySelector('.opf-memo-in');
  ta.oninput=()=>setValue(el,ta.value);
  applyLook(host,def);                       /* §9.223 ③ */
  if(!el.dataset.opWidgetWired){
   el.dataset.opWidgetWired='1';
   el.addEventListener('change',()=>syncWidget(host));
  }
  syncWidget(host);
  return true;
 }
 /* ---------- 手打ち（§9.220 ③、利用者の指示） ----------
    「マスタによる候補選択のパターンでも手打ち入力が可能なモードを追加して
     ほしいです」

    **値を持つのは`<select>`のまま**（§9.218 ②の約束を崩さない）。候補に
    無い値は`<option>`を**その場で足してから**入れる——足さずに代入すると
    `select.value`は空文字になり、**打った値が黙って消える**（選択肢に無い
    値を`select.value`へ入れる罠は§9.203・§9.204で2度踏んでいる）。 */
 function addOption(sel,v){
  const s=String(v==null?'':v);
  if(!s)return;
  if([...sel.options].some(o=>o.value===s))return;
  /* **手打ちの置き場は1つだけ**。1文字打つたびに`<option>`を足すと
     「む」「むら」「むらさ」…が溜まり、次に組み直したとき**打ちかけの
     文字がそのままボタンとして並ぶ**。既にある手打ちの席を書き換える。 */
  const slot=sel.querySelector('option[data-op-free="1"]');
  const o=slot||document.createElement('option');
  o.value=s;o.textContent=s;o.dataset.opFree='1';
  if(!slot)sel.appendChild(o);
 }
 /* **手打ちの値は必ず知らせる**（§9.226 ①）。`addOption()`は手打ちの席を
    使い回すので、`特`→`特注`と打ち足したときに**`<option>`の値を書き換えた
    時点で`select.value`も一緒に動く**——そのあと`setValue()`を呼んでも
    「同じ値」と判断されて`change`が飛ばず、**最後の1文字ぶんが記録へ入らない**
    （`bind()`の`change`が`remember()`を呼ぶ作りなので、画面には出ているのに
    レコードは1つ前の文字列、という分かりにくい壊れ方になる）。
    ここでは等値の判定をせずに必ず飛ばす。 */
 function setFree(sel,v){
  const s=String(v==null?'':v);
  addOption(sel,s);
  if(sel.value!==s)sel.value=s;
  sel.dispatchEvent(new Event('input',{bubbles:true}));
  sel.dispatchEvent(new Event('change',{bubbles:true}));
 }
 /* いまの値が「候補から選んだもの」か「打ったもの」か。**印は候補の側に
    持たせる**——`<option>`は`apply()`でも足されるので、値だけを見ると
    記録から戻した手打ちを候補と読み違える。 */
 function isFreeValue(sel,v){
  if(!v)return false;
  const hit=[...sel.options].find(o=>o.value===v);
  return !hit||hit.dataset.opFree==='1';
 }
 /* ---- ボタン系の「その他」（§9.226 ①） ----
    末尾に1つだけ席を置き、**押すとその席が入力欄に変わる**。別の欄を下へ
    足さないので、器の高さも並びも他の項目と同じまま——「打つ場所は1つ」を
    どの形でも守るための形。 */
 function otherChipHtml(cls){
  return '<span class="opf-other" data-op-other="1">'
   +'<button type="button" class="'+cls+' opf-other-btn" role="radio" aria-checked="false" tabindex="-1"'
   +' title="候補にない値をここへ打てます"><span class="opf-btn-text">その他…</span></button>'
   +'<input type="text" class="opf-other-in" autocomplete="off"'
   +' placeholder="打ち込む" aria-label="候補にない値を打つ"></span>';
 }
 function wireOther(box,sel,host){
  const wrap=box.querySelector('.opf-other');if(!wrap)return;
  const inp=wrap.querySelector('.opf-other-in');
  const btn=wrap.querySelector('.opf-other-btn');
  if(btn)btn.onclick=e=>{
   e.preventDefault();
   box.classList.add('is-other-on');
   /* **空のまま席を開ける**（値はまだ書かない）。打った時点で入る。 */
   try{inp.focus()}catch(_){}
  };
  if(inp){
   inp.addEventListener('input',()=>{
    const v=inp.value.trim();
    if(v)setFree(sel,v);else setValue(sel,'');
    syncWidget(host);
   });
   /* 空のまま外れたら席を閉じる（開きっぱなしの空欄を残さない）。 */
   inp.addEventListener('blur',()=>{
    if(!inp.value.trim())box.classList.toggle('is-other-on',isFreeValue(sel,sel.value));
   });
  }
 }
 /* 形ごとの器とボタンの名前。**形が違うものは別の名前で持つ**（§9.220 ①、
    利用者の指摘「ラジオボタンやタブがほぼ同じデザインになっている」）
    ——以前は`ラジオ`も`タブ`も同じ`.opf-seg-btn`で、違いは連なっているか
    だけだった。名前が2つあって見た目が同じなら、選ばせる意味が無い。 */
 /* ---------- 見た目（§9.223 ③、利用者の指示） ----------
    「UIの種類と見た目(色や形、美観デザイン)など組合せでカスタムできるように
      してほしいです。」
    **「何で選ばせるか」と「どう見えるか」を別の軸にする。** 一緒にすると
    「青いタブ」「緑のタブ」…と種類が掛け算で増え、選ぶ盤が読めなくなる。
    綴りはサーバー（`operation_repo.LOOK_*_SLUG`）が正で、ここは受け取った
    印をクラスへ写すだけ。 */
 const LOOK_COLOR={'既定':'','主色':'teal','青':'blue','緑':'green','橙':'amber',
                   '赤':'red','紫':'violet','灰':'slate'};
 /* 形は**角丸のバリエーション**（§9.227 ①、利用者の指示）。廃止した
    `角`/`丸`はここでも寄せる——保存済みのレコードを開いたときに
    「知らない値＝既定」へ黙って落とさない（§9.132の`UI_SIZE_ALIASES`と
    同じ作法）。綴りはサーバー（`LOOK_SHAPE_SLUG`）が正。 */
 const LOOK_SHAPE={'標準':'','控えめ':'tight','大きめ':'wide'};
 const LOOK_SHAPE_ALIAS={'角丸':'標準','角':'控えめ','丸':'大きめ'};
 const LOOK_SIZE={'小':'sm','中':'','大':'lg'};
 /* **印を持つのは器（`<label>`）1箇所**。CSSはそこから下って当てる——
    部品ごとに付けると、形を足すたびに付け忘れが出る。 */
 function applyLook(host,def){
  if(!host)return;
  const lk=(def&&def.look)||{};
  [...host.classList].forEach(c=>{if(/^opf-(c|r|z)-/.test(c))host.classList.remove(c)});
  const shape=LOOK_SHAPE_ALIAS[lk.shape]||lk.shape;
  const c=LOOK_COLOR[lk.color]||'',r=LOOK_SHAPE[shape]||'',z=LOOK_SIZE[lk.size]||'';
  if(c)host.classList.add('opf-c-'+c);
  if(r)host.classList.add('opf-r-'+r);
  if(z)host.classList.add('opf-z-'+z);
 }
 /* ---------- 並べ方（§9.226 ①、利用者の指示「同じUIでもいくつかパターンが
    あるとよい」） ----------
    **意匠（色・形・大きさ）の4つ目の軸ではない。** あちらは「どう見えるか」、
    こちらは「選択肢をどう並べるか」——器の幅（マス数）に対して何個ずつ置くか
    なので、選ばせ方の側に属する。混ぜると「青い2列のボタン群」のような
    掛け算の名前が要る（§9.223 ③で避けた形）。
    綴りはサーバー（`operation_repo.LAYOUTS`）が正で、ここは印をクラスへ
    写すだけ。**効かない入力方法ではサーバーが`自動`へ落として返す**ので、
    ここで判定を持たない（§9.163「判定を画面にも書かない」）。 */
 const LAYOUT_CLASS={'自動':'','横1行':'row','折り返し':'wrap','縦':'col',
                     '2列':'g2','3列':'g3'};
 function applyLayout(box,def){
  if(!box)return;
  [...box.classList].forEach(c=>{if(/^opf-l-/.test(c))box.classList.remove(c)});
  const k=LAYOUT_CLASS[String((def&&def.layout)||'自動')]||'';
  if(k)box.classList.add('opf-l-'+k);
 }
 const CHOICE_SHAPES={
  'ラジオ':    {box:'opf-radio',btn:'opf-radio-btn',dot:true},
  'セグメント':{box:'opf-seg',  btn:'opf-seg-btn'},
  'タブ':      {box:'opf-tabs', btn:'opf-tab-btn'},
  'ボタン群':  {box:'opf-chips',btn:'opf-chip-btn'},
  /* §9.223 ③で足した2つ。**選ぶ状況が違うもの**だけを足す（見た目の違いは
     意匠の軸が持つので、色違いを種類として増やさない）。
     カード … 説明を添えた大きな札。選ぶのに説明が要るとき
     トグル … 2択の入切。「有/無」のような対のとき（3つ以上では出さない） */
  'カード':    {box:'opf-cards',btn:'opf-card-btn',note:true},
  'トグル':    {box:'opf-toggle',btn:'opf-toggle-btn'},
 };

 /* 器を1回だけ作る。**選択肢が変わったら作り直す**（内径のプリセットは
    仕掛データが届いてから入る・§9.204）ので、署名で見分ける。 */
 function buildWidget(def,host,kind){
  /* **意匠は組み立ての前に当てる**（§9.223 ③）。色・形・大きさを変えても
     部品の署名（種類＋選択肢）は同じなので、下の`box.dataset.sig===sig`で
     早々に帰る道が通る——そこから当てていると、**意匠のボタンだけが
     押しても何も起きない**（設定窓の見本で実際にそうなっていた）。
     当て直しはクラスの付け替えだけなので、毎回通しても安い。 */
  applyLook(host,def);
  if(kind==='メモ'||kind==='1行'||kind==='定型文')return buildMemoWidget(def,host,kind);
  if(NUM_WIDGETS.indexOf(kind)>=0)return buildNumberWidget(def,host,kind);
  const sel=host.querySelector(':scope>select');
  if(!sel)return false;
  const free=!!def.freeText;
  const opts=optionsOf(sel);
  const shape=CHOICE_SHAPES[kind];
  const sig=kind+(free?'+free':'')+'/'+String(def.layout||'')
    +(def.noBlank?'/nb':'')
    +'|'+opts.map(o=>o.v+'\u0001'+o.t).join('\u0002');
  const box=widgetHost(host);
  if(box.dataset.sig===sig){syncWidget(host);return true}
  box.dataset.sig=sig;
  host.classList.add('opf-alt');
  /* **選ぶ器そのものを打てるようにする**（§9.226 ①）。以前は
     「プルダウンのときだけ`<select>`を残して、下に打ち込み欄を足す」形
     だったが、打つ場所と選ぶ場所が2つ並んで読めなかった。手打ちのときは
     `<select>`を器の裏へ回し、**見えるのは1つの箱（`.opf-combo`）だけ**に
     する（値の持ち主は今までどおり`<select>`）。 */
  const combo=(kind===WIDGET_SELECT&&free);
  const hideNative=kind!==WIDGET_SELECT||combo;
  sel.classList.toggle('opf-native-off',hideNative);
  if(hideNative)sel.setAttribute('tabindex','-1');else sel.removeAttribute('tabindex');
  if(kind===WIDGET_SELECT&&!free){
   /* 素のプルダウン。器は要らない（意匠だけ当てる）。 */
   box.className='opf-widget opf-plain';
   box.innerHTML='';
  }else if(combo){
   box.className='opf-widget opf-combo';
   box.innerHTML='<input type="text" class="opf-combo-in" autocomplete="off" role="combobox"'
    +' aria-expanded="false" aria-label="'+esc(def.name)+'（候補から選ぶか、そのまま打てます）"'
    +' placeholder="選ぶ／打つ">'
    +'<button type="button" class="opf-combo-open" aria-label="候補から選ぶ" title="候補から選ぶ">▾</button>';
   const inp=box.querySelector('.opf-combo-in');
   inp.addEventListener('input',()=>{
    const v=inp.value.trim();
    if(!v){setValue(sel,'');return}
    /* **候補と同じ文字を打ったら候補として扱う**——手打ちの席へ入れると、
       同じ値が候補と手打ちの2箇所に並ぶ。 */
    const hit=[...sel.options].find(o=>o.dataset.opFree!=='1'&&o.text===v);
    if(hit)setValue(sel,hit.value);else setFree(sel,v);
   });
   box.querySelector('.opf-combo-open').onclick=e=>{e.preventDefault();openPicker(def,host,sel)};
  }else if(kind==='一覧'){
   box.className='opf-widget opf-pick';
   box.innerHTML='<button type="button" class="opf-pick-btn">'
    +'<span class="opf-pick-now">選ぶ</span><span class="opf-pick-caret" aria-hidden="true">▾</span></button>';
   box.querySelector('.opf-pick-btn').onclick=e=>{e.preventDefault();openPicker(def,host,sel)};
  }else if(kind==='入切'){
   /* 入切（§9.226 ①）。**入＝先頭の空でない値／切＝空**。3つ以上あっても
      使うのは先頭だけなので、そのことを文字で書く（§4）。 */
   const on=opts.find(o=>o.v!=='')||{v:'',t:''};
   const more=opts.filter(o=>o.v!=='').length;
   box.className='opf-widget opf-switch';
   box.innerHTML='<button type="button" class="opf-switch-btn" role="switch" aria-checked="false"'
    +' data-op-on="'+esc(on.v)+'" data-op-on-label="'+esc(on.t||'入')+'" data-op-off-label="切">'
    +'<i class="opf-switch-track" aria-hidden="true"><i class="opf-switch-knob"></i></i>'
    +'<span class="opf-switch-text">切</span></button>'
    +(more>1?'<small class="opf-widget-note">選択肢が'+more+'件あります。入切では先頭の「'
      +esc(on.t||on.v)+'」だけを使います</small>':'');
   const sw=box.querySelector('.opf-switch-btn');
   sw.onclick=e=>{
    e.preventDefault();
    const nowOn=!!sel.value&&sel.value!=='-';
    setValue(sel,nowOn?'':sw.dataset.opOn);
    syncWidget(host);
   };
  }else{
   const stage=kind==='段階';
   box.className='opf-widget '+(stage?'opf-stage':(shape?shape.box:'opf-seg'));
   box.setAttribute('role','radiogroup');
   box.setAttribute('aria-label',def.name);
   const btnCls=stage?'opf-stage-btn':(shape?shape.btn:'opf-seg-btn');
   const dot=(!stage&&shape&&shape.dot)?'<i class="opf-dot" aria-hidden="true"></i>':'';
   /* 段階は「選ばない」を並べない——順番の帯に空の段が混ざると、
      1段目が「選ばない」なのか最低の段なのか読めない。
      **`空欄なし`のときも並べない**（§9.228 ④、利用者の指示「非選択状態の
      表示が大きいのでそれをなしにしたり初期値設定したりできるようにしたい」）
      ——ラジオやトグルでは「—」の札が1枚ぶんの場所を取る。初期値と
      組み合わせれば、最初から1つ選ばれた状態で出せる。 */
   const list=(stage||def.noBlank)?opts.filter(o=>o.v!==''):opts;
   box.innerHTML='<div class="opf-shape">'+list.map((o,i)=>{
    const label=(o.v===''||o.t==='-')?'—':o.t;
    const tip=noteOf(def,o.v);
    /* **カードは説明を文字で出す**（§9.223 ③）。`title`に隠すと、選ぶのに
       説明が要るから大きな札にした意味が無くなる（§3）。 */
    const note=(shape&&shape.note&&tip)?'<small class="opf-btn-note">'+esc(tip)+'</small>':'';
    const no=stage?'<i class="opf-stage-no" aria-hidden="true">'+(i+1)+'</i>':'';
    return '<button type="button" role="radio" aria-checked="false" tabindex="-1"'
     +' class="'+btnCls+'" data-opv="'+esc(o.v)+'"'+(tip&&!note?' title="'+esc(tip)+'"':'')
     +'>'+dot+no+'<span class="opf-btn-text">'+esc(label)+'</span>'+note+'</button>';
   }).join('')+(free?otherChipHtml(btnCls):'')+'</div>'
    +(stage?'<small class="opf-stage-scale"><b class="opf-stage-now">—</b> 段目</small>':'');
   applyLayout(box,def);
   box.querySelectorAll('[data-opv]').forEach(b=>{
    b.onclick=e=>{e.preventDefault();setValue(sel,b.dataset.opv);syncWidget(host)};
   });
   if(free)wireOther(box,sel,host);
   /* **左右キーで移れること**（ラジオグループの約束）。押せるのにキーボードで
      辿れない部品を作らない。**打ち込み欄の中では効かせない**——文字を
      打っているときに矢印でカーソルを動かせないのは壊れて見える。 */
   box.onkeydown=e=>{
    if(['ArrowRight','ArrowLeft','ArrowUp','ArrowDown'].indexOf(e.key)<0)return;
    if(e.target&&e.target.classList&&e.target.classList.contains('opf-other-in'))return;
    const btns=[...box.querySelectorAll('[data-opv]')];
    if(!btns.length)return;
    e.preventDefault();
    const i=Math.max(0,btns.findIndex(b=>b.classList.contains('is-on')));
    const d=(e.key==='ArrowRight'||e.key==='ArrowDown')?1:-1;
    const nx=btns[(i+d+btns.length)%btns.length];
    setValue(sel,nx.dataset.opv);syncWidget(host);nx.focus();
   };
  }
  applyLook(host,def);                       /* §9.223 ③ 色・形・大きさ */
  /* selectの側が変わっても印を合わせる（プリセット・記録の復元）。 */
  if(!sel.dataset.opWidgetWired){
   sel.dataset.opWidgetWired='1';
   sel.addEventListener('change',()=>syncWidget(host));
  }
  syncWidget(host);
  return true;
 }
 /* 器を外す（マスタで「プルダウン」へ戻したとき）。**付いたまま置かない**
    ——外し忘れると、戻したはずの欄がボタンのまま残る（§9.210 ④と同じ罠）。 */
 function stripWidget(host){
  const box=host.querySelector(':scope>.opf-widget');
  if(box)box.remove();
  host.classList.remove('opf-alt');
  /* **`<input>`の欄も元へ戻す**（§9.219 ③）。`select`だけを見ていると、
     「メモ」から戻したときに欄が1pxのまま残り**打てない欄**になる。 */
  const sel=valueEl(host);
  if(sel){sel.classList.remove('opf-native-off');sel.removeAttribute('tabindex')}
 }
 /* ---------- テンキー（§9.219 ③、キーボードの無い端末向け） ----------
    **浮き窓は器の外（body直下）へ`position:fixed`で出す**（§9.201）。
    値を持つのは元の`<input>`のままで、ここは押した文字を書き込むだけ。 */
 let padEl=null,padBack=null,padTarget=null;
 function ensureKeypad(){
  if(padEl)return padEl;
  padEl=document.createElement('div');
  padEl.className='opf-picker opf-keypad';padEl.id='opfKeypad';padEl.hidden=true;
  const keys=['7','8','9','4','5','6','1','2','3','0','.','-'];
  padEl.innerHTML='<div class="opf-picker-box" role="dialog" aria-modal="true">'
   +'<header><b id="opfKeypadName"></b>'
   +'<button type="button" id="opfKeypadClose" aria-label="閉じる">×</button></header>'
   +'<output class="opf-keypad-view" id="opfKeypadView"></output>'
   +'<div class="opf-keypad-grid">'
   +keys.map(k=>'<button type="button" class="opf-keypad-key" data-opk="'+k+'">'+k+'</button>').join('')
   +'<button type="button" class="opf-keypad-key opf-keypad-del" data-opk="del">1文字消す</button>'
   +'<button type="button" class="opf-keypad-key opf-keypad-clear" data-opk="clear">全部消す</button>'
   +'</div></div>';
  document.body.appendChild(padEl);
  WL.modal.keepOpen(padEl);
  padEl.querySelector('#opfKeypadClose').onclick=closeKeypad;
  padEl.querySelectorAll('[data-opk]').forEach(b=>{
   b.onclick=e=>{
    e.preventDefault();
    if(!padTarget)return;
    const k=b.dataset.opk;
    let v=String(padTarget.value==null?'':padTarget.value);
    if(k==='clear')v='';
    else if(k==='del')v=v.slice(0,-1);
    else if(k==='-')v=v.charAt(0)==='-'?v.slice(1):('-'+v);
    else if(k==='.'){if(v.indexOf('.')<0)v=(v||'0')+'.'}
    else v=v+k;
    setValue(padTarget,v);
    const view=padEl.querySelector('#opfKeypadView');
    if(view)view.textContent=v||'—';
   };
  });
  document.addEventListener('keydown',e=>{
   if(WL.modal.escCloses(e)&&padEl&&!padEl.hidden){e.stopPropagation();closeKeypad()}
  },true);
  return padEl;
 }
 function closeKeypad(){
  if(!padEl)return;
  padEl.hidden=true;padTarget=null;
  const back=padBack;padBack=null;
  if(back&&back.focus){try{back.focus()}catch(e){}}
 }
 function openKeypad(def,host,el){
  const p=ensureKeypad();
  p.hidden=false;padTarget=el;
  padBack=host.querySelector('.opf-pad-btn');
  p.querySelector('#opfKeypadName').textContent=def.name+(def.unit?`（${def.unit}）`:'');
  const view=p.querySelector('#opfKeypadView');
  if(view)view.textContent=String(el.value||'')||'—';
 }

 /* ---------- 説明つきで選ぶ浮き窓 ----------
    **器の外（body直下）へ`position:fixed`で出す**（§9.201）。`.selectors`は
    `overflow`を持つ器の中にあるので、中に置くと下半分が切れる。 */
 let pickerEl=null,pickerBack=null;
 function ensurePicker(){
  if(pickerEl)return pickerEl;
  pickerEl=document.createElement('div');
  pickerEl.className='opf-picker';pickerEl.id='opfPicker';pickerEl.hidden=true;
  pickerEl.innerHTML='<div class="opf-picker-box" role="dialog" aria-modal="true">'
   +'<header><b id="opfPickerName"></b>'
   +'<button type="button" id="opfPickerClose" aria-label="閉じる">×</button></header>'
   +'<input type="search" id="opfPickerFind" placeholder="絞り込む" autocomplete="off">'
   +'<div class="opf-picker-list" id="opfPickerList"></div></div>';
  document.body.appendChild(pickerEl);
  WL.modal.keepOpen(pickerEl);
  pickerEl.querySelector('#opfPickerClose').onclick=closePicker;
  document.addEventListener('keydown',e=>{
   if(WL.modal.escCloses(e)&&pickerEl&&!pickerEl.hidden){e.stopPropagation();closePicker()}
  },true);
  return pickerEl;
 }
 function closePicker(){
  if(!pickerEl)return;
  pickerEl.hidden=true;
  const back=pickerBack;pickerBack=null;
  if(back&&back.focus){try{back.focus()}catch(e){}}
 }
 function openPicker(def,host,sel){
  const el=ensurePicker();
  el.hidden=false;
  pickerBack=host.querySelector('.opf-pick-btn');
  el.querySelector('#opfPickerName').textContent=def.name;
  /* **できることを先に書く**（§CLAUDE 2）。手打ちできるかどうかは項目ごとに
     違うので、絞り込み欄の案内も切り替える。 */
  const fnd=el.querySelector('#opfPickerFind');
  if(fnd)fnd.placeholder=def.freeText?'絞り込む／候補にない値を打つ':'絞り込む';
  const find=el.querySelector('#opfPickerFind');
  const list=el.querySelector('#opfPickerList');
  const opts=optionsOf(sel);
  const free=!!def.freeText;
  const draw=()=>{
   const raw=String(find.value||'').trim();
   const q=raw.toLowerCase();
   const hit=opts.filter(o=>!q||(o.t+' '+noteOf(def,o.v)).toLowerCase().indexOf(q)>=0);
   /* **絞り込み欄がそのまま手打ちの欄**（§9.226 ①）。候補にない値のために
      別の入力欄を足さない——打つ場所は1つ、が全部の形での約束。
      **候補に同じ文字があるときは出さない**（同じ値を2箇所に並べない）。 */
   const same=opts.some(o=>o.t===raw||o.v===raw);
   const own=(free&&raw&&!same)
     ?'<button type="button" class="opf-picker-item opf-picker-free" data-opfree="'+esc(raw)+'">'
      +'<b>「'+esc(raw)+'」をこのまま使う</b><small>候補にない値として記録します</small></button>'
     :'';
   list.innerHTML=own+(hit.length?hit.map(o=>{
    const label=(o.v===''||o.t==='-')?'（選ばない）':o.t;
    const note=noteOf(def,o.v);
    return '<button type="button" class="opf-picker-item'+(o.v===sel.value?' is-on':'')+'"'
     +' data-opv="'+esc(o.v)+'"><b>'+esc(label)+'</b>'
     +(note?'<small>'+esc(note)+'</small>':'')+'</button>';
   }).join(''):(own?'':'<p class="opf-picker-empty">「'+esc(find.value)+'」に当たる選択肢はありません。'
     +(free?'':'この項目は候補からしか選べません。')+'</p>'));
   list.querySelectorAll('[data-opv]').forEach(b=>{
    b.onclick=()=>{setValue(sel,b.dataset.opv);syncWidget(host);closePicker()};
   });
   const fb=list.querySelector('[data-opfree]');
   if(fb)fb.onclick=()=>{setFree(sel,fb.dataset.opfree);syncWidget(host);closePicker()};
  };
  /* **入力中に一覧だけを描き直す**（§9.117）——入力欄を作り替えるとカーソルが飛ぶ。 */
  find.value='';find.oninput=draw;
  draw();
  try{find.focus()}catch(e){}
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
   if(!g){g={name,items:[],fold:false,span:0,pad:true,showWhen:new Set()};out.push(g)}
   g.items.push(d);
   if(d.fold)g.fold=true;
   /* ダミー（空き）は**カード1枚の属性**（§9.228 ②、利用者の指示
      「ダミーのカードだけ追加したいがダミー群ごとしか追加できないのも
      修正してほしい」）。**群の見出しを消すのは「全部が空き」のときだけ**
      ——1枚でも中身があるなら、その群には見出しが要る。 */
   g.pad=(g.pad!==false)&&!!d.dummy;
   /* 群の幅（§9.226 ③）。**1つでも指定があればそれ**——畳むと同じ読み方に
      そろえる（群の中で食い違ったときにどちらが正かを決めておく）。 */
   if(!g.span&&Number(d.groupSpan)>0)g.span=Math.min(gridCols,Number(d.groupSpan));
   (d.showWhen||[]).forEach(x=>g.showWhen.add(String(x).trim()));
  });
  /* 中身が1枚も無い群は「全部が空き」ではない（初期値のtrueを落とす）。 */
  out.forEach(g=>{if(!g.items.length)g.pad=false;g.dummy=g.pad});
  return out;
 }

 /* ---------- 群を「列でも区切る」（§9.226 ③、利用者の指示） ----------
    「マスタでは現在1列複数行で、行の中で区切りを作っていますが、まとまりを
     作りやすくできるように列にも区切りをつけられるようにしたい」

    群に幅（マス）を持たせ、**横いっぱいでない群は横に並ぶ**ようにする。
    自動配置（`order`＋`span`）では群の見出しが必ず1行を切ってしまうので、
    幅を決めた群があるときだけ**マスを明示して置く**。

    **計算はここ1箇所**——マスタの盤（`master-maint.js`）も同じ関数を通す。
    2つ持つと「盤ではこう見えるのに測定画面では違う」が作れる（§9.176の
    `entryCellInfo()`と同じ約束）。

    引数は `[{name, span(0=横いっぱい), items:[{key, span}]}]`、
    戻りは `{heads,items,rows,banded}`（col/row は1始まり）。 */
 function packLayout(groups,cols){
  const n=Math.max(1,Number(cols)||12);
  const heads=[],items=[];
  let row=1,col=1,bottom=1;
  const newBand=()=>{row=bottom;col=1};
  (groups||[]).forEach(g=>{
   const gs=Math.max(1,Math.min(n,Number(g.span)>0?Number(g.span):n));
   if(col>1&&col+gs-1>n)newBand();
   /* 全部が空きの群は**見出しの行を取らない**（§9.228 ②）——見出しを
      描かないので、中身は見出しの位置から始める（1行ぶん余計に空かない）。 */
   heads.push({name:g.name,col,row,span:gs,dummy:!!g.dummy});
   let r=g.dummy?row:row+1,c=col;
   (g.items||[]).forEach(it=>{
    const w=Math.max(1,Math.min(gs,Number(it.span)||1));
    if(c>col&&c+w-1>col+gs-1){c=col;r++}
    items.push({key:it.key,col:c,row:r,span:w});
    c+=w;
   });
   bottom=Math.max(bottom,(g.items&&g.items.length)?r+1:row+1);
   col+=gs;
   if(col>n)newBand();
  });
  /* **横いっぱいの群しか無いときは今までどおり**（`order`で流す）。
     マスを明示すると、マスタに載っていない`.selectors`の子（作業時間など）が
     空いたマスへ自動で入り込みうる——健全な設定の見え方を変えない。 */
  const banded=(groups||[]).some(g=>Number(g.span)>0&&Number(g.span)<n);
  return {heads,items,rows:Math.max(1,bottom-1),banded};
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

 /* 組み込みの欄の見出しをマスタの項目名に合わせる（§9.228 ①）。
    **先頭のテキスト節点だけ**を書き換える（`<label>`の中の入力欄を消さない）。
    テキスト節点が無い形（将来`<span>`で包んだ場合など）では何もしない
    ——見出しが2つになるより、元の名前のままのほうがまし。 */
 function renameBuiltinLabel(el,name){
  const t=String(name||'').trim();
  if(!t)return;
  for(const n of el.childNodes){
   if(n.nodeType===3&&n.nodeValue.trim()){
    if(n.nodeValue!==t)n.nodeValue=t;
    return;
   }
  }
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
   el.style.order='';el.style.gridColumn='';el.style.gridRow='';
   delete el.dataset.opplace;delete el.dataset.opgroup;delete el.dataset.opfill;
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
   const gs=groupsFor(place);
   /* 群を「列でも区切る」（§9.226 ③）。**幅を決めた群があるときだけ**
      マスを明示する（`banded`）——無いときは今までどおり`order`で流す。 */
   const pack=packLayout(gs.map(g=>({name:g.name,span:g.span,dummy:g.dummy,
     items:g.items.map(d=>({key:d.name,span:Number(d.span)||4}))})),gridCols);
   const headAt=new Map(pack.heads.map(h=>[h.name,h]));
   const cellAt=new Map(pack.items.map(x=>[x.key,x]));
   gs.forEach(g=>{
    const fold=isFolded(g);
    const spot=pack.banded?headAt.get(g.name):null;
    /* ---------- 空き（ダミー）（§9.228 ②、利用者の指示） ----------
       「ダミーのカードだけ追加したいがダミー群ごとしか追加できないのも
        修正してほしい」——空きは**カード1枚**。群の見出しを消すのは
       **その群が全部空きのとき**だけで、ふつうの群の中に空きを1枚だけ
       混ぜることもできる。空きは**見出しも枠も地も文字も持たない**。 */
    if(!g.pad){
    const head=document.createElement(g.fold?'button':'b');
    head.className='prep-head'+(g.fold?' prep-fold':'');
    head.dataset.opgen='1';head.dataset.opgroup=g.name;head.dataset.opplace=place;
    head.style.order=String(seq++);
    if(spot){head.style.gridColumn=spot.col+'/span '+spot.span;head.style.gridRow=String(spot.row)}
    else head.style.gridColumn='1/-1';
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
    }
    g.items.forEach(d=>{
     /* 空きのカード（§9.228 ②）。**入力欄は1つも作らない**——作ると
        空白ではなくなる。マスだけを押さえる。 */
     if(d.dummy){
      const pad=document.createElement('div');
      pad.className='prep-pad';
      pad.dataset.opgen='1';pad.dataset.opgroup=g.name;pad.dataset.opplace=place;
      pad.dataset.oppad='1';
      pad.setAttribute('aria-hidden','true');
      pad.style.order=String(seq++);
      const at0=pack.banded?cellAt.get(d.name):null;
      if(at0){pad.style.gridColumn=at0.col+'/span '+at0.span;pad.style.gridRow=String(at0.row)}
      else pad.style.gridColumn='span '+Math.max(1,Math.min(gridCols,Number(d.span)||4));
      box.appendChild(pad);
      return;
     }
     let el=hostOf(d);
     if(!el&&!d.builtin){el=fieldEl(d,seq);box.appendChild(el)}
     if(!el){missing.push(d.name);return}
     el.dataset.opplace=place;el.dataset.opgroup=g.name;
     /* **組み込みの欄も名前はマスタが決める**（§9.228 ①、利用者の指摘
        「マスタで関連の項目を名前変更しても…どこかでハードコーディングが
        残っていて名前変更が効かない」）。組み込みの欄は`index.html`が
        持っている`<label data-f="coilStop">コイル止め<select…>`をそのまま
        置いているだけで、**見出しの文字はHTMLに焼き付いたまま**だった
        ——自由項目は`fieldEl()`が`d.name`から作るので効いていた、という
        分かりにくい食い違い。コイル止めだけでなく**組み込みの欄すべて**。
        **書き換えるのは先頭のテキスト節点だけ**——`<label>`の中には
        `<select>`や`<small class="prep-from">`が入っているので、
        `textContent`ごと差し替えると入力欄が消える。 */
     if(d.builtin)renameBuiltinLabel(el,d.name);
     /* **器いっぱいに使う**（§9.218 ②、利用者の指摘「項目間の余白が広く、
        かなり表示欄がもったいない」「2列分にしたときに1列と比べると余白が
        出てスカスカな印象。余白は無いようにUI幅で稼いでほしい」）。
        以前は§9.130で測った「中身なりの幅」をそのまま使っており、
        6マス中2マス（413px）の器に154pxの選択欄が入って**259pxが空いて
        いた**（実測）。**幅を決めるのはマスタが選んだマス数**という形に
        揃えるので、狭くしたい欄はマス数を減らす——1つの事実で決まる。
        `fitControlWidths()`はこの印の付いた欄を測らない（測ると
        `max-width`が入って器より狭いまま残る）。 */
     el.dataset.opfill='1';
     /* **前に測った`max-width`を落とす。** `fitControlWidths()`は
        `data-opfill`が付く前にも走る（測定を開いた直後の1回）ので、
        インラインの`max-width`が残ったままだとCSSに勝ち、器の中で
        154pxのまま余白が残る（実測。実際にそうなった）。 */
     el.querySelectorAll('select,input,textarea').forEach(c=>{c.style.maxWidth=''});
     el.style.order=String(seq++);
     const at=pack.banded?cellAt.get(d.name):null;
     if(at){el.style.gridColumn=at.col+'/span '+at.span;el.style.gridRow=String(at.row)}
     else{el.style.gridColumn='span '+Math.max(1,Math.min(gridCols,Number(d.span)||4));
          el.style.gridRow=''}
     el.classList.toggle('op-folded',fold);
     el.classList.toggle('op-required',!!d.required);
     /* 見せ方（§9.221 ⑦）は**組み込みの欄にも当たる**——器の属性を書くだけで、
        値を持つ`<select>`/`<input>`そのものには触らない。 */
     applyPresentation(el,d);
     syncBuiltinUnit(el,d);
     /* 選ばせ方（§9.218 ②）。**組み込みの欄にも当たる**——値を持つのは
        今までどおり`<select>`なので、当てても壊れるものが無い。 */
     const kind=widgetOf(d);
     /* **`<select>`だけの話ではない**（§9.219 ③）。数値・自由記述の欄は
        `<input>`なので、値を持つ要素が在れば器を被せる。 */
     /* **プルダウンでも手打ちが要る**（§9.220 ③）——形はそのままで
        「打つ場所」だけを足すので、器を被せる判断は2つの事実の和になる。 */
     const needsBox=kind!==WIDGET_SELECT||(d.freeText&&el.querySelector(':scope>select'));
     if(needsBox&&valueEl(el))buildWidget(d,el,kind);
     else stripWidget(el);
     /* **意匠は器を被せない欄にも当たる**（§9.223 ③）。素のプルダウンでも
        「主色・丸・大」を選べないと、選ばせ方を変えないと見た目を変えられない
        ことになる（2つの軸にした意味が無い）。 */
     applyLook(el,d);
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
  syncWidgets();
  if(window.WL&&WL.measureSteps&&WL.measureSteps.fitWidths)WL.measureSteps.fitWidths();
  rememberCellPx(box);
 }
 /* ---------- 1マスの実寸を覚える（§9.226 ①） ----------
    マスタの設定窓は「測定画面での見え方」を見せるが、**そこには測定画面が
    無い**ので1マスが何pxなのかを知りようがない。定数で持つと、画面の作りを
    変えたときに設定窓だけが古い縮尺で描き続ける（縮尺が違うと、文字の幅は
    縮まないので**入るはずのものが見切れて見える**）。
    ここで実測してこの端末に覚えさせ、設定窓はそれを使う。**取れなければ
    書かない**——古い値のほうが「何も無い」より当たる。 */
 const CELL_KEY='MeasureOpCellPxV1';
 function rememberCellPx(box){
  try{
   const t=getComputedStyle(box).gridTemplateColumns.split(/\s+/).filter(Boolean);
   if(t.length!==gridCols)return;
   const w=parseFloat(t[0]);
   if(!Number.isFinite(w)||w<8)return;
   localStorage.setItem(CELL_KEY,String(Math.round(w*10)/10));
  }catch(e){}
 }
 function cellPx(){
  try{
   const v=Number(localStorage.getItem(CELL_KEY));
   if(Number.isFinite(v)&&v>=8&&v<=400)return v;
  }catch(e){}
  return 94;                                 /* 実測の既定（1920幅・12マス） */
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
    attachFormat(el,()=>settle(el,def,note));
    el.addEventListener('input',()=>{sanitize(el,def);remember(def.name,rawText(el,el.value))});
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
   putValue(el,v);
  });
  applyInitials();
  syncWidgets();
 }
 /* ---------- 初期値（§9.220 ②、利用者の指示） ----------
    「入力の方法によらず、初期値登録機能の実装をお願いします」

    決めごと:
     ・**まだ記録が無い欄にだけ入れる**。`settings.opData`に鍵があれば
       —— 空文字であっても —— 触らない。空にしたのは利用者の判断で、
       開き直すたびに初期値へ戻るのでは「消せない欄」になる。
     ・**入れたら記録にも書く**（§9.208 ②「打った時点でレコードへ入れる」）。
       画面にだけ出して記録に入れないと、保存せずに閉じた人と保存した人で
       中身が変わる。
     ・**選択肢に無い初期値も入れる**（候補を後から消した場合。`addOption`
       で足してから入れる——足さずに代入すると黙って空になる）。
     ・**組み込みの欄にも入れる**（§9.229 ③、利用者の指示「汎用設計にして
       いるつもりなので」）。ただし置き場が違う——組み込みの値は
       `settings.opData`ではなく`settings.<キー>`なので、**画面へ入れるだけ**
       にして控えへは書かない（保存は`measurement-view.js`の`collect()`が
       `#<キー>`から拾う）。入れるのは**まだ何も選ばれていないとき**だけで、
       選ばれていない印は選択欄が使う`''`と`'-'`の2つ（§4のとおり、既定の
       選択肢が入っている欄には入らないことを設定画面に書く）。
       内径の仕掛由来プリセット（§9.204）は`settings.innerDiameter`を見て
       いて、こちらは控えを書かないので**仕掛の値が勝つ**——順番が決まって
       いるので、どちらが勝つか決められないということは無い。 */
 const BLANK_VALUES=['','-'];
 function applyInitials(){
  const bag=store();
  defs.forEach(d=>{
   const init=String(d.initial==null?'':d.initial);
   if(!init||d.dummy)return;
   if(d.builtin){
    const el=controlOf(d);
    if(!el)return;
    if(BLANK_VALUES.indexOf(String(el.value||'').trim())<0)return;
    if(el.tagName==='SELECT')addOption(el,init);
    putValue(el,init);
    return;
   }
   if(bag&&Object.prototype.hasOwnProperty.call(bag,d.name))return;
   const el=controlOf(d);
   if(!el)return;
   if(String(el.value||'')!=='')return;
   if(el.tagName==='SELECT')addOption(el,init);
   putValue(el,init);
   /* **`remember()`は使わない**——あちらは`markDirty()`まで呼ぶので、
      記録を開いただけで「未保存の変更あり」になる。初期値は利用者が
      打ったものではないので、開いた瞬間に編集を名乗らせない。
      保存のときは`collect()`が画面から拾い直すので取りこぼさない。 */
   if(bag)bag[d.name]=init;
  });
 }
 /* **`.value`への代入では`change`が飛ばない**（DOMも変わらない）ので、
    記録の復元・仕掛由来のプリセット（§9.204の内径）のあとは、こちらから
    印を合わせに行く。忘れると**値は入っているのにボタンがどれも選ばれて
    いない**という、いちばん分かりにくい形で壊れる。 */
 function syncWidgets(){
  document.querySelectorAll('.selectors>.opf-alt').forEach(syncWidget);
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
  /* **空き（ダミー）の群の行は数えない**（§9.227 ③）。あの行は場所を
     取るためだけに在り、入力欄を一度も描かない——数に入れると
     「記録した値 3/9」の分母だけが増え、**どう頑張っても埋まらない1件**が
     残る（画面には出ていないので探しようがない）。 */
  const free=defs.filter(d=>!d.builtin&&!d.dummy);
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
   if(!d.required||d.dummy)return;      /* 空きの群の行は数えない（§9.227 ③） */
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
 /* マスタ管理の設定窓が**同じ部品**で見本を出すための口（§9.218 ①）。
    見本を別に作ると、設定画面で見えた形と実際の形が食い違う
    （§9.176の`entryCellInfo()`と同じ約束）。 */
 function previewWidget(def,host,kind){
  try{return buildWidget(def,host,kind)}catch(e){console.warn('見本を作れませんでした',e);return false}
 }
 WL.opData={load,layout,render:layout,refresh,apply,collect,values,filled,requiredControls,
            syncAutoOpen,syncWidgets,previewWidget,ruleText,
            /* 見せ方を当てる口（§9.221 ⑦）。**当てるのはこの1本**——設定窓の
               見本も測定画面もここを通るので、形が食い違わない。 */
            /* 意匠（§9.223 ③）もこの口が当てる——**選ばせ方が「プルダウン」の
               ままだと`previewWidget()`を通らない**ので、部品の側だけで
               当てていると素の欄に色・形・大きさが効かない。 */
            presentation:(host,def)=>{applyPresentation(host,def);applyLook(host,def);
              syncBuiltinUnit(host,Object.assign({builtin:'preview'},def))},
            /* 値の整形を見本の欄にも当てる口（§9.221 ⑦）。**整え方も
               同じ`settle()`を通す**——見本だけ桁そろえが効かないと、
               「3桁区切り」を選んでも設定画面では素の数字のままになる。 */
            attachFormat,
            settlePreview:(el,def)=>settle(el,Object.assign({},def,{preview:true}),null),
            defs:()=>defs.slice(),
            /* 群を列でも区切る割り付け（§9.226 ③）。**マスタの盤も同じ
               関数を通す**——2つ持つと盤と測定画面で並びが食い違う。 */
            packLayout,
            /* 測定画面の1マスの実寸（§9.226 ①）。設定窓の見本が**実物と
               同じ大きさ**で描くために使う。 */
            cellPx,
            /* 設備が変わったら次に開くとき読み直す（マスタ管理で足した直後）。 */
            forget:()=>{defs=[];builtinOff=[];defsFor=null;loading=null}};
})();
