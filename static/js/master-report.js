"use strict";
/* master-report.js: マスタ管理の専用画面——帳票ブロックの見本と帳票レイアウトマスタ
   ============================================================
   §9.324 R3 で master-maint.js から切り出した（中身はそのまま）。
   ・帳票ブロックの「刷り上がりの見本」（§9.249 ③）・マトリクス配置（§9.245）・
     表は「ピボット」で組む（§9.277）・`bindFieldBuilders`
   ・帳票レイアウトマスタ（§9.254 ③）・紙から帳票ブロックマスタへ（§9.274）
   盤（master-maint.js）から `WL.mm` で受け取り、`registerSpecial` で名乗る。
   ============================================================ */
(function(){
 const {fbCatalog,hintHtml,maintState,mmFracText,mmSetHidden,openMaintEditor,openMasterMaint,requireMaintUser}=WL.mm;
 /* ================================================================
    帳票ブロックの「刷り上がりの見本」（§9.249 ③、利用者の指示）
    ----------------------------------------------------------------
    「もっとわかりやすく視覚化した形で表示を工夫し設定しやすいものを」

    幅「6マス」が紙の何割かは、**紙を見なければ分からない**。決めることの
    すぐ隣に紙の見本を置き、押した幅・高さ・列数・載せた項目がその場で
    形になるようにする。

    **見本は形だけ**——値は実際のロットで入る。そう書いておかないと、
    「見本に値が出ていない＝壊れている」と読まれる（§CLAUDE 6）。
    **紙の割り付けは`report-dashboard.js`が持つ**ので、ここでは寸法を
    決め打ちにせず、12マスという約束だけを借りる（幅の数字は同じ`span`）。
    ================================================================ */
 const RB_PAGE_ROWS=12;   // 紙の縦のマス数（report-dashboard.js の既定と同じ）
 function rbAsideHtml(){
  return `<aside class="rb-aside" aria-label="刷り上がりの見本">
    <div class="rb-aside-head">
     <b>刷り上がりの見本</b>
     <span class="rb-aside-tools">
      <button type="button" class="rb-tgl is-on" id="rbToggleOthers" aria-pressed="false"
        title="この設備のほかの塊も薄く重ねて、紙全体でどう見えるかを出します">紙全体で見る</button>
      <button type="button" class="rb-tgl is-on" id="rbToggleDummy" aria-pressed="true"
        title="値の場所にありそうなダミーを入れます。桁と文字数が実物に近いので、幅が足りるかを確かめられます">見本の値</button>
     </span>
    </div>
    <!-- **中身の見本**（§9.278、利用者の指示「帳票ブロックでの中身の作り込みが
         重要なのでダミーデータで中身の表示プレビューができるように」）。
         紙の中の場所（下の枠）は**大きさの既定**を決めるためのもので、実際の
         大きさは設備ごとの紙で決める。ここで確かめたいのは**中身の形**。 -->
    <div class="rb-preview" id="rbPreview" aria-label="中身の見本（見本のロット1件で描いています）">
     <div class="rb-preview-head">
      <b>中身の見本</b>
      <small id="rbPreviewNote">見本のロット1件で描いています（保存されません）</small>
     </div>
     <div class="rb-sec" id="rbSection"></div>
    </div>
    <div class="rb-paper" id="rbPaper" role="img" aria-label="紙の中のこの塊の位置と大きさ">
     <div class="rb-paper-grid" id="rbPaperGrid"></div>
     <div class="rb-paper-others" id="rbPaperOthers" hidden></div>
     <div class="rb-paper-block" id="rbPaperBlock"><b id="rbPaperName">この塊</b></div>
    </div>
    <p class="rb-spill" id="rbSpill" hidden></p>
    <!-- **どの紙に効くのかを画面に出す**（§9.274／§CLAUDE 6）。ここで決めるのは
         「既定」で、設備ごとの紙が上書きしている——それが読めないと、幅を変えても
         紙が変わらない理由が分からない（利用者の報告の半分がこれ）。 -->
    <p class="rb-where" id="rbWhere"></p>
    <p class="rb-aside-note" id="rbNote">${hintHtml('ここで決めるのは**大きさの既定**です。実際の大きさと置き場所は**設備ごとの紙**（帳票画面の「配置を組み換え」）で決めます。')}</p>
    <dl class="rb-facts">
     <dt>幅</dt><dd id="rbFactSpan">—</dd>
     <dt>高さ</dt><dd id="rbFactRows">—</dd>
     <dt>内訳</dt><dd id="rbFactCols">—</dd>
     <dt>繰り返し</dt><dd id="rbFactRepeat">—</dd>
    </dl>
   </aside>`;
 }
 /* ---------- ダミーの値（§9.250 ⑤、利用者の指示） ----------
    「データダミーをつかって、帳票の表示が最終的にどうなるか…すぐに確認
     できる導線を準備してください」

    **見本の値はサーバーが答える**（`field_catalog()`の`sample`）——道を
    1本足したときに見本も一緒に足すことになる（§9.163）。画面が道の綴りから
    推測すると、道が増えるたびに2箇所直すことになる。
    **知らない道でも空にしない**（空だと「見本が壊れている」と読まれる）。 */
 const rbSample=new Map();
 function rbNoteSamples(groups){
  (groups||[]).forEach(g=>(g.items||[]).forEach(it=>{
   if(it&&it.path)rbSample.set(String(it.path),String(it.sample==null?'':it.sample));
  }));
 }
 function rbSampleOf(path){
  const v=rbSample.get(String(path||''));
  return (v===undefined||v==='')?'（値）':v;
 }
 /* 行数の生の値。**空と`0`はどちらも「中身なり」**（§9.250 ④）。
    判定を1箇所に置く——散らすと、見本と札と一言で別々の答えが出る。 */
 function rbRowsRaw(form){
  const el=form&&form.querySelector('[data-field="rows"]');
  const v=String(el?(el.value||''):'').trim();
  return (v===''||v==='0')?'':v;
 }
 /* 見本を描き直す。**読むのは隠し欄の値だけ**——押した札の見た目ではなく
    保存される値を映す（見た目だけを写すと、保存と食い違う見本ができる）。 */
 function rbPaintPreview(form){
  const v=k=>{const el=form.querySelector(`[data-field="${CSS.escape(k)}"]`);return el?String(el.value||''):''};
  const grid=form.querySelector('#rbPaperGrid'),block=form.querySelector('#rbPaperBlock');
  if(!grid||!block)return;
  const span=Math.max(1,Math.min(12,Number(v('span'))||12));
  /* **`0`も「中身なり」**（§9.250 ④）。保存済みの塊は行数を`0`で持っている
     ものがあり、`rowsRaw?…`だけで見ると**文字の`'0'`は真**なので
     `Math.max(1,0)`＝1行として描いていた（「中身なり」の塊が紙の見本では
     1行に潰れていた）。空と0は同じ意味なので1箇所で揃える。 */
  const rowsRaw=rbRowsRaw(form);
  const rows=rowsRaw?Math.max(1,Math.min(RB_PAGE_ROWS,Number(rowsRaw))):3;
  const area=v('kindText')==='エリア（枠と文字）';
  if(!grid.childElementCount){
   grid.innerHTML=Array.from({length:12*RB_PAGE_ROWS},()=>'<i></i>').join('');
  }
  block.style.setProperty('--rb-span',String(span));
  block.style.setProperty('--rb-rows',String(rows));
  block.classList.toggle('is-auto',!rowsRaw);
  block.classList.toggle('is-area',area);
  const nm=form.querySelector('#rbPaperName');
  if(nm)nm.textContent=v('name')||'（名前を入れてください）';
  const setText=(id,text)=>{const el=form.querySelector(id);if(el)el.textContent=text};
  setText('#rbFactSpan',`${span} / 12 マス（${mmFracText(span,12)}）`);
  setText('#rbFactRows',rowsRaw?`${rowsRaw}行（固定）`:'中身なり（描いてから測ります）');
  /* **空欄でも「いま何列で出るか」を言う**（§CLAUDE 6）。`reportSection`の
     既定は2列なので、「中身の数から決まります」だけだと何列になるか読めない。 */
  const colsRaw=v('cols');
  /* 頭打ちは**欄の選択肢と同じ12**（§9.289）——ここが4のままだったのは、
     CSSに`.rp-grid-1`と`.rp-grid-4`しか無かった頃の名残り。 */
  const colsEff=Math.max(1,Math.min(12,Number(colsRaw)||2));
  setText('#rbFactCols',area?'—（エリアは値を出しません）'
    :(colsRaw?`${colsRaw}列`:`未指定（いまは${colsEff}列）`));
  setText('#rbFactRepeat',area?'—':(v('repeatText')==='分割後の子ロットごと'?'子ロットの数だけ':'1回だけ'));
  /* 節そのもの（§9.278、利用者の指示「帳票ブロックでの中身の作り込みが重要
     なのでダミーデータで中身の表示プレビューができるように」）。
     **紙を組むのは`report-dashboard.js`の1本**（§9.163）——ここに2つ目の
     組み立てを持つと、盤で確かめた形と刷り上がりが食い違う。実際そうなって
     いて、この見本は**子ロットの繰り返しも「全体」の行も統計の値も出せず**、
     大きさを見る以外の役に立っていなかった（利用者の報告）。
     材料は**見本のロット1件**（`sample_record`。§9.253と同じもの）。 */
  const sec=form.querySelector('#rbSection');
  if(!sec)return;
  const nameNow=v('name')||'（名前）';
  if(area){
   sec.className='rb-sec is-area';
   sec.innerHTML=(window.WL&&WL.reportStat&&WL.reportStat.areaHtml)
     ? WL.reportStat.areaHtml(v('text')||nameNow)
     : `<div class="rb-sec-head">${esc(nameNow)}</div>`;
   return;
  }
  const rowsData=fbParse(v('content'));
  sec.className='rb-sec';
  if(!rowsData.length){
   sec.innerHTML='<p class="rb-sec-empty">載せる項目がありません。'
    +'<b>画面がもともと持っている中身</b>のまま刷られます。</p>';
   return;
  }
  if(!(window.WL&&WL.reportStat&&WL.reportStat.sectionHtml)){
   /* **無ければ黙らない**（§CLAUDE「公開漏れは黙って素通しになる」）。 */
   console.error('WL.reportStat.sectionHtml が無いので中身の見本を描けません');
   sec.innerHTML='<p class="rb-sec-empty">中身の見本を描けませんでした。</p>';
   return;
  }
  /* **見本のロットは設備ごと**（§9.174。配置も統計もその設備のもの）。
     取りに行っているあいだは前の絵を残す——空にすると、欄を1文字直すたびに
     見本が消えて点滅する。 */
  const rec=rbSampleRecord(form,()=>rbPaintPreview(form));
  const blank={basic:{},settings:{},measurements:{},product:{rows:[]}};
  const src=rbState.dummy?(rec||blank):blank;
  const repeat=(v('repeatText')==='分割後の子ロットごと')?'子ロット':'';
  const dir=(v('repeatDirText')==='横に並べる')?'横':'';
  try{
   /* **紙と同じ幅で描いてから縮める**（§9.278）——器なりに描くと、器が
      紙の塊より狭いぶんだけ列が痩せ、**紙では折り返さないロット番号が
      見本だけ2行になる**（再現度がこの見本の値打ちなので、そこがずれると
      見る意味が無い）。幅は紙の実寸から出す（A4 210mm − 余白8mm×2 を
      96dpi換算＝`RB_PAPER_W`）ので、幅の札を押すとその場で変わる。 */
   sec.innerHTML='<div class="rb-sec-fit">'
    +WL.reportStat.sectionHtml(src,nameNow,rowsData,Number(v('cols'))||0,repeat,dir)
    +'</div>';
   rbFitPreview(sec,span);
  }catch(e){
   console.error('中身の見本を描けませんでした',e);
   sec.innerHTML='<p class="rb-sec-empty">中身の見本を描けませんでした。</p>';
  }
  const note=form.querySelector('#rbPreviewNote');
  if(note)note.textContent=rbState.dummy
    ?(rec?'見本のロット1件で描いています（保存されません）':'見本のロットを取り込んでいます…')
    :'値を入れずに枠だけ出しています（「見本の値」で入ります）';
 }
 /* 紙の塊の実寸（§9.278）。A4の210mmから四辺8mmの余白を引いた194mmを
    96dpi換算した値——紙を組む側（`.rp-page`）と同じ約束なので、ここで
    別の数を持たない。 */
 const RB_PAPER_W=Math.round(194/25.4*96);
 function rbFitPreview(sec,span){
  const fit=sec.querySelector('.rb-sec-fit');
  if(!fit)return;
  const w=Math.max(120,Math.round(RB_PAPER_W*Math.max(1,Math.min(12,span))/12));
  fit.style.setProperty('--rb-prev-w',w+'px');
  /* **測るのは描いたあと**（§9.221 ⑥）——`clientWidth`は組み直す前の幅を返す。
     入るときは少し大きく見せる（紙の文字は9px前後で、そのままでは読めない）。 */
  requestAnimationFrame(()=>{
   const host=sec.clientWidth-8;
   if(!host||!w)return;
   const k=Math.max(.5,Math.min(1.6,host/w));
   fit.style.setProperty('--rb-prev-scale',String(k));
   /* 縮めたぶん器の高さも詰める（`transform`は場所を取り続ける）。 */
   const inner=fit.firstElementChild;
   fit.style.height=inner?Math.ceil(inner.getBoundingClientRect().height)+'px':'';
  });
 }
 /* 見本のロット（§9.253）。**設備ごとに1回だけ取り、写しを持つ**——
    欄を1文字直すたびに往復すると、打っている最中に見本が止まる。
    **取れたら描き直す**（`again`）。**保存はしない**（画面のメモリだけ）。 */
 const rbSampleRec=new Map();
 function rbSampleRecord(form,again){
  const eq=rbPaperEq(form);
  if(rbSampleRec.has(eq))return rbSampleRec.get(eq);
  rbSampleRec.set(eq,null);
  api('/api/report-block-master/sample-record?equipment='+encodeURIComponent(eq))
   .then(r=>{rbSampleRec.set(eq,(r&&r.record)||null);if(again)again()})
   .catch(()=>{rbSampleRec.set(eq,null)});
  return null;

 }
 /* ---------- 紙全体で見る（§9.250 ⑤、利用者の指示） ----------
    「データダミーをつかって、帳票の表示が最終的にどうなるか…すぐに確認
     できる導線を準備してください」

    この塊だけを見ても、**紙のどこが空いているか・何ページ目に来るか**は
    分からない。同じ設備の塊を**表示順に流し込んで**紙を組み、
    **いま編集している塊はその流れの中で強調する**——除いて重ねると、
    自分の塊が実際に来る場所とは違う絵になる（見本の値打ちが消える）。

    **掴めることは変えない**（§4）——`#rbPaperBlock`（8方向のつまみを持つ）
    を、流れの中の自分の席へ**測って重ねる**。席の位置はブラウザの自動配置が
    決めるので、こちらで組み直さない（同じ並べ方を2つ持たない）。

    **紙からはみ出したものは「次の紙へ」と数える**（§CLAUDE 4・6）
    ——`.rb-paper`は`overflow:hidden`なので、黙って切ると「無い」と読まれる。 */
 /* いま編集している塊が「どの紙」に置かれるか。**対象設備の先頭**——
    紙は設備1つぶん（`report:<設備>`・§9.174）なので、複数設備を対象にした
    塊は代表の1枚で見せ、そのことを画面に書く。 */
 function rbPaperEq(form){
  const el=form.querySelector('[data-equipment-all="equipment"]');
  if(el&&el.checked)return '';                 /* すべての設備＝共通の紙で見る */
  const on=[...form.querySelectorAll('[data-equipment-field="equipment"]:checked')];
  return on.length?String(on[0].value||''):'';
 }
 /* 本物の紙を読む（§9.274）。**「紙全体で見る」は本物の紙で組む**
    ——以前はマスタの行だけを表示順に流していたので、**出していない塊まで
    並び、設備ごとに変えた幅も効かず**、刷り上がりとは別物だった
    （利用者の報告「紙レイアウトのところで見えているデータは変わりません」）。
    読めなければ今までどおりマスタの行で組む（fail-open）。 */
 async function rbLoadPaper(form){
  if(!(window.WL&&WL.reportLayout&&WL.reportLayout.info))return null;
  const eq=rbPaperEq(form);
  if(rbState.paperFor===eq&&rbState.paper)return rbState.paper;
  try{
   const info=await WL.reportLayout.info(eq);
   rbState.paper=info;rbState.paperFor=eq;
   return info;
  }catch(e){rbState.paper=null;rbState.paperFor=null;return null}
 }
 /* 塊が「いまその紙に置かれているか」を文字で出す（§CLAUDE 3・§2）。
    **置かれていなければ、置く場所まで言う**——ここで幅を決めても紙に出ない、
    という食い違いがいちばん分かりにくい。 */
 function rbPaintWhere(form){
  const el=form.querySelector('#rbWhere');if(!el)return;
  const v=k=>{const x=form.querySelector(`[data-field="${CSS.escape(k)}"]`);return x?String(x.value||''):''};
  const me=String(v('name')||(maintState.editing&&maintState.editing.name)||'').trim();
  const info=rbState.paper;
  const eqName=rbState.paperFor?`「${rbState.paperFor}」`:'共通（設備の分からないロット）';
  if(!info){
   el.innerHTML=`<b>紙での見え方</b>この塊の<b>幅と高さはここが既定</b>で、`
    +`<b>実際の大きさは設備ごとの紙</b>が持ちます`
    +`（帳票レイアウトマスタ、または帳票画面の「配置を組み換え」で決めます）。`;
   return;
  }
  const hit=(info.blocks||[]).find(x=>x.key===me);
  if(!hit){
   el.innerHTML=`<b>紙での見え方</b>${esc(eqName)}の紙には<b>まだ置かれていません</b>。`
    +`保存したあと、<b>帳票レイアウト</b>（またはこの塊のある帳票の「配置を組み換え」）で`
    +`「出す」にすると紙に出ます。`;
   return;
  }
  el.innerHTML=`<b>紙での見え方</b>${esc(eqName)}の紙に`
   +(hit.shown?`<b>出しています</b>`:`<b>置いてありますが出していません</b>`)
   +`（幅 ${hit.span}/${info.grid} マス・高さ ${hit.rows?hit.rows+'段':'中身なり'}）。`
   +(hit.span!==hit.defSpan||hit.rows!==hit.defRows
     ?`<i>この紙では既定（幅 ${hit.defSpan}・高さ ${hit.defRows||'中身なり'}）と違う値が効いています。</i>`
     :`<i>いまは下の既定がそのまま効いています。</i>`);
 }
 /* ---------- 紙全体で見る（§9.250 ⑤、利用者の指示） ----------
    「データダミーをつかって、帳票の表示が最終的にどうなるか…すぐに確認
     できる導線を準備してください」

    この塊だけを見ても、**紙のどこが空いているか・何ページ目に来るか**は
    分からない。同じ設備の塊を**表示順に流し込んで**紙を組み、
    **いま編集している塊はその流れの中で強調する**——除いて重ねると、
    自分の塊が実際に来る場所とは違う絵になる（見本の値打ちが消える）。

    **掴めることは変えない**（§4）——`#rbPaperBlock`（8方向のつまみを持つ）
    を、流れの中の自分の席へ**測って重ねる**。席の位置はブラウザの自動配置が
    決めるので、こちらで組み直さない（同じ並べ方を2つ持たない）。

    **紙からはみ出したものは「次の紙へ」と数える**（§CLAUDE 4・6）
    ——`.rb-paper`は`overflow:hidden`なので、黙って切ると「無い」と読まれる。 */
 function rbPaintOthers(form){
  const layer=form.querySelector('#rbPaperOthers');
  const block=form.querySelector('#rbPaperBlock');
  const note=form.querySelector('#rbSpill');
  if(!layer||!block)return;
  if(!rbState.others){
   layer.hidden=true;layer.innerHTML='';
   block.classList.remove('is-placed');
   block.style.left=block.style.top=block.style.width=block.style.height='';
   if(note){note.hidden=true;note.textContent=''}
   return;
  }
  const v=k=>{const el=form.querySelector(`[data-field="${CSS.escape(k)}"]`);return el?String(el.value||''):''};
  const me=String(v('name')||maintState.editing&&maintState.editing.name||'');
  const eq=v('equipment');
  const eqFirst=eq.split(/[,、]/)[0].trim();
  const meSpan=Math.max(1,Math.min(12,Number(v('span'))||12));
  const meRows=(()=>{const r=rbRowsRaw(form);return r?Math.max(1,Math.min(RB_PAGE_ROWS,Number(r))):3})();
  let list=null;
  const info=rbState.paper;
  /* **本物の紙で組むのは、この塊がその紙に置かれているときだけ**（§9.274）。
     まだ置かれていない塊（＝新規作成中や、紙へ出していない塊）は**紙の上に
     席が無い**ので、本物の流れへ混ぜると必ず末尾＝次の紙へ回る位置になり、
     8方向のつまみが紙の外へ出て掴めなくなる（§9.250 ④の機能がそこだけ
     失われる）。置かれていないことは`#rbWhere`が文字で言う（§CLAUDE 4）ので、
     見本は今までどおり表示順の流れで「だいたいこの大きさ」を見せる。 */
  const onPaper=!!(info&&Array.isArray(info.blocks)
    &&info.blocks.some(x=>x.key===me&&x.shown));
  if(onPaper){
   /* **本物の紙**（`report:<設備>`）。出している塊だけを、効いている幅と
      高さで並べる。マス数は紙の割り（12/24/…）なので、見本の12マスへ
      **比で直す**（見本は12マス固定・§9.249 ③）。 */
   const toSpan=n=>Math.max(1,Math.min(12,Math.round(Number(n||1)*12/(info.grid||12))));
   const toRows=n=>Math.max(1,Math.min(RB_PAGE_ROWS,
     Math.round(Number(n||0)*RB_PAGE_ROWS/(info.pageRows||RB_PAGE_ROWS))))||2;
   /* **編集している塊は流れの中の自分の席に置く**——末尾へ足すと、紙が
      埋まっている設備では必ず最後（＝次の紙へ回る側）に見えて、
      「自分の塊が実際に来る場所」という見本の値打ちが消える。
      幅と高さだけは**いま欄に入っている値**で描く（触った結果が出る）。 */
   let placed=false;
   list=info.blocks.filter(x=>x.shown).map(x=>{
    if(x.key===me){placed=true;return {name:me,span:meSpan,rows:meRows,me:true}}
    return {name:String(x.label||x.key||''),span:toSpan(x.span),
            rows:x.rows?toRows(x.rows):2,me:false};
   });
   /* `onPaper`で絞ってあるので必ず席がある。念のため（設定が入れ替わる
      隙で消えていたら）末尾へ置く。 */
   if(!placed)list.push({name:me||'この塊',span:meSpan,rows:meRows,me:true});
  }else{
   /* 読めなかったとき、またはまだ紙に置いていない塊（fail-open）。
      マスタの行を表示順に流す。 */
   const fits=x=>{
    if(String(x.enabledText||'')==='無効')return false;
    const t=String(x.equipment||'').trim();
    if(!eq||eq==='*'||t==='*'||!t)return true;
    return t.split(/[,、]/).map(y=>y.trim()).includes(eqFirst);
   };
   list=(rbState.blocks||[]).filter(x=>String(x.name||'')!==me).filter(fits)
     .map(x=>({name:String(x.name||''),order:Number(x.order)||0,
       span:Math.max(1,Math.min(12,Number(x.span)||12)),
       rows:Math.max(1,Math.min(RB_PAGE_ROWS,Number(x.rows)||2)),me:false}));
   list.push({name:me||'この塊',order:Number(v('order'))||0,span:meSpan,rows:meRows,me:true});
   list.sort((a,b)=>(a.order-b.order)||a.name.localeCompare(b.name,'ja'));
  }
  layer.hidden=false;
  layer.innerHTML=list.map(x=>
   `<i style="--rb-span:${x.span};--rb-rows:${x.rows}"${x.me?' data-me="1" class="is-me"':''}`
   +` title="${esc(x.name)}"><b>${esc(x.name)}</b></i>`).join('');
  /* 席へ重ねるのは**描いたあと**（自動配置の結果を測る）。 */
  requestAnimationFrame(()=>{
   const slot=layer.querySelector('[data-me]');
   const paper=form.querySelector('#rbPaper');
   if(!slot||!paper)return;
   const pr=paper.getBoundingClientRect(),sr=slot.getBoundingClientRect();
   if(!(sr.height>0))return;
   block.classList.add('is-placed');
   block.style.left=Math.round(sr.left-pr.left)+'px';
   block.style.top=Math.round(sr.top-pr.top)+'px';
   block.style.width=Math.round(sr.width)+'px';
   block.style.height=Math.round(sr.height)+'px';
   /* 紙に載りきらなかった塊を数える。**「無い」ではなく「次の紙へ」**。 */
   if(note){
    const lr=layer.getBoundingClientRect();
    const over=[...layer.children].filter(el=>el.getBoundingClientRect().bottom>lr.bottom+1);
    note.hidden=!over.length;
    note.textContent=over.length?`この紙に載りきらないもの ${over.length}件（次の紙へ回ります）`:'';
   }
  });
 }
 /* ---------- 紙の見本を掴んで大きさを変える（§9.250 ④、利用者の指示） ----------
    「幅と高さの指定をさせる部分だが、刷り上がりの見本という視覚表示があるので
     これを**四方のどこからでもドラッグアンドドロップで大きさの変更**が
     できるようにするだけで大きさの指定を直感的に行うことができるように
     なります」

    つまみは**8方向**（四辺＋四隅）。**JSが差し込む**——HTMLへ8個書かせると、
    書き漏らした窓だけ端を掴めなくなる（`WL.makeFloatingWindow`と同じ作法）。
    **マスに吸い付かせる**（1マス＝紙の1/12）——中途半端な幅は保存できない
    ので、掴んでいる最中だけ滑らかに動いても意味が無い。
    **値は隠し欄へ書く**（`mmSetHidden`）ので、札の押した印も紙の見本も
    ③の欄も同じ`change`で追随する（見た目だけ変えると保存と食い違う）。 */
 const RB_GRIPS=['n','e','s','w','ne','nw','se','sw'];
 function rbBindPaperDrag(form){
  const block=form.querySelector('#rbPaperBlock'),grid=form.querySelector('#rbPaperGrid');
  if(!block||!grid||block.dataset.rbDrag)return;
  block.dataset.rbDrag='1';
  block.insertAdjacentHTML('beforeend',RB_GRIPS.map(h=>
   `<i class="rb-grip rb-grip-${h}" data-rb-grip="${h}" role="slider" tabindex="0"`
   +` aria-label="大きさを変える（${h.length>1?'角':'辺'}）"></i>`).join(''));
  block.querySelectorAll('[data-rb-grip]').forEach(g=>{
   g.onpointerdown=ev=>{
    ev.preventDefault();ev.stopPropagation();
    const dir=g.dataset.rbGrip;
    const gr=grid.getBoundingClientRect();
    const cw=gr.width/12,ch=gr.height/RB_PAGE_ROWS;
    if(!(cw>0&&ch>0))return;
    const spanEl=form.querySelector('[data-field="span"]');
    const span0=Math.max(1,Math.min(12,Number(spanEl&&spanEl.value)||12));
    const rowsRaw0=rbRowsRaw(form);
    const rows0=rowsRaw0?Math.max(1,Math.min(RB_PAGE_ROWS,Number(rowsRaw0))):3;
    /* **選べる幅・高さへ吸い付かせる**（§9.250 ④）。紙の幅は5段
       （1/4・1/3・1/2・2/3・全幅）しか無く、サーバーの`normalize_span()`が
       いちばん近い段へ丸める——掴んで5マスにできてしまうと、**見本は5マス
       なのに保存は4マス**になり、見本が嘘をつく（§CLAUDE 6）。
       **選べる値は「− 数 ＋」の器が持つ**（§9.311 D/E。`data-allow`）ので、
       マスタ側で段を増減しても付いてくる（一覧を書き写さない）。 */
    const allowList=key=>{
     const el=form.querySelector(`.mm-step[data-step-field="${CSS.escape(key)}"]`);
     const vs=String((el&&el.dataset.allow)||'').split(',').map(Number)
       .filter(n=>Number.isFinite(n)&&n>0);
     return [...new Set(vs)].sort((a,b)=>a-b);
    };
    const spanAllow=allowList('span');
    const rowsAllow=allowList('rows');
    const snap=(n,list)=>{
     if(!list.length)return n;
     return list.reduce((best,x)=>Math.abs(x-n)<Math.abs(best-n)?x:best,list[0]);
    };
    const x0=ev.clientX,y0=ev.clientY;
    let lastSpan=span0,lastRows=rows0;
    g.setPointerCapture&&g.setPointerCapture(ev.pointerId);
    block.classList.add('is-grabbing');
    const move=m=>{
     if(dir.indexOf('e')>=0||dir.indexOf('w')>=0){
      const d=Math.round((m.clientX-x0)/cw)*(dir.indexOf('w')>=0?-1:1);
      const v=snap(Math.max(1,Math.min(12,span0+d)),spanAllow);
      if(v!==lastSpan){lastSpan=v;mmSetHidden(form,'span',String(v))}
     }
     if(dir.indexOf('s')>=0||dir.indexOf('n')>=0){
      const d=Math.round((m.clientY-y0)/ch)*(dir.indexOf('n')>=0?-1:1);
      const v=snap(Math.max(1,Math.min(RB_PAGE_ROWS,rows0+d)),rowsAllow);
      if(v!==lastRows){lastRows=v;mmSetHidden(form,'rows',String(v))}
     }
    };
    const up=()=>{
     block.classList.remove('is-grabbing');
     document.removeEventListener('pointermove',move,true);
     document.removeEventListener('pointerup',up,true);
    };
    document.addEventListener('pointermove',move,true);
    document.addEventListener('pointerup',up,true);
   };
   /* **キーボードでも変えられること**（掴めるのに辿れない部品を作らない）。
      1回で**選べる段を1つ**進む——ドラッグと同じ値しか作らない。 */
   g.onkeydown=e=>{
    const dir=g.dataset.rbGrip;
    const wide=dir.indexOf('e')>=0||dir.indexOf('w')>=0;
    const tall=dir.indexOf('s')>=0||dir.indexOf('n')>=0;
    let d=0;
    if(e.key==='ArrowRight'||e.key==='ArrowUp')d=1;
    else if(e.key==='ArrowLeft'||e.key==='ArrowDown')d=-1;
    else return;
    e.preventDefault();
    const stepIn=(key,cur)=>{
     const el=form.querySelector(`.mm-step[data-step-field="${CSS.escape(key)}"]`);
     const vs=[...new Set(String((el&&el.dataset.allow)||'').split(',').map(Number)
       .filter(n=>Number.isFinite(n)&&n>0))].sort((a,b)=>a-b);
     if(!vs.length)return cur+d;
     let i=vs.indexOf(cur);
     if(i<0)i=vs.reduce((bi,x,k)=>Math.abs(x-cur)<Math.abs(vs[bi]-cur)?k:bi,0);
     return vs[Math.max(0,Math.min(vs.length-1,i+d))];
    };
    if(wide){
     const el=form.querySelector('[data-field="span"]');
     mmSetHidden(form,'span',String(stepIn('span',
       Math.max(1,Math.min(12,Number(el&&el.value)||12)))));
    }
    if(tall){
     const raw=rbRowsRaw(form);
     mmSetHidden(form,'rows',String(stepIn('rows',raw?Number(raw):3)));
    }
   };
  });
 }
 /* 配線。**打っている最中も追う**（`input`）——名前を打つたびに紙の見本の
    題が変わるので、どの塊を触っているのかを見失わない。 */
 const rbState={dummy:true,others:false,blocks:[]};
 function rbBindAside(form){
  const paint=()=>{rbPaintPreview(form);rbPaintOthers(form);rbPaintWhere(form)};
  rbBindPaperDrag(form);
  const tglDummy=form.querySelector('#rbToggleDummy');
  if(tglDummy&&!tglDummy.dataset.wired){
   tglDummy.dataset.wired='1';
   tglDummy.onclick=e=>{
    e.preventDefault();
    rbState.dummy=!rbState.dummy;
    tglDummy.classList.toggle('is-on',rbState.dummy);
    tglDummy.setAttribute('aria-pressed',rbState.dummy?'true':'false');
    paint();
   };
  }
  const tglOthers=form.querySelector('#rbToggleOthers');
  if(tglOthers&&!tglOthers.dataset.wired){
   tglOthers.dataset.wired='1';
   tglOthers.onclick=async e=>{
    e.preventDefault();
    rbState.others=!rbState.others;
    tglOthers.classList.toggle('is-on',rbState.others);
    tglOthers.setAttribute('aria-pressed',rbState.others?'true':'false');
    /* **重ねるものは開いたときに取る**（窓を開くたびに引くと、紙全体を
       見ない人まで往復が1本増える）。**本物の紙が読めればそちら**
       （§9.274）——マスタの行だけで組むと、出していない塊まで並び、
       設備ごとに変えた幅も効かない絵になる。 */
    if(rbState.others){
     await rbLoadPaper(form);
     /* **マスタの行も必ず持っておく**——まだ紙に置いていない塊は本物の紙で
        組めないので、そのときはこちらを流す（`rbPaintOthers`の後半）。
        `rbState.paper`が読めたかどうかで取り分けると、**新規作成中だけ
        顔ぶれが1件になる**（実際に踏んだ）。写しは保存・削除のたびに
        `forgetReportCaches()`が捨てるので、古い顔ぶれは残らない。 */
     if(!rbState.blocks.length){
      try{const r=await api('/api/report-block-master');rbState.blocks=r.items||[]}
      catch(_){rbState.blocks=[]}
     }
    }
    paint();
   };
  }
  /* 見本の値は候補と一緒に届く（§9.250 ⑤）。**届いたら塗り直すこと**
     ——投げっぱなしにすると、②のタブを開くまで値の場所が「（値）」のまま
     残る（§9.234 ⑧と同じ罠）。**失敗しても黙って進む**（値が「（値）」に
     なるだけで、設定そのものは触れる）。 */
  fbLoadCatalog().then(()=>paint()).catch(()=>{});
  /* **この塊がどの紙に置かれているか**は開いた時点で読む（§9.274）——
     読めなくても窓は使える（fail-open）。 */
  rbLoadPaper(form).then(()=>paint()).catch(()=>{});
  if(form.dataset.rbWired==='1'){paint();return}
  form.dataset.rbWired='1';
  form.addEventListener('change',paint);
  form.addEventListener('input',paint);
  requestAnimationFrame(paint);
 }

 /* ---------- 帳票まわりの写しを捨てる（§9.274、利用者の報告） ----------
    「帳票ブロックマスタをいじっても、帳票の紙レイアウトのところで見えている
     データ、プレビューのデータは変わりません」

    写しは3つある——紙の側（`WL.reportBlocks`）・候補の一覧（`fbCatalog`）・
    「紙全体で見る」の顔ぶれ（`rbState.blocks`）。**捨てるのは1箇所**
    （§9.163）——**別々に捨てると必ず捨て漏れる**（実際、候補の一覧と
    紙全体で見るは一度も捨てていなかったので、操業データの項目を足しても
    候補に出ず、塊を足しても紙の見本に出なかった）。 */
 function forgetReportCaches(){
  if(window.WL&&WL.reportBlocks&&typeof WL.reportBlocks.forget==='function')WL.reportBlocks.forget();
  fbCatalog.groups=[];fbCatalog.loadedFor=null;fbCatalog.loading=null;fbCatalog.vocab=null;
  rbState.blocks=[];rbState.paper=null;rbState.paperFor=null;
 }
 async function fbLoadCatalog(){
  const eq=String(maintState.equipment||'');
  if(fbCatalog.loadedFor===eq)return fbCatalog.groups;
  if(fbCatalog.loading)return fbCatalog.loading;
  fbCatalog.loading=(async()=>{
   try{
    const r=await api('/api/report-block-master'+(eq?'?equipment='+encodeURIComponent(eq):''));
    fbCatalog.groups=Array.isArray(r.catalog)?r.catalog:[];
    /* **語彙はサーバーが答える**（§9.163）——種別・寄せ・書式の呼び名を
       画面へ写すと、選べる書式を1つ足すたびに2箇所直すことになる。 */
    fbCatalog.vocab={cellKinds:r.cellKinds||null,aligns:r.aligns||null,
                     formatKinds:r.formatKinds||null,datePatterns:r.datePatterns||null,
                     /* 表に組むときの軸と列数の上限（§9.277）。 */
                     pivotAxes:Array.isArray(r.pivotAxes)?r.pivotAxes:null,
                     axisLot:r.axisLot||null,colsMax:r.contentColsMax||null,
                     /* 既定の中身を写すための並び（§9.285 ②）。**塊ごと**に
                        「保存形の文字列」と「列数」が入る。 */
                     defaultCells:(r.defaultCells&&typeof r.defaultCells==='object')
                       ?r.defaultCells:null};
    /* 見本の値は**候補と一緒に届く**（§9.250 ⑤）。別の口で取りに行くと、
       候補にあるのに見本の値だけ無い道が作れる。 */
    rbNoteSamples(fbCatalog.groups);
   }catch(e){fbCatalog.groups=[]}
   fbCatalog.loadedFor=eq;fbCatalog.loading=null;
   return fbCatalog.groups;
  })();
  return fbCatalog.loading;
 }
 /* `[内容]`の文字列 ⇄ 行の配列。**読み方はサーバー（`parse_content`）と
    同じ約束**——`=`が無い行はラベルと道が同じ。 */
 /* ---------- マトリクス配置（§9.245、利用者の指示） ----------
    「ブロックごとにデータの配置をどのようなマトリクスに並べるか視覚的に
     調整できる機能が欲しいです」

    **保存の形は`ラベル=出どころ`のまま**（§9.226 ⑥）で、後ろに`|`で
    **横に使うマス数**を足す。`|`の無い行は今までどおり1マス——既に登録して
    ある塊はそのまま読める。空きマスは**道もラベルも持たない行**（`|1`）。
    区切りに`,`と`、`を使っているので、マス数の区切りは`|`にしてある。
    **読み方はサーバー（`parse_content`）と同じにすること**——2通りあると、
    設定画面で組んだ形と紙が食い違う。 */
 const FB_SPAN_MAX=12;
 /* 内訳の列数（§9.255 ②／§9.277）。**サーバーが受ける上限に合わせる**
    ——ここだけ小さいと、盤で選べない列数を紙が受け入れることになる。
    §9.277で12まで（紙の`reportSection`が受ける数）——ピボットに組むと
    「1＋項目×集計」で簡単に6を超えるので、6のままだと**組んだ表が保存で
    黙って丸められて**いた。**上限そのものはサーバーが答える**
    （`fbVocab().colsMax`）ので、ここは届く前の受け皿。
    縦のマス数は器の高さで決まるので、選ばせるのは4段まで（それ以上は
    塊の高さのほうを③で決める話になる・§CLAUDE 11）。 */
 const FB_COLS_MAX=12,FB_COL_CHOICES=[1,2,3,4,5,6,7,8,9,10,11,12],FB_ROWS_MAX=4;
 function fbSpan(v,max){
  const n=Math.floor(Number(v));
  return Number.isFinite(n)?Math.max(1,Math.min(max||FB_SPAN_MAX,n)):1;
 }
 /* ---------- 縦のマス数（§9.255 ②、利用者の指示） ----------
    「『紙での並び』の部分は単純に何列何行だけでなく、データ内もグリッドに
     対応する形で細かく調整できるようにしてください」

    後置きを`<横>`から`<横>x<縦>`へ広げた。**`x`が無ければ縦1**なので、
    既に登録してある塊（`|2`だけ）はそのまま読める。読み方はサーバーの
    `parse_content`と**同じ約束**にすること（2通りあると、設定画面で組んだ
    形と紙が食い違う・§9.245）。 */
 /* ---------- 1つのマス（セル）が持つもの（§9.274、利用者の指示） ----------
    「縦にも項目を並べて、横も共通軸で並べたりすることでマトリクスも整形
     できるようにしたいです」「配置したデータの書式変更もできるように」

    種別は3つ（値／見出し／空き）。**見出し＝値を持たず文字だけ出すマス**で、
    これが無いと共通の軸を持つ表が組めない。共通の軸で並べたときはラベルが
    見出しと二重になるので、**ラベルを出さない**も要る。

    **読み方はサーバー（`report_block_repo.parse_content`／`dump_content`）と
    同じ約束にすること**——2通りあると、盤で組んだ形と紙が食い違う（§9.245）。
    突き合わせは`tests/fixtures/report_cells.json`で両方を同じ例に通す。 */
 const FB_KIND_VALUE='value',FB_KIND_HEAD='head',FB_KIND_BLANK='blank';
 /* 語彙（呼び名・選べる書式）は**サーバーが答える**（§9.163）。届く前でも
    盤は開けるので、綴りだけをここに持ち、**呼び名は持たない**。 */
 /* ---------- マスの高さは実測して決める（§9.303 ②） ----------
    利用者の報告「表を組み、多段になってくると、調整用のブロックが重なったり
    して乱れる」。盤のマスの下段（出どころ＋横N・縦M のつまみ）は列数が増える
    と折り返すが、**グリッドの行高はその折り返しを見込まない**——
    `grid-auto-rows:minmax(3.4em,auto)`の`auto`（max-content）は
    **「折り返さない前提」**で高さを見積もるので、実際に列幅へ置いて折り返した
    ぶんは行に入らず、**中身がマスの枠から溢れて下のマスへ重なる**
    （実測: 中身83px／マスの内寸75px）。1マスぶんに要る高さを測って
    `--fb-cell-h`へ入れる。

    **測る前に前の値を外すこと**（§9.210 ④・§9.217の罠）——付いたまま測ると、
    一度伸びた高さが二度と縮まない。
    **器の高さ（stretchされた箱）ではなく中身を測ること**——マスはトラックの
    高さまで引き伸ばされるので、`clientHeight`から測ると「いま与えられている
    高さ」を測り直すだけになり、縮む方向へ動かない。 */
 function fbFitCellHeight(wrap){
  if(!wrap||!wrap.classList.contains('is-matrix'))return;
  wrap.style.removeProperty('--fb-cell-h');
  const rows=[...wrap.querySelectorAll('.fb-row')];
  if(!rows.length)return;
  const gapY=parseFloat(getComputedStyle(wrap).rowGap)||0;
  let need=0;
  rows.forEach(el=>{
   /* 縦Nマスの札は N 行ぶん＋そのあいだの隙間を使うので、1マスぶんへ均す。 */
   const tall=Math.max(1,Number((/span\s+(\d+)/.exec(el.style.gridRow||'')||[])[1])||1);
   const inner=[...el.children].reduce((h,c)=>{
    const cm=getComputedStyle(c);
    return h+c.getBoundingClientRect().height
           +(parseFloat(cm.marginTop)||0)+(parseFloat(cm.marginBottom)||0);
   },0);
   const cs=getComputedStyle(el);
   const box=inner+(parseFloat(cs.paddingTop)||0)+(parseFloat(cs.paddingBottom)||0)
             +(parseFloat(cs.borderTopWidth)||0)+(parseFloat(cs.borderBottomWidth)||0);
   const one=(box-(tall-1)*gapY)/tall;
   if(one>need)need=one;
  });
  /* 端数の切り上げぶんだけ余分に取る（0.5pxの差でも溢れると重なって見える）。 */
  if(need>0)wrap.style.setProperty('--fb-cell-h',(Math.ceil(need)+1)+'px');
 }
 /* 窓の大きさが変わると列幅＝折り返しの回数が変わるので測り直す（§9.130）。
    **見張りは1つだけ**——描き直すたびに付けると器の数だけ積み上がる。 */
 function fbWatchCellHeight(wrap){
  if(!wrap||wrap.__fbRo||typeof ResizeObserver!=='function')return;
  let busy=false;
  wrap.__fbRo=new ResizeObserver(()=>{
   if(busy)return;                       /* 自分が高さを変えたぶんで回らない */
   busy=true;
   requestAnimationFrame(()=>{try{fbFitCellHeight(wrap)}finally{busy=false}});
  });
  try{wrap.__fbRo.observe(wrap)}catch(e){}
 }
 function fbCell(o){
  const x=o||{};
  let kind=String(x.kind||'').trim();
  if(kind!==FB_KIND_HEAD&&kind!==FB_KIND_BLANK)kind=x.blank?FB_KIND_BLANK:FB_KIND_VALUE;
  let label=String(x.label==null?'':x.label).trim();
  let path=String(x.path==null?'':x.path).trim();
  if(kind===FB_KIND_HEAD)path='';
  else if(kind===FB_KIND_BLANK){label='';path=''}
  else if(!path){kind=FB_KIND_BLANK;label=''}
  return {label,path,blank:kind===FB_KIND_BLANK,
          span:fbSpan(x.span),rows:fbSpan(x.rows,FB_SPAN_MAX),kind,
          showLabel:kind===FB_KIND_VALUE?(x.showLabel!==false):false,
          /* ラベルを**値の上**へ置く（§9.292 ⑤、利用者の指示「上下にラベルと
             内容が組み合わさるパターンでレイアウトできるように」）。
             ラベルを出さないマス・見出し・空きでは意味を持たないので落とす
             ——**サーバーと同じ落とし方**にすること（片方だけが持つと、
             盤の見本と紙が食い違う）。 */
          stack:kind===FB_KIND_VALUE&&x.showLabel!==false&&!!x.stack,
          align:fbAlign(x.align),format:fbFormat(x.format),
          /* **対象（子ロット）の軸のマス**（§9.277）。印の付いた並びだけを
             紙が**1つの表の中で**子ロットの数だけ複製する——子ロットの数は
             レコードごとに違うので、設計のときは1つぶんの型だけを置く。 */
          lot:!!x.lot};
 }
 const FB_ALIGNS=['','left','center','right'];
 const fbAlign=v=>FB_ALIGNS.indexOf(String(v||''))>=0?String(v||''):'';
 const FB_DECIMAL_MAX=6;
 /* 書式の綴りは`WL.cellFormat`（`base.js`）と同じ——値を整えるのはあの1箇所で、
    ここが持つのは「何を保存するか」だけ（2つ目の整形器を作らない）。 */
 function fbFormat(spec){
  if(!spec||typeof spec!=='object')return null;
  const kind=String(spec.kind||'').trim();
  if(['number','datetime','text'].indexOf(kind)<0)return null;
  const pre=String(spec.prefix||'').slice(0,16),suf=String(spec.suffix||'').slice(0,16);
  let out;
  if(kind==='number'){
   let dec=spec.decimals;
   if(dec===''||dec==null||!Number.isFinite(Number(dec)))dec=null;
   else dec=Math.max(0,Math.min(FB_DECIMAL_MAX,Math.floor(Number(dec))));
   out={kind:'number',decimals:dec,thousands:!!spec.thousands};
  }else if(kind==='datetime'){
   out={kind:'datetime',pattern:String(spec.pattern||'').slice(0,40)||'yyyy/MM/dd'};
  }else out={kind:'text'};
  if(pre)out.prefix=pre;
  if(suf)out.suffix=suf;
  /* **既定だけの指定は持たない**——「そのまま」と同じ意味の指定を保存すると、
     何も変えていない塊まで保存のたびに形が変わる。 */
  if(kind==='text'&&!pre&&!suf)return null;
  return out;
 }
 /* 行の形（`ラベル=道|横x縦`）では書けないマスか。 */
 const fbRich=c=>c.kind===FB_KIND_HEAD||(c.kind===FB_KIND_VALUE&&!c.showLabel)
   ||!!c.align||!!c.format||!!c.lot||!!c.stack;
 function fbParse(text){
  const s=String(text==null?'':text).trim();
  /* **JSONは`[`で始まるかどうかだけで見分ける**（サーバーと同じ約束）。
     壊れたJSONは行の形として読み直す——黙って空にしない。 */
  if(s.charAt(0)==='['){
   let data=null;
   try{data=JSON.parse(s)}catch(e){data=null}
   if(Array.isArray(data))return data.filter(x=>x&&typeof x==='object').map(fbCell);
  }
  return String(text||'').replace(/、/g,',').replace(/\r/g,'\n').replace(/,/g,'\n')
   .split('\n').map(x=>x.trim()).filter(Boolean).map(line=>{
    let s=line,span=1,rows=1;
    const b=s.indexOf('|');
    if(b>=0){
     const tail=s.slice(b+1).trim().toLowerCase();
     const x=tail.indexOf('x');
     span=fbSpan((x>=0?tail.slice(0,x):tail).trim()||1);
     rows=x>=0?fbSpan(tail.slice(x+1).trim()||1):1;
     s=s.slice(0,b).trim();
    }
    const i=s.indexOf('=');
    const label=i>=0?s.slice(0,i).trim():s;
    const path=i>=0?s.slice(i+1).trim():s;
    /* 空きマスは落とさない——場所を取ることが役目なので、消すと詰まる。 */
    if(!path)return fbCell({kind:FB_KIND_BLANK,span,rows});
    return fbCell({label:label||path,path,span,rows});
   });
 }
 function fbText(rows){
  /* **1マスの項目は今までどおりの1行で書く**（`|1`を足さない）——書き足すと、
     何も変えていない塊まで保存のたびに形が変わる。
     縦も1なら`x`を足さない（同じ理由）。
     **新しい持ちもの（見出し・ラベルを出さない・寄せ・書式）を1つでも
     使っているときだけJSONへ切り替える**（§9.274）——こうすると、触って
     いない塊の保存値は1バイトも変わらない。 */
  const cells=(rows||[]).map(fbCell);
  if(!cells.length)return '';
  if(cells.some(fbRich)){
   return JSON.stringify(cells.map(c=>({label:c.label,path:c.path,span:c.span,rows:c.rows,
     kind:c.kind,showLabel:c.showLabel,stack:c.stack,align:c.align,format:c.format,lot:c.lot})));
  }
  return cells.map(r=>{
   const sp=fbSpan(r.span),tall=fbSpan(r.rows);
   const size=(tall>1?sp+'x'+tall:(sp>1?String(sp):''));
   if(r.blank)return '|'+(size||'1');
   return `${r.label||r.path}=${r.path}`+(size?'|'+size:'');
  }).join('\n');
 }
 /* 効いている書式を**文字で出す**（§9.285 ③／§CLAUDE 3）。1マスずつ押して
    確かめないと、どのマスに書式が付いているのか分からない——「設定したのに
    効いていない」と読まれる原因になる。 */
 function fbFmtLabel(f){
  if(!f||!f.kind)return '';
  const bits=[];
  if(f.kind==='number'){
   bits.push(f.decimals==null?'数値':`小数${f.decimals}桁`);
   if(f.thousands)bits.push('3桁区切り');
  }else if(f.kind==='datetime')bits.push(f.pattern||'yyyy/MM/dd');
  else bits.push('文字');
  if(f.prefix)bits.push(`前「${f.prefix}」`);
  if(f.suffix)bits.push(`後「${f.suffix}」`);
  return bits.join('・');
 }
 /* いま候補に在る道（§9.285 ④）。**候補に無い道も書ける**（サーバーは
    選択肢で塞いでいない）ので、これは**間違いの合図ではなく事実の合図**
    ——項目名が変わった・元データからその列が消えた塊は紙で空欄になるので、
    盤の時点でそう分かるようにする（§4「できないことは、できないと書く」）。
    **候補が届いていないうちは何も言わない**（読めなかったことを
    「無い」と言わない・§CLAUDE 3）。 */
 function fbKnownPaths(){
  const set=new Set();
  (fbCatalog.groups||[]).forEach(g=>(g.items||[]).forEach(i=>{if(i&&i.path)set.add(i.path)}));
  return set;
 }
 /* 種別・寄せ・書式の呼び名。**サーバーが答える**（§9.163）が、届く前でも
    盤は開けるので**綴りだけの受け皿**を持つ（呼び名は綴りそのもの）。
    受け皿を「日本語の写し」にしないこと——写した瞬間に2箇所になる。 */
 function fbVocab(){
  const v=fbCatalog.vocab||{};
  return {
   cellKinds:v.cellKinds||[{v:FB_KIND_VALUE,label:'value'},{v:FB_KIND_HEAD,label:'head'},
                           {v:FB_KIND_BLANK,label:'blank'}],
   aligns:v.aligns||FB_ALIGNS.map(x=>({v:x,label:x||'auto'})),
   formatKinds:v.formatKinds||[{v:'',label:'-'},{v:'number',label:'number'},
                               {v:'datetime',label:'datetime'},{v:'text',label:'text'}],
   datePatterns:v.datePatterns||['yyyy/MM/dd','yyyy/MM/dd HH:mm','HH:mm'],
   /* 表に組むときの軸（§9.277）。**既定の置き方はこの並びが決める**——
      1つ目を行、残りを列。届く前でも盤は開けるので受け皿を持つ。 */
   pivotAxes:v.pivotAxes||['対象','項目','集計'],
   axisLot:v.axisLot||'対象',
   /* 節の中の列数の上限。**紙が受ける数と同じ**（サーバーが答える）。 */
   colsMax:Number(v.colsMax)||FB_COLS_MAX,
   /* 既定の中身を写せる塊（§9.285 ②）。届く前は空——写す口を出さない
      （押せるのに何も起きないボタンを作らない・§4）。 */
   defaultCells:v.defaultCells||{}};
 }
 /* ---------- 表は「ピボット」で組む（§9.277、利用者の指示） ----------
    「EXCELのピボットテーブルのように自由に組めるように、表にしたときには
     選んだ項目の中に必要な共通軸を抽出してそれを置く場所を自動もしくは
     その後ユーザーに修正させる形で作成することで最終形の表の形をしっかり
     固定できるはずです。軸の位置と数がわかれば表の形状がわからずに最終形の
     出力に困らないのでそのように対応してください」

    §9.274では候補が`row`/`col`という**置き場つきの名前**を名乗っており、
    「板厚は行・MINは列」という**決め打ちの1通り**しか作れなかった。
    行と列を入れ替えることも、3つ目の軸（対象＝子ロット）を足すこともできない。

    いまは候補が`axes`（**名前と値だけ**）を名乗り、**置き場は盤が決める**。
      ・軸を抽出する            … `fbAxes(rows)`
      ・置き場の既定を決める    … サーバーの並び順の1つ目を行・残りを列
      ・利用者が直せる          … 軸ごとの「行／列」の切り替え
      ・いまの形を文字で出す    … 「行＝対象／列＝項目・集計（7列×3段）」

    **対象（子ロット）は行だけ**——子ロットの数はレコードごとに違うので、
    設計のときに置けるのは**1つぶんの型**（`lot:true`のマス）だけで、数は
    紙が決める。行なら型は**連続したひとかたまり**になるので複製できるが、
    列だと1行ごとに飛び飛びになる。**できないことは画面に書く**（§4）。 */
 /* 軸を置く箱は2つ（§9.278、利用者の指示「軸単位のドラッグアンドドロップ」）。
    **「使わない」の箱は作らない**——軸を外すと、その軸の値どうしが同じマスへ
    重なって**どの値を出すのか決まらない**（EXCELは足し合わせられるが、
    ここの値はMIN/MAXなので足せない）。置く先は行か列の2つだけ。 */
 const FB_AXIS_ROW='行',FB_AXIS_COL='列',FB_AXIS_SIDES=[FB_AXIS_ROW,FB_AXIS_COL];
 /* 候補が名乗る軸。**綴りはサーバーが持つ**ので、ここでは引くだけ。 */
 function fbAxesOf(path){
  for(const g of (fbCatalog.groups||[]))
   for(const it of (g.items||[]))
    if(it.path===path&&it.axes&&typeof it.axes==='object')return it.axes;
  return null;
 }
 function fbAxisVal(a,n){return (a&&a[n]!=null)?a[n]:''}
 /* いま選んでいる値のマスから軸を抜き出す。→ {live,known,bad,axes}
    **サーバーの並び順で返す**（既定の置き場がその順で決まる）。 */
 function fbAxes(rows){
  const live=(rows||[]).filter(r=>r.kind===FB_KIND_VALUE&&r.path);
  const known=[],bad=[];
  live.forEach(r=>{
   const a=fbAxesOf(r.path);
   /* **組んだ表の足場は軸を名乗らなくてよい**（§9.277）——「対象」の行の
      見出し（子ロット番号）は盤が作ったマスで、利用者が選んだ項目ではない。
      ここで`bad`へ入れると、**一度組んだ表は二度と組み直せなくなる**
      （軸の帯が消え、「表に組む」も理由の分からない断り書きで固まる）。 */
   if(!a&&r.lot)return;
   if(!a)bad.push(r);else known.push({r,a});
  });
  const order=fbVocab().pivotAxes;
  const names=[];
  known.forEach(k=>Object.keys(k.a).forEach(n=>{if(names.indexOf(n)<0)names.push(n)}));
  names.sort((x,y)=>{
   const i=order.indexOf(x),j=order.indexOf(y);
   return (i<0?99:i)-(j<0?99:j);
  });
  const axes=names.map(n=>{
   const values=[];
   known.forEach(k=>{const v=k.a[n];if(v!=null&&values.indexOf(v)<0)values.push(v)});
   return {name:n,values};
  });
  return {live,known,bad,axes};
 }
 /* 対象（子ロット）の軸は**繰り返しの設定から生える**——候補の項目ではなく
    「この塊を子ロットごとに描くか」という塊の設定なので、そちらを見る。 */
 function fbLotAxisOn(box){
  const form=box.closest('form')||document;
  const el=form.querySelector('[data-field="repeatText"],[data-field="repeat"]');
  return /子ロット/.test(String((el&&el.value)||''));
 }
 /* 「全体」（総計）を出せる軸（§9.278、利用者の指示「集計(小計や総計)のONOFF」）。
    **足し合わせに意味のある軸だけ**——`対象`は子ロットを束ねたものが
    ロット全体なので総計が定義できるが、`項目`（板厚と板幅）や`集計`
    （MINとMAX）は**足しても意味のある数にならない**。無い集計の欄を並べて
    「押しても変わらない」を作らず、**出せない理由をその場に書く**（§4）。 */
 function fbAxisTotalable(a){return !!(a&&a.lot)}
 const FB_LOT_WHOLE='全体';
 function fbGrandOn(state,a){
  if(!fbAxisTotalable(a))return false;
  const g=(state&&state.grand)||{};
  /* **既定は出す**——今までの表には「全体」の行があるので、既定を変えると
     設定を触っていない現場の紙から行が1本消える。 */
  return g[a.name]===undefined?true:!!g[a.name];
 }
 /* 軸の値（メンバー）。対象の軸は「全体」＋**子ロット1つぶんの型**。
    数は紙が決めるので、盤に置くのは型1つだけ（§9.277）。 */
 function fbAxisMembers(a){
  if(!a)return [];
  if(a.lot){
   const m=[];
   if(a.grand)m.push({value:FB_LOT_WHOLE,whole:true});
   m.push({value:null,lot:true});
   return m;
  }
  return (a.values||[]).map(v=>({value:v}));
 }
 function fbAxisSize(a){return Math.max(1,fbAxisMembers(a).length)}
 /* 置き場。**掴んで置いた順を覚え**、触っていない軸はサーバーの並びの既定
    （1つ目を行・残りを列）へ落ちる。**対象は行だけ**（型が連続したかたまりに
    なる置き方でしか複製できない）。 */
 function fbPlacement(box,state){
  const ax=fbAxes(state.rows).axes;
  const lot=fbVocab().axisLot;
  const list=fbLotAxisOn(box)
    ? [{name:lot,values:null,lot:true}].concat(ax.filter(a=>a.name!==lot))
    : ax.filter(a=>a.name!==lot);
  const by=new Map(list.map(a=>[a.name,a]));
  const put=(state&&state.axes)||{};
  const seen=new Set(),ordered={};
  FB_AXIS_SIDES.forEach(at=>{
   ordered[at]=[];
   (put[at]||[]).forEach(n=>{if(by.has(n)&&!seen.has(n)){seen.add(n);ordered[at].push(n)}});
  });
  list.forEach((a,i)=>{
   if(seen.has(a.name))return;
   seen.add(a.name);
   ordered[a.lot?FB_AXIS_ROW:(i===0?FB_AXIS_ROW:FB_AXIS_COL)].push(a.name);
  });
  /* **対象は必ず行のいちばん外側**（§9.278）。列に置けないだけでなく、
     行の内側にも置けない——紙は`lot:true`の**ひとかたまり**を子ロットの数だけ
     複製するので、内側にすると「全体」の行と子ロットの行が交互になり、
     かたまりが途切れて**行がばらける**（実際に「行＝集計・対象」で踏んだ）。 */
  if(by.has(lot)){
   FB_AXIS_SIDES.forEach(at=>{ordered[at]=ordered[at].filter(n=>n!==lot)});
   ordered[FB_AXIS_ROW]=[lot].concat(ordered[FB_AXIS_ROW]);
  }
  const mk=(n,at)=>{
   const a=by.get(n);
   const o={name:n,values:a.values,lot:!!a.lot,at,fixed:!!a.lot,
            totalable:fbAxisTotalable(a)};
   o.grand=fbGrandOn(state,o);
   return o;
  };
  return [].concat(ordered[FB_AXIS_ROW].map(n=>mk(n,FB_AXIS_ROW)),
                   ordered[FB_AXIS_COL].map(n=>mk(n,FB_AXIS_COL)));
 }
 /* いま組める表。**組めないなら理由を返す**（§4）。 */
 function fbTablePlan(box,state){
  const found=fbAxes(state.rows);
  if(!found.live.length)return {err:'先に候補から項目を選んでください。'};
  if(found.bad.length)return {err:'「'+esc(found.bad[0].label||found.bad[0].path)
    +'」は軸を名乗らない項目です'
    +'（表に組めるのは「測定した値の統計」のように<b>項目＋集計</b>で決まる項目だけです）。'};
  const place=fbPlacement(box,state);
  const rowAx=place.filter(a=>a.at===FB_AXIS_ROW);
  const colAx=place.filter(a=>a.at===FB_AXIS_COL);
  if(!rowAx.length)return {place,err:'<b>行</b>に置く軸がありません（どれか1つを「行」へ移してください）。'};
  if(!colAx.length)return {place,err:'<b>列</b>に置く軸がありません（どれか1つを「列」へ移してください）。'};
  const colN=colAx.reduce((n,a)=>n*fbAxisSize(a),1);
  const cols=rowAx.length+colN;
  const max=fbVocab().colsMax;
  if(cols>max)return {place,err:'この置き方だと<b>'+cols+'列</b>になり、1つの塊に入る'
    +max+'列を超えます（軸をどれか「行」へ移してください）。'};
  return {place,rowAx,colAx,cols,colN,
    heads:colAx.length,
    bodyRows:rowAx.reduce((n,a)=>n*fbAxisSize(a),1)};
 }
 /* 組み合わせを作る（先の軸が外側）。 */
 function fbCombos(axes){
  let out=[[]];
  (axes||[]).forEach(a=>{
   const ms=fbAxisMembers(a),next=[];
   out.forEach(pre=>ms.forEach(m=>next.push(
     pre.concat([{axis:a,value:m.value,lot:!!m.lot,whole:!!m.whole}]))));
   out=next;
  });
  return out;
 }
 function fbMakeTable(box,state,sync){
  const plan=fbTablePlan(box,state);
  const say=t=>{const el=box.querySelector('.fb-hint');if(el)el.innerHTML=t};
  if(plan.err){say(plan.err);return}
  const rowAx=plan.rowAx,colAx=plan.colAx;
  const known=fbAxes(state.rows).known;
  /* 軸の値の組み合わせ → 元の項目。**選んでいない組み合わせは空きマス**
     （詰めると軸がずれる）。 */
  const keyAx=rowAx.concat(colAx).filter(x=>!x.lot);
  const at=new Map();
  known.forEach(k=>at.set(keyAx.map(x=>fbAxisVal(k.a,x.name)).join(String.fromCharCode(31)),k.r));
  const lotName=fbVocab().axisLot;
  const out=[];
  /* ---- 見出しの段（列の軸のぶん）---- */
  colAx.forEach((a,li)=>{
   /* 左上の角。**行の軸のぶんの幅**をまとめて空ける。 */
   if(li===0)out.push(fbCell({kind:FB_KIND_BLANK,span:rowAx.length,rows:colAx.length}));
   const inner=colAx.slice(li+1).reduce((n,x)=>n*fbAxisSize(x),1);
   const outer=colAx.slice(0,li).reduce((n,x)=>n*fbAxisSize(x),1);
   for(let k=0;k<outer;k++)
    fbAxisMembers(a).forEach(m=>out.push(fbCell({kind:FB_KIND_HEAD,label:m.value,span:inner})));
  });
  /* ---- 本体 ---- */
  const rowCombos=fbCombos(rowAx);
  const colCombos=fbCombos(colAx);
  /* **外側のラベルは繰り返さない**（§9.278、利用者の指示「縦軸、横軸それぞれ
     項目が２つ以上あるときはその並びによってEXCELのピボットのように階層構造で
     ラベル付け」）。EXCELの既定と同じで、同じ値が続くところは空きマスにする
     ——毎行くり返したい人のために切り替えも置く。 */
  const flat=!!(state&&state.repeatLabel);
  let prev=null;
  rowCombos.forEach(rc=>{
   const isLot=rc.some(x=>x.lot);
   rc.forEach((x,i)=>{
    /* 同じ値が続いているか（自分より外側もすべて同じときだけ「続き」）。 */
    const same=!flat&&prev&&prev.slice(0,i+1).every((p,j)=>
      p.axis.name===rc[j].axis.name&&p.value===rc[j].value&&p.lot===rc[j].lot);
    if(same){
     out.push(fbCell({kind:FB_KIND_BLANK,lot:isLot}));
    }else if(x.lot){
     /* 対象の行の見出しは**子ロット番号**（`lot.no`）。値のマスなので、
        紙がその回の子ロットで埋める。**かたまりの1行目は必ずここを通る**
        （対象は行のいちばん外側なので、直前の組み合わせとは必ず違う）ので、
        子ロットごとの複製でも番号が消えない。 */
     out.push(fbCell({label:lotName,path:'lot.no',showLabel:false,align:'left',lot:true}));
    }else out.push(fbCell({kind:FB_KIND_HEAD,label:x.value,align:'left',lot:isLot}));
    /* **対象の行に居るマスは、見出しも含めて全部に印を付ける**（§9.277）
       ——紙は「印の付いた**ひとかたまり**」を子ロットの数だけ複製するので、
       途中に印の無いマスが挟まると、そのマスだけが先頭へ抜け出して
       行がばらける（行の軸を2本にした瞬間に起きる）。 */
   });
   prev=rc;
   colCombos.forEach(cc=>{
    const pick=rc.concat(cc);
    const key=keyAx.map(x=>{
     const hit=pick.find(y=>y.axis.name===x.name);
     return hit?(hit.value||''):'';
    }).join(String.fromCharCode(31));
    /* **鍵に対象は入らない**（`keyAx`が除いてある）——全体の行も子ロットの
       行も、引く道は同じ`stat.*`で、違うのは紙が渡す文脈だけ。 */
    const src=at.get(key);
    out.push(src?fbCell(Object.assign({},src,{showLabel:false,align:'right',lot:isLot}))
                :fbCell({kind:FB_KIND_BLANK,lot:isLot}));
   });
  });
  state.rows=out;state.sel=null;
  /* 列数は「内訳の列数」の欄が持ち主（§CLAUDE 8）——ここは書き換えるだけ。 */
  const ci=(box.closest('form')||document).querySelector('[data-field="cols"]');
  const want=String(Math.min(fbVocab().colsMax,plan.cols));
  if(ci){
   /* **選択肢に無い数を黙って捨てない**（§9.277）——`<select>`は知らない値を
      代入すると空になり、`cols=0`＝既定の2列で刷られる（実際に7列で踏んだ）。
      無ければ候補へ足してから入れる（§9.204と同じ罠）。 */
   if(ci.tagName==='SELECT'&&![...ci.options].some(o=>o.value===want)){
    const o=document.createElement('option');o.value=want;o.textContent=want;ci.appendChild(o);
   }
   ci.value=want;
   ci.dispatchEvent(new Event('change',{bubbles:true}));
  }
  sync();
  say(fbPlanText(plan)+'で組みました。<b>このあと手で直せます。</b>');
 }
 /* いまの表の形を文字で出す（§9.277）。**軸の位置と数が読めれば最終形が
    決まる**——「押せるから、まだ組めていない」と読まれないための1行でもある。 */
 function fbPlanText(plan){
  const nm=a=>esc(a.name)+(a.lot?(a.grand?'（全体＋子ロットぶん）':'（子ロットぶん）'):'');
  return '<b>行＝'+plan.rowAx.map(nm).join('・')
    +'／列＝'+plan.colAx.map(nm).join('・')+'</b>'
    +'（'+plan.cols+'列 × 見出し'+plan.heads+'段＋本体'+plan.bodyRows+'段）';
 }
 /* **読み書きの約束を名前で出す**（§9.274）。サーバー（`parse_content`／
    `dump_content`）と1対1で、`tests/test_rbcells.js`が同じ例で突き合わせる
    ——公開していないと、網は盤のDOM越しにしか見られず、**盤が読み直さない
    形でも通ってしまう**（実際にそうなった）。`window.*`ではなく`WL.*`へ出す
    （§CLAUDE「新しく公開するものは名前空間へ」）。 */
 window.WL=window.WL||{};
 WL.reportCells={parse:t=>fbParse(t),text:c=>fbText(c),cell:o=>fbCell(o)};
 function bindFieldBuilders(form){
  form.querySelectorAll('[data-fb]').forEach(box=>{
   if(box.dataset.fbWired)return;
   box.dataset.fbWired='1';
   const hidden=box.querySelector('input[data-field]');
   /* `place`＝軸の置き場（§9.277）。**触った軸だけ覚える**——触っていない
      軸は既定（サーバーの並び順の1つ目を行・残りを列）のままにする。
      **保存の対象ではない**（組んだ結果はマスの並びが持っている）。 */
   const state={rows:fbParse(hidden?hidden.value:''),cat:'',q:'',sel:null,place:{}};
   /* **隠し欄へ書いたら`change`を飛ばす**（§9.218 ②「`.value`への代入では
      `change`が飛ばない」）。飛ばさないと、同じフォームの中で値を見ている
      もの——刷り上がりの見本（§9.249 ③）・`data-when`の出し入れ——が
      **一度も気づけない**（見本が「載せる項目がありません」のままだった）。 */
   const push=()=>{
    if(!hidden)return;
    hidden.value=fbText(state.rows);
    hidden.dispatchEvent(new Event('change',{bubbles:true}));
   };
   const sync=()=>{
    /* **マスの形を1つにそろえる**（§9.274）——候補から足したときは
       `{label,path}`しか無いので、種別も寄せも書式も持たない。ここで
       通しておかないと「表に組む」が値のマスを1つも見つけられない
       （実際に踏んだ）。 */
    state.rows=(state.rows||[]).map(fbCell);
    push();
    /* **選んでいたマスが消えたら選択も外す**——残すと、別のマスの設定を
       触っているように見える（§CLAUDE 3）。 */
    if(state.sel!=null&&(state.sel<0||state.sel>=state.rows.length))state.sel=null;
    drawCols();drawChosen();drawList();drawInsp();drawTableBtn();
    if(typeof drawSeedRef.fn==='function')drawSeedRef.fn();
    if(typeof drawStackRef.fn==='function')drawStackRef.fn();
   };
   /* `drawSeed`は下で定義するので、呼ぶ側は入れ物越しに見る（巻き上げの
      効かない`const`を上から参照しない）。 */
   const drawSeedRef={fn:null};
   /* ラベルと値の並べ方のボタンも同じ作法（§9.292 ⑤）。 */
   const drawStackRef={fn:null};
   /* 列数は**「内訳の列数」の欄が持つ**（§CLAUDE 8。同じ数を2箇所に置くと
      片方だけ直した状態が作れる）。空欄＝2列は`reportSection`の既定と同じ。 */
   const colsInput=()=>form.querySelector('[data-field="cols"]');
   const colCount=()=>{
    const el=colsInput();
    const n=Math.floor(Number(el&&el.value));
    return Number.isFinite(n)&&n>=1?Math.min(FB_COLS_MAX,n):2;
   };
   /* 列数も「− 数 ＋」の1つへ（§9.311 D/E、利用者の指示「列数を指定する
      部分もボタンでたくさんあるので、数字を決めればよい部分なので、ここも
      コンパクトにトグルボタンをつけて**決めた数値1つが見えればよい**」）。
      12枚並べていたが、読みたいのは**いま何列か**の1つだけ。 */
   const drawCols=()=>{
    const host=box.querySelector('.fb-cols');if(!host)return;
    const cur=colCount();
    const at=FB_COL_CHOICES.indexOf(cur);
    host.innerHTML=`<i>列数</i>`
     +`<button type="button" class="fb-cols-btn" data-fb-cols-step="-1"`
     +` ${at<=0?'disabled title="これ以上減らせません"':'title="1列減らします"'}>−</button>`
     +`<b class="fb-cols-val">${cur}</b>`
     +`<button type="button" class="fb-cols-btn" data-fb-cols-step="1"`
     +` ${at>=FB_COL_CHOICES.length-1?'disabled title="これ以上増やせません"':'title="1列増やします"'}>＋</button>`;
    host.querySelectorAll('[data-fb-cols-step]').forEach(b=>b.onclick=()=>{
     const el=colsInput();
     if(!el)return;
     const i=Math.max(0,FB_COL_CHOICES.indexOf(colCount()));
     const to=Math.max(0,Math.min(FB_COL_CHOICES.length-1,i+(Number(b.dataset.fbColsStep)||0)));
     el.value=String(FB_COL_CHOICES[to]);
     el.dispatchEvent(new Event('change',{bubbles:true}));
     drawCols();drawChosen();
    });
   };
   const drawChosen=()=>{
    const wrap=box.querySelector('.fb-rows');if(!wrap)return;
    const cnt=box.querySelector('.fb-count');
    const n=colCount();
    const shown=state.rows.filter(r=>!r.blank).length;
    if(cnt)cnt.textContent=state.rows.length
      ?`${shown}件${state.rows.length>shown?`・空き${state.rows.length-shown}`:''}`
      :'まだありません';
    /* **紙と同じマトリクスで出す**（§9.245）——縦1列の一覧では、何列に
       なるのか・どこで折り返すのかが読めない。 */
    wrap.style.setProperty('--fb-cols',n);
    wrap.classList.toggle('is-matrix',true);
    /* 1行ごとに数え直さない（候補は200列を超えうる）。 */
    const known=fbKnownPaths();
    wrap.innerHTML=state.rows.length?state.rows.map((r,i)=>{
      const sp=Math.min(n,fbSpan(r.span,n));
      const tall=fbSpan(r.rows,FB_ROWS_MAX);
      /* **マス数は「− 数 ＋」の1つに畳む**（§9.311 D/E、利用者の指示
         「各項目のサイズを決めるボタンは**小さくなった時に見切れる**ので、
          数字をトグルボタンとセットでコンパクトに表示できるように」）。
         以前は横12枚＋縦4枚＝16個の札を1マスの下段に並べており、列数を
         増やすと**折り返して下のマスへ重なっていた**（§9.303 ②で高さを
         測り直して受けていたが、そもそも並べる数のほうが多すぎた）。
         **横と縦はどちらか分かる形にする**（§9.255 ②）——数字だけだと
         「4」が4列なのか4段なのか読めないので、印（横／縦）は残す。
         **端では押せなくして理由を書く**（§4）。 */
      const stepper=(kind,cur,mx,at)=>`<span class="fb-step" data-fb-step-kind="${kind}">`
       +`<i class="fb-size-tag" title="${kind==='span'?'横':'縦'}に使うマス数">${kind==='span'?'横':'縦'}</i>`
       +`<button type="button" class="fb-step-btn" data-fb-${at}="${i}:${Math.max(1,cur-1)}"`
       +(cur<=1?' disabled title="これ以上減らせません"':` title="${kind==='span'?'横':'縦'}に${cur-1}マスにします"`)
       +`>−</button>`
       +`<b class="fb-step-val">${cur}</b>`
       +`<button type="button" class="fb-step-btn" data-fb-${at}="${i}:${Math.min(mx,cur+1)}"`
       +(cur>=mx?' disabled title="これ以上増やせません"':` title="${kind==='span'?'横':'縦'}に${cur+1}マスにします"`)
       +`>＋</button></span>`;
      const size=`<span class="fb-size">`
       +stepper('span',sp,n,'span')
       +stepper('rows',tall,FB_ROWS_MAX,'rows')+`</span>`;
      const st=` style="grid-column:span ${sp}${tall>1?`;grid-row:span ${tall}`:''}"`;
      /* **1マスの中は2段**（§CLAUDE 11）——名前・出どころ・マス数・×を横1列に
         並べると、3列のときに名前の欄が1文字ぶんまで潰れる（実機の見え方で
         確認）。上段＝掴む所と名前、下段＝出どころとマス数。 */
      /* **選んでいるマスは印を付ける**（§CLAUDE 3）——下の設定欄がどのマスの
         話なのかが読めないと、隣のマスを直してしまう。 */
      const on=(state.sel===i)?' is-sel':'';
      if(r.blank)return `<div class="fb-row fb-row-blank${on}" draggable="true" data-fb-i="${i}"${st}>`
       +`<div class="fb-row-top"><span class="fb-grip" aria-hidden="true">⠿</span>`
       +`<b class="fb-blank-name">空きマス</b>`
       +`<button type="button" class="fb-del" title="この空きマスを外します">×</button></div>`
       +`<div class="fb-row-bot">${size}</div></div>`;
      /* 見出しのマス（§9.274）。**値の道を持たない**ので、下の段は
         「見出し」であることとマス数だけ。 */
      if(r.kind===FB_KIND_HEAD)
       return `<div class="fb-row fb-row-head${on}" draggable="true" data-fb-i="${i}"${st}>`
       +`<div class="fb-row-top"><span class="fb-grip" aria-hidden="true">⠿</span>`
       +`<input type="text" class="fb-label" value="${esc(r.label)}" aria-label="見出しの文字"`
       +` placeholder="見出しの文字">`
       +`<button type="button" class="fb-del" title="この見出しを外します">×</button></div>`
       +`<div class="fb-row-bot"><i class="fb-kindtag">見出し</i>${size}</div></div>`;
      const fmt=fbFmtLabel(r.format);
      /* **候補に無い道は印を出す**（§9.285 ④）——元データからその列が
         無くなれば紙は空欄になる。候補が1件も届いていないうちは言わない。 */
      const unknown=known.size&&r.path&&!known.has(r.path);
      return `<div class="fb-row${on}${r.showLabel===false?' fb-row-bare':''}" draggable="true" data-fb-i="${i}"${st}>`
      +`<div class="fb-row-top"><span class="fb-grip" aria-hidden="true">⠿</span>`
      +`<input type="text" class="fb-label" value="${esc(r.label)}" aria-label="紙に出す名前"`
      +`${r.showLabel===false?' title="ラベルは紙に出しません（表の軸と二重にならないように）"':''}>`
      +`<button type="button" class="fb-del" title="この項目を外します">×</button></div>`
      +`<div class="fb-row-bot">`
      +`<code class="fb-path" title="${esc(r.path)}">${esc(r.path)}</code>`
      +(fmt?`<i class="fb-fmttag" title="この欄に効いている書式です（マスを押すと変えられます）">${esc(fmt)}</i>`:'')
      +(unknown?`<i class="fb-warn" title="いまの候補にこの道がありません。項目名が変わったか、元データからその列が無くなった可能性があります。紙では空欄になります。">候補に無い</i>`:'')
      +size+`</div></div>`;
     }).join('')
      :`<p class="fb-empty">左の候補を押すと、ここへ増えます。<b>左上から順に紙へ並びます。</b></p>`;
    /* **押しただけなら選ぶ**（掴んで動かしたときは並べ替え・§9.90と同じ分け方）。
       つまみ・名前欄・×は自分の仕事があるので、そこを押したときは選ばない。 */
    wrap.querySelectorAll('.fb-row').forEach(row=>{
     row.addEventListener('mousedown',e=>{
      if(e.target.closest('button,input,code'))return;
      state.sel=Number(row.dataset.fbI);drawChosen();drawInsp();
     });
    });
    wrap.querySelectorAll('[data-fb-span]').forEach(b=>b.onclick=()=>{
     const [i,v]=b.dataset.fbSpan.split(':').map(Number);
     state.rows[i].span=v;sync();
    });
    wrap.querySelectorAll('[data-fb-rows]').forEach(b=>b.onclick=()=>{
     const [i,v]=b.dataset.fbRows.split(':').map(Number);
     state.rows[i].rows=v;sync();
    });
    wrap.querySelectorAll('.fb-del').forEach(b=>b.onclick=()=>{
     state.rows.splice(Number(b.closest('.fb-row').dataset.fbI),1);sync();
    });
    wrap.querySelectorAll('.fb-label').forEach(inp=>{
     /* **打っている最中に作り直さない**（§9.117）——カーソルが飛ぶ。
        値だけを控えておき、書き戻しは隠し欄へ直接行う。 */
     inp.oninput=()=>{
      state.rows[Number(inp.closest('.fb-row').dataset.fbI)].label=inp.value;
      push();
     };
    });
    let from=-1;
    wrap.querySelectorAll('.fb-row').forEach(row=>{
     row.addEventListener('dragstart',e=>{
      from=Number(row.dataset.fbI);row.classList.add('is-drag');
      try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain','')}catch(_){}
     });
     row.addEventListener('dragend',()=>row.classList.remove('is-drag'));
     row.addEventListener('dragover',e=>{e.preventDefault()});
     row.addEventListener('drop',e=>{
      e.preventDefault();
      const to=Number(row.dataset.fbI);
      if(from<0||from===to)return;
      const m=state.rows.splice(from,1)[0];
      state.rows.splice(to,0,m);from=-1;sync();
     });
    });
    /* **マスの高さは実測して入れる**（§9.303 ②）——列数と折り返しで
       変わるので、描き直すたびに測る。 */
    fbFitCellHeight(wrap);fbWatchCellHeight(wrap);
   };
   const drawList=()=>{
    const cats=box.querySelector('.fb-cats'),list=box.querySelector('.fb-list');
    if(!cats||!list)return;
    const groups=fbCatalog.groups||[];
    if(!groups.length){
     cats.innerHTML='';
     list.innerHTML='<p class="fb-empty">候補を読み込めませんでした。<b>出どころを直接書くこともできます</b>（例: <code>basic.lotNo</code>）。</p>';
     return;
    }
    if(!state.cat||!groups.some(g=>g.group===state.cat))state.cat=groups[0].group;
    cats.innerHTML=groups.map(g=>
      `<button type="button" class="fb-cat${g.group===state.cat?' is-on':''}" data-fb-cat="${esc(g.group)}"`
      +` title="${esc(g.note||'')}">${esc(g.group)}<i>${g.items.length}</i></button>`).join('');
    cats.querySelectorAll('[data-fb-cat]').forEach(b=>b.onclick=()=>{state.cat=b.dataset.fbCat;drawList()});
    const g=groups.find(x=>x.group===state.cat)||{items:[]};
    const q=String(state.q||'').trim().toLowerCase();
    const used=new Set(state.rows.map(r=>r.path));
    const hit=g.items.filter(it=>!q||(it.label+' '+it.path).toLowerCase().indexOf(q)>=0);
    list.innerHTML=(g.note?`<p class="fb-note">${esc(g.note)}</p>`:'')
     +(hit.length?hit.map(it=>
      `<button type="button" class="fb-item${used.has(it.path)?' is-used':''}"`
      +` data-fb-add="${esc(it.path)}" data-fb-label="${esc(it.label)}"`
      +` title="${esc(it.path)}">${esc(it.label)}`
      +`${used.has(it.path)?'<i class="fb-used">載せています</i>':''}`
      +`${it.note?`<small>${esc(it.note)}</small>`:''}</button>`).join('')
      :`<p class="fb-empty">「${esc(state.q)}」に当たる項目はありません。</p>`);
    list.querySelectorAll('[data-fb-add]').forEach(b=>b.onclick=()=>{
     const path=b.dataset.fbAdd;
     /* **同じ項目を2つ載せない**（同じ値が2箇所に並ぶ・§CLAUDE 8）。
        既に載せているものを押したら、外す（押した結果が必ず変わる）。 */
     const at=state.rows.findIndex(r=>r.path===path);
     if(at>=0)state.rows.splice(at,1);
     else state.rows.push({label:b.dataset.fbLabel||path,path});
     sync();
    });
   };
   /* ---------- 選んだマスの設定（§9.274） ----------
      種別・ラベルを出すか・寄せ・書式。**横/縦のマス数はここに出さない**
      ——盤のマスが既に持っており、同じ数を2箇所に置くと片方だけ直した状態が
      作れる（§CLAUDE 8）。
      **選んでも盤が動かない**（§9.227 ②）ように、器は常に置いて中身だけ
      入れ替える（選んでいないときは「マスを押してください」）。 */
   const drawInsp=()=>{
    const host=box.querySelector('.fb-insp');if(!host)return;
    host.hidden=false;
    const i=state.sel,r=(i!=null&&i>=0)?state.rows[i]:null;
    if(!r){
     host.innerHTML='<p class="fb-insp-empty">上のマスを押すと、'
      +'<b>種別・ラベル・寄せ・書式</b>をここで決められます。</p>';
     return;
    }
    const kinds=fbVocab().cellKinds;
    const aligns=fbVocab().aligns;
    const fmts=fbVocab().formatKinds;
    const f=r.format||{};
    const seg=(name,cur,list,attr)=>`<span class="fb-seg" role="group" aria-label="${esc(name)}">`
     +list.map(o=>`<button type="button" class="${String(o.v)===String(cur)?'is-on':''}"`
       +` ${attr}="${esc(String(o.v))}" aria-pressed="${String(o.v)===String(cur)?'true':'false'}">`
       +`${esc(o.label)}</button>`).join('')+'</span>';
    const who=r.kind===FB_KIND_BLANK?'空きマス'
      :(r.kind===FB_KIND_HEAD?`見出し「${r.label||'（文字なし）'}」`:(r.label||r.path));
    host.innerHTML=`<div class="fb-insp-head"><b>選んだマス</b>`
     +`<span class="fb-insp-who" title="${esc(r.path||'')}">${esc(who)}</span>`
     +`<span class="fb-insp-at">${i+1} / ${state.rows.length} マス目</span></div>`
     +`<div class="fb-insp-body">`
     +`<label class="fb-insp-row"><span>種別</span>${seg('種別',r.kind,kinds,'data-fb-kind')}</label>`
     +(r.kind===FB_KIND_VALUE
       ?`<label class="fb-insp-row"><span>ラベル</span>`
        +`<span class="fb-seg" role="group" aria-label="ラベル">`
        +`<button type="button" class="${r.showLabel!==false?'is-on':''}" data-fb-lab="1"`
        +` aria-pressed="${r.showLabel!==false?'true':'false'}">出す</button>`
        +`<button type="button" class="${r.showLabel===false?'is-on':''}" data-fb-lab="0"`
        +` aria-pressed="${r.showLabel===false?'true':'false'}">出さない</button></span>`
        +`<i class="fb-insp-note">表の軸で並べたときは、見出しと二重になるので「出さない」。</i></label>`
        /* ラベルと値の並べ方（§9.292 ⑤、利用者の指示「上下にラベルと内容が
           組み合わさるパターンでレイアウトできるように」）。
           **ラベルを出さないマスでは欄ごと出さない**——並べる相手が無いのに
           選ばせると、押しても何も起きない設定になる（§4）。 */
        +(r.showLabel!==false
          ?`<label class="fb-insp-row"><span>並べ方</span>`
           +`<span class="fb-seg" role="group" aria-label="ラベルと値の並べ方">`
           +`<button type="button" class="${r.stack?'':'is-on'}" data-fb-stack="0"`
           +` aria-pressed="${r.stack?'false':'true'}">横（ラベル：値）</button>`
           +`<button type="button" class="${r.stack?'is-on':''}" data-fb-stack="1"`
           +` aria-pressed="${r.stack?'true':'false'}">上下（ラベルの下に値）</button></span>`
           +`<i class="fb-insp-note">上下にすると、狭いマスでも値の幅を目いっぱい使えます。</i></label>`
          :'')
       :'')
     +`<label class="fb-insp-row"><span>寄せ</span>${seg('寄せ',r.align||'',aligns,'data-fb-align')}</label>`
     +(r.kind===FB_KIND_VALUE
       ?`<label class="fb-insp-row"><span>書式</span>${seg('書式',(f.kind||''),fmts,'data-fb-fmt')}</label>`
        +(f.kind==='number'
          ?`<label class="fb-insp-row"><span>小数の桁</span>`
           +`<input type="number" class="fb-fnum" data-fb-dec min="0" max="${FB_DECIMAL_MAX}"`
           +` value="${f.decimals==null?'':esc(String(f.decimals))}" placeholder="そのまま">`
           +`<label class="fb-insp-chk"><input type="checkbox" data-fb-th`
           +`${f.thousands?' checked':''}> 3桁区切り</label></label>`
          :'')
        +(f.kind==='datetime'
          ?`<label class="fb-insp-row"><span>日付の書式</span>`
           +`<input type="text" class="fb-ftext" data-fb-pat value="${esc(f.pattern||'')}"`
           +` list="fbDatePatterns" placeholder="yyyy/MM/dd">`
           +`<datalist id="fbDatePatterns">`
           +fbVocab().datePatterns.map(x=>`<option value="${esc(x)}">`).join('')+`</datalist>`
           +`<i class="fb-insp-note">yyyy 年／MM 月／dd 日／HH 時／mm 分。'文字'で囲むとそのまま出ます。</i></label>`
          :'')
        +(f.kind
          ?`<label class="fb-insp-row"><span>前後の文字</span>`
           +`<input type="text" class="fb-ftext" data-fb-pre value="${esc(f.prefix||'')}" placeholder="前" maxlength="16">`
           +`<input type="text" class="fb-ftext" data-fb-suf value="${esc(f.suffix||'')}" placeholder="後（単位など）" maxlength="16">`
           +`</label>`
          :'')
       :'')
     +`</div>`;
    const patch=o=>{Object.assign(state.rows[i],fbCell({...state.rows[i],...o}));sync();drawInsp()};
    host.querySelectorAll('[data-fb-kind]').forEach(b=>b.onclick=e=>{
     e.preventDefault();patch({kind:b.dataset.fbKind});
    });
    host.querySelectorAll('[data-fb-lab]').forEach(b=>b.onclick=e=>{
     e.preventDefault();patch({showLabel:b.dataset.fbLab==='1'});
    });
    host.querySelectorAll('[data-fb-stack]').forEach(b=>b.onclick=e=>{
     e.preventDefault();patch({stack:b.dataset.fbStack==='1'});
    });
    host.querySelectorAll('[data-fb-align]').forEach(b=>b.onclick=e=>{
     e.preventDefault();patch({align:b.dataset.fbAlign});
    });
    host.querySelectorAll('[data-fb-fmt]').forEach(b=>b.onclick=e=>{
     e.preventDefault();
     const k=b.dataset.fbFmt;
     patch({format:k?{...(state.rows[i].format||{}),kind:k}:null});
    });
    /* **打っている最中に組み直さない**（§9.117）——カーソルが飛ぶ。
       値だけ控えて隠し欄へ書き、器はそのままにする。 */
    const live=(sel,fn)=>{const el=host.querySelector(sel);if(!el)return;
     el.oninput=()=>{const c=state.rows[i];c.format=fbFormat(fn({...(c.format||{})},el));push();drawChosen()}};
    live('[data-fb-dec]',(f,el)=>({...f,decimals:el.value===''?null:Number(el.value)}));
    live('[data-fb-pat]',(f,el)=>({...f,pattern:el.value}));
    live('[data-fb-pre]',(f,el)=>({...f,prefix:el.value}));
    live('[data-fb-suf]',(f,el)=>({...f,suffix:el.value}));
    const th=host.querySelector('[data-fb-th]');
    if(th)th.onchange=()=>patch({format:{...(state.rows[i].format||{}),thousands:th.checked}});
   };
   const blank=box.querySelector('.fb-blank');
   if(blank)blank.onclick=()=>{state.rows.push(fbCell({kind:FB_KIND_BLANK}));state.sel=state.rows.length-1;sync()};
   const headBtn=box.querySelector('.fb-head');
   if(headBtn)headBtn.onclick=()=>{
    state.rows.push(fbCell({kind:FB_KIND_HEAD,label:''}));state.sel=state.rows.length-1;sync();
    /* 足したら**そこへ書ける状態にする**（§2「次にすることを1つだけ指す」）。 */
    const inp=box.querySelector(`.fb-row[data-fb-i="${state.sel}"] .fb-label`);
    if(inp)try{inp.focus()}catch(_){}
   };
   const tableBtn=box.querySelector('.fb-table');
   if(tableBtn)tableBtn.onclick=()=>fbMakeTable(box,state,sync);
   /* ---------- 軸の置き場を見せる（§9.277、利用者の指示） ----------
      「軸の位置と数がわかれば表の形状がわからずに最終形の出力に困らない」

      **押せるのに何も起きないボタンを残さない**（§4）ので、組める材料が
      揃っていないときは押せなくして理由を出す。そのうえで、
      **いまどの軸をどこへ置くのか**を帯に出す——出さないと「押せるから
      まだ組めていない」と読まれる（利用者の報告「何回でも『表に組む』
      ボタンを押せるので表に組める状態」がそれ）。 */
   const LOT_ONLY_ROW='対象（子ロット）は「行のいちばん外側」に固定です。'
     +'子ロットの数はロットごとに違うので、置けるのは1行ぶんの型だけ——'
     +'内側や列にすると型が飛び飛びになり、子ロットぶんに複製できません。';
   const drawTableBtn=()=>{
    const bar=box.querySelector('.fb-axes');
    const plan=fbTablePlan(box,state);
    if(tableBtn){
     /* **組めないなら押せなくして理由を出す**（§4）——置き方が決まって
        いないのに押せると、押しても何も起きないボタンになる。直し方は
        帯の箱なので、**帯は出したまま**にする。 */
     tableBtn.disabled=!!plan.err;
     tableBtn.title=plan.err
       ? String(plan.err).replace(/<[^>]*>/g,'')
       : String(fbPlanText(plan)).replace(/<[^>]*>/g,'')+' で組み直します';
    }
    if(!bar)return;
    const place=plan.place||[];
    if(!place.length){bar.hidden=true;bar.innerHTML='';return}
    bar.hidden=false;
    /* 軸の札。**掴んで動かせるが、押しても動く**（§9.247 ①と同じ作法）
       ——掴めない環境（触る画面・キーボード）で置き場を変える道を残す。 */
    const chip=a=>{
     const other=a.at===FB_AXIS_ROW?FB_AXIS_COL:FB_AXIS_ROW;
     return '<span class="fb-axis'+(a.fixed?' is-fixed':'')+'"'
      +(a.fixed?'':' draggable="true"')+' data-fb-axis="'+esc(a.name)+'"'
      +' data-fb-at="'+esc(a.at)+'">'
      +'<i class="fb-axis-grip" aria-hidden="true">⠿</i>'
      +'<b>'+esc(a.name)+'</b>'
      +'<small>'+(a.lot?(a.grand?'全体＋子ロットぶん':'子ロットぶん')
                      :esc((a.values||[]).join('・')))+'</small>'
      +'<button type="button" class="fb-axis-move" data-fb-move="'+esc(a.name)+'"'
      +' data-fb-to="'+esc(other)+'"'
      +(a.fixed?' disabled title="'+esc(LOT_ONLY_ROW)+'"'
               :' title="'+esc(other+'へ移す')+'"')
      +'>'+esc(other)+'へ</button></span>';
    };
    const boxes=FB_AXIS_SIDES.map(at=>{
     const mine=place.filter(a=>a.at===at);
     return '<div class="fb-axbox'+(mine.length?'':' is-empty')+'" data-fb-box="'+esc(at)+'">'
      +'<b class="fb-axbox-cap">'+esc(at)+'</b>'
      +'<span class="fb-axbox-list">'
      +(mine.length?mine.map(chip).join('')
        :'<em class="fb-axbox-none">ここへ軸を落とすと'+esc(at)+'になります</em>')
      +'</span></div>';
    }).join('');
    /* 総計（§9.278）。**出せる軸にだけ欄を出し、出せない軸は理由を書く**
       ——押しても数が変わらない欄を並べない（§4）。 */
    const tot=place.filter(a=>a.totalable);
    const opt='<div class="fb-axes-opt">'
     +(tot.length
       ?tot.map(a=>'<label class="fb-axes-chk"><input type="checkbox" data-fb-grand="'
         +esc(a.name)+'"'+(a.grand?' checked':'')+'> <span>「'+esc(FB_LOT_WHOLE)
         +'」の'+esc(a.at)+'を出す（総計）</span></label>').join('')
       :'<span class="fb-axes-note" title="いまの軸（項目・集計）はMINとMAXのように'
         +'足し合わせても意味のある数にならないので、小計・総計を出せません。'
         +'子ロットごとに繰り返す塊にすると「対象」の軸が生え、その総計＝'
         +'ロット全体を出せます。">小計・総計は出せません（理由）</span>')
     +'<label class="fb-axes-chk"><input type="checkbox" data-fb-replab'
     +(state.repeatLabel?' checked':'')+'> <span>ラベルを毎行くり返す</span></label>'
     +'</div>';
    bar.innerHTML='<i class="fb-axes-cap">軸の置き場</i>'
     +'<div class="fb-axboxes">'+boxes+'</div>'+opt
     +'<span class="fb-axes-now">'+(plan.err
        ? '<em class="fb-axes-bad">'+plan.err+'</em>'
        : 'この形で組みます: '+fbPlanText(plan))+'</span>';
    const moveTo=(name,at,before)=>{
     /* いまの並びを取り出してから動かす（**触っていない軸も並びへ焼き付ける**
        ——焼かないと、1つ動かした拍子に他の軸が既定へ戻る）。 */
     const cur={};FB_AXIS_SIDES.forEach(s=>cur[s]=place.filter(a=>a.at===s).map(a=>a.name));
     FB_AXIS_SIDES.forEach(s=>cur[s]=cur[s].filter(n=>n!==name));
     const list=cur[at];
     const i=before?list.indexOf(before):-1;
     if(i<0)list.push(name);else list.splice(i,0,name);
     state.axes=cur;
     drawTableBtn();
    };
    bar.querySelectorAll('[data-fb-move]').forEach(b=>b.onclick=e=>{
     e.preventDefault();e.stopPropagation();
     if(b.disabled)return;
     moveTo(b.dataset.fbMove,b.dataset.fbTo,null);
    });
    /* ---- 掴んで動かす（§9.278）---- */
    bar.querySelectorAll('.fb-axis[draggable="true"]').forEach(el=>{
     el.ondragstart=ev=>{
      state.axisDrag=el.dataset.fbAxis;
      try{ev.dataTransfer.setData('text/plain',el.dataset.fbAxis);
          ev.dataTransfer.effectAllowed='move'}catch(_e){}
      el.classList.add('is-dragging');
     };
     el.ondragend=()=>{state.axisDrag=null;el.classList.remove('is-dragging')};
    });
    bar.querySelectorAll('[data-fb-box]').forEach(bx=>{
     const at=bx.dataset.fbBox;
     bx.ondragover=ev=>{
      const n=state.axisDrag;if(!n)return;
      /* **対象は行だけ**——落とせない箱では受け付けず、そのことを見せる。 */
      const a=place.find(x=>x.name===n);
      if(a&&a.fixed&&at!==FB_AXIS_ROW){bx.classList.add('is-deny');return}
      ev.preventDefault();bx.classList.add('is-over');
     };
     bx.ondragleave=()=>bx.classList.remove('is-over','is-deny');
     bx.ondrop=ev=>{
      ev.preventDefault();bx.classList.remove('is-over','is-deny');
      const n=state.axisDrag;if(!n)return;
      const a=place.find(x=>x.name===n);
      if(a&&a.fixed&&at!==FB_AXIS_ROW)return;
      /* 落とした位置＝カーソルの右にある札の**手前**（§9.199と同じ数え方）。 */
      let before=null;
      [...bx.querySelectorAll('.fb-axis')].forEach(el=>{
       if(before||el.dataset.fbAxis===n)return;
       const r=el.getBoundingClientRect();
       if(ev.clientX<r.left+r.width/2)before=el.dataset.fbAxis;
      });
      moveTo(n,at,before);
     };
    });
    bar.querySelectorAll('[data-fb-grand]').forEach(c=>c.onchange=()=>{
     state.grand=Object.assign({},state.grand||{},{[c.dataset.fbGrand]:c.checked});
     drawTableBtn();
    });
    const rl=bar.querySelector('[data-fb-replab]');
    if(rl)rl.onchange=()=>{state.repeatLabel=rl.checked;drawTableBtn()};
   };
   /* 「内訳の列数」を欄から直したときも枠を組み直す（同じ数の2つの入口が
      食い違わないように）。 */
   const ci=colsInput();
   if(ci&&!ci.dataset.fbWired){ci.dataset.fbWired='1';ci.addEventListener('change',()=>{drawCols();drawChosen()})}
   /* 繰り返しを切り替えたら軸の帯を描き直す（§9.277）——「対象（子ロット）」の
      軸は**候補の項目ではなく塊の設定から生える**ので、切り替えたときに
      描き直さないと**軸がいつまでも現れない**（利用者から見れば「子ロット
      ごとにしたのに表に組めない」）。欄は別の段（③）にあり、その段を触っても
      ②の盤は組み直されないので、`change`を1つ拾う。 */
   const rpf=(box.closest('form')||document)
     .querySelector('[data-field="repeatText"],[data-field="repeat"]');
   if(rpf&&!rpf.dataset.fbWired){rpf.dataset.fbWired='1';
    rpf.addEventListener('change',()=>drawTableBtn())}
   const search=box.querySelector('.fb-search');
   if(search)search.oninput=()=>{state.q=search.value;drawList()};
   const clr=box.querySelector('.fb-clear');
   if(clr)clr.onclick=()=>{state.rows=[];sync()};
   /* ---------- ラベルと値をまとめて上下／横へ（§9.292 ⑤、利用者の指示） ----------
      「帳票ブロックマスタを組み立てていくと、ラベルと内容が横並びになった
       状態でレイアウトされますが、上下のパターンも欲しいです」

      **設定はマスの`stack`1つだけ**で、これはそこへ同じ値を書く操作
      （「既定の中身を写す」と同じ立ち位置。設定を2つ持たない・§9.207）。
      **ラベルを出していないマスは触らない**——並べる相手が無い。
      **いまどちらかをボタンが名乗る**（§CLAUDE 2・§3）。
      **触れるマスが1つも無ければ押せなくして理由を書く**（§4）。 */
   const stackBtn=box.querySelector('.fb-stack');
   const stackable=()=>state.rows.filter(r=>r.kind===FB_KIND_VALUE&&r.showLabel!==false);
   const drawStackBtn=drawStackRef.fn=()=>{
    if(!stackBtn)return;
    const t=stackable();
    const on=t.length>0&&t.every(r=>r.stack);
    stackBtn.disabled=!t.length;
    stackBtn.textContent=on?'ラベルを横に':'ラベルを上下に';
    stackBtn.title=!t.length
      ?'ラベルを出しているマスがありません（見出し・空き・「ラベル出さない」のマスには並べ方がありません）。'
      :(on?`いま ${t.length}マスが「上下」です。押すと「横（ラベル：値）」へ戻します。`
          :`ラベルを出している ${t.length}マスを、まとめて「上下（ラベルの下に値）」にします。`);
   };
   if(stackBtn)stackBtn.onclick=()=>{
    const t=stackable();if(!t.length)return;
    const on=t.every(r=>r.stack);
    state.rows=state.rows.map(r=>fbCell({...r,stack:(r.kind===FB_KIND_VALUE&&r.showLabel!==false)?!on:false}));
    sync();
   };
   /* ---------- 既定の中身を写す（§9.285 ②、利用者の指示） ----------
      「汎用化できていない部分を汎用表現を追加し編集可能範囲に取り込む」

      `寸法（オーダー／製造）`のようにコードが表を組み立てている塊は、
      `[内容]`が空のあいだは今までどおりコードの中身で刷られる（§9.278）。
      そこを触りたいとき、**白紙から組み直させると、いま見えている形が
      押した瞬間に消えたように見える**（§9.259の「共通を写してから個人へ」と
      同じ理由）。ここが**いま紙に出ているのと同じ並び**を入れる。

      **並びも列数もサーバーが答える**（§9.163）ので、画面は入れるだけ。
      **写せない塊ではボタンごと出さない**（§4）。 */
   const seed=box.querySelector('.fb-seed');
   const seedOf=()=>{
    const key=String((maintState.editing||{}).builtin||'').trim();
    return key?(fbVocab().defaultCells||{})[key]||null:null;
   };
   const drawSeed=drawSeedRef.fn=()=>{
    if(!seed)return;
    const d=seedOf();
    seed.hidden=!d;
    if(!d)return;
    /* **何が起きるかをボタンが名乗る**（§CLAUDE 2）——「写す」だけでは
       いまの並びが消えるのかどうかが読めない。 */
    /* **短く**（§9.234 ①）——帯は列数の札と並ぶので、長い文言を入れると
       器が足りずに縦書きへ折り返す（実機のキャプチャで確認）。全文は`title`。 */
    seed.textContent=state.rows.length?'既定へ戻す':'既定を写す';
    seed.title=state.rows.length
      ?'いま並べているマスを捨てて、画面がもともと持っている中身と同じ並びに戻します。'
      :'画面がもともと持っている中身と同じ並びを入れます。ここから1マスずつ直せます。';
   };
   if(seed)seed.onclick=()=>{
    const d=seedOf();if(!d)return;
    if(state.rows.length&&!confirm('いま並べているマスを捨てて、既定の中身に戻します。よろしいですか。'))return;
    state.rows=fbParse(d.content||'');
    /* **列数も一緒に入れる**——並びだけ写すと、既定は6列なのに欄が2列の
       ままで、写した瞬間に別の絵になる（§9.280と同じ食い違い）。 */
    const ci=colsInput();
    if(ci&&d.cols){ci.value=String(d.cols);ci.dispatchEvent(new Event('change',{bubbles:true}))}
    sync();
   };
   drawCols();drawChosen();drawList();drawInsp();drawTableBtn();drawSeed();
   /* 語彙（種別・寄せ・書式の呼び名）は候補と一緒に届く（§9.163）。
      **届いたら描き直すこと**——投げっぱなしにすると、設定欄が綴りのまま
      出たきり日本語にならない（§9.234 ⑧と同じ罠）。 */
   fbLoadCatalog().then(()=>{drawList();drawInsp();drawTableBtn();drawSeed()});
  });
 }
 /* --- 数値: 上下ボタン・3桁区切り・右づめ --- */
 /* ============================================================
    帳票レイアウトマスタ（§9.254 ③、利用者の指示）
    ------------------------------------------------------------
    「帳票の表示画面からいける、レイアウト調整画面ですが、これは実質、
     帳票レイアウトマスタなので、マスタとしても配置し、この帳票レイアウト
     マスタと帳票ブロックマスタを配線しリンクさせてレイアウト調整画面から
     表示内容調整できたところなど、機能が重複する部分は統合して帳票マスタ
     として親子関係のある高性能マスタとしてさらに使いやすく改良再構成して
     ください」

    左＝**設備ごとの紙**（親）／右＝**その紙に載る塊**（子）。`op-choice`と
    同じ2ペインの作法（§9.221 ②）で、器→ペイン→一覧の3段に
    `flex:1;min-height:0`を通してスクロールは内側だけにする（§9.222 ⑤）。

    **判定と保存は`WL.reportLayout`の1本だけ**（§9.163）——幅の詰め方も
    既定の書き下ろしも紙の割りも`report-dashboard.js`にしか無い。ここで
    数え直すと、マスタと紙で違う答えが出る。
    ============================================================ */
 let rlyState={papers:[],picked:null,info:null,q:'',loading:false,err:''};
 function rlySay(text,bad){
  const el=$('#rlyState');if(!el)return;
  el.textContent=text||'';el.classList.toggle('is-bad',!!bad);
 }
 const RLY_COMMON='';                      /* 空＝設備の分からないロットの紙 */
 const rlyLabel=eq=>String(eq||'')||'共通（設備の分からないロット）';
 /* **閲覧モードでは触らせない**（§9.169と同じ作法）。列レイアウトマスタの
    保存はedit/scheduleにしか開いていないので、押せると403で断られる
    ——押せるのに何も起きないボタンは、無い機能より質が悪い（§4）。
    **消さずに押せなくして理由を書く**（何ができないのかが読めるように）。 */
 const rlyEditable=()=>((window.accessMode&&window.accessMode.mode)||'edit')!=='view';
 const RLY_READONLY='この端末は閲覧モードなので、配置は変えられません（編集モードの端末で直してください）。';
 /* 保存済みの紙。**サーバーだけが全対象を知っている**（§9.178）——`target`は
    画面が組み立てる文字列なので、どんな設備の紙が保存済みかは推測できない。 */
 async function rlyLoadPapers(){
  const prefix=(WL.reportLayout&&WL.reportLayout.targetOf(RLY_COMMON)||'report:共通')
    .replace(/共通$/,'');
  const saved=new Map();
  try{
   const r=await api('/api/column-layout-master?all=1');
   (r.items||[]).forEach(it=>{
    const t=String(it.target||'');
    if(t.indexOf(prefix)!==0)return;
    const name=t.slice(prefix.length);
    saved.set(name==='共通'?RLY_COMMON:name,
      {order:(it.order||[]).length,hidden:(it.hidden||[]).length});
   });
  }catch(e){/* 読めなくても設備の一覧は出せる（fail-open） */}
  /* **設備マスタが正**（§9.239 ③）。保存済みの紙だけを並べると、これから
     作る設備の紙を開く手立てが無い。保存が残っている「もう無い設備」も
     消さずに出す——消すと、その設定を片付けられなくなる。 */
  let eqs=[];
  try{await loadEquipmentMaster();eqs=(equipmentMasterState.items||[]).map(e=>e.name).filter(Boolean)}
  catch(e){eqs=[]}
  const seen=new Set(),out=[];
  const push=(eq,gone)=>{
   const k=String(eq||'');
   if(seen.has(k))return;
   seen.add(k);
   const s=saved.get(k)||null;
   out.push({equipment:k,label:rlyLabel(k),saved:!!s,
             blocks:s?s.order:0,hiddenCount:s?s.hidden:0,gone:!!gone});
  };
  push(RLY_COMMON,false);
  eqs.forEach(e=>push(e,false));
  [...saved.keys()].forEach(k=>push(k,true));
  return out;
 }
 async function loadReportLayoutMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  form.classList.remove('mm-form-compact');
  if(!(window.WL&&WL.reportLayout)){
   /* **公開漏れは黙って素通しにしない**（§CLAUDE）——「あれば使う」で書くと、
      名前を変えた日に画面が静かに空になる。 */
   console.error('WL.reportLayout が見つかりません（report-dashboard.js）');
   list.innerHTML='<div class="mm-empty">帳票の画面が読み込まれていないため、配置を読めません。</div>';
   return;
  }
  if(!list.querySelector('.rly-edit'))list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   rlyState.papers=await rlyLoadPapers();
   if(rlyState.picked==null||!rlyState.papers.some(p=>p.equipment===rlyState.picked)){
    /* **この端末の使用設備から始める**（§2「探させない」）——無ければ先頭。 */
    let want=null;
    try{want=(typeof currentConfiguredEquipment==='function')?currentConfiguredEquipment():''}
    catch(e){want=''}
    rlyState.picked=rlyState.papers.some(p=>p.equipment===want)?want:(rlyState.papers[0]||{}).equipment;
    if(rlyState.picked===undefined)rlyState.picked=RLY_COMMON;
   }
   rlyState.info=await WL.reportLayout.info(rlyState.picked);
   rlyState.err='';
  }catch(e){
   rlyState.err=e.message||String(e);
  }
  renderReportLayout();
 }
 function renderReportLayout(){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  /* **器の高さを中まで届ける**（§9.222 ⑤）。印を外すのは`loadMaintInner()`の
     1箇所——外し忘れると他のタブの一覧がスクロールしない枠になる。 */
  list.classList.add('is-fill');
  list.parentElement&&list.parentElement.classList.add('is-fill');
  const info=rlyState.info||{};
  form.innerHTML=`<div class="op-bar">`
   +`<span class="op-bar-note">左が<b>設備ごとの紙</b>、右がその紙に載る<b>塊</b>です。`
   +`塊そのもの（名前・種別・載せる項目）は<b>帳票ブロック</b>が持ちます。</span>`
   +`<button type="button" id="rlyArrange" class="mm-btn-primary sm"${rlyEditable()?'':' disabled'}`
   +` title="${rlyEditable()?'見本のロットでこの設備の紙を開き、置き場所を掴んで動かせる状態にします（実データは要りません）':esc(RLY_READONLY)}">紙で組み換える</button>`
   +`<button type="button" id="rlyGotoBlocks" class="mm-btn-ghost sm"`
   +` title="塊そのもの（名前・種別・載せる項目）を直す帳票ブロックマスタへ移ります">帳票ブロックを開く</button>`
   +`<span class="op-bar-state" id="rlyState"></span></div>`;
  list.innerHTML=`<div class="rly-edit">${rlyPaperPaneHtml()}${rlyBlockPaneHtml(info)}</div>`;
  bindReportLayout();
  if(rlyState.err)rlySay('配置を読めませんでした: '+rlyState.err,true);
 }
 function rlyPaperPaneHtml(){
  const q=String(rlyState.q||'').trim().toLowerCase();
  const all=rlyState.papers||[];
  const hit=q?all.filter(p=>p.label.toLowerCase().includes(q)):all;
  const kept=all.filter(p=>p.saved).length;
  return `<div class="rly-papers">
    <div class="rly-papers-head">
     <b>設備ごとの紙</b><span class="oc-count">${all.length}件（設定あり ${kept}件）</span>
     <input type="search" id="rlySearch" value="${esc(rlyState.q||'')}" placeholder="設備名で絞る" autocomplete="off">
    </div>
    <div class="rly-paper-list">${hit.map(p=>{
      const on=p.equipment===rlyState.picked;
      const state=p.saved?`${p.blocks}塊を配置${p.hiddenCount?`／外し ${p.hiddenCount}`:''}`:'既定のまま';
      return `<button type="button" class="rly-paper${on?' is-on':''}" data-rly-paper="${esc(p.equipment)}"
        title="${esc(p.label)}／${esc(state)}${p.gone?'／設備マスタにはもうありません（設定だけが残っています）':''}">
       <b>${esc(p.label)}</b>
       <span class="rly-paper-sub">
        <span class="rly-paper-meta">${esc(state)}</span>
        ${p.gone?'<span class="rly-paper-gone">設備マスタに無し</span>':''}
       </span>
      </button>`}).join('')
      ||`<p class="mm-empty">${q?'絞り込みに当たる設備がありません。':'設備がまだ登録されていません。'}</p>`}</div>
   </div>`;
 }
 function rlyBlockPaneHtml(info){
  if(!info||!info.blocks)return `<div class="rly-blocks"><p class="mm-empty">左で<b>設備</b>を選ぶと、その紙に載る塊が出ます。</p></div>`;
  const shown=info.blocks.filter(b=>b.shown).length;
  const spans=info.spans||[],rowChoices=info.rowChoices||[];
  const ro=rlyEditable()?'':' disabled';
  const head=`<div class="rly-blocks-head">
    <b>${esc(rlyLabel(info.equipment))}の紙</b>
    <span class="oc-count">塊 ${info.blocks.length}件（出す ${shown}／出さない ${info.blocks.length-shown}）</span>
    <span class="rly-grid">紙の割り
     <span class="rly-grid-pick" role="group" aria-label="紙の列数">${(info.gridChoices||[]).map(n=>
       `<button type="button" data-rly-cols="${n}" class="${n===info.grid?'is-on':''}"${ro} title="紙を横${n}マスに割ります">${n}列</button>`).join('')}</span>
     <span class="rly-grid-pick" role="group" aria-label="紙の段数">${(info.pageRowChoices||[]).map(n=>
       `<button type="button" data-rly-rows="${n}" class="${n===info.pageRows?'is-on':''}"${ro} title="紙を縦${n}段に割ります">${n}段</button>`).join('')}</span>
    </span>
    <button type="button" id="rlyReset" class="mm-btn-ghost sm danger"${(info.saved&&rlyEditable())?'':' disabled'}
      title="${!rlyEditable()?esc(RLY_READONLY)
        :(info.saved?'この設備の配置を消して、登録順・登録幅・全部出す（既定）へ戻します'
        :'まだこの設備の配置は保存されていません（いまも既定のままです）')}">既定に戻す</button>
   </div>`;
  const rows=info.blocks.map(b=>{
   const pos=b.col&&b.row?`${b.col}列 ${b.row}段`:'自動';
   const origin=b.user?'自作の塊':(b.id?'既定の塊':'既定の塊（マスタ未登録）');
   /* **既定と違うところを言う**（§9.254 ③／§2）——幅と高さは帳票ブロックが
      既定を持ち、この紙が上書きする。どちらで直すのかを思い出させないため、
      **違うときだけ**「既定 X → いま Y」と書く（同じときは何も足さない）。 */
   const rowsWord=n=>n?`${n}/${info.pageRows}段`:'中身なり';
   const diff=[];
   if(b.defSpan&&b.span!==b.defSpan)diff.push(`幅 既定${b.defSpan}→${b.span}`);
   if(b.rows!==b.defRows)diff.push(`高さ 既定${rowsWord(b.defRows)}→${rowsWord(b.rows)}`);
   return `<div class="rly-row${b.shown?'':' is-off'}" data-rly-key="${esc(b.key)}">
     <span class="rly-cell rly-name" title="${esc(b.key)}">
      <b>${esc(b.label)}</b>
      <small>${esc(origin)}${b.kind?'・'+esc(b.kind):''}${b.fields?`・${b.fields}項目`:''}${
       diff.length?`<i class="rly-diff" title="帳票ブロックが持つ既定と違います。既定へ戻すには同じ値を選び直してください">${esc(diff.join('・'))}</i>`:''}</small></span>
     <span class="rly-cell rly-vis">
      <button type="button" class="rly-tgl${b.shown?' is-on':''}" data-rly-vis="${esc(b.key)}"
        aria-pressed="${b.shown?'true':'false'}"${ro}
        title="${ro?esc(RLY_READONLY):(b.shown?'この紙から外します（設定は残ります）':'この紙へ出します')}">${b.shown?'出す':'出さない'}</button></span>
     <span class="rly-cell rly-pick">
      <select data-rly-span="${esc(b.key)}" aria-label="${esc(b.label)}の幅"${ro}
        title="${ro?esc(RLY_READONLY):`紙の横${info.grid}マスのうち何マスを使うかです`}">${spans.map(c=>
        `<option value="${c.v}"${c.v===b.span?' selected':''}>幅 ${esc(c.label)}（${c.v}/${info.grid}）</option>`).join('')}</select></span>
     <span class="rly-cell rly-pick">
      <select data-rly-rows-of="${esc(b.key)}" aria-label="${esc(b.label)}の高さ"${ro}
        title="${ro?esc(RLY_READONLY):`紙の縦${info.pageRows}段のうち何段を使うかです。「中身なり」は描いてから測って合わせます`}">
       <option value="0"${b.rows?'':' selected'}>高さ 中身なり</option>${rowChoices.map(c=>
        `<option value="${c.v}"${c.v===b.rows?' selected':''}>高さ ${esc(c.label)}（${c.v}/${info.pageRows}）</option>`).join('')}</select></span>
     <span class="rly-cell rly-pos" title="置き場所は「紙で組み換える」で決めます">${esc(pos)}</span>
     <span class="rly-cell rly-act">
      ${b.id?`<button type="button" class="mm-btn-ghost sm" data-rly-edit="${b.id}"
        title="この塊そのもの（名前・種別・載せる項目）を帳票ブロックマスタで直します">中身を直す</button>`
       :`<em class="mm-blank" title="この塊はアプリがもともと持っているもので、帳票ブロックマスタにまだ行がありません">—</em>`}</span>
    </div>`;
  }).join('');
  return `<div class="rly-blocks">
    ${head}
    <div class="rly-table" role="table">
     <div class="rly-row is-head" role="row">
      <span>塊</span><span>紙に出す</span><span>幅</span><span>高さ</span><span>置き場所</span><span></span>
     </div>
     <div class="rly-table-scroll">${rows||'<p class="mm-empty">この設備の紙に載る塊がありません。</p>'}</div>
    </div>
    <p class="rly-note">${rlyEditable()?'':`<b>${esc(RLY_READONLY)}</b> `}置き場所（何列目・何段目）は<b>紙で組み換える</b>から、見本のロットで実際の紙を見ながら決めます。
     ここで決めた幅・高さ・出す/出さないは<b>この設備の紙だけ</b>に効きます（塊そのものの既定は帳票ブロックが持ちます）。</p>
   </div>`;
 }
 function bindReportLayout(){
  const list=$('#masterMaintList');if(!list)return;
  const se=$('#rlySearch');
  if(se)se.oninput=()=>{
   /* **入力中に器を作り直さない**（§9.117）——1文字ごとにカーソルが飛ぶ。
      作り直すのは左の一覧だけ。 */
   rlyState.q=se.value;
   const pane=list.querySelector('.rly-papers');
   if(!pane){renderReportLayout();return}
   const keep=se.selectionStart;
   pane.outerHTML=rlyPaperPaneHtml();
   bindReportLayout();
   const el=$('#rlySearch');
   if(el){el.focus();try{el.setSelectionRange(keep,keep)}catch(_){}}
  };
  list.querySelectorAll('[data-rly-paper]').forEach(b=>b.onclick=()=>rlyPick(b.dataset.rlyPaper));
  list.querySelectorAll('[data-rly-vis]').forEach(b=>b.onclick=()=>{
   const k=b.dataset.rlyVis,on=b.classList.contains('is-on');
   rlyWrite(()=>WL.reportLayout.setShown(rlyState.picked,k,!on),
     on?`「${k}」を紙から外しました。`:`「${k}」を紙へ出しました。`);
  });
  list.querySelectorAll('select[data-rly-span]').forEach(el=>el.onchange=()=>{
   const k=el.dataset.rlySpan;
   rlyWrite(()=>WL.reportLayout.setSpan(rlyState.picked,k,Number(el.value)),`「${k}」の幅を変えました。`);
  });
  list.querySelectorAll('select[data-rly-rows-of]').forEach(el=>el.onchange=()=>{
   const k=el.dataset.rlyRowsOf;
   rlyWrite(()=>WL.reportLayout.setRows(rlyState.picked,k,Number(el.value)),`「${k}」の高さを変えました。`);
  });
  list.querySelectorAll('[data-rly-cols]').forEach(b=>b.onclick=()=>
   rlyWrite(()=>WL.reportLayout.setGrid(rlyState.picked,Number(b.dataset.rlyCols),null),'紙の列数を変えました。'));
  list.querySelectorAll('[data-rly-rows]').forEach(b=>b.onclick=()=>
   rlyWrite(()=>WL.reportLayout.setGrid(rlyState.picked,null,Number(b.dataset.rlyRows)),'紙の段数を変えました。'));
  list.querySelectorAll('[data-rly-edit]').forEach(b=>b.onclick=()=>rlyEditBlock(b.dataset.rlyEdit));
  const rs=$('#rlyReset');
  if(rs)rs.onclick=async()=>{
   /* **消える操作は1回だけ確かめる**（§CLAUDE 5）。 */
   if(!confirm(`${rlyLabel(rlyState.picked)}の紙の設定（並び・幅・高さ・出す/出さない・紙の割り）を消して、既定に戻しますか？\n塊そのもの（帳票ブロック）は消えません。`))return;
   rlyWrite(()=>WL.reportLayout.reset(rlyState.picked),'既定に戻しました。');
  };
  const ar=$('#rlyArrange');
  if(ar)ar.onclick=async()=>{
   rlySay('見本のロットで紙を開いています…');
   try{await WL.reportLayout.arrange(rlyState.picked,{returnTo:'layout'})}
   catch(e){rlySay('紙を開けませんでした: '+(e.message||String(e)),true)}
  };
  const gb=$('#rlyGotoBlocks');
  if(gb)gb.onclick=()=>document.querySelector('#masterMaintNav [data-master="reportBlock"]')?.click();
 }
 async function rlyPick(eq){
  const v=String(eq||'');
  if(rlyState.picked===v&&rlyState.info)return;
  rlyState.picked=v;
  rlySay('読み込んでいます…');
  try{rlyState.info=await WL.reportLayout.info(v);rlyState.err=''}
  catch(e){rlyState.err=e.message||String(e)}
  renderReportLayout();
 }
 /* 書き込みは1本にまとめる。**保存の状態を必ず文字で出す**（§9.212 ④）
    ——黙って投げると、次の読み直しで元の値が出るだけで「勝手に戻った」と
    しか見えない。書いたあとは**帳票の写しも捨てる**（§9.226 ①）。 */
 async function rlyWrite(run,okText){
  if(requireMaintUser()===null)return;
  rlySay('保存しています…');
  try{
   await run();
   forgetReportCaches();
   rlyState.papers=await rlyLoadPapers();
   rlyState.info=await WL.reportLayout.info(rlyState.picked);
   rlyState.err='';
   renderReportLayout();
   rlySay(okText||'保存しました。');
  }catch(e){
   rlySay('保存できませんでした: '+(e.message||String(e)),true);
  }
 }
 /* 子（帳票ブロック）へ渡す。**開いていたタブごと移る**（§9.253と同じ
    作法）——「マスタ管理の先頭」へ落とすと、直したい塊をもう一度探すことになる。 */
 /* ---------- 紙から帳票ブロックマスタへ（§9.274、利用者の指示） ----------
    「帳票の紙レイアウトからブロックをダブルクリックしたら、帳票ブロック
     マスタに移行するように配線してください。今のモーダルでできることは
     少ないのでマスタに繋いできちんと修正できるようにしたいです」

    **開き方は`rlyEditBlock()`の1本**（帳票レイアウトマスタからの行き来と
    同じ道）——2つ持つと、片方だけ直したときに「紙からは開けるのに
    レイアウトからは開けない」が作れる。 */
 WL.reportBlockMaster={
  open:async id=>{
   if(id==null||id==='')  {showToast&&showToast('この塊はマスタに行がありません',
     'この端末のマスタにまだ登録されていない塊です（マスタ管理 > 帳票ブロックを開くと作られます）。',5200);return}
   /* **マスタ管理へ移ってから開く**——帳票の画面から呼ばれるので、
      タブが出来上がるのを待つ必要がある（`rlyEditBlock`が待つ）。 */
   if(typeof openMasterMaint==='function')openMasterMaint('reportBlock');
   await rlyEditBlock(id);
  }};
 async function rlyEditBlock(id){
  const nav=document.querySelector('#masterMaintNav [data-master="reportBlock"]');
  if(!nav){rlySay('帳票ブロックのタブが見つかりません。',true);return}
  nav.click();
  /* 一覧が届いてから開く。**届かなければ一覧のまま**（黙って何もしない、を
     作らない）。 */
  for(let i=0;i<60;i++){
   const it=(maintState.items||[]).find(x=>String(x.id)===String(id));
   if(it){openMaintEditor(it);return}
   await new Promise(r=>setTimeout(r,100));
  }
  showToast&&showToast('塊を開けませんでした','帳票ブロックの一覧から選んでください。',5000);
 }


 /* 盤の登録簿へ名乗る（§9.324 R3）。 */
 WL.mm.registerSpecial('report-layout',{load:loadReportLayoutMaint,onEditorClose:renderReportLayout});
 Object.assign(WL.mm,{RB_PAGE_ROWS,bindFieldBuilders,forgetReportCaches,rbAsideHtml,rbBindAside});
})();
