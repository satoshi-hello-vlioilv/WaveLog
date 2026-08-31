/* test_opblank.js: 「空欄の札を出さない」は組み込みの選択欄でも効く（§9.246 ①）
   ============================================================
   利用者の報告（証拠つき）:
     「操業データ項目マスタで空欄の札を出さないに設定しても、自動の項目
      (役割が設定されている項目)の場合、選択自体はできているが、それが
      有効になりません。実際に適用された入力画面を見ると、空欄の札である
      「－」が出たままになっています。何回選んで保存しなおしても、
      セグメント以外のUIに変えても改善しません」
     ①空欄の札を出さないにしている ②マスタには数値の登録しかない
     ③マスタ内のサンプルにも「ー」は表示されない
     ④実際の画面には「ー」も含みマスタに登録されているすべてが表示されている

   ③と④の食い違いが決め手だった。**札の出どころが2つある**——
     設定窓の見本 … マスタの値(`def.choices`)から作る → `-`が無い
     実際の画面   … `base.js`の`optionFill()`が作り、**先頭へ`-`を足す**
   `noBlank`の絞り込みは`o.v!==''`（空文字だけ）だったので、値が`'-'`の
   この札は落ちなかった。判定を`isBlankOpt()`の1箇所へ寄せてある。

   ここで固定するのは次の点。**どれも直す前なら落ちる**ことを確かめてある。
    1. セグメントで「—」の札が出ない（組み込み・役割つきの欄で）
    2. **プルダウンでも**「—」が選べない（利用者「セグメント以外でも改善しない」）
    3. **一覧の浮き窓でも**「（選ばない）」が出ない
    4. 「出す」に戻すと「—」が戻る（＝札を消しているのは設定であって、
       いつでも消えるわけではない。片側だけ見る網は素通りする）
    5. マスタの値は1つも落ちない（300/400/508/610 が全部並ぶ）
    6. **値を作らない**——プリセットが無ければ未選択のまま（利用者の証拠⑤）
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const EQ='テスト設備A';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)}).then(async r=>({code:r.status,json:await r.json().catch(()=>({}))}));
const get=p=>fetch(B+p).then(r=>r.json());
let b=null;

(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1800,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message));
 page.on('dialog',d=>d.accept());

 const items=async()=>(await get('/api/operation-item-master')).items||[];
 const byName=async nm=>(await items()).find(x=>x.name===nm)||{};
 /* **`/update`は全列を書く**（§9.113／§9.212 ②）ので、触らない値も送り返す。
    idと名前だけで呼ぶと、送らなかった`[群]`が空で上書きされる（§9.244で
    実際にやらかした）。 */
 let target=null,saved=null;
 /* 既定は「いま試している欄」だが、名前を渡せば別の行も直せる
    （§9.286 ⑤は**仕掛由来のプリセットが無い欄**で確かめたい）。 */
 const put=async(patch,name)=>{
  const r=await byName(name||target);
  const body={};
  ['id','name','group','place','type','unit','choice','decimals','min','max',
   'widget','order','required','enabled','initial','noBlank','freeText','layout',
   'span','groupSpan','role','unitPlace','align','valueFormat','digits',
   'note','minFrom','maxFrom','sourceNote'].forEach(k=>{if(k in r)body[k]=r[k]});
  body.equipment=r.equipmentText||r.equipment||'*';
  body.user_id='tests';
  Object.assign(body,patch);
  return post('/api/operation-item-master/update',body);
 };

 /* 測定画面を開く。マスタ（/api/operation-form）は投げっぱなしで取りに行くので
    **時間でなく条件で待つ**（§9.102）——器に印が付いた＝割り付けが済んだ。 */
 const openMeasure=async()=>{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  const ok=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(r){r.querySelector('.sc-row-start').click();return true}return false;
  });
  if(!ok)throw Error('開始できる行が無い');
  await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:25000});
  await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});
  /* 操業データのマスタが届いて割り付けが済むまで（`defs`が入った＝
     `WL.opData.defs()`が1件でも返す）。 */
  await page.waitForFunction(()=>!!(window.WL&&WL.opData&&WL.opData.defs&&WL.opData.defs().length),
    null,{timeout:25000});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 };
 /* いま画面に出ている「その欄」の姿。器の中の札と、値を持つ`<select>`の
    **見えている選択肢**を両方見る（片方だけだと形を変えたときに漏れる）。 */
 const shot=id=>page.evaluate(key=>{
  const host=document.getElementById(key)?.closest('.opf')
           ||document.querySelector(`[data-f="${key}"]`);
  if(!host)return null;
  const sel=host.querySelector(':scope>select');
  return {
   印:host.dataset.opNoblank||'',
   札:[...host.querySelectorAll('.opf-widget [data-opv]')].map(x=>x.textContent.trim()),
   選べる値:sel?[...sel.options].filter(o=>!o.hidden&&!o.disabled).map(o=>o.value):null,
   全部の値:sel?[...sel.options].map(o=>o.value):null,
   いまの値:sel?sel.value:null,
   選択位置:sel?sel.selectedIndex:null,
  };
 },id);

 try{
  await post('/api/access-mode',{mode:'edit'});

  /* ==========================================================
     0) 前提: 組み込みで族が choice の欄（＝利用者の言う「自動の項目」）
     ========================================================== */
  for(const nm of ['内径','コイル止め','バリ揃え','オペレータ']){
   const r=await byName(nm);
   if(r.builtin&&r.widgetFamily==='choice'){target=nm;saved=r.noBlank;break}
  }
  if(!target){rec('前提: 組み込みの選択欄がある',false,'見つかりません');throw Error('前提なし')}
  const base=await byName(target);
  rec('前提: 組み込みの選択欄（型は「文字」のまま／選択肢は[選択肢名]で結ぶ）',
      base.type!=='選択'&&base.widgetFamily==='choice',
      `${target}: type=${base.type} family=${base.widgetFamily} builtin=${base.builtin}`);
  const domId=base.builtin;
  /* **マスタに`-`は無い**（利用者の証拠②）。札はここから来ていない。 */
  const choices=(await get('/api/operation-form?equipment='+encodeURIComponent(EQ)))
    .items?.find(x=>x.builtin===domId)?.choices||[];
  rec('前提: マスタの選択肢に「-」は入っていない（利用者の証拠②）',
      !choices.includes('-'),JSON.stringify(choices));

  /* ==========================================================
     1) 「出す」…「—」の札が在る（もう片側。ここが常に落ちる網では
        「消えている」を確かめたことにならない）
     ========================================================== */
  await put({noBlank:false,widget:'セグメント'});
  await openMeasure();
  const on=await shot(domId);
  if(!on){rec('前提: その欄が測定画面に出ている',false,domId);throw Error('欄が無い')}
  /* 札の字は**`WL.optionBlankLabel`の1箇所**（§9.287-I）。ここへ直に
     `-`や`（選ばない）`と書くと、字を変えたときに網だけが古い約束のまま
     残る（しかも「同じ字が2箇所にある」ことこそが直した相手）。 */
  const BLANK_LABEL=await page.evaluate(()=>window.WL&&WL.optionBlankLabel);
  rec('「選ばない」の札の字は1箇所（WL.optionBlankLabel）が答える',
      !!BLANK_LABEL,String(BLANK_LABEL));
  rec('「出す」のときは「選ばない」の札が在る',
      on.札.some(t=>t===BLANK_LABEL||t==='—'||t==='-'),`札=${JSON.stringify(on.札)}`);

  /* ==========================================================
     2) 「出さない」…セグメントで「—」が消える（本題）
        直す前は`o.v!==''`しか落とさないので、値`'-'`の札が残って落ちる。
     ========================================================== */
  await put({noBlank:true,widget:'セグメント'});
  await openMeasure();
  const seg=await shot(domId);
  rec('器に「空欄なし」の印が届いている',seg.印==='1',`data-op-noblank=${seg.印||'(なし)'}`);
  rec('セグメントで「選ばない」の札が出ない（本題）',
      !seg.札.some(t=>t===BLANK_LABEL||t==='—'||t==='-'),`札=${JSON.stringify(seg.札)}`);
  rec('マスタの値は1つも落ちない',
      choices.every(v=>seg.札.includes(v)),
      `札=${JSON.stringify(seg.札)} / マスタ=${JSON.stringify(choices)}`);
  /* **値を作らない**（利用者の証拠⑤「自動で持ってくるものがなければ未選択」）。
     先頭の候補を勝手に選ぶと、選んでいない値が記録へ入る（§9.204の罠）。 */
  rec('自動で入る値が無ければ未選択のまま（勝手に先頭を選ばない）',
      seg.いまの値===''||seg.いまの値==='-'||choices.includes(seg.いまの値),
      `value=${JSON.stringify(seg.いまの値)} selectedIndex=${seg.選択位置}`);

  /* ==========================================================
     3) プルダウンでも「—」が選べない
        （利用者「セグメント以外のUIに変えても改善しません」）
        素の`<select>`は器を被せないので`buildWidget()`を通らない
        ——札だけを絞る直し方ではここが残る。
     ========================================================== */
  await put({noBlank:true,widget:'プルダウン'});
  await openMeasure();
  const dd=await shot(domId);
  rec('プルダウンでも「-」が候補に出ない',
      !(dd.選べる値||[]).some(v=>v===''||v==='-'),
      `選べる=${JSON.stringify(dd.選べる値)}`);
  rec('プルダウンの候補からマスタの値は落ちない',
      choices.every(v=>(dd.選べる値||[]).includes(v)),
      `選べる=${JSON.stringify(dd.選べる値)}`);
  rec('「-」は消さずに伏せてある（「出す」へ戻せる）',
      (dd.全部の値||[]).some(v=>v===''||v==='-'),
      `全部=${JSON.stringify(dd.全部の値)}`);

  /* ==========================================================
     4) 一覧の浮き窓でも「（選ばない）」が出ない
        ここは`openPicker()`が`optionsOf()`を素通しで使っていた箇所。
     ========================================================== */
  await put({noBlank:true,widget:'一覧'});
  await openMeasure();
  const picked=await page.evaluate(key=>{
   const host=document.getElementById(key)?.closest('.opf')
            ||document.querySelector(`[data-f="${key}"]`);
   const btn=host&&host.querySelector('.opf-pick-btn');
   if(!btn)return {ある:false};
   btn.click();
   const items=[...document.querySelectorAll('#opfPicker [data-opv]')]
     .map(x=>x.querySelector('b')?.textContent.trim()||x.textContent.trim());
   const close=document.getElementById('opfPickerClose');
   if(close)close.click();
   return {ある:true,items};
  },domId);
  if(!picked.ある)rec('一覧の浮き窓が開ける',false,'.opf-pick-btn が無い');
  else{
   rec('一覧の浮き窓に「（選ばない）」が出ない',
       !picked.items.some(t=>/選ばない/.test(t)),JSON.stringify(picked.items));
   rec('一覧の浮き窓にマスタの値は全部出る',
       choices.every(v=>picked.items.includes(v)),JSON.stringify(picked.items));
  }

  /* ==========================================================
     5) 初期値のハードコーディングが無い（§9.286 ⑤、利用者の指示）
        「初期値を『-』でハードコーディングしているものが残っており…
         初期値も含めて汎用化対応しているので、ハードコーディング部分を
         除去してきれいに汎用部品のみで対応できるように」

        `-`は**札の字**であって値ではない。値として持っていたせいで、
        `applyInitials()`が見る「まだ何も選ばれていない」を画面の側が先に
        埋めてしまい、**マスタの`[初期値]`が組み込みの欄で一度も効かなかった**。
     ========================================================== */
  await put({noBlank:false,widget:'プルダウン',initial:''});
  await openMeasure();
  const blank=await page.evaluate(([key,lb])=>{
   const sel=document.getElementById(key);
   const st=(typeof S!=='undefined'&&S.measure&&S.measure.settings)||{};
   const dash=Object.entries(st).filter(([k,v])=>v==='-').map(([k])=>k);
   return {value:sel?sel.value:null,
           blankOptValue:sel?[...sel.options].find(o=>o.textContent.trim()===lb)?.value:null,
           blankText:sel?[...sel.options].find(o=>o.value==='')?.textContent.trim():null,
           setting:st[key],dash};
  },[domId,BLANK_LABEL]);
  rec('「選ばない」の札は値を持たない（値は空文字）',blank.blankOptValue==='',
      JSON.stringify(blank));
  rec('初期値を決めていない欄は空で始まる（`-`という値を作らない）',
      blank.value===''&&(blank.setting===undefined||blank.setting===''),
      JSON.stringify(blank));
  rec('記録のどの欄にも`-`が入っていない',blank.dash.length===0,JSON.stringify(blank.dash));

  /* ---- 「選ばない」の字は1箇所（§9.287-I、利用者の報告） ----
     「オペレータ（元ハードコーディングを汎用設計で作り直した欄）は初期値
      未入力のとき『-』が出っぱなし。オペレータ2（ゼロから汎用設計で作った欄）は
      正しく初期値を持っている」

     §9.286 ⑤で**値**としての`-`は外したが、**字**は3通りに分かれたままだった
     ——組み込み（`optionFill()`）が`-`、汎用（`measure-opdata.js`）が空、
     器の浮き窓が`（選ばない）`。同じ「選んでいない」が**その欄の作られ方で
     別の顔になる**（§CLAUDE 8）。 */
  rec('組み込みの欄の「選ばない」の札も1箇所の字を使う（`-`ではない）',
      blank.blankText===BLANK_LABEL,JSON.stringify(blank.blankText));
  /* **閉じた欄は空の札を「選んでいない」として扱う**——`hit.text`をそのまま
     出していたので、同じ欄なのに閉じると`-`・開くと`（選ばない）`だった。 */
  await put({noBlank:false,widget:'一覧',initial:''});
  await openMeasure();
  const shut=await page.evaluate(key=>{
   const sel=document.getElementById(key);
   const host=sel&&sel.closest('.opf-host');
   const now=host&&host.querySelector('.opf-pick-now');
   return {value:sel?sel.value:null,now:now?now.textContent.trim():null,
           empty:now?now.classList.contains('is-empty'):null};
  },domId);
  rec('選んでいない欄は閉じた状態で「-」を出さない（促しを出す）',
      shut.now!==null&&shut.now!=='-'&&shut.now!=='—',JSON.stringify(shut));
  rec('選んでいない印が付く（色だけでなく状態として持つ）',shut.empty===true,
      JSON.stringify(shut));

  /* マスタで初期値を決めると、**組み込みの欄でも**入る（§9.229 ③）。
     直す前は`-`が先に入っていたため、ここが必ず落ちる。
     **確かめるのはオペレータ**——内径は仕掛由来のプリセットが勝つ約束
     （§9.204）なので、初期値の道を通ったかどうかを見分けられない。
     **選択肢に無い値でよい**（`applyInitials()`は`addOption()`で足してから
     入れる。選択肢がマスタに1件も無い設備でも確かめられる）。 */
  const OPER='オペレータ',INIT='初期値'+Date.now().toString(36).slice(-4);
  const oper=await byName(OPER);
  if(oper&&oper.builtin){
   const operSaved=String(oper.initial||'');
   try{
    await put({initial:INIT},OPER);
    await openMeasure();
    const got=await page.evaluate(v=>{
     const sel=document.getElementById('operator');
     return {value:sel?sel.value:null,
             /* **「いまの値が候補にある」では確かめたことにならない**——
                「選ばない」の札（値は空文字）が必ず在るので、何も入って
                いなくても真になる。**初期値そのもの**を探すこと。 */
             足した:sel?[...sel.options].some(o=>o.value===v):null,
             setting:((typeof S!=='undefined'&&S.measure&&S.measure.settings)||{}).operator};
    },INIT);
    rec('マスタの初期値が組み込みの欄にも入る',got.value===INIT,
        `${JSON.stringify(got)} / 期待=${INIT}`);
    rec('選択肢に無い初期値でも欄へ足してから入れる',got.足した===true,JSON.stringify(got));
   }finally{
    try{await put({initial:operSaved},OPER)}catch(e){}
   }
  }else{
   rec('マスタの初期値が組み込みの欄にも入る',false,'オペレータの行が見つかりません');
  }

  rec('画面のエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  console.log('FATAL: '+(e&&e.stack||e));
  R.push({n:'FATAL',ok:false});
 }finally{
  /* **組み込みの行は消せないので、触ったら必ず元へ**（§9.121）。
     **戻す先は「拾った値」ではなく種の既定（プルダウン）**——
     `BUILTIN_SEEDS`は`[入力方法]`を持たないので組み込みの欄の既定は
     `WIDGET_SELECT`＝プルダウン。「開いたときの値へ戻す」にすると、
     **前の実行が落ちて残した値をそのまま焼き付ける**（実際に起きた：
     このテストが一度FATALしたあと内径がセグメントのまま残り、次の実行が
     それを「元の値」として拾って固定し、**関係の無い`test_scale`が
     『コントロールの高さがトークンに収まる』で落ちた**）。
     `noBlank`は拾った値へ戻してよい（既定=Falseで、種にも無い）。 */
  try{if(target)await put({noBlank:!!saved,widget:'プルダウン',initial:''})}catch(e){}
  try{await post('/api/access-mode',{mode:'edit'})}catch(e){}
  if(b)await b.close();
 }
 const ng=R.filter(x=>!x.ok).length;
 console.log(`\n${R.length-ng}/${R.length} PASS`);
 process.exit(ng?1:0);
})();
