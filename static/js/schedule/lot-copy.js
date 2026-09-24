/* lot-copy.js: 選んだ予定のロット番号を、決めた区切りでつないでコピーする（§9.368）
   ============================================================
   利用者の指示:「スケジュールモードでの作業スケジュール一覧の右クリック
   メニューに『ICASコピー』という機能を実装してください。これは選択中の
   すべてのロットの『ロット番号』を区切り文字である半角スペースを使って
   区切って連結させた形にしてコピーさせるものです。これの設定もその
   コピーボタンのポップオーバーメニューとして入れ子で追加しておきたいです。
   設定はルール複数を作れるようにする。区切り文字を選ぶことができる、
   区切り文字の数を決められる、入れる頻度を決められる。といった具合で
   複数組み合わせて対応できるようにしたうえで設定の部分は専用モーダルで
   対応し、どのような文字列になるか視覚的に見えるようにサンプルを表示させて」

   ------------------------------------------------------------
   決めたこと

   ① **つなぎ方は「決まり（区切り）の並び」で持つ。**
      1つの決まりは `N件ごとに・この文字を・何個` の3つだけ。これを何本でも
      重ねられるので、「ふだんは半角スペース、10件ごとに改行」のような
      組み合わせが**足し算で**書ける。文字ごとに専用の設定を作らない
      （増やすたびに画面と保存の形が増える）。

   ② **同じ位置に2つ以上あたったら、書いた順にぜんぶ重ねる**（利用者の指示）。
      1件ごとに`,`／4件ごとに`/`／2件ごとに`+`／3件ごとに`,`を重ねると、
      4件目のうしろは`,/+`（決まりの並び順に足す）。

      **一度は「間隔の大きいほうが勝つ」にしていたが、撤回した。** 行末に
      見えない空白が残るのを嫌ったための勝ち負けだったが、それは
      「区切りを重ねられない」という**別の制限**とセットで払う代償だった
      ——空白が邪魔なら、その決まりを書かなければよい。**足すか捨てるかを
      決めるのは利用者**で、こちらが先に捨ててよいものではない。
      重なり方は見本でそのまま見えるので、覚えなくてよい（§2）。

   ③ **見本は上の帯に固定で出す**（§9.288 と同じ作り）。設定を触るたびに
      「こうコピーされる」が同じ場所で変わる。**区切りは見えるようにする**
      ——半角スペースも改行もタブも、そのままでは画面で見分けられない
      （記号は`␣`/`⏎`/`→`。表示だけで、コピーされるのは本物の文字）。

   ④ **保存は端末に持つ**（`localStorage`）。貼り付け先（ICAS）は端末ごとの
      都合なので、`scLayout`（この端末の見え方）と同じ置き場にする。

   ⑤ **「既定」という触れない行を作らない**（§9.367で踏んだ罠）。最初の1回だけ
      「区切らずにつなぐ」の1本を書き込み（§9.462）、あとは**どれも同じように直せる・消せる**。

   外へ出すのは `WL.lotCopy` の5つだけ。
   ============================================================ */
