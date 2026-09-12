/* test_scframe.js: 空の日付・直の枠（§9.238 ②）
   ------------------------------------------------------------
   利用者の指示:
    「予定を少し飛ばして設定する場合に、何も予定がない領域にセットできる、
     空の日付や直の枠を登録できるようにしたいです。これを作ると、日にちや
     直をいくつか飛ばして、先のスケジュールを先に決めることができるように
     なるので、そういった都合よく使える枠を実装してください。スケジュールが
     押し出してくる際は連動してロットが自然にその設定枠に入るようにします」

   ここで固定すること:
    1. 入口があり、コメントと同じ作法（押す／掴んで落とす）で入れられる
    2. **中身の無い枠は作らない**——日付を聞いてから入れる（§4）
    3. 枠は**自分では時間を使わない**（見積0分）
    4. 枠の**次の予定が、選んだ日・選んだ直の頭から始まる**（これが本体）
    5. 枠の**手前の予定は動かない**
    6. **起点が枠を追い越していたら何もしない**（reached）——これが利用者の
       言う「押し出してくる際は連動してロットが自然にその設定枠に入る」。
       過去日の枠で同じ道を通す。
    7. 直の候補は**勤務形態マスタから引く**（画面に書き写さない・§9.163）
    8. ダブルクリックで日付・直を変えられる／右クリックにも入口がある
    9. 予定から外せる

   **確かめるときは「枠の次の予定」まで見ること**——枠が行として並ぶことだけを
   見る網は、時刻をまったく動かさない実装でも通る。 */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const W=require('./lib/wait.js');    // 待ちは1箇所の道具で置く（§9.347）
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';

