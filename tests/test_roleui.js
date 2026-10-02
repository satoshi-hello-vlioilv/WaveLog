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
    ⑥ **表示列の編集**（§9.512）: 変更不可なら保存を送らず字で言う／自分の分だけなら
       自分だけへ切り替えてから保存する（断って行き止まりにしない）／編集可なら今までどおり。
       何を保存してよいかは**サーバーの答え**（列レイアウトの応答）で決める

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

 // ---- ⑥ 表示列の編集（§9.512） ----------------------------------------
 /* **本物の列レイアウトへは書かない**（応答を差し替え、届いた宛先だけを数える）。 */
 const T='list:RT:UI';
 let colLevel='変更不可';const sent=[];
 const caps=l=>({columnEdit:l,canEditOwnColumns:l!=='変更不可',canEditCommonColumns:l==='編集可'});
 await page.route(/\/api\/column-layout-master/,route=>{
  const req=route.request(),u=req.url();
  if(!u.includes(encodeURIComponent(T))&&!(req.postData()||'').includes(T))return route.continue();
  const base={ok:true,target:T,canPersonalize:true,order:[],widths:{},...caps(colLevel)};
  if(req.method()==='GET')return route.fulfill({json:{...base,scope:'common'}});
  const scope=/\/scope/.test(u);
  sent.push(scope?'切替':'保存');
  return route.fulfill({json:{...base,scope:'personal'}});
 });
 const tryPatch=async lv=>{
  colLevel=lv;sent.length=0;
  await page.evaluate(t=>{WL.columnLayout.forget(t);document.getElementById('toastArea').innerHTML=''},T);
  await page.evaluate(t=>WL.columnLayout.patch(t,{widths:{A:80}}),T);
  await idle();
  return page.evaluate(t=>({sent:null,scope:WL.columnLayout.scope(t),
   toast:(document.getElementById('toastArea')||{}).textContent||''}),T).then(r=>({...r,sent:sent.slice()}));
 };
 const none=await tryPatch('変更不可');
 rec('⑥ 表示列の編集が「変更不可」なら保存を送らない',none.sent.length===0,JSON.stringify(none.sent));
 rec('⑥ 保存されないことと直す場所を字で言う',
   /保存されません/.test(none.toast)&&/アクセス権限マスタ/.test(none.toast),none.toast.slice(0,60));
 const self=await tryPatch('自分の分だけ');
 rec('⑥ 「自分の分だけ」なら自分だけへ切り替えてから保存する（みんなの分は書かない）',
   JSON.stringify(self.sent)==='["切替","保存"]'&&self.scope==='personal',JSON.stringify(self));
 rec('⑥ 切り替えたことを字で言う',/自分だけの表示列に切り替えました/.test(self.toast),self.toast.slice(0,40));
 const fullCol=await tryPatch('編集可');
 rec('⑥ 「編集可」なら今までどおりそのまま保存する',JSON.stringify(fullCol.sent)==='["保存"]',JSON.stringify(fullCol.sent));
 await page.unroute(/\/api\/column-layout-master/);

 // ---- ⑦ できること（§9.538、利用者の選択 D-6＋D-10） --------------------------
 /* 主役は端末の登録の一覧。タブ「できることの見張り」と行を開く（▸）が**サーバーの答え**を描くだけか。
    **本物の権限へは書かない**（一覧の応答を差し替える）。 */
 await applyLevel('開発者','編集可');
 const DEFS=[['master:open','マスタ管理','マスタ管理を開く'],['columns:common','一覧の見せ方','表示列を変える（みんなの分）']]
  .map(([key,group,label])=>({key,group,label,short:label}));
 const item=(id,loginId,role,a,b)=>({id,loginId,pcName:'',role,masterEdit:'編集可',masterEditEffective:'編集可',columnEdit:'編集可',
  canEdit:'編集可',canSchedule:'不可',canFieldReorder:'不可',fieldReorderEquipment:'',
  caps:[{key:'master:open',state:a,note:''},{key:'columns:common',state:b,note:''}]});
 await page.route(/\/api\/access-permission-master(\?|$)/,route=>{
  if(route.request().method()!=='GET')return route.continue();
  return route.fulfill({json:{ok:true,table:'アクセス権限マスタ',roles:['設備作業者','一般ユーザー','メンテナンス者','開発者'],
   items:[item(9001,'RTdev','開発者','yes','yes'),item(9002,'RTop','設備作業者','no','no')],
   capDefs:DEFS,capWatch:{counts:{'master:open':1,'columns:common':1},lone:['master:open','columns:common']}}});
 });
 await page.evaluate(()=>{WL.mm.openMasterMaint();document.querySelector('[data-master="accessPermission"]').click()});
 await W.until(page,()=>document.querySelectorAll('#masterMaintList .mm-rowtw').length===2,null,{ms:10000,what:'行を開く印'});
 const tabs=await page.evaluate(()=>[...document.querySelectorAll('#masterMaintList [data-ltab]')].map(b=>b.textContent.trim()));
 rec('⑦ 主役は端末の登録（最初のタブ・台数）で、見張りのタブの札が⚠の数を言う',
   tabs.length===2&&/端末の登録\s*2台/.test(tabs[0])&&/できることの見張り\s*⚠ 2/.test(tabs[1]),JSON.stringify(tabs));
 await page.click('#masterMaintList .mm-row:not(.head) .mm-rowtw');
 await W.until(page,()=>!!document.querySelector('#masterMaintList .mm-rowdetail'),null,{ms:5000,what:'行の下に開く'});
 const det=await page.evaluate(()=>({id:document.querySelector('.mm-rowdetail').dataset.rowId,
  marks:[...document.querySelectorAll('.mm-rowdetail .mm-cap')].map(m=>m.textContent),
  editor:!document.getElementById('maintEditorModal')?.hidden&&!!document.getElementById('maintEditorModal')}));
 rec('⑦ ▸ で行の下に「できること」が開き、サーバーの答えをそのまま描く（編集の窓は開かない）',
   det.id==='9001'&&det.marks.join('')==='○○'&&!det.editor,JSON.stringify(det));
 await page.click('#masterMaintList [data-ltab="permWatch"]');
 await W.until(page,()=>!!document.querySelector('#masterMaintList .mm-capmx'),null,{ms:5000,what:'見張りのタブ'});
 const mx=await page.evaluate(()=>({lone:[...document.querySelectorAll('.mm-capmx tr.is-lone th.l')].map(t=>t.textContent),
  n:[...document.querySelectorAll('.mm-capmx .mm-capn.is-low')].map(t=>t.textContent),
  warn:(document.querySelector('.mm-lview-warn')||{}).textContent||''}));
 rec('⑦ 見張り: 1台以下の「できること」を名指しし、台数を塗る（字でも言う）',
   mx.lone.length===2&&mx.n.join()==='1台,1台'&&/1台以下/.test(mx.warn),JSON.stringify(mx));
 await page.click('#masterMaintList [data-ltab=""]');
 await W.until(page,()=>!!document.querySelector('#masterMaintList .mm-row.head'),null,{ms:5000,what:'一覧へ戻る'});
 rec('⑦ 1枚目のタブで一覧へ戻れる',true);
 await page.unroute(/\/api\/access-permission-master(\?|$)/);

}, {viewport:{width:1600,height:1000}});