(function(){
 const KEY='scLotCopyRulesV1';
 const PICK_KEY='scLotCopyRuleV1';     // 最後に使ったルール（次もこれで貼る）
 const MAX_RULES=20, MAX_SEPS=6, MAX_COUNT=20, MAX_EVERY=999;
 /* 「その他」に書ける長さ（利用者の指示「1文字に限定せず何文字でも、
    また、空白でも設定できるように」）。**1文字という決めはどこにも無い**
    ——空白だけの文字列も、`  →  `のような飾りも、そのまま区切りになる。
    上限を置くのは端末の保存（`localStorage`）を守るためで、**画面にも
    書く**（何文字まで入るかを推測させない・§CLAUDE 画面基準 6）。 */
 const MAX_TEXT=40;

 /* 区切り文字の顔ぶれ。**よく使うものを1押しで選べる**ための短い一覧で、
    ここに無い区切りは「その他」に**何文字でも**書ける（空白まじりも可）。 */
 const SEP_KINDS=[
  {kind:'space',  label:'半角スペース', ch:' '},
  {kind:'wide',   label:'全角スペース', ch:'　'},
  {kind:'comma',  label:'カンマ',       ch:','},
  {kind:'tab',    label:'タブ',         ch:'\t'},
  {kind:'nl',     label:'改行',         ch:'\n'},
  {kind:'semi',   label:'セミコロン',   ch:';'},
  {kind:'pipe',   label:'縦棒',         ch:'|'},
  {kind:'slash',  label:'スラッシュ',   ch:'/'},
  {kind:'hyphen', label:'ハイフン',     ch:'-'},
  {kind:'none',   label:'区切らない',   ch:''},
  {kind:'custom', label:'その他（自分で書く）', ch:''},
 ];
 const kindOf=k=>SEP_KINDS.find(x=>x.kind===k)||SEP_KINDS[0];

 /* **目に見えない字を見えるようにする答えは、この1箇所。** 1文字ずつ当てるので、
    「その他」に`, `（カンマ＋空白）のような**混じった文字列**を書いても、
    どこに空白があるかが見本で読める。**表示だけ**で、コピーされるのは本物の字。
    以前は区切りの種類ごとに記号を1つ持っていたが、それだと「その他」に
    書いた文字列の中の空白を指せなかった（種類は1つでも中身は何文字でもある）。 */
 const MARKS={' ':'␣','\u3000':'▫','\t':'→','\n':'⏎'};
 const visibleChars=v=>String(v||'').replace(/[ \u3000\t\n]/g,c=>MARKS[c]);

 /* ---------- 最初の1回だけ書き込む1行（§9.400 → §9.462、利用者の指示） ----------
    **触れない既定ではない**——名前も中身も変えられ、消せる。

    **中身は「区切らずにつなぐ」の1本だけ**（§9.462）。以前は
    `ICAS（半角スペース）`と`半角スペース＋10件ごとに改行`の2本を入れていたため、
    **何も設定していない人のコピーが半角スペース入り**になっていた——§9.403で
    「ルール無しの場合、区切り無しの連結」と決めたのに、例の2本が先に効いて
    **「ルール無し」の状態に一度もならなかった**（利用者の報告「ルールなしの
    区切らずにつなぐができずに、半角スペースが入る、2つのルールが内部的に
    入っている」）。

    **`id`を時刻から作らないこと**（§9.400）。決め打ちの`id`にして、作ったその場で
    保存する（`rules()`）ので、以後はただの1行として直せる・消せる。 */
 function seed(){
  return [{id:'r_plain',name:'区切らずにつなぐ',seps:[{kind:'none',text:'',count:1,every:1}]}];
 }
 /* §9.400〜§9.403で書き込んでいた例の2本。**触っていないものだけ**片付ける
    （`retireOldSeeds()`）——名前か中身を1つでも直していれば、それは利用者の行。 */
 const OLD_SEEDS=[
  {id:'r_icas_space',name:'ICAS（半角スペース）',seps:[{kind:'space',text:'',count:1,every:1}]},
  {id:'r_icas_space_nl10',name:'半角スペース＋10件ごとに改行',
   seps:[{kind:'space',text:'',count:1,every:1},{kind:'nl',text:'',count:1,every:10}]},
 ];
 const sameRule=(a,b)=>JSON.stringify({id:a.id,name:a.name,seps:a.seps})
                       ===JSON.stringify({id:b.id,name:b.name,seps:b.seps});
 /* 触っていない例の2本を外す。**外して空になったら新しい1行を入れる**——
    例しか持っていなかった人は「何も設定していない人」なので、その人の答えも
    「区切らずにつなぐ」にそろえる。 */
 function retireOldSeeds(list){
  const kept=list.filter(r=>!OLD_SEEDS.some(o=>sameRule(r,o)));
  if(kept.length===list.length)return {list,changed:false};
  return {list:kept.length?kept:seed().map(normRule),changed:true};
 }
 /* ---------- ルールが1本も無いときの「素のつなぎ方」（§9.400、利用者の指示） ----------
    「ルールなしの場合コピーはロットナンバーだけの連結コピーになるなど、
      ルールがないとしてコピーができないではじくみたいなことのないように」

    **コピーを断る理由に「ルールが無い」を使わない。** ルールは貼り付け先に
    合わせるためのもので、**無ければ無いなりにつなげばよい**。

    区切りは**無し**（`A1A2A3`）。§9.400では「貼り先が求める形」と読んで
    半角スペース1つにしたが、**利用者の指示で改めた**（§9.403）:

      「ルール無しの場合、区切り無しの連結が良いです」

    もともとの依頼が「**ロットナンバーだけの連結コピー**」だったので、
    こちらが元の言葉どおり。区切りが要る貼り先はルールを1本作る。
    **この行は一覧に出さない**（出すと§9.367で撤回した「触れない既定」に戻る）。
    代わりに**名前で状態を言う**ので、メニューにも結果にもそのまま出る。 */
 const PLAIN={id:'',name:'ルールなし（区切らずにつなぐ）',
              seps:[{kind:'none',text:'',count:1,every:1}]};
 const clampInt=(v,lo,hi)=>{
  const n=Math.round(Number(v));
  return Number.isFinite(n)?Math.min(hi,Math.max(lo,n)):lo;
 };
 function normSep(s){
  s=s&&typeof s==='object'?s:{};
  const kind=SEP_KINDS.some(x=>x.kind===s.kind)?s.kind:'space';
  return {kind,text:String(s.text||'').slice(0,MAX_TEXT),
          count:clampInt(s.count,1,MAX_COUNT),every:clampInt(s.every,1,MAX_EVERY)};
 }
 function normRule(r,i){
  r=r&&typeof r==='object'?r:{};
  const seps=(Array.isArray(r.seps)?r.seps:[]).slice(0,MAX_SEPS).map(normSep);
  return {id:String(r.id||('r'+i+'_'+Date.now())),
          name:String(r.name||'').slice(0,40)||`ルール${i+1}`,
          seps:seps.length?seps:[normSep({})]};
 }
 let cache=null;
 /* ---------- 読み出し（§9.400、利用者の報告①） ----------
    **「まだ作っていない」と「利用者が空にした」を見分ける。** 鍵そのものが
    無いときだけ例を書き込み、**その場で保存する**（以後は本物の行）。
    保存されているのが空配列`[]`なら、それは**消した結果**なのでそのまま空。

    以前は`raw.length`が0なら`seed()`へ倒していたため、
      ・例の2本は**どこにも保存されていない**のに「登録済み」に見え
      ・全部消すと、その場では「ルールがありません」と言うのに
        **再読込で復活した**（利用者の報告「内部的にルールがある状態」）
    という食い違いが起きていた。 */
 function rules(){
  if(cache)return cache;
  let raw=null,had=false;
  try{
   const s=localStorage.getItem(KEY);
   had=(s!==null);
   raw=JSON.parse(s||'null');
  }catch(e){WL.quiet.note('保存された値を読めない（例を書き直して続ける）',e);raw=null;had=false}
  if(had&&Array.isArray(raw)){
   const r=retireOldSeeds(raw.map(normRule));
   cache=r.list;
   if(r.changed)save();         // 片付けた結果を本物にする（次の起動で繰り返さない）
   return cache;
  }
  cache=seed().map(normRule);
  save();                       // **例も本物の行にする**（直せる・消せる）
  return cache;
 }
 function save(){
  try{localStorage.setItem(KEY,JSON.stringify(cache||[]))}
  catch(e){WL.quiet.note('保存できなくてもコピー自体は効く',e)}
 }
 function currentId(){
  let id='';
  try{id=String(localStorage.getItem(PICK_KEY)||'')}
  catch(e){WL.quiet.note('保存された値を読めない（先頭のルールで続ける）',e)}
  const list=rules();
  return (list.some(r=>r.id===id)?id:(list[0]||{}).id)||'';
 }
 function setCurrentId(id){
  try{localStorage.setItem(PICK_KEY,String(id||''))}
  catch(e){WL.quiet.note('保存できなくても今回のコピーは効く',e)}
 }
 /* いま使うつなぎ方。**必ず1つ返す**（§9.400）——1本も無ければ`PLAIN`。
    呼ぶ側に「無いときの扱い」を書かせない（はじく分岐がそこで増える）。 */
 function currentRule(){
  const list=rules();
  return list.find(r=>r.id===currentId())||list[0]||PLAIN;
 }

 /* ---------- つなぎ方（②） ----------
    `i`件目までを並べたあとの区切り。**あたる決まりを、書いた順にぜんぶ返す**
    ——1つもあたらなければ空になり、そこは区切らない。 */
 function sepsAt(rule,i){
  return (rule&&rule.seps||[]).filter(s=>i%s.every===0);
 }
 /* 決まりの並び → 実際にコピーされる字。**重ねるのはここ1箇所**（見本も本番も
    通る）。1本ぶんは「その文字 × いくつ」で、それを並び順に足す。 */
 function sepChars(list){
  return (list||[]).map(s=>{
   const k=kindOf(s.kind);
   const ch=k.kind==='custom'?String(s.text||''):k.ch;
   return ch.repeat(s.count);
  }).join('');
 }
 /* コピーする文字列そのもの。**ここが唯一の組み立て**——見本も本番も通す
    （見本と刷り上がりが食い違わないための1箇所・§9.163）。 */
 function joinLots(lots,rule){
  const list=(lots||[]).map(v=>String(v??'').trim()).filter(Boolean);
  return list.map((lot,i)=>(i?sepChars(sepsAt(rule,i)):'')+lot).join('');
 }

 /* ---------- 見本（③） ----------
    区切りを**見えるように**したときだけ記号を添える。記号は画面のためだけで、
    コピーされる文字は`joinLots()`が答えたものそのまま。 */
 function sampleHtml(lots,rule,showMarks){
  const list=(lots||[]).map(v=>String(v??'').trim()).filter(Boolean);
  if(!list.length)return '<span class="icc-empty">つなぐロット番号がありません</span>';
  return list.map((lot,i)=>{
   const head=i?sepPieceHtml(sepsAt(rule,i),showMarks):'';
   return head+`<span class="icc-lot">${esc(lot)}</span>`;
  }).join('');
 }
 function sepPieceHtml(list,showMarks){
  const raw=sepChars(list);
  if(!raw)return '<i class="icc-sep is-none" title="ここは区切りません"></i>';
  /* **数えるのは「実際にコピーされる字」から**（§9.371）。以前は
     「記号 × いくつ」で組み直していたので、記号を持たない区切り（カンマ等）は
     `,,`を2回繰り返して`,,,,`と出ていた——見本と刷り上がりが食い違っていた。 */
  const shown=(showMarks?visibleChars(raw):raw).slice(0,60);
  const br='<br>'.repeat((raw.match(/\n/g)||[]).length);
  /* **何が重なっているかを、その場で言う**（探させない・§2）。 */
  const why=list.map(s=>`${kindOf(s.kind).label}×${s.count}（${s.every}件ごと）`).join(' ＋ ');
  return `<i class="icc-sep" title="${esc(why)}">${esc(shown)}</i>${br}`;
 }

 /* ---------- コピー ----------
    `navigator.clipboard`が使えない場面（古い版・許可されていない）でも
    黙って何もしないことにしない（§4）——隠し欄からの複写へ落とす。 */
 async function writeClipboard(text){
  try{
   if(navigator.clipboard&&navigator.clipboard.writeText){
    await navigator.clipboard.writeText(text);return true;
   }
  }catch(e){WL.quiet.note('クリップボードAPIが使えない（隠し欄から複写する）',e)}
  try{
   const ta=document.createElement('textarea');
   ta.value=text;ta.setAttribute('readonly','');
   ta.style.position='fixed';ta.style.left='-2000px';ta.style.top='0';
   document.body.append(ta);ta.select();
   const ok=document.execCommand('copy');
   ta.remove();
   return ok;
  }catch(e){WL.quiet.note('複写もできない（理由を出す）',e);return false}
 }
 /* 外から呼ぶ入口。`lots`は「選択中のロット番号」の並び。 */
 async function copyLots(lots,rule){
  const use=rule||currentRule();
  const list=(lots||[]).map(v=>String(v??'').trim()).filter(Boolean);
  if(!list.length){
   showToast&&showToast('コピーできません','ロット番号のある予定が選ばれていません',4000);
   return false;
  }
  const text=joinLots(list,use);
  const ok=await writeClipboard(text);
  if(ok)showToast&&showToast(`${list.length}件のロット番号をコピーしました`,
    `${use.name}／${list.slice(0,3).join('・')}${list.length>3?`　ほか${list.length-3}件`:''}`,3600);
  else showToast&&showToast('コピーできませんでした',
    'ブラウザがクリップボードへの書き込みを許可していません',6000);
  return ok;
 }

 /* ---------- 入れ子のメニュー（ポップオーバー） ----------
    親（「ICASコピー」）を押すと**いま選んでいるルールでコピー**、
    横に開く子で**ルールを選ぶ／設定を開く**。押しても何も起きない親を
    作らない（§4）。 */
 function menuItems(lots){
  const list=rules();
  const cur=currentId();
  /* **どのルールがどう並ぶかを、選ぶ前に見せる**（§CLAUDE 画面基準 2・
     「選ばせるものは選ぶ前に見える」§9.200）。名前だけでは、10件ごとの改行が
     入るのかどうかが読めない。 */
  const items=list.map(r=>({
   label:(r.id===cur?'● ':'○ ')+r.name,
   note:previewLine(lots,r),showNote:true,
   run:()=>{setCurrentId(r.id);copyLots(lots,r)},
  }));
  /* **1本も無くてもコピーできる**（§9.400、利用者の指示）。押せない項目で
     「ありません」と言うだけにすると、**そこで手が止まる**——素のつなぎ方を
     押せる形で出し、作る道はその下の「コピーの設定…」が持つ。 */
  if(!list.length)items.push({label:'● '+PLAIN.name,
    note:previewLine(lots,PLAIN)+'／ルールを作ると、ここに並びます',showNote:true,
    run:()=>copyLots(lots,PLAIN)});
  items.push({sep:true});
  items.push({label:'コピーの設定…',note:'区切り文字・数・入れる頻度を決めます',
              run:()=>openSettings(lots)});
  return items;
 }
 /* メニューに添える1行の見本。**長いと読めない**ので頭だけ。 */
 function previewLine(lots,rule){
  const list=(lots||[]).map(v=>String(v??'').trim()).filter(Boolean);
  const src=list.length?list.slice(0,4):['A0001','A0002','A0003','A0004'];
  const shown=joinLots(src,rule).replace(/\t/g,'→').replace(/\n/g,'⏎').replace(/ /g,'␣').replace(/　/g,'▫');
  return shown.slice(0,48)+(shown.length>48?'…':'');
 }

 /* ---------- 設定モーダル ----------
    作りは「①どのルールを使うか → ②そのルールの区切り」の2列＋**上の帯に
    見本**（§9.288）。**触ったらその場で保存**（§9.113）——保存ボタンを
    持たない。閉じるボタンは1つ。 */
 let ui=null;    // {lots,ruleId,marks,count}
 function openSettings(lots){
  const list=rules();
  ui={lots:(lots||[]).map(v=>String(v??'').trim()).filter(Boolean),
      ruleId:currentId()||((list[0]||{}).id||''),
      marks:true,count:12,deleting:''};
  const asked=confirmModal({eyebrow:'ICAS COPY',title:'ICASコピーの設定',
   hideCancel:true,confirmLabel:'閉じる',
   bodyHtml:'<div class="icc-modal" id="iccModal"></div>'});
  render();
  return asked;
 }
 /* 見本に使うロット番号。**選んでいるものが正**——実際に貼るものが見えて
    いれば、頭の中で置き換えずに済む（§2「思い出させない」）。足りない
    ぶんは見本の番号で埋め、埋めたことを字で言う。 */
 function sampleLots(){
  const real=(ui&&ui.lots)||[];
  const n=(ui&&ui.count)||12;
  const out=real.slice(0,n);
  for(let i=out.length;i<n;i++)out.push('A'+String(1001+i).padStart(4,'0'));
  return out;
 }
 function sampleNote(){
  const real=((ui&&ui.lots)||[]).length,n=(ui&&ui.count)||12;
  /* **どのつなぎ方で見えているのかを添える**（§9.400）——ルールが1本も無い
     ときは素のつなぎ方なので、それを名前で言わないと出どころが読めない。 */
  const via=rules().length?'':`／${PLAIN.name}`;
  if(!real)return `見本のロット番号${n}件（予定を選んでから開くと、選んだロットで見えます）${via}`;
  if(real>=n)return `選んでいる${real}件のうち先頭${n}件${via}`;
  return `選んでいる${real}件＋見本${n-real}件${via}`;
}
 function ruleNow(){return rules().find(r=>r.id===(ui&&ui.ruleId))||null}
 /* 見本に使うつなぎ方。**1本も無いときは素のつなぎ方**（§9.400）——
    「ルールを選んでください」と書くと、**作るまで何も起きない画面**に見える。 */
 function sampleRule(){return ruleNow()||(rules().length?null:PLAIN)}

 function render(){
  const box=document.getElementById('iccModal');
  if(!box)return;
  const list=rules(),rule=ruleNow();
  box.innerHTML=sampleSectionHtml(rule)+`<div class="icc-cols">`
   +ruleListHtml(list)+sepListHtml(rule)+`</div>`;
  wire(box);
 }
 function sampleSectionHtml(rule){
  return `<section class="icc-sample">
   <div class="icc-sample-head">
    <b>こうコピーされます</b>
    <small class="icc-sample-src">${esc(sampleNote())}</small>
    <span class="icc-spacer"></span>
    <label class="icc-check"><input type="checkbox" id="iccMarks"${ui.marks?' checked':''}>
     <span>区切りを見えるようにする</span></label>
    <span class="icc-count">見本の件数
     <span class="mm-num" data-num-wrap>
      <button type="button" class="mm-num-btn" data-icc-count="-1" aria-label="見本の件数を減らす">−</button>
      <input class="mm-num-input icc-count-input" id="iccCount" type="text" inputmode="numeric"
             autocomplete="off" value="${esc(String(ui.count))}">
      <button type="button" class="mm-num-btn" data-icc-count="1" aria-label="見本の件数を増やす">＋</button>
     </span></span>
   </div>
   <output class="icc-sample-out${ui.marks?' is-marked':''}" id="iccSample">${
     (rule||sampleRule())?sampleHtml(sampleLots(),rule||sampleRule(),ui.marks)
        :'<span class="icc-empty">ルールを選んでください</span>'}</output>
  </section>`;
 }
 /* 名前は**その場で書き換える**（§9.342の窓は1枚しかないので、設定の窓の
    上に入力の窓を重ねられない——重ねると設定の中身が消える）。消すのも
    同じ理由で**行の中の2手**にする（押し間違いは1手では起きない・§5）。 */
 function ruleListHtml(list){
  const rows=list.map(r=>{
   const on=r.id===ui.ruleId;
   if(ui.deleting===r.id)return `<li class="icc-rule is-deleting" data-rule="${esc(r.id)}">
     <span class="icc-rule-ask">「${esc(r.name)}」を消しますか？</span>
     <span class="icc-rule-tools">
      <button type="button" class="icc-mini is-danger" data-delyes="${esc(r.id)}">消す</button>
      <button type="button" class="icc-mini" data-delno="1">やめる</button>
     </span></li>`;
   return `<li class="icc-rule${on?' is-on':''}" data-rule="${esc(r.id)}">
    <button type="button" class="icc-rule-pick" data-pick="${esc(r.id)}"
      title="${on?'このルールでコピーします':'このルールに切り替えます'}">
     <span class="icc-rule-mark" aria-hidden="true">${on?'●':'○'}</span></button>
    <span class="icc-rule-body">
     <input type="text" class="icc-rule-name" maxlength="40" data-name="${esc(r.id)}"
            value="${esc(r.name)}" autocomplete="off" spellcheck="false"
            aria-label="ルールの名前">
     <small class="icc-rule-preview">${esc(previewLine(ui.lots,r))}</small></span>
    <span class="icc-rule-tools">
     <button type="button" class="icc-mini" data-dup="${esc(r.id)}" title="この内容で1本増やします">複製</button>
     <button type="button" class="icc-mini is-danger" data-del="${esc(r.id)}" title="このルールを消します">削除</button>
    </span></li>`;
  }).join('');
  return `<section class="icc-panel icc-panel-rules">
   <h3><span class="icc-no">1</span>どのルールでつなぐか</h3>
   <ul class="icc-rule-list">${rows||`<li class="icc-empty-row"><b>ルールはありません。</b>
     いまは <b>${esc(PLAIN.name.replace(/^ルールなし（|）$/g,''))}</b> でコピーします。
     別のつなぎ方にしたいときは「＋ ルールを追加」から作れます。</li>`}</ul>
   <button type="button" class="icc-add" id="iccAddRule"${list.length>=MAX_RULES?' disabled title="これ以上は増やせません"':''}>＋ ルールを追加</button>
  </section>`;
 }
 /* **決まりの並びは表にする**（§CLAUDE 画面基準 9「情報欄は縦にそろえる」）。
    見出しは1行だけ置き、行ごとにラベルを繰り返さない。
    **「その文字」の欄は常に置く**——「その他」のときだけ現れる作りにすると、
    行ごとに欄の左端がずれて列を目で追えなくなる。使えないときは
    押せなくして理由を書く（§4）。 */
 const SEP_COLS=['','何件ごと','区切り文字','いくつ',''];
 function sepListHtml(rule){
  if(!rule)return `<section class="icc-panel icc-panel-seps">
   <h3><span class="icc-no">2</span>区切りの決まり</h3>
   <p class="icc-help">左でルールを選ぶと、ここに区切りの決まりが出ます。</p></section>`;
  const head=`<li class="icc-sep-head">${SEP_COLS.map(t=>`<span>${esc(t)}</span>`).join('')}</li>`;
  const rows=rule.seps.map((s,i)=>{
   const k=kindOf(s.kind);
   const free=k.kind==='custom';
   return `<li class="icc-sep-row" data-i="${i}">
    <span class="icc-sep-no">${i+1}</span>
    <span class="mm-num" data-num-wrap>
     <button type="button" class="mm-num-btn" data-sep-step="-1" data-f="every" data-i="${i}" aria-label="間隔を減らす">−</button>
     <input class="mm-num-input icc-w-num" type="text" inputmode="numeric" autocomplete="off"
            data-f="every" data-i="${i}" value="${esc(String(s.every))}" aria-label="何件ごと">
     <button type="button" class="mm-num-btn" data-sep-step="1" data-f="every" data-i="${i}" aria-label="間隔を増やす">＋</button>
    </span>
    <span class="icc-kind">
     <select class="icc-w-sel" data-f="kind" data-i="${i}" aria-label="区切り文字">
      ${SEP_KINDS.map(x=>`<option value="${x.kind}"${x.kind===s.kind?' selected':''}>${esc(x.label)}</option>`).join('')}
     </select>
     ${free?`<input type="text" class="icc-w-free" maxlength="${MAX_TEXT}" data-f="text" data-i="${i}"
       value="${esc(s.text)}" aria-label="その文字"
       placeholder="何文字でも／空白も可" title="${MAX_TEXT}文字まで。空白だけでも入れられます（見本の「区切りを見えるようにする」で位置が見えます）"
       autocomplete="off">`:''}
    </span>
    <span class="mm-num" data-num-wrap>
     <button type="button" class="mm-num-btn" data-sep-step="-1" data-f="count" data-i="${i}" aria-label="数を減らす">−</button>
     <input class="mm-num-input icc-w-num" type="text" inputmode="numeric" autocomplete="off"
            data-f="count" data-i="${i}" value="${esc(String(s.count))}" aria-label="いくつ">
     <button type="button" class="mm-num-btn" data-sep-step="1" data-f="count" data-i="${i}" aria-label="数を増やす">＋</button>
    </span>
    <button type="button" class="icc-mini is-danger icc-sep-del" data-sepdel="${i}"
     ${rule.seps.length<=1?' disabled title="最後の1本は消せません（区切らないなら「区切らない」を選びます）"':' title="この決まりを消します"'}>削除</button>
   </li>`;
  }).join('');
  return `<section class="icc-panel icc-panel-seps">
   <h3><span class="icc-no">2</span>区切りの決まり</h3>
   <p class="icc-help">上から順に「<b>N件ごとに</b>／<b>この文字を</b>／<b>何個</b>」入れます。
    同じ位置に2つ以上あたるときは<b>この並び順にぜんぶ重ねます</b>
    （「1件ごとにカンマ」＋「4件ごとにスラッシュ」なら、4件目のうしろは
    <code>,/</code>）。<b>重なった形は上の見本でそのまま見えます。</b>
    「その他」には<b>何文字でも</b>書けます（空白だけでも構いません）。</p>
   <ol class="icc-sep-list">${head}${rows}</ol>
   <button type="button" class="icc-add" id="iccAddSep"${rule.seps.length>=MAX_SEPS?' disabled title="これ以上は増やせません"':''}>＋ 決まりを足す</button>
  </section>`;
 }

 function wire(box){
  const rule=ruleNow();
  const marks=box.querySelector('#iccMarks');
  if(marks)marks.onchange=()=>{ui.marks=marks.checked;render()};
  const cnt=box.querySelector('#iccCount');
  if(cnt)cnt.oninput=()=>{ui.count=clampInt(cnt.value,1,200);paintSample()};
  box.querySelectorAll('[data-icc-count]').forEach(b=>{
   b.onclick=()=>{ui.count=clampInt(ui.count+Number(b.dataset.iccCount),1,200);render()};
  });
  box.querySelectorAll('[data-pick]').forEach(b=>{
   b.onclick=()=>{ui.ruleId=b.dataset.pick;setCurrentId(ui.ruleId);render()};
  });
  const addRule=box.querySelector('#iccAddRule');
  if(addRule)addRule.onclick=()=>{
   if(rules().length>=MAX_RULES)return;
   const r=normRule({name:`ルール${rules().length+1}`,
                     seps:[{kind:'space',count:1,every:1}]},rules().length);
   r.id='r'+Date.now();
   cache=rules().concat([r]);save();
   ui.ruleId=r.id;ui.deleting='';setCurrentId(r.id);render();
   /* **名前をすぐ書ける**ようにして返す（探させない・§2）。 */
   const el=document.querySelector(`#iccModal [data-name="${CSS.escape(r.id)}"]`);
   if(el){el.focus();el.select()}
  };
  box.querySelectorAll('[data-name]').forEach(el=>{
   el.oninput=()=>{
    const r=rules().find(x=>x.id===el.dataset.name);if(!r)return;
    r.name=String(el.value||'').slice(0,40);save();
   };
   el.onblur=()=>{
    const r=rules().find(x=>x.id===el.dataset.name);if(!r)return;
    /* **空の名前を残さない**（一覧で選べなくなる）。 */
    if(!r.name.trim()){r.name=`ルール${rules().indexOf(r)+1}`;save();render()}
   };
  });
  box.querySelectorAll('[data-dup]').forEach(b=>{
   b.onclick=()=>{
    const r=rules().find(x=>x.id===b.dataset.dup);if(!r||rules().length>=MAX_RULES)return;
    const copy=normRule({name:r.name+'（写し）',seps:r.seps.map(s=>({...s}))},rules().length);
    copy.id='r'+Date.now();
    cache=rules().concat([copy]);save();
    ui.ruleId=copy.id;ui.deleting='';setCurrentId(copy.id);render();
   };
  });
  box.querySelectorAll('[data-del]').forEach(b=>{
   b.onclick=()=>{ui.deleting=b.dataset.del;render()};
  });
  box.querySelectorAll('[data-delno]').forEach(b=>{
   b.onclick=()=>{ui.deleting='';render()};
  });
  box.querySelectorAll('[data-delyes]').forEach(b=>{
   b.onclick=()=>{
    const id=b.dataset.delyes;
    cache=rules().filter(x=>x.id!==id);save();
    ui.deleting='';
    if(ui.ruleId===id){ui.ruleId=(cache[0]||{}).id||'';setCurrentId(ui.ruleId)}
    render();
   };
  });
  const addSep=box.querySelector('#iccAddSep');
  if(addSep&&rule)addSep.onclick=()=>{
   if(rule.seps.length>=MAX_SEPS)return;
   /* 初期値は**既にある最大の10倍**。同じ間隔を足しても今は両方が効く（②）ので
      間違いではないが、いちばん多い使い方は「ふだんの区切り＋たまに大きな区切り」
      なので、そこから始めれば直す手が少ない（**思い出させない**・§CLAUDE 画面基準）。 */
   const top=Math.max(...rule.seps.map(s=>s.every));
   rule.seps.push(normSep({kind:'nl',count:1,every:clampInt(top*10,2,MAX_EVERY)}));
   save();render();
  };
  box.querySelectorAll('[data-sepdel]').forEach(b=>{
   b.onclick=()=>{
    if(!rule||rule.seps.length<=1)return;
    rule.seps.splice(Number(b.dataset.sepdel),1);save();render();
   };
  });
  box.querySelectorAll('[data-sep-step]').forEach(b=>{
   b.onclick=()=>{
    if(!rule)return;
    const s=rule.seps[Number(b.dataset.i)];if(!s)return;
    const f=b.dataset.f,dir=Number(b.dataset.sepStep)||1;
    s[f]=clampInt(s[f]+dir,1,f==='every'?MAX_EVERY:MAX_COUNT);
    save();render();
   };
  });
  box.querySelectorAll('.icc-sep-row [data-f]').forEach(el=>{
   const i=Number(el.dataset.i),f=el.dataset.f;
   const apply=()=>{
    if(!rule)return;
    const s=rule.seps[i];if(!s)return;
    if(f==='kind'){s.kind=el.value;save();render();return}
    if(f==='text'){s.text=String(el.value||'').slice(0,MAX_TEXT);save();paintSample();return}
    s[f]=clampInt(el.value,1,f==='every'?MAX_EVERY:MAX_COUNT);
    save();paintSample();
   };
   if(el.tagName==='SELECT')el.onchange=apply;else el.oninput=apply;
   if(el.tagName!=='SELECT')el.onblur=()=>render();
  });
 }
 /* 見本だけ塗り直す（数を打っている最中に器ごと作り直すと、打っている欄が
    消えてカーソルが飛ぶ）。 */
 function paintSample(){
  const out=document.getElementById('iccSample');
  const rule=ruleNow()||sampleRule();
  if(!out||!rule)return;
  out.classList.toggle('is-marked',!!ui.marks);
  out.innerHTML=sampleHtml(sampleLots(),rule,ui.marks);
  const src=document.querySelector('#iccModal .icc-sample-src');
  if(src)src.textContent=sampleNote();
 }

 WL.lotCopy={rules,currentRule,joinLots,copyLots,menuItems,openSettings,PLAIN};
})();