const two=n=>String(n).padStart(2,'0');
const isoDay=d=>`${d.getFullYear()}-${two(d.getMonth()+1)}-${two(d.getDate())}`;

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 const setMode=m=>page.evaluate(async mm=>{await fetch('/api/access-mode',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:mm})})},m);
 const post=(p,body)=>page.evaluate(async a=>{
  const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-scframe'},a.b))});
  let j={};try{j=await r.json()}catch(e){}
  return {status:r.status,body:j};
 },{p,b:body||{}});
 const plan=()=>page.evaluate(async e=>{
  const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e));
  return (await r.json()).entries||[];
 },EQ);
 const made=[];

 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                          localStorage.setItem('AccessMeasurementUserId','tester')},EQ);
  await setMode('schedule');
  await post('/api/schedule/session/acquire',{equipment:EQ});

  /* ---- 0) 直の候補は勤務形態マスタから来る ---- */
  const shifts=await page.evaluate(async e=>{
   const r=await fetch('/api/schedule/shift-pattern-master?equipment='+encodeURIComponent(e));
   const j=await r.json();
   const out=[];
   (j.items||[]).forEach(p=>(p.segments||[]).forEach(s=>out.push({name:s.name,start:s.start})));
   return out;
  },EQ);
  rec('直の候補を勤務形態マスタから引ける',shifts.length>0,JSON.stringify(shifts).slice(0,140));
  const shift=shifts[0]||null;

  /* ---- 1) 枠を「既存の予定の手前」へ入れる ----
     **末尾へ入れても何も確かめられない**（後続が無い）ので、必ず手前へ。 */
  const before=await plan();
  const movable=before.filter(e=>e.kind==='作業'&&e.reorderable&&e.parentId==null);
  rec('動かせる予定がフィクスチャにある',movable.length>=2,`${movable.length}件`);
  const anchor=movable[movable.length-1];        // この行の手前へ枠を入れる
  const ahead=movable[0];                        // 枠より前の行（動いてはいけない）
  const aheadStart0=ahead.plannedStart;

  const target=new Date();target.setDate(target.getDate()+9);
  const day=isoDay(target);
  const add=await post('/api/schedule/plan/add',
    {equipment:EQ,kind:'枠',position:`before:${anchor.id}`,
     detail:{frameDate:day,frameShift:shift?shift.name:'',frameNote:'先の予定を先に決める'}});
  const frameId=add.body&&add.body.id;
  if(frameId)made.push(frameId);
  rec('日付・直の枠を予定の手前へ入れられる',add.status===200&&!!frameId,
      `${add.status} ${JSON.stringify(add.body).slice(0,90)}`);

  /* ---- 2) 日付の無い枠は断る（中身の無い行を作らない・§4） ---- */
  const bad=await post('/api/schedule/plan/add',{equipment:EQ,kind:'枠',detail:{frameShift:'1直'}});
  rec('日付の無い枠は断る',bad.status>=400&&/日付/.test(String(bad.body&&bad.body.error||'')),
      `${bad.status} ${String(bad.body&&bad.body.error||'').slice(0,60)}`);

  /* ---- 3) 枠は時間を使わず、次の予定がその日・その直から始まる ---- */
  const after=await plan();
  const fr=after.find(e=>String(e.id)===String(frameId));
  const at=after.findIndex(e=>String(e.id)===String(frameId));
  const next=after.slice(at+1).find(e=>e.parentId==null&&e.plannedStart);
  rec('枠は「枠」という区分で並ぶ',!!fr&&fr.kind==='枠',JSON.stringify(fr&&{kind:fr.kind,state:fr.state}));
  rec('枠の見積は0分（自分では時間を使わない）',
      !!fr&&fr.estimate&&Number(fr.estimate.minutes)===0,JSON.stringify(fr&&fr.estimate));
  rec('枠は「いつから・どれだけ空けたか」を返す',
      !!fr&&!!fr.frame&&fr.frame.date===day&&Number.isFinite(Number(fr.frame.gapMinutes)),
      JSON.stringify(fr&&fr.frame));
  /* **これが本体。** 枠の次の予定が、選んだ日・選んだ直の頭から始まる。 */
  const nextAt=next&&next.plannedStart?new Date(next.plannedStart):null;
  rec('枠の次の予定は、選んだ日から始まる',
      !!nextAt&&isoDay(nextAt)===day,
      JSON.stringify({枠:day,次:next&&next.plannedStart,件:next&&(next.lotNo||next.title)}));
  if(shift&&shift.start){
   const [h,m]=String(shift.start).split(':').map(Number);
   rec('枠の次の予定は、選んだ直の開始時刻から始まる',
       !!nextAt&&nextAt.getHours()===h&&nextAt.getMinutes()===m,
       JSON.stringify({直:shift.name,開始:shift.start,次:next&&next.plannedStart}));
  }else{
   rec('枠の次の予定は、選んだ直の開始時刻から始まる',true,'この設備に勤務区分がありません');
  }
  /* 枠自身は場所だけ取る（次の予定と同じ時刻に居る＝時間を食っていない）。 */
  rec('枠自身は時間を食っていない（次の予定と同じ時刻に居る）',
      !!fr&&!!next&&fr.plannedStart===next.plannedStart,
      JSON.stringify({枠:fr&&fr.plannedStart,次:next&&next.plannedStart}));
  /* ---- 4) 枠の手前の予定は動かない ----
     **時刻の一致で見ないこと**（§9.284）。予定の起点は展開のたびに「いま」から
     引き直す（§9.198）ので、2回の`plan()`のあいだに**壁時計のぶんだけ必ず動く**。
     しかも起点は5分刻みへ切り上げるので、5分の境目をまたぐと**5分跳ぶ**。
     分まで（`slice(0,16)`）で比べていたため、**秒の境目をまたいだ実行だけが
     落ちて**いた（実測: `23:25:59.294` と `23:26:00.020`＝0.73秒差）。
     いっぽう枠が誤って押し出したなら、行き先は枠の日＝**9日後**。
     **1時間の幅で見れば、ゆらぎ（最大5分）と本物（216時間）を取り違えない。** */
  const aheadNow=after.find(e=>String(e.id)===String(ahead.id));
  const drift=(aheadNow&&aheadNow.plannedStart&&aheadStart0)
    ?Math.abs(new Date(aheadNow.plannedStart)-new Date(aheadStart0)):null;
  rec('枠より前の予定は動かない（枠の日へ飛ばされない）',
      drift!=null&&drift<3600*1000,
      JSON.stringify({前:aheadStart0,後:aheadNow&&aheadNow.plannedStart,
                      ずれ秒:drift==null?null:Math.round(drift/1000),枠の日:day}));

  /* ---- 5) 起点が追い越していたら何もしない（押し出しで自然に埋まる） ---- */
  const past=isoDay(new Date(Date.now()-3*24*3600*1000));
  const up=await post('/api/schedule/plan/update',{id:frameId,frame:{frameDate:past,frameShift:''}});
  rec('枠の日付・直をあとから変えられる',up.status===200,`${up.status}`);
  const after2=await plan();
  const fr2=after2.find(e=>String(e.id)===String(frameId));
  const at2=after2.findIndex(e=>String(e.id)===String(frameId));
  const next2=after2.slice(at2+1).find(e=>e.parentId==null&&e.plannedStart);
  rec('過ぎた日の枠は「ここまで埋まりました」になる',
      !!fr2&&!!fr2.frame&&fr2.frame.reached===true&&Number(fr2.frame.gapMinutes)===0,
      JSON.stringify(fr2&&fr2.frame));
  rec('過ぎた日の枠は後続の時刻を動かさない（自然に埋まった状態）',
      !!next2&&new Date(next2.plannedStart).getTime()<new Date(`${day}T00:00:00`).getTime(),
      JSON.stringify({次:next2&&next2.plannedStart}));

  /* ---- 6) 画面: 入口・行・直し方 ---- */
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  await page.waitForFunction(id=>(WL.scheduleView.entries()||[]).some(e=>String(e.id)===String(id)),
    frameId,{timeout:30000});

  const entry=await page.evaluate(()=>{
   const el=document.getElementById('scFrameBtn'),cmt=document.getElementById('scCommentBtn');
   return el?{出ている:!el.hidden,掴める:el.getAttribute('draggable')==='true',
              コメントのとなり:!!cmt&&cmt.nextElementSibling===el,
              文字:el.textContent.replace(/\s+/g,'')}:null;
  });
  rec('枠の入口がコメントのとなりにある',
      !!entry&&entry.出ている&&entry.コメントのとなり,JSON.stringify(entry));
  rec('枠の入口は掴んで落とせる',!!entry&&entry.掴める,JSON.stringify(entry));

  /* ---- 枠は「上位階層の箱」（§9.300 ②、利用者の指示「日付、直の枠に
       ついては、3ロット分くらいの大きめの枠だけのものを作って箱として使う
       感じのものに変更してほしい…上位階層に日付・直という箱を1つ作って
       おくようなイメージです」） ----------------------------------
     直す前の枠は**ふつうの1行**で、実測すると日付列に`09/04`（起点がいま
     居る日）・時刻`04:11〜04:11`・見積`0分`・実績`-`が並び、題名だけが
     `8/29（土） から`——**1つの行に違う日付が2つ**あった。利用者の言う
     「空のスケジュール的な何かを入れるような感じ」がまさにこれ。
     **「箱のクラスが付いた」だけを見ないこと**——高さと、束ねた幅と、
     箱が名乗る文字まで実測する。 */
  const rowInfo=await page.evaluate(id=>{
   const rows=[...document.querySelectorAll('.sc-row-line')];
   const row=rows.find(r=>String(r.dataset.id)===String(id));
   if(!row)return null;
   const other=rows.find(r=>r!==row&&!r.classList.contains('sc-row-frame-box'));
   const box=row.querySelector('.sc-frame-box');
   const cells=[...row.querySelectorAll('[data-col]')].map(c=>c.dataset.col);
   const w=el=>el?Math.round(el.getBoundingClientRect().width):0;
   return {箱:!!box,
           区分:box?(box.querySelector('.sc-frame-kind')||{}).textContent||'':'',
           行き先:box?(box.querySelector('.sc-frame-head')||{}).textContent||'':'',
           状態:box?(box.querySelector('.sc-frame-sub')||{}).textContent||'':'',
           高さ:Math.round(row.getBoundingClientRect().height),
           ふつうの行の高さ:other?Math.round(other.getBoundingClientRect().height):0,
           箱の幅:w(box),行の幅:w(row),列:cells,
           文字:row.innerText.replace(/\s+/g,' ').slice(0,120),
           直せる印:row.classList.contains('sc-row-frame-edit'),
           title:row.title};
  },frameId);
  rec('枠は箱として出る（ふつうの行ではない）',!!rowInfo&&rowInfo.箱,JSON.stringify(rowInfo));
  rec('箱の高さはロット3行ぶん',
      !!rowInfo&&rowInfo.ふつうの行の高さ>0
      &&Math.abs(rowInfo.高さ-rowInfo.ふつうの行の高さ*3)<=2,
      `枠=${rowInfo&&rowInfo.高さ}px ふつう=${rowInfo&&rowInfo.ふつうの行の高さ}px`);
  /* 行いっぱい（§9.300 ②）——枠の日付・時刻・見積の列は「起点がいま居る
     場所」であって枠の事実ではないので、束ねて箱にする。操作の列は残す
     （外す手立てを消さない・§4）。 */
  rec('箱は行いっぱいを束ねる（操作の列は残す）',
      !!rowInfo&&rowInfo.箱の幅>rowInfo.行の幅*0.7
      &&rowInfo.列.includes('__actions__')&&!rowInfo.列.includes('__date__'),
      JSON.stringify({箱:rowInfo&&rowInfo.箱の幅,行:rowInfo&&rowInfo.行の幅,列:rowInfo&&rowInfo.列}));
  rec('箱が「何の行か」を文字で名乗る（§3）',!!rowInfo&&/枠/.test(rowInfo.区分),
      JSON.stringify(rowInfo&&rowInfo.区分));
  rec('行き先（日付・直）が箱の見出しに出る',
      !!rowInfo&&/から/.test(rowInfo.行き先),JSON.stringify(rowInfo&&rowInfo.行き先));
  /* **紙と画面は同じ答えを見る**（§9.163）——紙(`schedule-print.js`の
     `contentRunOf`)は`rowStyle.titlePlace`をそのまま読むので、効いている値を
     返すのが`rowStyleOf()`の役目。**枠だけ**が全幅で、設備停止・コメントの
     既定は今までどおり（§9.132。わざわざ選んでいない人の見え方を変えない）。 */
  const places=await page.evaluate(()=>{
   const v=WL.scheduleView;
   const at=k=>String((v.rowStyleOf({kind:k})||{}).titlePlace||'');
   return {枠:at('枠'),設備停止:at('設備停止'),コメント:at('コメント'),作業:at('作業')};
  });
  rec('効いている「題名の位置」は枠だけ全幅（紙も同じ答えを見る）',
      places.枠==='全幅'&&places.設備停止===''&&places.コメント===''&&places.作業==='',
      JSON.stringify(places));
  rec('行に「いつから」と状態が文字で出る',
      !!rowInfo&&/埋まりました|空き/.test(rowInfo.文字),JSON.stringify(rowInfo&&rowInfo.文字));
  rec('ダブルクリックで直せる印が付く',!!rowInfo&&rowInfo.直せる印,JSON.stringify(rowInfo&&rowInfo.title));

  /* 直す窓が開き、直の候補がマスタから並ぶこと。 */
  await page.evaluate(id=>{
   const row=[...document.querySelectorAll('.sc-row-line')].find(r=>String(r.dataset.id)===String(id));
   row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  },frameId);
  await page.waitForSelector('#scFrameDate',{timeout:12000});
  const dlg=await page.evaluate(()=>({
   日付:document.getElementById('scFrameDate').value,
   直の数:document.querySelectorAll('input[name="scFrameShift"]').length,
   その日の頭:[...document.querySelectorAll('.sc-frame-shift b')].some(b=>/その日の頭/.test(b.textContent)),
   説明:document.querySelector('.sc-frame-edit .confirm-modal-note')?.textContent||''}));
  rec('ダブルクリックで日付・直の窓が開く',!!dlg.日付,JSON.stringify(dlg.日付));
  rec('直の候補がマスタから並ぶ（「その日の頭から」も選べる）',
      dlg.直の数>=1&&dlg.その日の頭,JSON.stringify({数:dlg.直の数,頭:dlg.その日の頭}));
  rec('「時間を使わない」ことを窓に書いてある',/時間を使いません/.test(dlg.説明),dlg.説明.slice(0,60));
  await page.click('#appConfirmCancel');
  await page.waitForTimeout(400);

  /* 右クリックにも入口がある（入口を種別ごとに変えない）。 */
  const menu=await page.evaluate(id=>{
   const row=[...document.querySelectorAll('.sc-row-line')].find(r=>String(r.dataset.id)===String(id));
   row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:400,clientY:300}));
   const items=[...document.querySelectorAll('.sc-row-menu button')].map(b=>b.textContent.trim());
   document.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
   return items;
  },frameId);
  rec('右クリックにも「枠の日付・直を変える」がある',
      menu.some(t=>/枠の日付・直を変える/.test(t)),JSON.stringify(menu).slice(0,180));

  /* ---- 8) 行から「作業日・直を直す」道が辿れる（§9.376） ----
     利用者の指摘⑥「作業日の変更はどのようにしたら出来ますか」。**機能は
     前からあった**が、入口が道具列のアイコン1つで、「この行を別の日へ」と
     いう言葉からは辿れなかった。ここで固定するのは**辿れること**と、
     **押す前に何が起きるか分かること**。 */
  const planRow=(await plan()).find(e=>e.kind==='作業'&&e.state==='予定'&&e.parentId==null);
  rec('前提: これから並ぶ作業の行がある',!!planRow,JSON.stringify(planRow&&{id:planRow.id,lot:planRow.lotNo}));
  const rowMenu=id=>page.evaluate(i=>{
   const row=[...document.querySelectorAll('.sc-row-line')].find(r=>String(r.dataset.id)===String(i));
   if(!row)return null;
   row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:400,clientY:300}));
   const items=[...document.querySelectorAll('.sc-row-menu button')].map(b=>b.textContent.trim());
   document.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
   return items;
  },id);
  const WORD='ここから下を、別の日・直から並べる';
  const workMenu=planRow?await rowMenu(planRow.id):[];
  rec('作業の行の右クリックから「別の日・直から並べる」を辿れる',
      (workMenu||[]).some(t=>t.includes(WORD)),JSON.stringify(workMenu).slice(0,220));
  const frameMenu=await rowMenu(frameId);
  rec('枠の行には出さない（すぐ上の項目と同じことになる）',
      !(frameMenu||[]).some(t=>t.includes(WORD)),JSON.stringify(frameMenu).slice(0,220));

  /* **押す前に「どこへ入るか」を言う**（§2 推測させない）。 */
  await page.evaluate(a=>{
   const row=[...document.querySelectorAll('.sc-row-line')].find(r=>String(r.dataset.id)===String(a.id));
   row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:400,clientY:300}));
   const btn=[...document.querySelectorAll('.sc-row-menu button')].find(b=>b.textContent.includes(a.word));
   if(btn)btn.click();
  },{id:planRow.id,word:WORD});
  await page.waitForSelector('#scFrameDate',{timeout:12000});
  const where=await page.evaluate(()=>{
   const el=document.querySelector('.sc-frame-where');
   return el?(el.textContent||'').replace(/\s+/g,' ').trim():'';
  });
  rec('窓が「どこへ入るか」を先に言う',
      !!where&&where.includes(String(planRow.lotNo||'').trim())&&/すぐ上/.test(where),
      where.slice(0,140));

  /* **決めたら、その行のすぐ上に入る**——言ったとおりに入ること。 */
  const day2=isoDay(new Date(Date.now()+11*86400000));
  await page.evaluate(d=>{document.getElementById('scFrameDate').value=d},day2);
  await page.click('#appConfirmOk');
  /* **サーバーに入るまで待つ**（楽観的な行はidを持たないので、並びは
     **確定したidで見る**——字で見ると、日付の出し方を変えた日に嘘になる）。
     **`page.waitForFunction`では測れない**——あれは述語が返したPromiseを
     待たず、Promiseそのものを「真」と読んで即座に抜ける（§9.376）。
     サーバーへ聞き直す待ちは`W.poll`で置く。 */
  const found=await W.poll(async()=>(await plan()).find(e=>e.kind==='枠'&&e.frame&&e.frame.date===day2),
    f=>!!f,25000,400);
  const newFrameId=found?String(found.id):'';
  /* 入らなかったときは**画面が言っている理由をそのまま記録する**（§9.372）
     ——「入らなかった」だけでは、断られたのか届かなかったのかが分からない。 */
  const said=await page.evaluate(()=>[...document.querySelectorAll('#toastArea .toast')]
    .map(x=>(x.textContent||'').replace(/\s+/g,' ').trim()).join(' ／ ')).catch(()=>'');
  rec('決めた日・直の枠がサーバーに入る',!!newFrameId,`id=${newFrameId} (${day2}) 知らせ=${said.slice(0,200)}`);
  if(newFrameId)made.push(newFrameId);
  const order=await page.evaluate(a=>{
   const ids=[...document.querySelectorAll('#scTimeline .sc-row-line')].map(r=>String(r.dataset.id));
   return {at:ids.indexOf(String(a.frame)),row:ids.indexOf(String(a.row))};
  },{frame:newFrameId,row:planRow.id});
  rec('言ったとおり、その行のすぐ上に入る',
      order.at>=0&&order.row>=0&&order.at===order.row-1,
      `枠=${order.at}番目 / ${planRow.lotNo}=${order.row}番目`);

  /* ---- 7) 予定から外せる ---- */
  const del=await post('/api/schedule/plan/delete',{id:frameId});
  rec('枠は予定から外せる',del.status===200,`${del.status}`);
  /* **控えから消すのはこの1件だけ**（§9.362 後片付けは「消えた」で確かめる）
     ——丸ごと空にすると、あとで足した枠が片付かないまま次の実行へ残る。 */
  if(del.status===200){const i=made.indexOf(frameId);if(i>=0)made.splice(i,1)}
  const gone=(await plan()).every(e=>String(e.id)!==String(frameId));
  rec('外したら一覧から消える',gone);

 }catch(e){
  console.log('FATAL: '+e.message);
  R.push({n:'FATAL',ok:false});
 }finally{
  /* **落ちてもブラウザを閉じる**（tests/README.md）。残ると編集セッションを
     掴んだままになり、後続のスケジュール系が連鎖で落ちる。 */
  try{for(const id of made)await post('/api/schedule/plan/delete',{id})}catch(_){}
  /* **「消えた」で確かめる**（§9.362）——消したつもりで弾かれていると、
     置いた枠が次の実行の起点を動かし、遠くの網が落ちる。 */
  try{
   const left=(await plan()).filter(e=>made.some(id=>String(id)===String(e.id))).length;
   rec('後片付け: 置いた枠が消えている',left===0,`残り${left}件`);
  }catch(e){rec('後片付け: 置いた枠が消えている',false,'数えられない: '+e.message)}
  try{await post('/api/schedule/session/release',{equipment:EQ})}catch(_){}
  try{await setMode('edit')}catch(_){}
  if(b)await b.close();
 }
 const ng=R.filter(x=>!x.ok);
 console.log(`\n=== SUMMARY ===\n${R.length-ng.length}/${R.length} passed`);
 ng.forEach(x=>console.log(' -',x.n,x.d||''));
 process.exit(ng.length?1:0);
})();
