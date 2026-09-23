/* test_rollwipe.js: ロールの全削除・完全入替の画面（§9.251、利用者の指示）
   ============================================================
   「ロールマスタの全削除機能（ロールマスタの完全入替機能）を実装して
    ください。」

   サーバー側の規則（範囲・消える件数・断り方）は `tests/test_rollio.py` が
   固定する。ここが見るのは**画面が取り消せない操作をどう見せるか**。

    1. 取り込み方が**選べて**、選ぶと**その場で説明が変わる**
       （何が消えるのかを、押す前に読めること）
    2. 取り込み方を選び直したら**下見をやり直す**——古い下見を残すと
       「削除0件」と書いてある画面のボタンで削除が走る
    3. 下見に**消えるロールが名前で並ぶ**（件数だけで済ませない・§CLAUDE 4）
    4. **読めない行があるときは「取り込む」を出さない**——押せるのに
       断られるボタンを残さない（§CLAUDE 4）
    5. 「全部消す…」は**主要動線から離れている**（追加ボタンより右）
    6. 全削除は**範囲を選ぶまで押せない**（「消す」に既定を持たせない）
    7. 範囲を選んで消すと、**その設備だけ**が一覧から消える

   **素通りに注意**: 「ボタンが在る」だけを見る網は、押しても何も起きない
   実装でも通る。件数・一覧の中身が実際に変わることまで見る。
   材料は自分で注ぎ込む（フィクスチャにロールは1本も無い）。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const TAG='RW'+process.pid;
const EQ='テスト設備A',EQ2='テスト設備B';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const getj=async p=>(await fetch(B+p)).json();
const made=[];

run('test_rollwipe: ロールの全削除・完全入替の画面（§9.251、利用者の指示）', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 try{
  await post('/api/access-mode',{mode:'edit'});
  const mk=async body=>{
   const r=await (await post('/api/roll-master',{user_id:'test',...body})).json();
   if(r.id)made.push(r.id);
   return r;
  };
  await mk({equipment:EQ,name:TAG+'A1',contactFace:'上',diaMax:200});
  await mk({equipment:EQ,name:TAG+'A2',contactFace:'下',diaMax:210});
  await mk({equipment:EQ2,name:TAG+'B1',diaMax:300});

  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  /* 起動の取得が静まってから書き換え・読み込み直す（すぐ reload すると初期化の取得が
     打ち切られ、アプリが「初期化エラー」を console へ出す・§9.451）。 */
  await W.booted(page); await idle();
  await page.evaluate(()=>{try{localStorage.removeItem('MasterListFoldV1')}catch(e){}});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:20000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:10000});
  /* 更新者IDは打ち込む欄ではなくなった（§9.276 ③）。端末の覚え（localStorage）へ入れる。 */
  await page.evaluate(v=>{try{localStorage.setItem('AccessMeasurementUserId',v)}catch(e){}},'tester');
  await page.waitForSelector('#masterMaintNav [data-master="roll"]',{timeout:20000});
  await page.click('#masterMaintNav [data-master="roll"]');
  await page.waitForSelector('#mmXioMode',{timeout:20000});
  const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));

  /* ---- 1) 取り込み方が選べて、説明がその場で変わる ---- */
  const modes=await page.evaluate(()=>[...document.querySelectorAll('#mmXioMode option')]
    .map(o=>({v:o.value,t:o.textContent.trim()})));
  rec('取り込み方を選べる（足す・上書き／ファイルの設備／すべての設備）',
      modes.length===3&&modes[0].v===''&&modes.map(m=>m.v).join(',')===',file,all',
      JSON.stringify(modes));
  rec('既定は「足す・上書きする」（今までの動きを変えない）',
      await page.evaluate(()=>document.getElementById('mmXioMode').value)==='',
      await page.evaluate(()=>document.getElementById('mmXioMode').value));
  const noteOf=async v=>{
   await page.selectOption('#mmXioMode',v);await settle();
   return page.evaluate(()=>(document.getElementById('mmXioNote')||{}).textContent||'');
  };
  const n0=await noteOf(''),n1=await noteOf('file'),n2=await noteOf('all');
  rec('選ぶと説明がその場で変わる（押す前に何が消えるか読める）',
      n0!==n1&&n1!==n2&&/残ります/.test(n0)&&/削除/.test(n1)&&/削除/.test(n2),
      JSON.stringify({n0:n0.slice(0,26),n1:n1.slice(0,26),n2:n2.slice(0,26)}));

  /* ---- 5) 「全部消す…」の置き場 ---- */
  const place=await page.evaluate(()=>{
   const del=document.getElementById('mmBulkDel'),add=document.getElementById('masterMaintAdd');
   if(!del)return null;
   const d=del.getBoundingClientRect(),a=add?add.getBoundingClientRect():null;
   return {右:a?d.left>a.right:null,見える:d.width>0&&d.height>0,
           危険色:getComputedStyle(del).backgroundColor,
           文:del.textContent.trim(),説明:del.title||''};
  });
  rec('「全部消す…」がある',!!place&&place.見える,JSON.stringify(place));
  rec('取り消せない操作は主要動線から離す（追加ボタンより右）',
      !!place&&place.右===true,JSON.stringify(place));
  rec('押す前に何が起きるかを名乗る（title）',
      !!place&&/範囲/.test(place.説明),place&&place.説明);

  /* ---- 6) 範囲を選ぶまで押せない ---- */
  await page.click('#mmBulkDel');
  await page.waitForFunction(()=>{
   const m=document.getElementById('appConfirmModal');
   return m&&!m.hidden&&document.querySelectorAll('input[name=mmBulkScope]').length>0;
  },null,{timeout:15000});
  const c0=await page.evaluate(()=>({
   選択肢:[...document.querySelectorAll('.mm-bulk-pick')].map(l=>l.textContent.trim()),
   選ばれている:[...document.querySelectorAll('input[name=mmBulkScope]')].filter(x=>x.checked).length,
   押せる:!document.getElementById('appConfirmOk').disabled,
   理由:(document.querySelector('.mm-bulk-need')||{}).textContent||'',
  }));
  rec('範囲は「設備ごと」と「すべての設備」から選ぶ',
      c0.選択肢.length>=3&&c0.選択肢.some(t=>t.includes(EQ))
      &&c0.選択肢.some(t=>t.includes(EQ2))&&c0.選択肢.some(t=>t.includes('すべての設備')),
      JSON.stringify(c0.選択肢));
  rec('件数を文字で出す（色だけで伝えない）',
      c0.選択肢.every(t=>/\d+件/.test(t)),JSON.stringify(c0.選択肢));
  rec('既定の範囲を持たせない（どれも選ばれていない）',c0.選ばれている===0,String(c0.選ばれている));
  rec('選ぶまで「削除する」は押せない',!c0.押せる,String(c0.押せる));
  rec('押せない理由をその場に書く',/範囲を選ぶ/.test(c0.理由),c0.理由);

  /* ---- 6b) 対象が多くてもボタンに手が届く（§9.255 ②、利用者の報告） ----
     「ロールマスタの削除機能で対象が多い時にモーダルの範囲がウィンドウの
      高さを超え、ボタンを操作不能となり身動きが取れなくなりました」

     原因は2つで**片方だけ直しても直らない**ので、両方を見る:
      ①1行が3段（丸ぽち／設備名／件数）になっていた——`.settings-body label`
        の`display:grid`が`.mm-bulk-pick`の`display:flex`に詳細度で勝っていた
      ②一覧に上限が無く、器（`.record-modal`）は`overflow`を持たないので
        はみ出したぶんは画面の外
     **「高さの数字」だけを見ないこと**——実際に押せるか（その座標にボタンが
     居るか）まで見る。行数は実機どおり多い状態を作ってから測る。 */
  const rowH=await page.evaluate(()=>{
   const l=document.querySelector('.mm-bulk-pick');
   return l?Math.round(l.getBoundingClientRect().height):0;
  });
  rec('範囲の1行は1段に収まる（丸ぽち・設備名・件数が横並び）',
      rowH>0&&rowH<=40,String(rowH)+'px');
  /* 実機（設備13件）と同じ混み具合を、開いている一覧そのものへ注ぎ込んで作る
     ——マスタを汚さずに**本物の器**の振る舞いを見るため。 */
  const fit=await page.evaluate(()=>{
   const box=document.querySelector('.mm-bulk-scopes');
   const one=box&&box.querySelector('.mm-bulk-pick');
   if(!box||!one)return null;
   for(let i=0;i<14;i++){
    const c=one.cloneNode(true);c.dataset.probe='1';
    const r=c.querySelector('input');if(r)r.checked=false;
    box.insertBefore(c,box.lastElementChild);
   }
   const dlg=document.querySelector('#appConfirmModal .settings-dialog');
   const ok=document.getElementById('appConfirmOk');
   const d=dlg.getBoundingClientRect(),o=ok.getBoundingClientRect();
   const hit=document.elementFromPoint(Math.round(o.left+o.width/2),
                                       Math.round(o.top+o.height/2));
   return {窓の上:Math.round(d.top),窓の下:Math.round(d.bottom),
           画面:window.innerHeight,
           ボタンの下:Math.round(o.bottom),
           押せる:!!(hit&&(hit===ok||ok.contains(hit))),
           一覧が中でスクロール:box.scrollHeight>box.clientHeight+1};
  });
  rec('対象が多くても窓が画面からはみ出さない（②）',
      !!(fit&&fit.窓の上>=0&&fit.窓の下<=fit.画面),JSON.stringify(fit));
  rec('対象が多くても「削除する」に手が届く（②）',
      !!(fit&&fit.押せる&&fit.ボタンの下<=fit.画面),JSON.stringify(fit));
  rec('あふれたぶんは一覧の中でスクロールする（②）',
      !!(fit&&fit.一覧が中でスクロール),JSON.stringify(fit));
  await page.evaluate(()=>document.querySelectorAll('[data-probe]').forEach(x=>x.remove()));

  /* ---- 7) 設備を1つ選んで消す ---- */
  await page.evaluate(e=>{
   const l=[...document.querySelectorAll('.mm-bulk-pick')].find(x=>x.textContent.includes(e));
   l.querySelector('input').click();
  },EQ2);
  await settle();
  const c1=await page.evaluate(()=>!document.getElementById('appConfirmOk').disabled);
  rec('範囲を選ぶと押せるようになる',c1===true,String(c1));
  await page.click('#appConfirmOk');
  await page.waitForFunction(t=>{
   const rows=[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')];
   return rows.length>0&&!rows.some(r=>r.textContent.includes(t));
  },TAG+'B1',{timeout:20000}).catch(()=>{});
  const after=await page.evaluate(()=>[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')]
    .map(r=>r.textContent).join(' | '));
  rec('選んだ設備のロールだけが一覧から消える',
      !after.includes(TAG+'B1')&&after.includes(TAG+'A1')&&after.includes(TAG+'A2'),
      after.slice(0,160));
  const srv=((await getj('/api/roll-master')).items||[]).filter(x=>x.name&&x.name.startsWith(TAG));
  rec('サーバー側でも消えている（画面だけの見せかけではない）',
      srv.length===2&&!srv.some(x=>x.name===TAG+'B1'),
      JSON.stringify(srv.map(x=>x.name)));

  /* ---- 2〜4) 下見の見せ方 ----
     **実物の流れで見る**（ファイルを選ぶ→下見が出る）。内部の関数を直に
     呼ぶと、`<input type=file>`〜`FileReader`〜`xioPreview()` の道を
     一度も通らずに「描き方だけ」を確かめることになる（素通り）。
     材料は**設備Aだけの書き出し**——そのあとに設備Aへ1本足せば、
     「ファイルに出てこない行」がちょうど1本できる。 */
  const xlsx=Buffer.from(await (await fetch(B+'/api/roll-master/export?equipment='
    +encodeURIComponent(EQ))).arrayBuffer());
  rec('前提: 設備Aぶんを書き出せた（往復の材料）',xlsx.length>500,String(xlsx.length));
  await mk({equipment:EQ,name:TAG+'A3',diaMax:220});   // ファイルに無い1本
  const pickFile=async mode=>{
   await page.selectOption('#mmXioMode',mode);
   await page.setInputFiles('#mmXioFile',{name:'roll.xlsx',
     mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     buffer:xlsx});
   await page.waitForFunction(()=>{
    const b=document.getElementById('mmXioResult');
    return b&&!b.hidden&&/追加|取り込めません/.test(b.textContent||'');
   },null,{timeout:20000});
   return page.evaluate(()=>({
    文:(document.getElementById('mmXioResult')||{}).textContent||'',
    ボタン:!!document.getElementById('mmXioApply'),
    ボタン文:(document.getElementById('mmXioApply')||{}).textContent||'',
   }));
  };
  const p0=await pickFile('');
  rec('「足す・上書きする」では消える行を出さない（今までどおり）',
      !/消えるロール/.test(p0.文)&&p0.ボタン,p0.文.slice(0,120));
  const p1=await pickFile('file');
  rec('「入れ替える」の下見に消えるロールが名前で並ぶ（件数だけで済ませない）',
      /消えるロール/.test(p1.文)&&p1.文.includes(TAG+'A3'),p1.文.slice(0,200));
  rec('入れ替えのボタンは削除の件数を名乗る',/\d+件削除/.test(p1.ボタン文),p1.ボタン文);
  /* **選び直したら下見をやり直す**——古い下見のまま押すと、画面が
     「削除0件」と言っているのに削除が走る。 */
  const p2=await page.evaluate(()=>new Promise(r=>{
   const sel=document.getElementById('mmXioMode');
   sel.value='';sel.dispatchEvent(new Event('change'));
   const t0=Date.now();
   const tick=()=>{
    const b=document.getElementById('mmXioResult');
    const txt=(b&&b.textContent)||'';
    if(/追加/.test(txt)&&!/消えるロール/.test(txt))return r({文:txt,やり直した:true});
    if(Date.now()-t0>20000)return r({文:txt,やり直した:false});
    requestAnimationFrame(tick);
   };
   tick();
  }));
  rec('取り込み方を選び直すと下見をやり直す（古い件数で押させない）',
      p2.やり直した===true,p2.文.slice(0,120));

  rec('画面の例外が出ていない',errs.length===0,errs.join(' / '));
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }finally{
  try{
   const left=((await getj('/api/roll-master')).items||[]).filter(x=>x.name&&x.name.startsWith(TAG));
   for(const x of left){try{await post('/api/roll-master/delete',{user_id:'test',id:x.id})}catch(_){}}
  }catch(_){}
  for(const id of made){try{await post('/api/roll-master/delete',{user_id:'test',id})}catch(_){}}
 }
}, {viewport:{width:1600,height:1000}});
