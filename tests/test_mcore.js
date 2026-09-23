/* test_mcore.js: 測定の中核（測定器からの転送 → セル送り → 保存）を固定する
   ============================================================
   測定画面を3段構成へ組み替える前に、**いま出来ていることを書き出す**ための
   安全網（再設計 第0段）。組み替えてからでは「前はできていた」を証明できない。

   固定するのは**振る舞い**であって**配置ではない**。ペインの幅やタブの数は
   これから変わるので、そこを固定すると組み替えた瞬間に落ちて意味を成さない。
   ここで見るのは「入れた値が正しい場所へ入り、正しく次へ進み、保存される」。

   **いちばん大事なのは受信欄のフォーカス**（§9.122）。測定中は
   `#deviceInput` にフォーカスが載り続けていることが動作条件で、外れると
   画面は「伝送入力停止中」になり測定器からの転送を受けない。この欄の
   フォーカス制御は過去に実機でしか出ない不具合を2件出している（多条の
   連続入力が崩れる／IMEセッションが残って転送文字列が二重になる）。
   組み替えで受信欄のDOMを作り直すと両方が戻るため、転送のたびに
   フォーカスが戻ることをここで固定する。

   期待値は**実際に転送を流して観測してから**書く。憶測で書くと外す。
   板幅の桁数は`WL.base.measurementDigits('width')`の1箇所が決める——§9.242 ②
   （利用者の指示）で**小数2桁**にした。それまでは入口で1桁へ丸めてから
   2桁で格納しており、ノギスの`DT110+026.15`は2桁目が必ず0になっていた
   （「ノギスだけ2桁」という設定はあったが、入口の丸めに潰されて一度も
   効いていない）。いまは`26.15`がそのまま入り、`27.5`は`27.50`と桁がそろう。 */
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';
/* 入力内容の名前（§9.391で「母材」と「丈毎」の2つに分けた）。
   画面の`WL.measureItem.MATERIAL`／`.PIECE`と同じ。 */
const MATERIAL='全長';        /* §9.396で改名 */
const PIECE='寸法・外観';     /* §9.396で改名 */
const setMode=m=>fetch(API+'/api/access-mode',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})});

