/* test_colmenu.js: 一覧の見出しを右クリックして列を出し入れする（§9.110）
   ============================================================
   列を1つ隠すためだけに設定パネルを開かせない。要望は
   「一覧のカラムの右クリックからも直感的に表示非表示できるように」。

   ここで固定するのは、崩れると使えなくなる点。
    1. どの見出しでも開く（番号・ボタンの列も含む）
    2. 「この列を隠す」で本当に消え、保存される
    3. **戻す操作が同じ場所にある**——隠した本人が次に探すのはここ
    4. 最後の1列は隠せない（見出しが無くなると右クリックする場所も消える）
    5. Escで閉じる／外を押すと閉じる
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';

const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
let target='';
const reset=()=>target?post('/api/column-layout-master',{target,clear:true,order:[],widths:{},hidden:[],
  names:{},formats:{},rules:{},user_id:'test'}):Promise.resolve();
run('test_colmenu: 一覧の見出しを右クリックして列を出し入れする（§9.110）', async ({page,rec,B,W,idle,paint,errs})=>{
try{
  await post('/api/access-mode',{mode:'edit'});

  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await W.booted(page,30000); await idle();
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#grid table',{timeout:30000});
  await page.waitForFunction(()=>document.querySelectorAll('#grid thead th').length>5,{timeout:20000});
  target=await page.evaluate(()=>WL.list.listLayoutTarget());
  await reset();
  await page.evaluate(()=>{WL.columnLayout.forget();return WL.list.load()});
  await page.waitForFunction(()=>document.querySelectorAll('#grid thead th').length>5,{timeout:20000});

  const heads=()=>page.evaluate(()=>[...document.querySelectorAll('#grid thead th')].map(t=>t.dataset.col));
  const open=async col=>{
   const th=await page.$(`#grid thead th[data-col="${col}"]`);
   if(!th)throw Error('見出しが無い: '+col);
   const bx=await th.boundingBox();
   await page.mouse.click(bx.x+bx.width/2,bx.y+bx.height/2,{button:'right'});
   await page.waitForSelector('.col-head-menu',{timeout:5000});
  };

  const all=await heads();
  rec('どの見出しにもキーが付いている',all.every(Boolean),`${all.length}列`);

  /* ---- 1) データ列で開く ---- */
  const pick=all.find(k=>k&&!k.startsWith('__')&&k!=='#');
  await open(pick);
  const menu1=await page.evaluate(()=>document.querySelector('.col-head-menu').innerText);
  rec('見出しの右クリックでメニューが出る',/この列を隠す/.test(menu1),menu1.split('\n')[0]);
  rec('どの列のメニューか分かる',menu1.split('\n')[0].length>0,menu1.split('\n')[0]);

  /* ---- 2) 隠せる・保存される ---- */
  await page.click('.col-head-menu .chm-hide');
  await page.waitForFunction(k=>![...document.querySelectorAll('#grid thead th')]
    .some(t=>t.dataset.col===k),pick,{timeout:8000});
  rec('「この列を隠す」で消える',!(await heads()).includes(pick),pick);
  const saved=await (await fetch(B+'/api/column-layout-master?target='+encodeURIComponent(target))).json();
  rec('隠したことが保存される',(saved.hidden||[]).includes(pick),JSON.stringify(saved.hidden));
  rec('番号・ボタンの列は並びから消えない（§9.110）',
   ['#','__split__','__measure__'].every(k=>(saved.order||[]).includes(k)),
   JSON.stringify((saved.order||[]).slice(0,4)));

  /* ---- 3) 同じ場所から戻せる ---- */
  const other=(await heads()).find(k=>k&&!k.startsWith('__')&&k!=='#');
  await open(other);
  const menu2=await page.evaluate(()=>document.querySelector('.col-head-menu').innerText);
  rec('隠している列がメニューに並ぶ',new RegExp('隠している列').test(menu2)&&menu2.includes(pick),
   menu2.replace(/\n/g,' | ').slice(0,90));
  await page.click(`.col-head-menu .chm-show[data-key="${pick}"]`);
  await page.waitForFunction(k=>[...document.querySelectorAll('#grid thead th')]
    .some(t=>t.dataset.col===k),pick,{timeout:8000});
  rec('押すとその列が戻る',(await heads()).includes(pick),pick);

  /* ---- 4) 「すべての列を表示」 ---- */
  await open(other);
  await page.click('.col-head-menu .chm-hide');
  await W.until(page,k=>![...document.querySelectorAll('#grid thead th')].some(t=>t.dataset.col===k),other,{ms:8000,what:'隠した列が見出しから消える'});
  await open(pick);
  await page.click('.col-head-menu .chm-all');
  await page.waitForFunction(k=>[...document.querySelectorAll('#grid thead th')]
    .some(t=>t.dataset.col===k),other,{timeout:8000});
  rec('「すべての列を表示」で全部戻る',(await heads()).includes(other),other);

  /* ---- 5) 番号・ボタンの列でも開く ---- */
  await open('#');
  rec('番号の列でもメニューが出る',
   await page.evaluate(()=>!!document.querySelector('.col-head-menu')));

  /* ---- 6) 閉じ方 ---- */
  await page.keyboard.press('Escape');
  await W.until(page,()=>!document.querySelector('.col-head-menu'),null,{ms:3000,what:'Escでメニューが閉じる'});
  rec('Escで閉じる',await page.evaluate(()=>!document.querySelector('.col-head-menu')));
  await open(pick);
  await page.mouse.click(760,860);
  await W.until(page,()=>!document.querySelector('.col-head-menu'),null,{ms:3000,what:'外を押してメニューが閉じる'});
  rec('外を押すと閉じる',await page.evaluate(()=>!document.querySelector('.col-head-menu')));

  /* ---- 7) 最後の1列は隠せない ---- */
  // 見出しが1つも無い表は、右クリックして戻すこともできなくなる。
  const keys=await heads();
  await page.evaluate(async ks=>{
   const t=WL.list.listLayoutTarget(),v=WL.columnLayout.get(t);
   await WL.columnLayout.save(t,{order:v.order,widths:v.widths,hidden:ks.slice(1),
                                 names:v.names,formats:v.formats,rules:v.rules});
   WL.list.renderGrid();
  },keys);
  await paint();
  const last=(await heads());
  rec('1列だけ残っている状態を作れた',last.length===1,JSON.stringify(last));
  await open(last[0]);
  await page.click('.col-head-menu .chm-hide');
  /* 「隠れない」ことを見る: 隠すなら保存と描き直しの往復が起きるので、それが静まるまで待つ。 */
  await idle(800);
  rec('最後の1列は隠せない',(await heads()).length===1,JSON.stringify(await heads()));

  rec('コンソールに例外が出ない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
  }finally{
  try{await reset()}catch(e){}
  }
  }, {viewport:{width:1500,height:900}});
