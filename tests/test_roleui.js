/* test_roleui.js: 設備作業者とマスタ編集の段が**画面に効いている**か（§9.322）。

   サーバーが正しく答えていても、**画面が引かなければ何も変わらない**
   （§9.306の教訓）。ここで固定するのは5つ。

    ① 「非表示」なら**左メニューからマスタ管理そのものが消える**
       （設備作業者の端末。押せるのに何も出ない入口を残さない・§4）
    ② 「閲覧のみ」ならマスタ管理は開くが、**追加も編集も出ない**
    ③ 「部分的編集可」なら**現場のマスタは編集でき、管理のマスタは読むだけ**
       ——判定はサーバーの答え（`adminMasters`）で、画面がタブ名で
       決めていたらこの網は落ちる
    ④ 書けないときは**理由を文字で出す**（§3・§4）
    ⑤ 「編集可」なら今までどおり（触っていない端末を巻き添えにしない・§9.132）

   **`/api/access-mode`を差し替えて確かめる**——実機の権限を書き換えて
   しまうと、以降のテストが全部その端末の権限で走ることになる。 */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';

/* 管理のマスタの綴りは**サーバーが答える**ものをそのまま流す（画面はこれを
   読むだけ、が守れているかを見たいので、網の側でも表を作らない）。 */
const ADMIN=['accessPermission','pathConfig','dataSource','queryJoin','measStorage',
             'cleanup','rawTable'];
const FAKE=(role,level)=>({ok:true,mode:'edit',canEdit:true,canSchedule:false,
 canFieldReorder:false,fieldReorderEquipment:'',loginId:'me',pcName:'PC-ME',
 pcNameSource:'test',role:role,revoked:null,
 masterEdit:level,masterEditStored:level,masterEditCap:level,
 canOpenMaster:level!=='非表示',
 canEditFieldMaster:level==='部分的編集可'||level==='編集可',
 canEditAdminMaster:level==='編集可',
 adminMasters:ADMIN});

