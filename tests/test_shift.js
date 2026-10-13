/* 触る前の行を控える（§9.362 ⑤）。製品の「勤務体系を削除」は**論理削除**
   （`有効=0`）なので行が残るうえ、**名前で拾って消すとフィクスチャの行まで
   消える**——実測で`勤務体系設備マスタ`が4行減っていた（§9.284の
   「無差別に消すと、後片付けを持つ網の期待と食い違う」そのもの）。
   **この実行で増えた行だけ**を素の表から片付ける。 */
'use strict';
const {run}=require('./lib/harness.js');
const H=require('./lib/harness.js');
const SNAP_TABLES=['勤務体系マスタ','勤務区分マスタ','勤務体系設備マスタ'];
let snapM=null;
run('test_shift: 勤務体系の編集（テンプレート・保存・区分追加）', async ({page,rec,W,idle})=>{
 snapM=await H.masterSnapshot(SNAP_TABLES);
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openMasterMaint',{timeout:15000});
 await page.evaluate(()=>localStorage.setItem('MeasurementUserIdV1','tester'));
 await page.click('#openMasterMaint');
 await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:8000});
 /* 更新者IDは打ち込む欄ではなくなった（§9.276 ③）。端末の覚え（localStorage）へ入れる。 */
 await page.evaluate(v=>{try{localStorage.setItem('AccessMeasurementUserId',v)}catch(e){}},'tester');
 await page.evaluate(()=>{const b=[...document.querySelectorAll('#masterMaintNav [data-master]')].find(x=>x.textContent.includes('勤務形態'));if(b)b.click()});
 await page.waitForSelector('.shift-editor',{timeout:8000});
 await idle();  // 勤務体系の一覧を読み終えるまで

 const migrated=await page.$$eval('.shift-list-item b',ns=>ns.map(n=>n.textContent));
 rec('旧フラット勤務形態が勤務体系へ自動移行されている',migrated.length>0,migrated.join(' / '));

 // テンプレートから 交替勤務(1,2,3直) を作る
 await page.click('#shiftNew');
 await W.until(page,()=>[...document.querySelectorAll('[data-shift-tmpl]')].some(x=>x.textContent.includes('1,2,3直')),null,{ms:4000,what:'テンプレートの札が出る'});
 /* 1f（§9.598）: 「＋ 勤務体系を追加」は頭の主の操作で、▾ のメニュー（空・テンプレート）を開く。メニューは右の詳細の ⋯ と同じ
    `#mmActMenu`（形を1つに）。 */
 const menu=await page.evaluate(()=>{const m=document.querySelector('#mmActMenu');
  return {open:!!m&&!m.hidden,caret:!!document.querySelector('#shiftNew .mm-hd-caret'),
   items:[...document.querySelectorAll('#mmActMenu [data-shift-tmpl] b')].map(b=>b.textContent)}});
 rec('「＋ 勤務体系を追加」は ▾ のメニューで空・テンプレートを選ぶ（§9.598 1f）',
     menu.open&&menu.caret&&menu.items[0]==='空の勤務体系'&&menu.items.length>=2,JSON.stringify(menu));
 await page.evaluate(()=>{const b=[...document.querySelectorAll('[data-shift-tmpl]')].find(x=>x.textContent.includes('1,2,3直'));if(b)b.click()});
 await W.until(page,()=>(document.querySelector('#shiftName')||{}).value==='交替勤務(1,2,3直)'&&document.querySelectorAll('.shift-seg').length===3,null,{ms:4000,what:'テンプレートの3区分が入る'});
 const t=await page.evaluate(()=>({
   name:document.querySelector('#shiftName').value,
   segs:[...document.querySelectorAll('.shift-seg')].map(el=>({
     n:el.querySelector('.shift-seg-name').value,
     s:el.querySelector('.shift-seg-start').value,
     e:el.querySelector('.shift-seg-end').value,
     next:el.querySelector('.shift-seg-next').textContent})),
   timeInputs:document.querySelectorAll('.shift-seg input[type="time"]').length,
   bars:document.querySelectorAll('.shift-bar .shift-bar-piece').length,   // 左の一覧の小さな帯（.shift-mini24）は数えない
   barNames:[...document.querySelectorAll('.shift-bar .shift-bar-piece b')].map(b=>b.textContent),
 }));
 rec('テンプレート1クリックで階層(体系+3区分)が入る',t.name==='交替勤務(1,2,3直)'&&t.segs.length===3,JSON.stringify(t.segs));
 rec('時刻はinput[type=time](直打ち回避)',t.timeInputs===6,'time inputs='+t.timeInputs);
 rec('日跨ぎの3直に「翌日」バッジが出る',t.segs[2].next==='翌日',JSON.stringify(t.segs[2]));
 rec('24時間バーが描かれる(日跨ぎは2本に分割)',t.bars===4,'pieces='+t.bars);
 const cov=await page.evaluate(()=>document.querySelector('#shiftCoverage')?.textContent);
 rec('カバレッジが可視化される',/24時間をすべてカバー/.test(cov||''),cov);
 /* 1f: 帯は区分の名前を書く（色だけで言わない）。カバーの字は帯の真下。入力中の区分は帯の同じ所が光る（図と入力を結ぶ）。 */
 rec('帯に区分の名前が書かれる（色だけで言わない）',['1直','2直','3直'].every(n=>t.barNames.includes(n)),JSON.stringify(t.barNames));
 rec('カバーの字は帯の真下',await page.evaluate(()=>!!document.querySelector('.shift-bar-wrap #shiftCoverage')),'');
 await page.locator('.shift-seg').nth(2).locator('.shift-seg-name').focus();
 await W.until(page,()=>document.querySelector('.shift-seg[data-i="2"].is-focus')&&document.querySelectorAll('.shift-bar .shift-bar-piece.is-hot').length>0,null,{ms:4000,what:'入力中の区分と帯が光る'});
 const hot=await page.evaluate(()=>[...document.querySelectorAll('.shift-bar .shift-bar-piece.is-hot')].map(p=>p.dataset.seg));
 rec('入力中の区分は帯の同じ所が光る（日跨ぎは2本とも）',hot.length===2&&hot.every(x=>x==='2'),JSON.stringify(hot));
 const foot0=await page.evaluate(()=>({st:document.querySelector('#shiftDirty')?.textContent||'',save:document.querySelector('#shiftSave')?.disabled}));
 rec('作ったばかりの体系は「入力あり」で保存を押せる',/^入力あり/.test(foot0.st)&&foot0.save===false,JSON.stringify(foot0));
 /* 適用設備は「n/N」。全部選ぶと「すべて選ぶ」は押せない。元（全設備共通）へ戻してから保存する
    ——全部の設備を付けて保存すると、フィクスチャの体系から設備を奪う（後片付けは増えた行しか消さない）。 */
 const eq0=await page.evaluate(()=>document.querySelector('.shift-eq-count')?.textContent||'');
 await page.click('#shiftEqAll');
 await W.until(page,()=>document.querySelector('#shiftEqAll')?.disabled===true,null,{ms:4000,what:'「すべて選ぶ」が押せなくなる'});
 const eq1=await page.evaluate(()=>document.querySelector('.shift-eq-count')?.textContent||'');
 const [n1,N1]=(eq1.match(/(\d+)\s*\/\s*(\d+)/)||[]).slice(1).map(Number);
 rec('適用設備は「n/N」で、全部選ぶと「すべて選ぶ」は押せない',N1>0&&n1===N1,`前 ${eq0} → 後 ${eq1}`);
 await page.click('#shiftEqNone');
 await W.until(page,()=>document.querySelector('#shiftEqNone')?.disabled===true,null,{ms:4000,what:'全設備共通へ戻る'});

 /* ---- 現場歴の日付補正(§9.195) ----
    日を跨ぐ区分にだけ「日付の数え方」を出す。跨がない区分に置くと、
    設定できるのに効かない欄になる(§4)。 */
 const dayoff=await page.evaluate(()=>[...document.querySelectorAll('.shift-seg')].map(el=>({
   n:el.querySelector('.shift-seg-name').value,
   cross:(el.querySelector('.shift-seg-next')?.textContent||'').trim(),
   sel:!!el.querySelector('select.shift-seg-dayoff'),
   val:el.querySelector('select.shift-seg-dayoff')?.value||'',
   na:(el.querySelector('.shift-seg-dayoff.is-na')?.textContent||'').trim()})));
 rec('日を跨ぐ区分にだけ「日付の数え方」が出る',
     dayoff.filter(x=>x.sel).length===1&&dayoff.find(x=>x.sel).n==='3直'
     &&dayoff.filter(x=>!x.sel).every(x=>x.na==='—'),JSON.stringify(dayoff));
 rec('既定は「前の日として数える（−1日）」',
     (dayoff.find(x=>x.sel)||{}).val==='-1',(dayoff.find(x=>x.sel)||{}).val);

 /* ---- 見出しと本文が同じグリッドを共有する(§9.176と同じ土台) ---- */
 const grid=await page.evaluate(()=>{
  const head=document.querySelector('.shift-seg-head');
  const rows=[...document.querySelectorAll('.shift-seg')];
  const cs=el=>getComputedStyle(el).gridTemplateColumns;
  const name=document.querySelector('#shiftName');
  return {same:!!head&&rows.every(r=>cs(r)===cs(head)),
          all:[...new Set([cs(head),...rows.map(cs)])],
          nameW:Math.round(name.getBoundingClientRect().width),
          eqDisp:getComputedStyle(document.querySelector('#shiftEquipment')).display,
          /* 設備名のタグ(§9.197)。**文字が読めること**と**高さがそろうこと**を
             見る——「何個あるか」だけの網は、名前が押し出されて消えていた
             ときも通っていた。 */
          eqTags:[...document.querySelectorAll('#shiftEquipment [data-shift-eq]')].map(t=>({
           name:t.dataset.shiftEq,
           text:t.textContent.replace(/[＋✓\s]/g,''),
           h:Math.round(t.getBoundingClientRect().height),
           clipped:t.scrollWidth>t.clientWidth+1}))};
 });
 rec('区分の見出しと本文が同じ列定義を共有する（左端がそろう）',grid.same,grid.all.join(' | '));
 /* **器は中身の長さから決める**(CLAUDE.md §11)。名称は長くても20字ほど
    なのに、以前は枠いっぱい(600px超)まで伸びていた。 */
 rec('勤務体系の名称欄が無意味に長くない',grid.nameW>0&&grid.nameW<=420,grid.nameW+'px');
 /* **設備名そのものが押せるタグ**(§9.197、利用者の指示)。マス目に
    チェックボックスを置く形は、名前が消える不具合の温床でもあった。 */
 rec('適用設備は名前のタグで並ぶ',grid.eqDisp==='flex',grid.eqDisp);
 rec('タグに設備名の文字が出て、切れていない',
     grid.eqTags.length>0&&grid.eqTags.every(t=>t.text===t.name&&!t.clipped),
     JSON.stringify(grid.eqTags));
 rec('タグの高さがそろう',
     grid.eqTags.length>0&&new Set(grid.eqTags.map(t=>t.h)).size===1,
     JSON.stringify(grid.eqTags.map(t=>t.h)));

 // 保存
 await page.click('#shiftSave'); await idle(400,10000);
 const saved=await page.evaluate(async()=>await fetch('/api/schedule/shift-pattern-master?scope=all').then(r=>r.json()));
 const p=(saved.items||[]).find(x=>x.name==='交替勤務(1,2,3直)');
 rec('保存され、階層のままサーバーに入る',!!p&&p.segments.length===3,p?JSON.stringify(p.segments):'not found');

 /* 1f: 保存した後は「変更なし」で、保存・キャンセルは押せない。削除は頭の ⋯ のメニュー（赤の字）。打つと「変更あり」、
    キャンセルで開いたときの値へ戻る（閉じない）。 */
 await W.until(page,()=>/^変更なし/.test(document.querySelector('#shiftDirty')?.textContent||''),null,{ms:8000,what:'保存の後は「変更なし」'});
 const foot1=await page.evaluate(()=>({save:document.querySelector('#shiftSave')?.disabled,cancel:document.querySelector('#shiftCancel')?.disabled,
  more:!!document.querySelector('#shiftMore'),delInFoot:!!document.querySelector('.mm-dfoot [id*="Del"],.shift-actions [id*="Del"]')}));
 rec('保存の後は「変更なし」で保存・キャンセルを押せない・削除は足元に無い',foot1.save&&foot1.cancel&&foot1.more&&!foot1.delInFoot,JSON.stringify(foot1));
 await page.click('#shiftMore');
 await W.until(page,()=>{const m=document.querySelector('#mmActMenu');return !!m&&!m.hidden&&!!m.querySelector('[data-shift-act="delete"]')},null,{ms:4000,what:'⋯ のメニューに削除が出る'});
 const del=await page.evaluate(()=>{const b=document.querySelector('#mmActMenu [data-shift-act="delete"]');return {danger:b.classList.contains('is-danger'),text:b.textContent}});
 rec('削除は ⋯ のメニューの赤の字',del.danger&&/削除/.test(del.text),JSON.stringify(del));
 await page.keyboard.press('Escape');
 await W.until(page,()=>document.querySelector('#mmActMenu')?.hidden===true,null,{ms:4000,what:'Esc でメニューが閉じる'});
 await page.fill('#shiftName','交替勤務(1,2,3直)の写し');
 await W.until(page,()=>/^変更あり/.test(document.querySelector('#shiftDirty')?.textContent||'')&&document.querySelector('#shiftSave')?.disabled===false,null,{ms:4000,what:'打つと「変更あり」'});
 await page.click('#shiftCancel');
 await W.until(page,()=>document.querySelector('#shiftName')?.value==='交替勤務(1,2,3直)'&&/^変更なし/.test(document.querySelector('#shiftDirty')?.textContent||''),null,{ms:4000,what:'キャンセルで元の値へ'});
 rec('打つと「変更あり」・キャンセルで開いたときの値へ戻る（閉じない）',
     await page.evaluate(()=>!!document.querySelector('.shift-editor')&&document.querySelector('#shiftName').value==='交替勤務(1,2,3直)'),'');

 // 区分追加は前の区分の終了時刻を引き継ぐ
 const nSeg=await page.$$eval('.shift-seg',x=>x.length);
 await page.click('#shiftAddSeg');
 await W.until(page,n=>document.querySelectorAll('.shift-seg').length>n,nSeg,{ms:4000,what:'区分が1つ増える'});
 const added=await page.evaluate(()=>{const els=[...document.querySelectorAll('.shift-seg')];const l=els[els.length-1];
   return {n:l.querySelector('.shift-seg-name').value,s:l.querySelector('.shift-seg-start').value,prevEnd:els[els.length-2].querySelector('.shift-seg-end').value}});
 rec('区分追加時に直前の終了時刻を開始の初期値にする',added.s===added.prevEnd,JSON.stringify(added));

 /* 1i（§9.598）: 区分を消すのは行の ⋯ のメニュー（主の動線に×を置かない）。保存するまではキャンセルで戻せる。 */
 const nNow=await page.$$eval('.shift-seg',x=>x.length);
 const segBtns=await page.evaluate(()=>({x:document.querySelectorAll('.shift-seg .shift-seg-del').length,more:document.querySelectorAll('.shift-seg .shift-seg-more').length}));
 await page.locator('.shift-seg').last().locator('.shift-seg-more').click();
 await W.until(page,()=>{const m=document.querySelector('#mmActMenu');return !!m&&!m.hidden&&!!m.querySelector('[data-shift-seg-act="delete"]')},null,{ms:4000,what:'区分の ⋯ に「この区分を消す」'});
 const segDel=await page.evaluate(()=>{const b=document.querySelector('#mmActMenu [data-shift-seg-act="delete"]');return {danger:b.classList.contains('is-danger'),text:b.textContent}});
 await page.click('#mmActMenu [data-shift-seg-act="delete"]');
 await W.until(page,n=>document.querySelectorAll('.shift-seg').length===n-1,nNow,{ms:4000,what:'区分が1つ減る'});
 rec('区分の行に×は無く、⋯ のメニュー（赤の字）から消す',segBtns.x===0&&segBtns.more===nNow&&segDel.danger,JSON.stringify({segBtns,segDel}));
 /* 足元（キャンセル・保存）は右の下端（設備停止・右の詳細と同じ場所）。 */
 const foot2=await page.evaluate(()=>{const f=document.querySelector('.shift-detail>.mm-dfoot').getBoundingClientRect(),w=document.querySelector('#masterMaintPanel .mm-list-wrap').getBoundingClientRect();return {fb:Math.round(f.bottom),wb:Math.round(w.bottom)}});
 rec('足元は右の下端にある',foot2.wb-foot2.fb>=0&&foot2.wb-foot2.fb<=24,JSON.stringify(foot2));
 /* 足して消したので元と同じ形なら「変更なし」でキャンセルは押せない（押せるときだけ押す）。 */
 if(!(await page.$eval('#shiftCancel',b=>b.disabled)))await page.click('#shiftCancel');
 await W.until(page,()=>/^変更なし/.test(document.querySelector('#shiftDirty')?.textContent||''),null,{ms:4000,what:'キャンセルで元へ'});

 /* **後始末。** 勤務体系はマスタDBに残り、実行をまたいで生き延びる(§9.121)。
    片付けないと、同じ名前の体系が回すたびに1件ずつ増えていく(実際に18件
    溜まっていた)。

    **名前で引いて消さないこと**（§9.362 ⑤）。この網が作る体系は
    フィクスチャにある体系と**同じ名前**なので、名前で拾うとフィクスチャの
    行まで消してしまう——製品の削除は設備割当を実DELETEするため、実測で
    `勤務体系設備マスタ`が4行減っていた（無くなった割当は誰も戻さない）。
    「触る前に居なかった行」だけを素の表から消す。 */
 try{if(snapM)await H.dropNewMasterRows(snapM)}
 catch(e){console.log('!! 増えた行を消せませんでした: '+(e&&e.message||e))}

}, {viewport:{width:1500,height:950}});