run('test_mcore: 測定の中核（測定器からの転送 → セル送り → 保存）を固定する', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 /* 転送はキーボードだけで行い、**こちらからフォーカスを触らない**。
    実機の測定器は間にクリックを挟まず次のデータを送り続けるので、
    アプリが毎回フォーカスを受信欄へ戻していなければ2件目以降は入らない。
    **ここで `page.focus()` を書いてはいけない**——書くと「フォーカスが戻る」
    ことを自分で戻してから確かめる形になり、検証が空振りする
    （実際に一度そう書き、`refocusDeviceInput()` を無効にしても
    35/35 PASS のままだったので気づいた）。 */
 const send=async raw=>{
  await page.keyboard.type(raw);
  await page.keyboard.press('Tab');
  await idle();
 };
 const widthRow=()=>page.evaluate(()=>(S.measure.measurements.width?.[0]||[]).slice(0,6));
 const focused=()=>page.evaluate(()=>document.activeElement?.id||'');

 try{
  await setMode('edit');
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});

  /* ---- 測定画面を開く ---- */
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  const started=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(r){r.querySelector('.sc-row-start').click();return true}return false;
  });
  rec('予定から測定画面を開ける',started);
  if(!started)throw Error('開始できる行が無い');
  await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:25000});
  await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,null,{timeout:30000}).catch(()=>{});
  await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});

  /* 測定画面は「準備」から始まる（§9.123）。転送を受けるのは②測定なので、
     ここで段を移す。**段の移動で受信欄のDOMは作り直されない**——それを
     確かめるのは後半の「同じノードのままか」。 */
  await page.evaluate(()=>WL.measureSteps.go('2'));
  await idle();

  /* ---- 受信の帯は「測定器を使う項目」でだけ出る ----
     既定の選択は「母材/丈毎」で、これは手入力の項目（画面にも
     「母材・丈は手入力です」と書いてある）。このとき受信の帯は `display:none`
     で、受信欄は 0×0 になる。
     **寸法ゼロの要素にはフォーカスが載らない**ので、そのあいだは転送を
     受け付けない——これは正しい振る舞いで、直す対象ではない。
     **見えているかどうかは寸法で見る**こと。DOMに文字があるかだけを見ると、
     `display:none` の中の「伝送入力停止中」を「画面が告げている」と読み違える
     （実際に一度そう書いて、測って気づいた）。 */
  const seeReceive=()=>page.evaluate(()=>{
   const box=document.querySelector('#inputStatusBox');
   const r=box?box.getBoundingClientRect():null;
   return {入力内容:document.querySelector('#measureType')?.value||'',
     帯が見えている:!!r&&r.width>0&&r.height>0&&getComputedStyle(box).display!=='none',
     高さ:r?Math.round(r.height):null,
     focus:document.activeElement?.id||'',
     受付:document.querySelector('#inputReady')?.textContent||''};
  });
  const mother=await seeReceive();
  rec('母材・丈（手入力の項目）では受信の帯を出さない',
      mother.入力内容===MATERIAL&&mother.帯が見えている===false,JSON.stringify(mother));
  rec('受信の帯が出ていないあいだは受信欄にフォーカスが載らない',
      mother.focus!=='deviceInput',JSON.stringify(mother));

  /* 条数を4にして、送り先が動くのを見えるようにする（1条だと巡回して0のまま） */
  await page.evaluate(()=>{
   const h=document.querySelector('#horizontalCount');
   h.value='4';h.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await idle();
  await page.evaluate(()=>{
   const s=document.querySelector('#measureType');
   s.value='板幅';s.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await idle();

  /* 測定器を使う項目に変えると帯が現れ、受信欄にフォーカスが載る。
     **ここが外れていると1件も測定できない。** */
  const ready=await seeReceive();
  rec('測定器を使う項目にすると受信の帯が現れる',
      ready.帯が見えている===true&&ready.高さ>0,JSON.stringify(ready));
  rec('帯が出ると受信欄にフォーカスが載る（転送を受けられる）',
      ready.focus==='deviceInput',JSON.stringify(ready));
  rec('受け付けている状態を文字でも持っている',/受付中/.test(ready.受付),ready.受付);

  /* ---- 1) ノギスの転送が板幅の正しいセルへ入り、次の条へ進む ---- */
  await send('DT110+026.15');
  let row=await widthRow();
  let st=await page.evaluate(()=>S.measure.settings.wStep);
  rec('ノギスの転送が板幅の1条目へ小数2桁で入る',row[0]==='26.15',JSON.stringify(row));
  rec('転送のあと次の条へ進む',st===1,'wStep='+st);
  rec('転送のあとも受信欄にフォーカスが戻る',await focused()==='deviceInput',await focused());
  rec('受信欄は次の転送のために空になる',
      await page.evaluate(()=>document.querySelector('#deviceInput').value)==='');

  /* ---- 2) 続けて送ると隣の条へ積み上がる ---- */
  await send('DT110+026.20');
  row=await widthRow();st=await page.evaluate(()=>S.measure.settings.wStep);
  rec('続けて送ると2条目へ入る',row[0]==='26.15'&&row[1]==='26.20',JSON.stringify(row));
  rec('2件目のあとも条が進む',st===2,'wStep='+st);

  /* ---- 3) 板厚は別の入力内容なので、板幅のままでは受け取らない（§9.138） ----
     板厚は**丈ごとに3点**（エッジOS・中央CL・エッジDS）、板幅は**条ごと**で
     枠の数がまるで違うため、入力内容を分けた。分けた以上、受け取れる測定器も
     項目ごとに決まる（バリ＝マイクロメータ、テレスコープ＝デプスゲージ と
     同じ形）。**板幅のままマイクロメータを送っても、どこにも入らない。** */
  await send('DT100+003.015');
  const th0=await page.evaluate(()=>(S.measure.measurements.thickness?.[0]||[]).slice(0,3));
  row=await widthRow();
  rec('板幅のままマイクロメータを送っても板厚へは入らない',th0.every(v=>v===''),JSON.stringify(th0));
  rec('受け取れない測定器では板幅も汚さない',row[0]==='26.15'&&row[1]==='26.20',JSON.stringify(row));
  rec('受け取れない測定器では受信欄で合図を出す',
      /device-error/.test(await page.evaluate(()=>document.querySelector('#deviceInput').className)));

  /* ---- 4) 測定器を通さない生の数値も受け付ける ---- */
  await send('27.5');
  row=await widthRow();
  rec('生の数値も板幅として受け付ける（桁はそろえる）',row[2]==='27.50',JSON.stringify(row));

  /* ---- 5) 壊れた入力は値を変えず、合図を出す ---- */
  const beforeBroken=await widthRow();
  await send('ZZZ');
  const afterBroken=await widthRow();
  const cls=await page.evaluate(()=>document.querySelector('#deviceInput').className);
  rec('壊れた入力は測定値を変えない',
      JSON.stringify(beforeBroken)===JSON.stringify(afterBroken),JSON.stringify(afterBroken));
  rec('壊れた入力は受信欄で合図を出す',/device-error/.test(cls),cls);
  rec('壊れた入力のあとも受信欄にフォーカスが残る',await focused()==='deviceInput',await focused());

  /* ---- 6) ↑↓で条を移動できる（条数を超えたら巡回する） ---- */
  const before=await page.evaluate(()=>S.measure.settings.wStep);
  await page.keyboard.press('ArrowDown');
  const down=await page.evaluate(()=>S.measure.settings.wStep);
  await page.keyboard.press('ArrowUp');
  const up=await page.evaluate(()=>S.measure.settings.wStep);
  rec('↓で次の条へ、端まで行ったら先頭へ巡回する',before===3&&down===0,`${before}→${down}`);
  rec('↑で前の条へ戻る',up===before,`${down}→${up}`);

  /* ---- 7) Ctrl系はフォーカスを奪わない ----
     ブラウザの既定ショートカットが割り込むと、転送の最後のTabを取りこぼす。
     このため measure-input.js は Ctrl/Alt/⌘ を捨てている。
     **段の移動をCtrl+数字に割り当てられないのはこれが理由。** */
  await page.keyboard.press('Control+a');
  await idle();  // 起きないこと（フォーカスが外れない）を見る: 起きるなら起きるはずの処理が静まるまで
  rec('Ctrl系を押しても受信欄からフォーカスが外れない',await focused()==='deviceInput',await focused());

  /* ---- 8) 「いま入る場所」が画面に出ている ---- */
  const guide=await page.evaluate(()=>({
   文字:document.querySelector('#stepStatus')?.textContent||'',
   current:document.querySelectorAll('#measurementGrid input.current').length,
   complete:document.querySelectorAll('#measurementGrid input.complete').length,
  }));
  rec('いま入る場所が文字で出ている',/条|丈/.test(guide.文字),guide.文字);
  rec('いま入る場所のセルに印が付く',guide.current>0,`current=${guide.current}`);
  rec('入力済みのセルに印が付く',guide.complete>=3,`complete=${guide.complete}`);

  /* ---- 9) 進捗が増える ---- */
  const prog=await page.evaluate(()=>{
   const chips=document.querySelector('#measureTypeChips')?.textContent||'';
   const m=chips.match(/板幅(\d+)\/(\d+)/);
   return {分子:m?+m[1]:null,分母:m?+m[2]:null,生:chips.slice(0,60)};
  });
  rec('測定した項目の進捗が0より増える',prog.分子>0,JSON.stringify(prog));
  rec('進捗は分母を持つ（何件中いくつかが分かる）',prog.分母>0,JSON.stringify(prog));

  /* ---- 9b) 板厚へ切り替えると3点（OS/CL/DS）の表になる（§9.138） ----
     枠の数と呼び名は`WL.measureItem`が1箇所で答える。**条の番号のまま
     3行だけ出す**のでも、40行出すのでもない——板厚は丈ごとに中央1点と
     エッジ2点で、条とは別の数え方をする。 */
  const setType=async v=>{
   await page.evaluate(t=>{const s=document.querySelector('#measureType');
     s.value=t;s.dispatchEvent(new Event('change',{bubbles:true}))},v);
   await idle();
  };
  await setType('板厚');
  /* 測定表は「丈位置×条」の1つの表（§9.136）なので、**行**が3つになる
     （枠の数は 3行 × 丈位置の数）。 */
  const tGrid=await page.evaluate(()=>({
   行:document.querySelectorAll('#measurementGrid .measure-matrix tbody tr').length,
   名:[...document.querySelectorAll('#measurementGrid .measure-matrix tbody th')].map(x=>x.textContent),
   丈の列:document.querySelectorAll('#measurementGrid .measure-matrix thead th button').length,
   見出し:document.querySelector('#measurePanelTitle')?.textContent||'',
   focus:document.activeElement?.id||'',
  }));
  rec('板厚は丈ごとに3点（OS/CL/DS）だけ描く',
      tGrid.行===3&&JSON.stringify(tGrid.名)===JSON.stringify(['OS','CL','DS']),JSON.stringify(tGrid));
  rec('板厚に切り替えても受信欄にフォーカスが載る',tGrid.focus==='deviceInput',JSON.stringify(tGrid));
  await send('DT100+003.015');
  const th1=await page.evaluate(()=>({
   値:(S.measure.measurements.thickness?.[0]||[]).slice(0,3),tStep:S.measure.settings.tStep}));
  rec('板厚ではマイクロメータの転送がOSへ入る',th1.値[0]==='3.015',JSON.stringify(th1));
  rec('板厚は次の点（CL）へ進む',th1.tStep===1,JSON.stringify(th1));
  const wAfter=await widthRow();
  rec('板厚を入れても板幅は変わらない',wAfter[0]==='26.15'&&wAfter[1]==='26.20',JSON.stringify(wAfter));
  /* この先の節は板幅の表を見るので戻す。 */
  await setType('板幅');

  /* ---- 10) 公差が無いときに、勝手にNGにしない ----
     このフィクスチャは公差を持たない(WL.measureInput.compactToleranceData が null)。
     **公差が無いのにNGを出すと、現場は直しようのない警告を見ることになる。** */
  const noTol=await page.evaluate(()=>{
   const has=typeof WL.measureInput.compactToleranceData==='function'&&!!WL.measureInput.compactToleranceData('width');
   if(has)return{公差あり:true};
   const cell=[...document.querySelectorAll('#measurementGrid input')].find(x=>x.dataset.mkey==='width');
   if(!cell)return{セルなし:true};
   cell.value='999';cell.dispatchEvent(new Event('input',{bubbles:true}));
   return{公差あり:false,NG:cell.classList.contains('ng'),クラス:cell.className};
  });
  rec('公差が無いときは、外れ値でも勝手にNGにしない',
      noTol.公差あり===true||noTol.NG===false,JSON.stringify(noTol));

  /* ---- 11) 手動入力モードへ切り替えられる ---- */
  await page.evaluate(()=>{
   const el=[...document.querySelectorAll('[data-mode]')].find(x=>x.dataset.mode==='manual');
   if(el)el.click();
  });
  await idle();
  const manual=await page.evaluate(()=>({
   モード:S.measure.settings.inputMode,
   案内:document.querySelector('#inputModeHelp')?.textContent||'',
   セルが編集できる:[...document.querySelectorAll('#measurementGrid input')].slice(0,3).every(x=>!x.readOnly),
  }));
  rec('手動入力モードへ切り替わる',manual.モード==='manual',JSON.stringify(manual));
  rec('手動入力モードではセルを直接編集できる',manual.セルが編集できる===true,JSON.stringify(manual));
  rec('手動入力モードの確定キーを案内する',/Enter/.test(manual.案内),manual.案内);

  /* 手動モードは Enter で確定する（自動モードのTabではない）。
     値は丸めの影響を受けない桁で送る——ここで見たいのは確定キーであって
     丸めではない（丸めは冒頭のノギスの検証で固定している）。 */
  /* モードの切り替えボタン自身が受信欄へフォーカスを移すので、ここでも
     こちらからは触らない（触ると同じ空振りになる）。 */
  await page.keyboard.type('28.45');
  await page.keyboard.press('Enter');
  await idle();
  const manualRow=await widthRow();
  rec('手動入力モードはEnterで確定する',manualRow.includes('28.45'),JSON.stringify(manualRow));

  /* ---- 12) 保存すると端末内と共有DBの両方へ残る（§9.91） ---- */
  const id=await page.evaluate(()=>S.measure.id);
  await page.evaluate(()=>{
   const btn=document.querySelector('#stampWorkStart');
   if(btn&&!btn.disabled)btn.click();
  });
  await idle();
  await page.evaluate(()=>document.querySelector('#saveDraft')?.click());
  await W.until(page,()=>!!document.querySelector('#measureModal')?.hidden,null,{ms:15000,what:'保存して測定画面が閉じる'});
  await idle(600,15000);
  /* 共有DBへの登録は画面を待たせずに送る（shareRecord）ので、届くまでサーバーへ聞き直す。 */
  await W.poll(()=>fetch(B+'/api/measurement/backup/list').then(x=>x.json()).catch(()=>({items:[]})),
    j=>(j.items||[]).some(i=>i.id===id||String(i.id).endsWith(id)),15000);
  const saved=await page.evaluate(async rid=>{
   const r=await fetch('/api/measurement/backup/list').then(x=>x.json()).catch(()=>({items:[]}));
   const local=typeof WL.records.reliableAll==='function'?await WL.records.reliableAll():[];
   return {共有:(r.items||[]).some(i=>i.id===rid),端末内:local.some(m=>m.id===rid),
           閉じた:!!document.querySelector('#measureModal')?.hidden};
  },id);
  rec('保存すると端末内に残る',saved.端末内===true,JSON.stringify(saved));
  rec('保存すると共有DBにも残る',saved.共有===true,JSON.stringify(saved));
  rec('保存すると測定画面が閉じる',saved.閉じた===true,JSON.stringify(saved));

  rec('コンソールに例外が出ない',errs.length===0,errs.slice(0,3).join(' / '));

  await cleanup();
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
  await cleanup();
 }
 /* 後片付け: 作ったレコードを端末内・共有の両方から消す。**落ちた側でも通る**
    ようにcatchからも呼ぶ。

    **画面のidと保存側の記録IDは同じではない。** 画面では `|L0001|K0001|C001`
    でも、共有DBには設備名が前に付いた `テスト設備A|L0001|K0001|C001` で入る。
    画面のidだけで消すと当たらず、残った実績が計画外実績としてタイムラインに
    出て、**無関係な test_scdrop を落とした**（§9.121）。一覧を引いて
    **末尾一致で消す**——前置きの規則を推測するより、実際に入っている
    idを見て消すほうが確実。 */
 async function cleanup(){
  try{await page.evaluate(async()=>{
   const id=(typeof S!=='undefined'&&S.measure)?S.measure.id:'';
   if(id&&typeof WL.records.reliableDelete==='function')await WL.records.reliableDelete(id).catch(()=>{});
   /* **消えるまで確かめる。** 共有(shareRecord)は画面を待たせずに送るので、
      1回消しただけだと**遅れて届いた登録が後から復活する**（通しで1回だけ
      test_scdrop が落ち、L0001に身に覚えのない実績が残っていた）。
      消す→数える→残っていたらもう一度、を数回まで繰り返す。 */
   if(id){
    for(let k=0;k<6;k++){
     const r=await fetch('/api/measurement/backup/list').then(x=>x.json()).catch(()=>({items:[]}));
     const ids=(r.items||[]).map(i=>i.id).filter(x=>x===id||String(x).endsWith(id));
     if(!ids.length)break;
     await fetch('/api/measurement/backup/delete',{method:'POST',
       headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})}).catch(()=>{});
     await new Promise(r2=>setTimeout(r2,250));
    }
   }
   const m=document.querySelector('#measureModal');if(m)m.hidden=true;
  })}catch(e){}
  try{await setMode('edit')}catch(e){}
 }
}, {viewport:{width:1920,height:1080}});
