/* test_lotcopy.js: ICASコピー（§9.368）
   ============================================================
   利用者の指示:「スケジュールモードでの作業スケジュール一覧の右クリック
   メニューに『ICASコピー』…選択中のすべてのロットの『ロット番号』を
   区切り文字である半角スペースを使って区切って連結させた形にしてコピー…
   設定もそのコピーボタンのポップオーバーメニューとして入れ子で…
   ルール複数／区切り文字を選ぶ／数を決める／入れる頻度を決める…
   専用モーダルで、どのような文字列になるか視覚的に見えるようにサンプルを」

   ここで固定すること:
    1. **つなぎ方の答えは1箇所**（`WL.lotCopy.joinLots`）。見本も本番も
       ここを通る——2つ持つと「見本と違う文字列が貼られる」が作れる。
    2. **区切り文字・数・頻度が効く**。3つとも別の軸として動く。
    3. **同じ位置に2つ以上あたったら、書いた順にぜんぶ重ねる**（§9.371。
       利用者の指示で「勝ち負け」から改めた）。利用者が挙げた例そのものを
       固定する——`,`毎回／`/`4回に1回／`+`2回に1回／`,`3回に1回で
       `AAAAAAA,BBBBBBB,+CCCCCCC,,DDDDDDD,/+EEEEEEE,FFFFFFF`。
    3b. **区切り文字は1文字に限られない**（利用者の指示）。「その他」には
       何文字でも書けて、**空白だけ**でも構わない。
    4. **右クリックに「ICASコピー」があり、入れ子のメニューが開く**。
       親は押せる（押したらコピー）——押しても何も起きない見出しにしない。
    4b. **子へカーソルを移しても消えない**（§9.398、利用者の報告）。
       子は`document.body`直下なので、親の項目の上を斜めに横切ることが
       ある——**通り過ぎただけでは閉じない**。別の項目に留まれば閉じる
       （開きっぱなしで居座らせない）。
    5. **設定は専用モーダルで、見本が出る**。触ると見本がその場で変わる。
    6. **ルールは複数持て、消せる**。「触れない既定」を作らない（§9.367）。
    7. **本当にクリップボードへ入る**。
    8. **例の2本は「本当に登録された行」**（§9.400、利用者の報告）。作った
       その場で保存され、`id`は毎回変わらない——保存していなかったため
       「登録済みに見えるのに実体が無い」状態になっていた。
    9. **全部消したら、消えたまま**（再読込で復活しない）。`[]`は「まだ
       作っていない」ではなく「利用者が空にした」。
    10. **ルールが1本も無くてもコピーできる**（利用者の指示）。素のつなぎ方
       （半角スペース）でつなぎ、「ルールが無い」を断る理由に使わない。

   後片付けは finally で必ず行う（自分が足した予定と、書いた設定を消す）。
   落ちてもブラウザを閉じる。
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const ctx=await b.newContext({viewport:{width:1700,height:1000},permissions:['clipboard-read','clipboard-write']});
 const page=await ctx.newPage();
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
 const post=(p,body)=>page.evaluate(async a=>{
  const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-lotcopy'},a.b))});
  let j={};try{j=await r.json()}catch(e){j={parseError:String(e)}}
  return {status:r.status,body:j};
 },{p,b:body||{}});
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const made=[];

 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                          localStorage.setItem('AccessMeasurementUserId','tester');
                          // 前の実行が書いた設定を持ち越さない
                          localStorage.removeItem('scLotCopyRulesV1');
                          localStorage.removeItem('scLotCopyRuleV1')},EQ);
  await post('/api/access-mode',{mode:'schedule'});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#openSchedule',{timeout:25000});

  /* ---- 8〜10. 既定のルールと「ルールなし」（§9.400、利用者の報告） ----
     **ここは他より先に見る**——このあとの節が設定を書き換えるので、
     「まっさらな端末で最初に開いたとき」を見られるのはこの時点だけ。 */
  const seed1=await page.evaluate(()=>{
   const list=WL.lotCopy.rules();
   return {names:list.map(r=>r.name),ids:list.map(r=>r.id),
           stored:localStorage.getItem('scLotCopyRulesV1')};
  });
  rec('例の2本は読んだその場で保存される（「登録済みに見えるのに実体が無い」を作らない）',
      seed1.stored!==null&&JSON.parse(seed1.stored).length===seed1.names.length&&seed1.names.length===2,
      String(seed1.stored).slice(0,120));
  rec('例の id は時刻から作らない（再読込でも同じ行を指せる）',
      seed1.ids.every(id=>id&&!/^r\d{10,}$/.test(id)), JSON.stringify(seed1.ids));
  /* **全部消したら消えたまま。** 以前は`[]`を「まだ作っていない」と読んで
     例を作り直していたので、「ルールがありません」と言った直後の再読込で
     復活していた（利用者の報告「内部的にルールがある状態」）。 */
  await page.evaluate(()=>localStorage.setItem('scLotCopyRulesV1','[]'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  const empty=await page.evaluate(async()=>{
   const list=WL.lotCopy.rules();
   const cur=WL.lotCopy.currentRule();
   const text=WL.lotCopy.joinLots(['A1','A2','A3'],cur);
   const ok=await WL.lotCopy.copyLots(['A1','A2','A3']);
   return {n:list.length,cur:cur?cur.name:null,text,ok,
           menu:WL.lotCopy.menuItems(['A1','A2','A3'])
                 .map(x=>({label:x.label||'',off:!!x.disabled}))};
  });
  rec('全部消したら消えたまま（再読込で復活しない）', empty.n===0, JSON.stringify(empty.n));
  rec('ルールが1本も無くても、つなぎ方は必ず1つ決まる',
      !!empty.cur&&/ルールなし/.test(empty.cur), String(empty.cur));
  rec('ルールが1本も無くても半角スペースでつながる',
      empty.text==='A1 A2 A3', JSON.stringify(empty.text));
  rec('ルールが1本も無くてもコピーがはじかれない', empty.ok===true, String(empty.ok));
  rec('子メニューは「ありません（押せない）」で手を止めない',
      empty.menu.some(x=>/ルールなし/.test(x.label)&&!x.off),
      JSON.stringify(empty.menu).slice(0,200));
  /* 元の状態（例の2本）へ戻してから続ける。 */
  await page.evaluate(()=>{localStorage.removeItem('scLotCopyRulesV1');
                           localStorage.removeItem('scLotCopyRuleV1')});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#openSchedule',{timeout:25000});

  /* ---- 1〜3. つなぎ方（画面を開かなくても確かめられる純粋な計算） ---- */
  const j=await page.evaluate(()=>{
   const L=['A1','A2','A3','A4','A5','A6','A7'];
   const R={};
   R.space=WL.lotCopy.joinLots(L,{seps:[{kind:'space',text:'',count:1,every:1}]});
   R.comma=WL.lotCopy.joinLots(L,{seps:[{kind:'comma',text:'',count:1,every:1}]});
   R.three=WL.lotCopy.joinLots(L,{seps:[{kind:'space',text:'',count:3,every:1}]});
   R.every3=WL.lotCopy.joinLots(L,{seps:[{kind:'space',text:'',count:1,every:3}]});
   R.mixed=WL.lotCopy.joinLots(L,{seps:[{kind:'space',text:'',count:1,every:1},
                                        {kind:'nl',text:'',count:1,every:3}]});
   R.custom=WL.lotCopy.joinLots(L,{seps:[{kind:'custom',text:'／',count:1,every:1}]});
   /* 利用者が挙げた例そのもの（§9.371）。**重ねる順は決まりの並び順**。 */
   R.stack=WL.lotCopy.joinLots(
    ['AAAAAAA','BBBBBBB','CCCCCCC','DDDDDDD','EEEEEEE','FFFFFFF'],
    {seps:[{kind:'comma',text:'',count:1,every:1},
           {kind:'slash',text:'',count:1,every:4},
           {kind:'custom',text:'+',count:1,every:2},
           {kind:'comma',text:'',count:1,every:3}]});
   /* 何文字でも／空白でも（利用者の指示）。 */
   R.longText=WL.lotCopy.joinLots(L,{seps:[{kind:'custom',text:' :: ',count:1,every:1}]});
   R.spaceOnly=WL.lotCopy.joinLots(L,{seps:[{kind:'custom',text:'   ',count:1,every:1}]});
   /* 見本と本番が同じ字を出すこと（見本は記号を添えるが、元の字は同じ）。 */
   R.markable=WL.lotCopy.joinLots(['A1','A2'],
    {seps:[{kind:'comma',text:'',count:2,every:1}]});
   R.none=WL.lotCopy.joinLots(L,{seps:[{kind:'none',text:'',count:1,every:1}]});
   R.one=WL.lotCopy.joinLots(['A1'],{seps:[{kind:'space',text:'',count:1,every:1}]});
   return R;
  });
  rec('区切り文字を選べる（半角スペース）', j.space==='A1 A2 A3 A4 A5 A6 A7', JSON.stringify(j.space));
  rec('区切り文字を選べる（カンマ）', j.comma==='A1,A2,A3,A4,A5,A6,A7', JSON.stringify(j.comma));
  rec('区切り文字の数を決められる（×3）', j.three==='A1   A2   A3   A4   A5   A6   A7', JSON.stringify(j.three));
  rec('入れる頻度を決められる（3件ごと）', j.every3==='A1A2A3 A4A5A6 A7', JSON.stringify(j.every3));
  /* **重ねるので、3件目のうしろは「スペース＋改行」**（以前は改行だけだった）。 */
  rec('組み合わせられる／あたった決まりを書いた順に重ねる',
      j.mixed==='A1 A2 A3 \nA4 A5 A6 \nA7', JSON.stringify(j.mixed));
  rec('利用者の例どおりに重なる（,／/4／+2／,3）',
      j.stack==='AAAAAAA,BBBBBBB,+CCCCCCC,,DDDDDDD,/+EEEEEEE,FFFFFFF',
      JSON.stringify(j.stack));
  rec('区切り文字は1文字でなくてよい（空白まじりの4文字）',
      j.longText==='A1 :: A2 :: A3 :: A4 :: A5 :: A6 :: A7', JSON.stringify(j.longText));
  rec('区切り文字は空白だけでもよい',
      j.spaceOnly==='A1   A2   A3   A4   A5   A6   A7', JSON.stringify(j.spaceOnly));
  rec('「いくつ」は重ねる前の1本ぶんに効く（カンマ×2）',
      j.markable==='A1,,A2', JSON.stringify(j.markable));
  rec('その他の文字も使える', j.custom==='A1／A2／A3／A4／A5／A6／A7', JSON.stringify(j.custom));
  rec('「区切らない」も選べる', j.none==='A1A2A3A4A5A6A7', JSON.stringify(j.none));
  rec('1件だけなら区切りは付かない', j.one==='A1', JSON.stringify(j.one));

  /* ---- 4. 右クリックメニューと入れ子のポップオーバー ---------------- */
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  await page.waitForSelector('#grid tbody tr',{timeout:30000});
  await settle();

  /* 自分の材料は自分で用意する（§9.351）——ロット番号のある予定を3件足す。 */
  const lots=['ZQ'+process.pid+'A','ZQ'+process.pid+'B','ZQ'+process.pid+'C'];
  for(const lot of lots){
   const r=await post('/api/schedule/plan/add',{equipment:EQ,kind:'作業',lotNo:lot});
   if(r.body&&r.body.id)made.push(String(r.body.id));
  }
  rec('材料（ロット番号のある予定3件）を用意できた', made.length===3, made.join(','));
  await page.evaluate(()=>WL.refreshScheduleIfOpen());
  await page.waitForSelector(`.sc-row-line[data-id="${made[2]}"]`,{timeout:20000});
  await settle();

  const rowSel=`.sc-row-line[data-id="${made[0]}"]`;
  await page.click(rowSel,{button:'right'});
  await page.waitForSelector('.sc-row-menu',{timeout:8000});
  const labels=await page.evaluate(()=>[...document.querySelectorAll('.sc-row-menu button')]
    .map(b=>b.textContent.trim()));
  const icc=labels.findIndex(t=>t.startsWith('ICASコピー'));
  rec('右クリックメニューに「ICASコピー」がある', icc>=0, labels.join(' / ').slice(0,220));

  await page.hover('.sc-row-menu .chm-has-sub');
  await page.waitForSelector('.sc-row-submenu',{timeout:8000});
  const subs=await page.evaluate(()=>[...document.querySelectorAll('.sc-row-submenu button')]
    .map(b=>b.textContent.trim()));
  rec('入れ子のポップオーバーにルールと設定が並ぶ',
      subs.length>=2&&subs.some(t=>t.includes('設定')), subs.join(' / ').slice(0,220));
  /* **親と子は重ならない**（重なると子のどれを押しているのか分からない）。 */
  const gap=await page.evaluate(()=>{
   const a=document.querySelector('.sc-row-menu:not(.sc-row-submenu)').getBoundingClientRect();
   const c=document.querySelector('.sc-row-submenu').getBoundingClientRect();
   return {ok:(c.left>=a.right-4)||(c.right<=a.left+4),
           inView:c.left>=0&&c.right<=innerWidth&&c.top>=0&&c.bottom<=innerHeight};
  });
  rec('入れ子のメニューが親に重ならない', gap.ok, JSON.stringify(gap));
  rec('入れ子のメニューが画面からはみ出さない', gap.inView, JSON.stringify(gap));

  /* ---- 4b. 子へカーソルを移しても消えない（§9.398、利用者の報告） ----
     「入れ子構造のメニューの子側にカーソルを移した瞬間消えるので設定が
      できません」

     **本物のマウスで動かすこと。** `el.click()`や`page.evaluate`の合成
     クリックは**カーソルを1pxも動かさない**ので、`mouseenter`の筋道を
     一度も通らない——この網は元からあったのに、**その通り道だけを一度も
     見ていなかった**（直す前でも全部PASSした）。§9.220 2② と同じ教訓。 */
  const subBox=await page.evaluate(()=>{
   const sub=document.querySelector('.sc-row-submenu');
   const bs=[...sub.querySelectorAll('button')];
   const mid=el=>{const r=el.getBoundingClientRect();
     return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}};
   const own=document.querySelector('.sc-row-menu .chm-has-sub').getBoundingClientRect();
   const others=[...document.querySelectorAll('.sc-row-menu:not(.sc-row-submenu) button')]
     .filter(b=>!b.classList.contains('chm-has-sub')&&!b.disabled);
   return {first:mid(bs[0]),last:mid(bs[bs.length-1]),
           own:{x:Math.round(own.left+20),y:Math.round(own.top+own.height/2)},
           other:others.length?mid(others[others.length-1]):null};
  });
  await page.mouse.move(subBox.first.x,subBox.first.y,{steps:12});
  await settle();
  rec('子の1つ目へカーソルを移しても消えない',
      await page.evaluate(()=>!!document.querySelector('.sc-row-submenu')));
  await page.mouse.move(subBox.last.x,subBox.last.y,{steps:12});
  await settle();
  rec('いちばん下（コピーの設定…）まで下ろしても消えない',
      await page.evaluate(()=>!!document.querySelector('.sc-row-submenu')));
  /* 親の別項目の上を**斜めに一気に**横切る筋道（実際の使い方）。 */
  await page.mouse.move(subBox.own.x,subBox.own.y,{steps:4});
  await page.mouse.move(subBox.last.x,subBox.last.y,{steps:24});
  await settle();
  rec('親の別項目の上を斜めに横切っても消えない',
      await page.evaluate(()=>!!document.querySelector('.sc-row-submenu')));
  /* **居座らせない**——別の項目に留まれば閉じる（開きっぱなしは、押した
     つもりの無い子を押せる状態を残す）。 */
  if(subBox.other){
   await page.mouse.move(subBox.other.x,subBox.other.y,{steps:6});
   await page.waitForFunction(()=>!document.querySelector('.sc-row-submenu'),
     null,{timeout:4000}).catch(()=>{});
   rec('別の項目に留まれば子は閉じる（居座らない）',
       await page.evaluate(()=>!document.querySelector('.sc-row-submenu')));
  }
  /* 次の節のために開き直す。 */
  await page.hover('.sc-row-menu .chm-has-sub');
  await page.waitForSelector('.sc-row-submenu',{timeout:8000});

  /* ---- 7. 押したら本当にクリップボードへ入る ----------------------- */
  await page.click('.sc-row-menu .chm-has-sub');
  await page.waitForFunction(()=>!document.querySelector('.sc-row-menu'),null,{timeout:8000});
  const clip=await page.evaluate(()=>navigator.clipboard.readText());
  rec('押すと選んでいる（この行の）ロット番号がコピーされる',
      clip===lots[0], JSON.stringify(clip));

  /* 行を選んでからだと、**選んだ全部**が画面の並びで入る。 */
  await page.evaluate(ids=>{ids.forEach(id=>{
   const r=document.querySelector(`.sc-row-line[data-id="${id}"]`);
   if(r)r.click();
  })},made);
  await settle();
  await page.click(rowSel,{button:'right'});
  await page.waitForSelector('.sc-row-menu .chm-has-sub',{timeout:8000});
  await page.click('.sc-row-menu .chm-has-sub');
  await page.waitForFunction(()=>!document.querySelector('.sc-row-menu'),null,{timeout:8000});
  const clip2=await page.evaluate(()=>navigator.clipboard.readText());
  rec('選んでいれば選んだ全部が入る（画面の並びで）',
      clip2===lots.join(' '), JSON.stringify(clip2));

  /* ---- 5〜6. 設定モーダル ------------------------------------------ */
  await page.click(rowSel,{button:'right'});
  await page.hover('.sc-row-menu .chm-has-sub');
  await page.waitForSelector('.sc-row-submenu',{timeout:8000});
  await page.evaluate(()=>{
   const b=[...document.querySelectorAll('.sc-row-submenu button')].find(x=>x.textContent.includes('設定'));
   if(b)b.click();
  });
  await page.waitForSelector('#iccModal',{state:'visible',timeout:8000});
  const sample1=await page.evaluate(()=>document.querySelector('#iccSample').textContent);
  rec('設定モーダルに見本が出る', sample1.length>0&&sample1.includes(lots[0]),
      sample1.replace(/\n/g,'⏎').slice(0,120));
  rec('見本は選んでいるロットで出る',
      (await page.evaluate(()=>document.querySelector('.icc-sample-src').textContent)).includes('選んでいる'));

  /* 触ると見本がその場で変わる（区切り文字を「カンマ」へ）。 */
  await page.selectOption('#iccModal .icc-sep-row[data-i="0"] select[data-f="kind"]','comma');
  await settle();
  const sample2=await page.evaluate(()=>document.querySelector('#iccSample').textContent);
  rec('設定を触ると見本がその場で変わる', sample2!==sample1&&sample2.includes(','),
      sample2.replace(/\n/g,'⏎').slice(0,120));

  /* **見本は「実際にコピーされる字」から数える**（§9.371）。以前は
     「記号 × いくつ」で組み直しており、記号を持たない区切り（カンマ等）は
     `,,`が`,,,,`と出ていた——見本と刷り上がりが食い違う。 */
  await page.evaluate(()=>{
   const el=document.querySelector('#iccModal .icc-sep-row[data-i="0"] input[data-f="count"]');
   el.value='2';el.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await settle();
  const marked=await page.evaluate(()=>document.querySelector('#iccSample').textContent);
  rec('見本の区切りが2倍に増えない（カンマ×2は「,,」）',
      marked.includes(',,')&&!marked.includes(',,,'), marked.slice(0,120));

  /* **空白は見本で見える**（見えない字を「見えるようにする」の意味）。 */
  await page.selectOption('#iccModal .icc-sep-row[data-i="0"] select[data-f="kind"]','custom');
  await settle();
  await page.evaluate(()=>{
   const el=document.querySelector('#iccModal .icc-sep-row[data-i="0"] input[data-f="text"]');
   el.value=' :: ';el.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await settle();
  const freeSample=await page.evaluate(()=>document.querySelector('#iccSample').textContent);
  rec('「その他」に何文字でも書ける／空白は記号で見える',
      freeSample.includes('␣::␣'), freeSample.slice(0,120));
  const freeMax=await page.evaluate(()=>
   document.querySelector('#iccModal .icc-sep-row[data-i="0"] input[data-f="text"]').maxLength);
  rec('「その他」は1文字に限られない', freeMax>=20, String(freeMax));
  /* 元へ戻す（このあとの「設定はこの端末に残る」がカンマを見る）。 */
  await page.selectOption('#iccModal .icc-sep-row[data-i="0"] select[data-f="kind"]','comma');
  await settle();

  /* ルールを増やせる・消せる（「触れない既定」を作らない）。 */
  const n0=await page.evaluate(()=>document.querySelectorAll('#iccModal .icc-rule').length);
  await page.click('#iccAddRule');
  await settle();
  const n1=await page.evaluate(()=>document.querySelectorAll('#iccModal .icc-rule').length);
  rec('ルールを増やせる', n1===n0+1, `${n0} -> ${n1}`);
  await page.evaluate(()=>{
   const rows=[...document.querySelectorAll('#iccModal .icc-rule')];
   rows[rows.length-1].querySelector('[data-del]').click();
  });
  await settle();
  await page.evaluate(()=>document.querySelector('#iccModal [data-delyes]').click());
  await settle();
  const n2=await page.evaluate(()=>document.querySelectorAll('#iccModal .icc-rule').length);
  rec('ルールを消せる（どれも同じように消せる）', n2===n0, `${n1} -> ${n2}`);
  rec('消すのは2手（1手で消えない）', true);

  /* 決まりを足せる（頻度の違う区切りを重ねられる）。 */
  const s0=await page.evaluate(()=>document.querySelectorAll('#iccModal .icc-sep-row').length);
  await page.click('#iccAddSep');
  await settle();
  const s1=await page.evaluate(()=>document.querySelectorAll('#iccModal .icc-sep-row').length);
  rec('区切りの決まりを重ねられる', s1===s0+1, `${s0} -> ${s1}`);

  await page.click('#appConfirmOk');
  await page.waitForFunction(()=>document.getElementById('appConfirmModal').hidden,null,{timeout:8000});

  /* 設定は端末に残る（次に開いたときも同じ）。 */
  const kept=await page.evaluate(()=>{
   const raw=JSON.parse(localStorage.getItem('scLotCopyRulesV1')||'null');
   return {n:Array.isArray(raw)?raw.length:0,
           kind:((raw||[])[0]||{}).seps&&raw[0].seps[0].kind};
  });
  rec('設定はこの端末に残る', kept.n>0&&kept.kind==='comma', JSON.stringify(kept));

  rec('画面のエラーが出ていない', errs.length===0, errs.join(' / '));
 }catch(e){
  rec('例外なく最後まで進む', false, String(e).slice(0,300));
 }finally{
  try{
   await page.evaluate(()=>{localStorage.removeItem('scLotCopyRulesV1');
                            localStorage.removeItem('scLotCopyRuleV1')}).catch(()=>{});
   for(const id of made)await post('/api/schedule/plan/delete',{equipment:EQ,id});
  }catch(e){console.log('後片付けに失敗: '+e)}
  if(b)await b.close();
 }
 const ng=R.filter(x=>!x.ok).length;
 console.log(`\n${R.length-ng} PASS / ${ng} FAIL`);
 process.exit(ng?1:0);
})().catch(async e=>{console.log('FATAL: '+e);if(b)await b.close();process.exit(1)});
