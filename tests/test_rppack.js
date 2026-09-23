/* test_rppack.js: 紙ぜんたいの余白は「横」と「縦」の別の軸（§9.311 C・§9.313）
   ============================================================
   利用者の報告:
     「帳票レイアウトの縦横の余白変更ボタンは別々に機能させたいのに、
      どちらを押しても両方反応して別々に機能してくれません。」

   §9.311 Cで軸を2つに分けたが、**実測では分かれていなかった**。
   ここで固定するのは「押した軸だけが動く」ことを**刷り上がりの寸法**で
   見ること——`--rp-dense-x`が空かどうか（宣言）を見る網は、CSSの
   フォールバックで両軸が1つの値に落ちていても素通りする（§9.289）。

   後片付けは finally で必ず行う（§9.121）。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const TARGET='report:'+EQ;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const cleanup=()=>post('/api/column-layout-master',{target:TARGET,clear:true,order:[],widths:{},hidden:[],
  names:{},formats:{},rules:{},formulas:{},locks:[],sorts:{},user_id:'test'}).catch(()=>{});

run('test_rppack: 紙ぜんたいの余白は「横」と「縦」の別の軸（§9.311 C・§9.313）', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 await cleanup();
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:30000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  /* ---------- 材料は自分で注ぎ込む（§9.291 ①） ----------
     軸が混ざるのは**塊ごとの段**（`rpFitBlockBodies`の自動の詰め）が
     効いているときだけ。中身なりの高さで全部が収まっている紙では
     `--rp-dense`が1つも付かず、**直す前でも通ってしまう**（実測: 段の塊0で
     3×3すべて分離していた）。中身の多い塊にわざと低い高さを与えて、
     詰めが走る状態を作ってから測る。
     保存の形は`40＋数`（`__配置版__`＝40+3）、`行数:`は288基準なので
     既定の48段では1行＝6（§9.222 ②）。 */
  await post('/api/column-layout-master',{target:TARGET,user_id:'test',
    widths:{'__配置版__':43,'行数:基本情報':40+3*6}});
  await page.evaluate(e=>WL.reportSample.open({equipment:e}),EQ);
  await page.waitForSelector('#reportContent .rp-blocks',{timeout:25000});
  await idle();
  await page.click('#reportArrange');
  await page.waitForSelector('#reportContent .rp-blocks.is-arranging',{timeout:15000});
  await idle();

  /* **測るのは刷り上がりの寸法**（§9.289）。倍率(`--rp-scale`)は`transform`
     なので`getComputedStyle`のpaddingには掛からない——そのまま比べられる。
     `--rp-fit`が掛かっている塊は文字ごと縮むので、**掛かっていない塊**を選ぶ。 */
  const look=()=>page.evaluate(()=>{
   const pg=document.getElementById('reportContent');
   const cs=getComputedStyle(pg);
   const f=[...document.querySelectorAll('#reportContent .rp-field')]
     .find(e=>e.offsetParent&&e.getBoundingClientRect().height>0);
   const t=[...document.querySelectorAll('#reportContent .rp-dim-table td')]
     .find(e=>e.offsetParent&&e.getBoundingClientRect().height>0);
   const n=e=>e?{l:parseFloat(getComputedStyle(e).paddingLeft),
                 r:parseFloat(getComputedStyle(e).paddingRight),
                 t:parseFloat(getComputedStyle(e).paddingTop),
                 b:parseFloat(getComputedStyle(e).paddingBottom)}:null;
   /* 塊ごとの段（`--rp-dense`／`--rp-dense-x/y`）が何件掛かっているか。 */
   const packed=[...document.querySelectorAll('#reportContent .rp-block-fit')]
     .filter(e=>e.style.getPropertyValue('--rp-pack')).length;
   return {紙x:cs.getPropertyValue('--rp-dense-x').trim()||'(未設定)',
           紙y:cs.getPropertyValue('--rp-dense-y').trim()||'(未設定)',
           欄:n(f),表:n(t),段の塊:packed,
           札:[...document.querySelectorAll('[data-rp-pack]')].map(x=>x.textContent.trim())};
  });
  const press=async ax=>{
   await page.evaluate(a=>{const b=document.querySelector(`[data-rp-pack="${a}"]`);if(b)b.click()},ax);
   /* 押すと描き直して裏で保存する（RP_AUTOSAVE_MS=400）。その往復まで静まるのを待つ。 */
   await idle(600);
  };
  /* ---------- 3×3の全部を測る（どこで混ざるかを表で出す） ---------- */
  const M={};
  for(let y=0;y<3;y++){
   for(let x=0;x<3;x++){
    M[`x${x}y${y}`]=await look();
    if(x<2)await press('x');
   }
   await press('x');                 /* 一巡してx=0へ戻す */
   if(y<2)await press('y');
  }
  await press('y');                  /* 一巡してy=0へ戻す */
  console.log('--- 余白の実測（欄の左右/上下・表の左右/上下） ---');
  Object.keys(M).forEach(k=>{
   const m=M[k];
   console.log(`  ${k}  紙[x=${m.紙x} y=${m.紙y}]  欄 左右${m.欄.l}/${m.欄.r} 上下${m.欄.t}/${m.欄.b}`
     +`  表 左右${m.表?m.表.l:'-'} 上下${m.表?m.表.t:'-'}  段の塊${m.段の塊}`);
  });
  const base=M.x0y0;
  /* **前提**——塊ごとの段が1つも効いていない紙では、この網は何も
     確かめないまま通る（§9.289）。 */
  rec('前提: 塊ごとの段（自動の詰め）が効いている紙で測っている',
      Object.keys(M).some(k=>M[k].段の塊>0),
      '段の塊: '+Object.keys(M).map(k=>k+'='+M[k].段の塊).join(' '));
  /* ---------- ① 押していない軸の余白は1pxも動かない ----------
     **比べるのは「塊の段が同じ」もの同士**（§9.303 ①）。詰めたことでその塊が
     紙に入るようになれば自動の詰めは解ける——それは「もう詰める必要が無い」
     という正しい動きで、軸が混ざったのとは別のこと。下の②でその解け方まで
     見る。 */
  const same=(a,b)=>a.段の塊===b.段の塊;
  const near=(a,b)=>Math.abs(a-b)<0.05;
  const yMix=[],xMix=[];
  for(let x=0;x<3;x++)for(let y=1;y<3;y++){
   const a=M[`x${x}y0`],c=M[`x${x}y${y}`];
   if(same(a,c)&&!(near(a.欄.l,c.欄.l)&&near(a.欄.r,c.欄.r)
                 &&(!a.表||!c.表||near(a.表.l,c.表.l))))
    yMix.push(`x${x}y${y}:左右 ${a.欄.l}→${c.欄.l}`);
  }
  for(let y=0;y<3;y++)for(let x=1;x<3;x++){
   const a=M[`x0y${y}`],c=M[`x${x}y${y}`];
   if(same(a,c)&&!(near(a.欄.t,c.欄.t)&&near(a.欄.b,c.欄.b)
                 &&(!a.表||!c.表||near(a.表.t,c.表.t))))
    xMix.push(`x${x}y${y}:上下 ${a.欄.t}→${c.欄.t}`);
  }
  rec('§9.313 「縦」を押しても左右の余白は動かない',yMix.length===0,
      yMix.join(' / ')||'混ざり0件');
  rec('§9.313 「横」を押しても上下の余白は動かない',xMix.length===0,
      xMix.join(' / ')||'混ざり0件');
  /* ---------- ② 塊ごとの段は「紙の余白に掛かる」（緩めない） ----------
     以前は紙の軸が段を**置き換えて**いたので、「横＝詰める」を押したのに
     左右が緩む（実測 1.1→1.2）という逆の動きが起きた。掛け算なら、
     押すほど必ず詰まる。 */
  const loosened=[];
  for(let y=0;y<3;y++)for(let x=1;x<3;x++){
   const a=M[`x${x-1}y${y}`],c=M[`x${x}y${y}`];
   if(same(a,c)&&c.欄.l>a.欄.l+0.001)loosened.push(`x${x}y${y}: ${a.欄.l}→${c.欄.l}`);
  }
  rec('§9.313 「横」を詰める側へ押して左右が緩むことはない',loosened.length===0,
      loosened.join(' / ')||'緩み0件');
  /* ---------- ③ 段が解けたら、紙の軸そのものの値へぴったり戻る ----------
     軸が混ざっているのではなく「自動の詰めが要らなくなった」ことを見分ける。
     段の掛かっていないマスの左右は、**段なしの既定 × 紙の横**で説明できる。 */
  const free=Object.keys(M).filter(k=>M[k].段の塊===0);
  const 既定=2;                                   /* `.rp-field`の左右（段なし・紙もふつう） */
  const 紙横=k=>M[k].紙x==='(未設定)'?1:Number(M[k].紙x);
  rec('§9.313 自動の詰めが解けた塊は「紙の横 × 既定」で説明できる',
      free.length>0&&free.every(k=>near(M[k].欄.l,既定*紙横(k))),
      free.map(k=>`${k}:${M[k].欄.l}(期待${(既定*紙横(k)).toFixed(2)})`).join(' '));
  /* ---------- ④ 前提: 押した軸そのものはちゃんと動く ---------- */
  rec('前提: 「横」を押すと左右の余白が詰まる',
      M.x1y0.欄.l<M.x0y0.欄.l-0.05,JSON.stringify({前:M.x0y0.欄.l,後:M.x1y0.欄.l}));
  rec('前提: 「縦」を押すと上下の余白が詰まる',
      M.x0y1.欄.t<M.x0y0.欄.t-0.05,JSON.stringify({前:M.x0y0.欄.t,後:M.x0y1.欄.t}));

  rec('画面のJSで例外が出ていない',errs.length===0,errs.join(' / '));
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }finally{
  await cleanup();
 }
}, {viewport:{width:1700,height:1000}});
