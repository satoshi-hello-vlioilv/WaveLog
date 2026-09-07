/* test_scpick.js: まとめて予定から外す（§9.170）
   ============================================================
   利用者の指示は「複数選択で一括D&Dスケジューリング、逆もしかりで
   一括スケジュール除外機能も」。入れる側（仕掛一覧のチェック→まとめて投入）
   は §9.5/§9.10 で既にあるので、ここで固定するのは**戻す側**。

   ここで固定すること:
    1. **選べるのは外せる行だけ。** 実施中・完了・計画外にはチェックを
       出さない——出しておいて落としたら断る、では選んだ手間が無駄になる
       （受け皿と同じ約束、§9.116）。
    2. **件数と対象は文字で出す。** 行の面の色だけでは何件選んだか数える
       ことになる。選択バーが件数とロット番号を言う。
    3. **全選択の分母は「外せる予定」。** 完了まで数えると、押しても
       増えない数が出る。
    4. **まとめて掴んだら全部運ぶ。** 受け皿も「選んだN件」と言い直す。
    5. **まとめて掴んでいる間は並べ替えない。** 動かせるのは掴んだ1行だけ
       なので、通り過ぎた位置に1行だけ置き去りになる。
    6. **消えた行のidを持ち続けない。** 外したあとに件数だけ合わない状態を
       作らない。
    7. **列を1本足していない。** 見出しと行は同じグリッド定義を共有して
       いるのが土台なので、2通り書くと片方だけ直した状態が作れる。

   後片付けは finally で必ず行う（自分で作った予定だけを消す。フィクスチャは
   他のテストも読む）。落ちてもブラウザを閉じる。
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
 const post=(p,body)=>page.evaluate(async a=>{
  const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-scpick'},a.b))});
  let j={};try{j=await r.json()}catch(e){}
  return {status:r.status,body:j};
 },{p,b:body||{}});
 const planIds=()=>page.evaluate(async e=>{
  const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e));
  return ((await r.json()).entries||[]).map(x=>String(x.id));
 },EQ);
 const made=[];
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));

 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                          localStorage.setItem('AccessMeasurementUserId','tester')},EQ);
  await post('/api/access-mode',{mode:'schedule'});

  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  await page.waitForSelector('#grid tbody tr .plan-select-checkbox',{timeout:30000});
  await settle();

  /* ---- 8. 予定を描き直しても仕掛一覧のスクロール位置が戻らない
        （§9.357、利用者の指示「D&Dでスケジュール表に追加する際に
        スクロール位置が戻されてしまう」） ----
     1件足すたびに `refreshScheduledLotFilter()` が `renderGrid()` **だけ**を
     呼ぶ。`load()` の中の `keepGridScroll()` を通らないので控える相手が居らず、
     毎回先頭へ戻っていた——「次の1件」を探し直すことになり、続けて足す作業が
     成り立たない。 */
  const geo=()=>page.evaluate(()=>{const e=document.querySelector('#grid');
    return e?{top:Math.round(e.scrollTop),max:Math.round(e.scrollHeight-e.clientHeight)}:null});
  const g0=await geo();
  if(!g0||g0.max<60){
   rec('前提: 仕掛一覧がスクロールできる高さにある（⑧）',false,JSON.stringify(g0));
  }else{
   await page.evaluate(v=>{document.querySelector('#grid').scrollTop=v},Math.min(200,Math.floor(g0.max/2)));
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const before=await geo();
   await page.evaluate(()=>{WL.scheduleView&&WL.scheduleView.render&&WL.scheduleView.render()});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const after=await geo();
   rec('予定を描き直しても仕掛一覧のスクロール位置が戻らない（⑧）',
       !!(before&&after&&before.top>0&&Math.abs(after.top-before.top)<=2),
       JSON.stringify({before,after}));
  }


  /* ---- 0) 入れる側（§9.5・§9.10）: チェックで複数選ぶ → まとめて投入 ----
     ここで作った行を、そのまま外す側の題材にする。**既存の行は触らない。** */
  const had=new Set(await page.evaluate(()=>[...document.querySelectorAll('.sc-row-line')].map(r=>r.dataset.id)));
  await page.evaluate(()=>{
   [...document.querySelectorAll('#grid tbody tr .plan-select-checkbox')].slice(0,3)
    .forEach(bx=>{bx.checked=true;bx.dispatchEvent(new Event('change',{bubbles:true}))});
  });
  await settle();
  const addBtn=await page.evaluate(()=>{
   const b=document.getElementById('planSelectAdd');
   return b?b.textContent:'';
  });
  /* **何件がどこへ行くのかをボタンに書く**（§9.170）。「設備へ追加」だけでは
     選んだ全部なのか今の行だけなのかが読めない。 */
  rec('選択件数バーが「どこへ何件」と書く',/3件追加/.test(addBtn)&&addBtn.includes(EQ),addBtn);
  await page.click('#planSelectAdd');
  await page.waitForFunction(n=>[...document.querySelectorAll('.sc-row-line')]
    .filter(r=>!/^tmp-/.test(r.dataset.id)).length>=n,had.size+3,{timeout:30000});
  await page.waitForTimeout(1500);
  const fresh=await page.evaluate(()=>[...document.querySelectorAll('.sc-row-line')].map(r=>r.dataset.id));
  fresh.filter(id=>!had.has(id)&&!/^tmp-/.test(id)).forEach(id=>made.push(id));
  rec('まとめて投入した3件が予定へ入る',made.length===3,made.join('/'));

  await settle();

  /* ---- 1) 選べるのは外せる行だけ ---- */
  const shape=await page.evaluate(()=>{
   const rows=[...document.querySelectorAll('.sc-row-line')];
   const withBox=rows.filter(r=>r.querySelector('.sc-pick-check'));
   /* 「実施中(着手)」「完了」の行にチェックが無いことを見る。区分の文字で
      判定する——状態はクラス名ではなく画面の言葉で確かめたい。 */
   const bad=rows.filter(r=>{
    const cat=(r.querySelector('.sc-row-cat')||{}).textContent||'';
    return /作業中|完了|取消|計画外/.test(cat)&&!!r.querySelector('.sc-pick-check');
   });
   return {rows:rows.length,withBox:withBox.length,bad:bad.length,
           head:!!document.getElementById('scPickAll'),
           pickable:document.getElementById('scTimeline').classList.contains('sc-pickable')};
  });
  rec('外せる行にだけチェックが出る',shape.withBox>0&&shape.bad===0,
      `全${shape.rows}行 / チェック${shape.withBox}行 / 出てはいけない行${shape.bad}`);
  rec('見出しにも全選択のチェックがある',shape.head&&shape.pickable);

  /* ---- 7) 列は1本も増えていない（見出しと行が同じ定義を共有している） ---- */
  const cols=await page.evaluate(()=>{
   const g=el=>getComputedStyle(el).gridTemplateColumns.split(' ').length;
   const head=document.querySelector('.sc-row-head'),line=document.querySelector('.sc-row-line');
   return {head:g(head),line:g(line),
           handle:Math.round(document.querySelector('.sc-row-handle').getBoundingClientRect().width)};
  });
  rec('見出しと行の列数が同じ（定義を2通り書いていない）',cols.head===cols.line,
      `見出し${cols.head} / 行${cols.line}`);
  /* チェックは**取っ手の列へ同居**させている。1列足すのではなく幅を持ち替える。 */
  rec('取っ手の列がチェックのぶん広がる',cols.handle>=28,`${cols.handle}px`);

  /* ---- 2) 選ぶと件数とロット番号が文字で出る ---- */
  await page.click(`.sc-row-line[data-id="${made[0]}"] .sc-pick-check`);
  await page.click(`.sc-row-line[data-id="${made[1]}"] .sc-pick-check`);
  await settle();
  const bar=await page.evaluate(()=>{
   const b=document.getElementById('scPickBar');
   return {hidden:b.hidden,text:b.textContent.replace(/\s+/g,' ').trim(),
           picked:document.querySelectorAll('.sc-row-line.is-picked').length,
           btn:!!document.getElementById('scPickRemove')};
  });
  rec('選ぶと選択バーに件数が文字で出る',
      !bar.hidden&&/2件を選択中/.test(bar.text)&&bar.btn,bar.text.slice(0,80));
  rec('選んだ行が面でも分かる',bar.picked===2,String(bar.picked));

  /* ---- 3) 全選択の分母は「外せる予定」だけ ---- */
  const all=await page.evaluate(()=>{
   const a=document.getElementById('scPickAll');
   a.click();
   const rows=[...document.querySelectorAll('.sc-row-line')];
   return {checked:rows.filter(r=>r.querySelector('.sc-pick-check:checked')).length,
           box:rows.filter(r=>r.querySelector('.sc-pick-check')).length,
           text:document.getElementById('scPickBar').textContent.replace(/\s+/g,' ').trim()};
  });
  rec('全選択は外せる予定だけを選ぶ',all.checked===all.box&&all.checked>=3,
      `${all.checked}/${all.box}`);
  rec('全選択のあとも件数を文字で言う',
      new RegExp(`${all.checked}件を選択中`).test(all.text),all.text.slice(0,60));

  /* いったん解除して、自分で作った3件だけにする。 */
  await page.evaluate(()=>document.getElementById('scPickAll').click());
  await settle();
  for(const id of made)await page.click(`.sc-row-line[data-id="${id}"] .sc-pick-check`);
  await settle();

  /* ---- 4) まとめて掴むと受け皿が「選んだN件」と言う ---- */
  const zone=await page.evaluate(id=>{
   const row=document.querySelector('.sc-row-line[data-id="'+id+'"]');
   row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:new DataTransfer()}));
   const z=document.getElementById('scDropRemove');
   return {hidden:z.hidden,text:z.textContent.replace(/\s+/g,' ').trim(),
           title:String(z.title||'').replace(/\s+/g,' ').trim(),
           dragging:document.querySelectorAll('.sc-row-line.sc-dragging').length};
  },made[0]);
  /* **件数は必ず文字で**（§9.170）。§9.238 ①で受け皿を小さくしたので札は
     1行になったが、**数えさせない**という要件は変わらない——確かめるのは
     「選んだ3件」と読めることであって、特定の言い回しではない。 */
  rec('まとめて掴むと受け皿が件数を言う',
      !zone.hidden&&/選んだ\s*3\s*件/.test(zone.text),zone.text.slice(0,60));
  /* **消した説明はtitleへ落ちていること**（§9.234 ①）。札を短くした代わりに
     「確認してから外す」「仕掛一覧へ戻る」が消えると、外す前に何が起きるかが
     読めなくなる。 */
  rec('短くした説明は受け皿のtitleに残っている',
      /確認してから外す/.test(zone.title)&&/仕掛一覧へ戻る/.test(zone.title)
      &&/3件/.test(zone.title),zone.title.slice(0,90));
  rec('運んでいる行を全部そう見せる',zone.dragging===3,String(zone.dragging));

  /* ---- 5) まとめて掴んだままでも並べ替えられる(§9.177で§9.170を改訂) ----
     以前は「動かせるのは掴んだ1行だけで、通り過ぎた位置に1行だけ置き去りに
     なる」ため止めていた。**掴んでいる行をまとめて同じ位置へ挿し込む**
     ようにしたので置き去りは起きない。利用者の要望は「スケジュール内で
     データを並び替えたい時も複数選択してまとめて動かしたい」。 */
  const reorder=await page.evaluate(ids=>{
   const before=[...document.querySelectorAll('.sc-row-line')].map(r=>r.dataset.id);
   /* **落とす先は掴める行から選ぶ。** 完了・作業中の行には並べ替えの
      配線が無いので、そこへ落としても何も起きない——以前の「並べ替えない」
      という網は、実はここで空振りしていた(壊れていても通る)。 */
   const other=[...document.querySelectorAll('.sc-row-line')]
     .find(r=>!ids.includes(r.dataset.id)&&r.draggable);
   const rect=other.getBoundingClientRect();
   other.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:new DataTransfer(),
     clientX:rect.left+5,clientY:rect.top+1}));
   const after=[...document.querySelectorAll('.sc-row-line')].map(r=>r.dataset.id);
   const at=ids.map(i=>after.indexOf(i)).sort((a,b)=>a-b);
   return {moved:JSON.stringify(before)!==JSON.stringify(after),
           together:at[at.length-1]-at[0]===at.length-1,
           beforeOther:at[at.length-1]<after.indexOf(other.dataset.id)};
  },made);
  rec('まとめて掴んだままでも並べ替えられる',reorder.moved===true,JSON.stringify(reorder));
  rec('掴んだ行は隣り合ったまま落ちる先へ入る',
      reorder.together===true&&reorder.beforeOther===true,JSON.stringify(reorder));

  /* ---- 6) 落とすとまとめて外れる（サーバーからも消える） ---- */
  await page.evaluate(()=>{
   const z=document.getElementById('scDropRemove');
   z.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:new DataTransfer()}));
  });
  await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:8000});
  const confirmText=await page.evaluate(()=>
    document.getElementById('appConfirmModal').textContent.replace(/\s+/g,' '));
  rec('確認は1回だけ・何件かと戻り先を言う',
      /3件/.test(confirmText)&&/仕掛一覧へ戻ります/.test(confirmText)&&/測定データはそのまま/.test(confirmText),
      confirmText.slice(0,140));
  await page.click('#appConfirmOk');
  await page.waitForFunction(ids=>ids.every(id=>!document.querySelector('.sc-row-line[data-id="'+id+'"]')),
    made,{timeout:15000});
  await page.waitForTimeout(2500);
  const left=await planIds();
  rec('落とすとサーバーからもまとめて消える',made.every(id=>!left.includes(id)),
      `残り: ${made.filter(id=>left.includes(id)).join('/')||'なし'}`);

  /* ---- 6b) 消えた行のidを持ち続けない ---- */
  const after=await page.evaluate(()=>{
   const b=document.getElementById('scPickBar');
   return {hidden:b.hidden,text:b.textContent.trim()};
  });
  rec('外したあと選択バーは引っ込む（件数だけ残らない）',after.hidden&&!after.text,
      `${after.hidden} "${after.text.slice(0,40)}"`);

  /* ---- 8) 権限の無いモードでは道具ごと出さない ---- */
  await post('/api/access-mode',{mode:'edit'});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  await settle();
  const view=await page.evaluate(()=>({
   checks:document.querySelectorAll('.sc-pick-check').length,
   all:!!document.getElementById('scPickAll'),
   bar:document.getElementById('scPickBar').hidden,
   pickable:document.getElementById('scTimeline').classList.contains('sc-pickable')}));
  rec('予定を動かせないモードではチェックを出さない',
      view.checks===0&&!view.all&&view.bar&&!view.pickable,JSON.stringify(view));

  rec('コンソールに例外を出さない',errs.length===0,errs.slice(0,2).join(' / '));
 }catch(e){rec('FATAL',false,e.message)}
 finally{
  /* 自分で作った予定だけを消す。落ちていても必ず通る。 */
  try{
   await post('/api/access-mode',{mode:'schedule'});
   await post('/api/schedule/session/acquire',{equipment:EQ});
   for(const id of made)await post('/api/schedule/plan/delete',{id});
  }catch(e){}
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