run('test_roleui: 設備作業者とマスタ編集の段が**画面に効いている**か（§9.322）。', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 let fake=null;
 await page.route('**/api/access-mode',route=>{
  if(!fake||route.request().method()!=='GET')return route.continue();
  route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fake)});
 });

 /* 段を差し替えて画面へ当て直す。**`refreshAccessMode()`の1本を通す**
    ——`accessMode`へ直に代入すると、入口の出し入れ（`applyAccessModeUI`）を
    通らないので、直す前でも通る網になる。 */
 const applyLevel=async(role,level)=>{
  fake=FAKE(role,level);
  await page.evaluate(()=>window.refreshAccessMode());
  await idle();
 };
 /* タブを名前で開く。**番号で開かないこと**（マスタが1つ増えただけで落ちる）。 */
 const openTab=async label=>{
  await page.evaluate(t=>{
   const el=[...document.querySelectorAll('#masterMaintNav [data-master]')]
     .find(x=>x.textContent.includes(t));
   if(el)el.click();
  },label);
  await idle();
 };
 const snap=()=>page.evaluate(()=>{
  const chip=document.getElementById('masterMaintLevel');
  return {title:document.getElementById('masterMaintTitle')?.textContent||'',
          rows:document.querySelectorAll('#masterMaintList .mm-row:not(.head)').length,
          edits:document.querySelectorAll('#masterMaintList .mm-edit').length,
          dels:document.querySelectorAll('#masterMaintList .mm-del').length,
          submit:!!document.querySelector('#masterMaintForm [type="submit"],#masterMaintForm .mm-open-editor'),
          chip:(chip&&!chip.hidden)?chip.textContent.trim():'',
          chipWhy:(chip&&!chip.hidden)?(chip.title||''):''};
 });

 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openMasterMaint',{timeout:15000});

 // ---- ⑤ 編集可（＝いまの端末の既定）: 今までどおり ---------------------
 await applyLevel('一般ユーザー','編集可');
 /* **`el.hidden`だけを見ないこと**——`.nav-item{display:flex}`は作者の規則なので、
    ブラウザ既定の`[hidden]{display:none}`に勝つ。実際に描かれているかで見る。 */
 const shown=()=>page.evaluate(()=>{
  const el=document.getElementById('openMasterMaint');
  return {hidden:el.hidden,drawn:!!el.offsetParent&&el.getBoundingClientRect().height>0};
 });
 const entryFull=await shown();
 rec('⑤ 編集可ならマスタ管理の入口は出たまま',!entryFull.hidden&&entryFull.drawn,
   JSON.stringify(entryFull));
 await page.click('#openMasterMaint');await idle();
 await openTab('設備');
 const full=await snap();
 rec('⑤ 編集可なら現場のマスタを編集できる',full.edits>0&&!full.chip,
   `${full.title} 編集${full.edits} 帯"${full.chip}"`);
 await openTab('アクセス権限');
 const fullAdmin=await snap();
 rec('⑤ 編集可なら管理のマスタも編集できる',fullAdmin.edits>0&&!fullAdmin.chip,
   `${fullAdmin.title} 編集${fullAdmin.edits} 帯"${fullAdmin.chip}"`);

 // ---- ③④ 部分的編集可 --------------------------------------------------
 await applyLevel('一般ユーザー','部分的編集可');
 await openTab('設備');
 const partField=await snap();
 rec('③ 部分的編集可でも現場のマスタは編集できる',partField.edits>0&&!partField.chip,
   `${partField.title} 編集${partField.edits} 帯"${partField.chip}"`);
 await openTab('アクセス権限');
 const partAdmin=await snap();
 rec('③ 部分的編集可では管理のマスタは読むだけ',
   partAdmin.rows>0&&partAdmin.edits===0&&partAdmin.dels===0,
   `${partAdmin.title} 行${partAdmin.rows} 編集${partAdmin.edits}`);
 rec('④ 読むだけの理由をその場に書く',
   /読み取り専用/.test(partAdmin.chip)&&/部分的編集可/.test(partAdmin.chipWhy),
   `"${partAdmin.chip}" / ${partAdmin.chipWhy.slice(0,50)}`);

 // ---- ② 閲覧のみ -------------------------------------------------------
 await applyLevel('一般ユーザー','閲覧のみ');
 await openTab('設備');
 const viewOnly=await snap();
 rec('② 閲覧のみなら現場のマスタも読むだけ',
   viewOnly.rows>0&&viewOnly.edits===0&&viewOnly.dels===0,
   `${viewOnly.title} 行${viewOnly.rows} 編集${viewOnly.edits}`);
 rec('② 追加の入口も出さない',!viewOnly.submit);
 rec('④ 段の名前と直す場所を書く',
   /読み取り専用/.test(viewOnly.chip)&&/閲覧のみ/.test(viewOnly.chipWhy)
   &&/アクセス権限マスタ/.test(viewOnly.chipWhy),viewOnly.chipWhy.slice(0,60));

 /* ---- 段に載っていないタブは帯を出さない（§9.322） ----
    接続状況の切断は区分（§9.272）が答えるので、「読み取り専用」と名乗ると
    **合図が嘘をつく**（実際には切断できる）。 */
 await openTab('接続状況');
 const presence=await snap();
 rec('段に載っていないタブ（接続状況）には帯を出さない',!presence.chip,
   `${presence.title} 帯"${presence.chip}"`);

 // ---- ① 非表示（設備作業者）--------------------------------------------
 await applyLevel('設備作業者','非表示');
 const gone=await shown();
 const mm=await page.evaluate(()=>document.body.classList.contains('mm-mode'));
 rec('① 非表示なら左メニューからマスタ管理が消える（実際に描かれない）',
   gone.hidden&&!gone.drawn,JSON.stringify(gone));
 rec('① 開いたまま区分が下がったら一覧へ戻す',!mm,String(mm));

 // ---- 段が上がれば戻る（片道にしない）----------------------------------
 await applyLevel('一般ユーザー','編集可');
 const back=await shown();
 rec('段が上がれば入口は戻る（片道にしない）',!back.hidden&&back.drawn,JSON.stringify(back));

}, {viewport:{width:1600,height:1000}});
