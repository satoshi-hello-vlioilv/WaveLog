/* test_eqsetup.js: 使用設備の設定モーダル（§9.257 ②、利用者の指示）
   ================================================================
     「アプリ使用設備の設定のモーダルが使いづらいのでわかりやすく使いやすく
      再構築してください。」

   直す前の窓の何が使いづらかったか（実測）:
    ・**同じ設備名が3箇所**に出ていた（選択欄・「設備マスタから選択: LS4」・
      「現在の設定: LS4」）。同じ値が枠付きで並ぶと、読む側は「違うものかも
      しれない」と見比べることになる（§CLAUDE 画面基準 8／§9.129）
    ・決めることが2つ（使う設備／LotDspのタブ）なのに見出しでそう言わず、
      区切りは`<hr>`1本だけ（基準14「決める順に並べる」）
    ・「＋ 設備マスタへ新規登録」を選ぶと欄が生えて**窓の高さが動いた**
      （§9.227 ②「選んでも1pxも動かない」）
    ・「設定を保存」の隣の②は**選んだ瞬間に効く**ので、ボタンの字が
      何を保存するのか嘘をついていた（§CLAUDE 2）
    ・`WL.records.ensureEquipmentSettingsModal()`が**別の作り**の窓を持っており
      （`<select>`でなく`<input>`・LotDspのタブも無い）、そちらが動いた
      瞬間に`WL.records.fillEquipmentSelect()`が落ちる状態だった（§9.163）

   ここで固定すること。**どれも直す前なら落ちる**:
    1. 決めることが番号付きの節に分かれている（①使う設備 ②開くタブ）
    2. **いまの設備名は窓の中で1箇所だけ**（3箇所に戻さない）
    3. 選んでも**窓の高さと保存ボタンの位置が1pxも動かない**
    4. ②は「選ぶとすぐ反映」と名乗り、**選んだだけで保存される**
       （`WL.lotDspTab`の配線が効いている＝窓をJSで組み立てても間に合う）
    5. 保存ボタンは**何を保存するのか名乗る**（本文の外＝いつでも押せる）
    6. 何も選ばずに押したら**理由を出して直す場所へ連れて行く**（§CLAUDE 4）
    7. 窓の作りは**1箇所**——`#appSettingsModal`を空にしても同じ形で戻る

   **「要素がある」だけを見ないこと**——直す前も欄そのものは在った。
   **実寸で位置を突き合わせる**（3）、**画面に出ている文字を数える**（2）。
   ================================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';

run('test_eqsetup: 使用設備の設定モーダル（§9.257 ②、利用者の指示）', async ({page,rec,B,W,paint,errs})=>{
 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});

  const open=async()=>{
   await page.click('.hd-chip-equip');
   await page.waitForFunction(()=>{
    const m=document.getElementById('appSettingsModal');
    return m&&!m.hidden&&!!document.getElementById('configuredEquipment')
      &&!!document.getElementById('lotDspTabSetting');
   },null,{timeout:15000});
   /* **組み上がりを待つのは条件で**（§9.102）——設備マスタを引き終えて
      候補が並んだら先へ進む。 */
   await page.waitForFunction(()=>{
    const s=document.getElementById('configuredEquipment');
    return s&&s.options.length>2;
   },null,{timeout:15000});
  };
  const shot=()=>page.evaluate(()=>{
   const d=document.querySelector('#appSettingsModal .settings-dialog');
   const sv=document.getElementById('saveAppSettings');
   const r=d.getBoundingClientRect(),s=sv.getBoundingClientRect();
   return {窓の高さ:Math.round(r.height),保存の上端:Math.round(s.top),
           保存の左端:Math.round(s.left)};
  });
  await open();

  /* ---------- 1) 決めることが節に分かれている ---------- */
  const secs=await page.evaluate(()=>[...document.querySelectorAll('#appSettingsModal .eqset-sec>h3')]
    .map(h=>({no:(h.querySelector('.eqset-no')||{}).textContent||'',
              title:h.childNodes.length?h.textContent.trim():''})));
  rec('決めることが番号付きの節に分かれている（①②）',
      secs.length===2&&secs[0].no==='①'&&secs[1].no==='②',
      JSON.stringify(secs));
  rec('①は使う設備・②はロット№の開き方',
      /設備/.test(secs[0].title||'')&&/タブ/.test(secs[1].title||''),
      JSON.stringify(secs.map(x=>x.title)));

  /* ---------- 2) いまの設備名は窓の中で1箇所だけ（§CLAUDE 8） ----------
     **選択欄の値は数えない**（選ぶ場所であって、値を報せる場所ではない）。
     数えるのは「画面に出ている文字として設備名が何箇所に書かれているか」。 */
  const dup=await page.evaluate(eq=>{
   const root=document.querySelector('#appSettingsModal .settings-dialog');
   const out=[];
   const walk=n=>{
    for(const c of n.childNodes){
     if(c.nodeType===3){
      if(String(c.nodeValue||'').indexOf(eq)>=0){
       const host=c.parentElement;
       if(host&&host.offsetParent!==null)out.push(host.className||host.tagName);
      }
     }else if(c.nodeType===1&&c.tagName!=='SELECT'&&c.tagName!=='OPTION')walk(c);
    }
   };
   walk(root);
   return out;
  },EQ);
  rec('いまの設備名は窓の中で1箇所だけに出る（3箇所に戻さない）',
      dup.length===1,JSON.stringify(dup));
  rec('その1箇所は①の見出しのチップ',
      dup.length===1&&/eqset-now/.test(dup[0]),JSON.stringify(dup));

  /* ---------- 3) 選んでも1pxも動かない（§9.227 ②） ---------- */
  const a=await shot();
  /* 選び替えは同期で描き直す。「動かない」を見るので、描画が1巡したところで測る。 */
  await page.selectOption('#configuredEquipment','__new__');
  await paint();
  const bx=await shot();
  await page.fill('#newEquipmentName','ZZ_'+Date.now());
  await paint();
  const c=await shot();
  await page.selectOption('#configuredEquipment','');
  await paint();
  const d=await shot();
  const same=[a,bx,c,d];
  rec('「＋新規登録」を選んでも窓の高さが動かない',
      same.every(x=>x.窓の高さ===a.窓の高さ),JSON.stringify(same.map(x=>x.窓の高さ)));
  rec('保存ボタンの位置が動かない（狙いが外れない）',
      same.every(x=>x.保存の上端===a.保存の上端&&x.保存の左端===a.保存の左端),
      JSON.stringify(same.map(x=>x.保存の上端+'/'+x.保存の左端)));
  /* 新規登録の欄は**場所を空けたまま伏せる**（消して詰めない）。 */
  const slot=await page.evaluate(()=>{
   const el=document.getElementById('newEquipmentEntry');
   const cs=getComputedStyle(el),r=el.getBoundingClientRect();
   return {見え方:cs.visibility,高さ:Math.round(r.height),表示:cs.display};
  });
  rec('伏せているときも場所は空いている（display:noneにしない）',
      slot.見え方==='hidden'&&slot.表示!=='none'&&slot.高さ>0,JSON.stringify(slot));

  /* ---------- 6) 何も選ばずに押したら理由を出す（§CLAUDE 4） ---------- */
  await page.click('#saveAppSettings');
  await W.until(page,()=>/選んで/.test((document.getElementById('eqsetFoot')||{}).textContent||''),null,{ms:5000,what:'断りの理由が足元に出る'});
  const refused=await page.evaluate(()=>({
   足:document.getElementById('eqsetFoot').textContent,
   窓:!document.getElementById('appSettingsModal').hidden,
   焦点:document.activeElement&&document.activeElement.id}));
  rec('何も選ばずに保存したら理由を出して閉じない',
      /選んで/.test(refused.足||'')&&refused.窓===true,JSON.stringify(refused));
  rec('直す場所（設備の欄）へ連れて行く',
      refused.焦点==='configuredEquipment',String(refused.焦点));

  /* ---------- 5) ボタンは何を保存するのか名乗る／本文の外に居る ---------- */
  const btn=await page.evaluate(()=>{
   const sv=document.getElementById('saveAppSettings');
   const body=document.querySelector('#appSettingsModal .settings-body');
   const r=body.getBoundingClientRect(),s=sv.getBoundingClientRect();
   return {字:sv.textContent.trim(),本文の中:body.contains(sv),
           本文より下:s.top>=r.bottom-1};
  });
  rec('保存ボタンが何を保存するのか名乗る',/使用設備/.test(btn.字),btn.字);
  rec('保存ボタンは本文の外（中身が増えても押せる）',
      btn.本文の中===false&&btn.本文より下===true,JSON.stringify(btn));

  /* ---------- 4) ②は選んだだけで保存される（§9.257 ②の配線） ----------
     **窓はJSがあとから組み立てる**ので、`base.js`が読み込み時に1度だけ
     欄を探す作りだと間に合わない＝**選んでも保存されない**。
     `localStorage`まで見ること（`select.value`だけを見る網は素通りする）。 */
  const before=await page.evaluate(()=>localStorage.getItem('LotDspLastTabV1'));
  const want=String(before==='5'?'6':'5');
  await page.selectOption('#lotDspTabSetting',want);
  await W.until(page,w=>localStorage.getItem('LotDspLastTabV1')===w,want,{ms:3000,what:'②のタブが端末へ保存される'});
  const after=await page.evaluate(()=>localStorage.getItem('LotDspLastTabV1'));
  rec('②のタブは選んだだけで保存される（保存ボタンを待たない）',
      after===want,JSON.stringify({前:before,選:want,後:after}));
  const instant=await page.evaluate(()=>{
   const h=document.getElementById('eqsetH2');
   return (h&&h.textContent)||'';
  });
  rec('②は「すぐ反映」と名乗る（保存ボタンが嘘をつかない）',
      /すぐ反映/.test(instant),instant.trim());
  await page.selectOption('#lotDspTabSetting',String(before||'1'));

  /* ---------- 7) 窓の作りは1箇所（同じ形で戻る） ----------
     直す前は`index.html`と`WL.records.ensureEquipmentSettingsModal()`が**別々の作り**を
     持っており、後者は`<input>`＋LotDspのタブ無しだった（そちらが動いた
     瞬間に`WL.records.fillEquipmentSelect()`が落ちる）。中身を捨てて開き直しても
     同じ形が戻ることで、作りが1つであることを固定する。 */
  await page.click('#cancelAppSettings');
  await W.until(page,()=>{const m=document.getElementById('appSettingsModal');return !m||m.hidden},null,{ms:5000,what:'設定の窓が閉じる'});
  await page.evaluate(()=>{document.getElementById('appSettingsModal').innerHTML=''});
  await open();
  const again=await page.evaluate(()=>({
   欄:document.getElementById('configuredEquipment')?.tagName,
   タブ:!!document.getElementById('lotDspTabSetting'),
   新規:!!document.getElementById('newEquipmentEntry'),
   節:document.querySelectorAll('#appSettingsModal .eqset-sec').length}));
  rec('中身を捨てても同じ形で戻る（作りが1つ）',
      again.欄==='SELECT'&&again.タブ&&again.新規&&again.節===2,
      JSON.stringify(again));
  const tabAgain=await page.evaluate(()=>document.getElementById('lotDspTabSetting').value);
  rec('作り直したあともタブの配線が効いている',
      tabAgain===String(before||'1'),JSON.stringify({欄:tabAgain,控え:before}));

  /* 保存できることまで見る（窓を組み替えて壊していない）。 */
  await page.selectOption('#configuredEquipment',EQ);
  await paint();
  await page.click('#saveAppSettings');
  await page.waitForFunction(()=>document.getElementById('appSettingsModal').hidden,
    null,{timeout:8000}).catch(()=>{});
  const saved=await page.evaluate(()=>({
   控え:localStorage.getItem('AccessMeasurementConfiguredEquipment'),
   帯:document.getElementById('headerEquipmentName')?.textContent}));
  rec('選んで保存すると端末の設定とヘッダーの両方へ届く',
      saved.控え===EQ&&saved.帯===EQ,JSON.stringify(saved));

  rec('画面のJSが例外を出していない',errs.length===0,errs.join(' / '));
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }
}, {viewport:{width:1400,height:900}});
