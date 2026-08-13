/* test_typescale.js: 文字サイズを基準にした寸法の統一(§9.90)
   ============================================================
   トークン化は済んでいたのに「揃って見えない」という指摘が続いた。
   実測すると原因は2つで、どちらも**トークン同士の関係が決まっていない**
   ことだった。

    (a) 1つの表の中で文字サイズが3種類あった
        仕掛一覧: セル14px / 行内ボタン12px / 分割フラグ12px / バッジ10px
        タイムライン: 内容14px / 日付12px / 時刻13px / 作業可否10px
        同じ距離で同時に読むものの大きさが違うと、表全体が揃って見えない。
    (b) 高さ÷文字サイズが 1.31/1.38/1.86/2.17/2.50/2.57/2.77 の7種類
        同じ「ボタン」でも小さいものほど詰まって見えていた。

   ここで固定するのは次の4点。
    1. **表ごとにセルの文字サイズは1つ**(--tbl-fs)。行内のボタン・リンクも
       同じ大きさで、印(フラグ・バッジ)だけが1段下がる
    2. **見出し(カラム名)は折り返さない**。中途半端に2行になると行の高さが
       変わって表として読めない
    3. **高さは文字から作る**。--ctl-h-* が文字サイズ×行送り＋上下余白で、
       文字が入らない高さになりようがない
    4. **行間は文字まで詰められる**。以前は --ctl-h-xs(26px固定)が下限を
       決めていて、最密でも31pxより詰まらなかった
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const EQ='テスト設備A';
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:30000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#grid table',{timeout:30000});
  await page.waitForTimeout(1500);

  /* ---- 1) 1つの表の中で文字が揃う ---- */
  const mismatch=sel=>page.evaluate(s=>{
   const px=v=>Math.round(parseFloat(v)*10)/10;
   const out=[];
   document.querySelectorAll(s).forEach(tr=>{
    const r=tr.getBoundingClientRect();if(r.width<=0||r.height<=0)return;
    const cell=px(getComputedStyle(tr).fontSize);
    tr.querySelectorAll('button,a,span,td').forEach(el=>{
     const rb=el.getBoundingClientRect();if(rb.width<=0||rb.height<=0)return;
     const cls=String(el.className||'');
     // 印(フラグ・バッジ)は1段下げる決まりなので、値のセルとは別に見る。
     if(/flag|badge|chip|pill|mark|workable/.test(cls))return;
     const fs=px(getComputedStyle(el).fontSize);
     if(Math.abs(fs-cell)>0.6)out.push(`${cls.split(' ')[0]||el.tagName}:${fs}≠${cell}`);
    });
   });
   return [...new Set(out)];
  },sel);
  const gridBad=await mismatch('#grid tbody tr');
  rec('仕掛一覧: 行の中の文字が値と同じ大きさ',gridBad.length===0,gridBad.slice(0,5).join(' / '));

  /* 印は「1段だけ」下げる(2段以上離すとちぐはぐに見える)。 */
  const markGap=await page.evaluate(()=>{
   const px=v=>parseFloat(v);
   const out=[];
   document.querySelectorAll('#grid tbody tr').forEach(tr=>{
    const cell=px(getComputedStyle(tr).fontSize);
    tr.querySelectorAll('[class*=badge],[class*=flag]').forEach(el=>{
     if(el.getBoundingClientRect().width<=0)return;
     const fs=px(getComputedStyle(el).fontSize);
     if(cell-fs>2.5)out.push(`${String(el.className).split(' ')[0]}:${fs} vs ${cell}`);
    });
   });
   return [...new Set(out)];
  });
  rec('仕掛一覧: 印は値から1段しか下げない',markGap.length===0,markGap.slice(0,4).join(' / '));

  /* ---- 2) 見出しは折り返さない ---- */
  const wrapped=async()=>page.evaluate(()=>{
   const px=v=>parseFloat(v)||0;
   const out=[];
   document.querySelectorAll('#grid th,.lc-name,[data-content-col]').forEach(el=>{
    const r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return;
    const cs=getComputedStyle(el);
    const lh=px(cs.lineHeight)||px(cs.fontSize)*1.35;
    const inner=el.clientHeight-px(cs.paddingTop)-px(cs.paddingBottom);
    if(inner>lh*1.55)out.push((el.textContent||'').trim().slice(0,14)+`(${Math.round(inner/lh*10)/10}行)`);
   });
   return out;
  });
  rec('見出しは1行のまま(既定の表示サイズ)',(await wrapped()).length===0);

  /* **わざと狭くしても折り返さない。** 表示名を長くし、幅も細くする。 */
  await page.evaluate(async()=>{
   const t=typeof listLayoutTarget==='function'?listLayoutTarget():'';
   const col=(S.columns||[])[1];
   if(!t||!col)return;
   await WL.columnLayout.save(t,{order:[],widths:{[col]:70},hidden:[],
     names:{[col]:'とても長い表示名の見出しです'},formats:{},rules:{}});
   renderGrid();
  });
  await page.waitForTimeout(500);
  const narrow=await wrapped();
  rec('幅を狭めても見出しは折り返さない',narrow.length===0,narrow.slice(0,3).join(' / '));
  const ell=await page.evaluate(()=>{
   const th=[...document.querySelectorAll('#grid th')].find(x=>/とても長い/.test(x.textContent||''));
   if(!th)return null;
   const cs=getComputedStyle(th);
   return {ws:cs.whiteSpace,ov:cs.overflow,te:cs.textOverflow,w:Math.round(th.getBoundingClientRect().width)};
  });
  rec('入り切らない見出しは省略記号になる',
   !!ell&&ell.ws==='nowrap'&&ell.te==='ellipsis'&&ell.ov==='hidden',JSON.stringify(ell));
  await page.evaluate(async()=>{
   const t=typeof listLayoutTarget==='function'?listLayoutTarget():'';
   if(t)await WL.columnLayout.save(t,{order:[],widths:{},hidden:[],names:{},formats:{},rules:{}});
   renderGrid();
  });
  await page.waitForTimeout(400);

  /* ---- 3) 高さは文字から作られている ---- */
  /* トークンは calc(...) のまま返ってくるので、**実際に当てて測る**。
     getPropertyValue('--fs') は "calc(14px * var(--ui-scale))" という
     文字列で、そのまま数値にはできない。 */
  const readTokens=()=>page.evaluate(()=>{
   const probe=document.createElement('div');
   probe.style.cssText='position:absolute;visibility:hidden;left:-9999px';
   document.body.appendChild(probe);
   const val=(prop,name)=>{
    probe.style.setProperty(prop,`var(${name})`);
    const v=parseFloat(getComputedStyle(probe)[prop==='font-size'?'fontSize':'height']);
    probe.style.removeProperty(prop);
    return v;
   };
   const out={fs:val('font-size','--fs'),fsSm:val('font-size','--fs-sm'),
              lh:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lh')),
              xs:val('height','--ctl-h-xs'),sm:val('height','--ctl-h-sm'),
              md:val('height','--ctl-h'),lg:val('height','--ctl-h-lg')};
   probe.remove();
   return out;
  });
  const tokens=await readTokens();
  const fits=(h,fs)=>h>=fs*tokens.lh;   // 文字1行が必ず入る
  rec('コントロールの高さに文字1行が必ず入る',
   fits(tokens.xs,tokens.fsSm)&&fits(tokens.sm,tokens.fsSm)&&fits(tokens.md,tokens.fs)&&fits(tokens.lg,tokens.fs),
   JSON.stringify(tokens));
  /* 役割の違いは**上下余白だけ**。同じ文字を使う2つの高さの差は、
     余白の差ぶんだけであること(比がばらつく原因を断つ)。 */
  rec('同じ文字の役割どうしは余白の差だけで決まる',
   Math.abs((tokens.sm-tokens.xs)-4)<1.5&&Math.abs((tokens.lg-tokens.md)-4)<1.5,
   `xs=${tokens.xs} sm=${tokens.sm} md=${tokens.md} lg=${tokens.lg}`);

  /* 表示サイズを変えても関係は崩れない。 */
  const scaled=[];
  for(const size of ['xs','xl']){
   await page.evaluate(s=>document.documentElement.setAttribute('data-ui-size',s),size);
   await page.waitForTimeout(200);
   scaled.push(await readTokens());
  }
  rec('表示サイズを変えても文字1行は必ず入る',
   scaled.every(t=>t.md>=t.fs*t.lh),JSON.stringify(scaled));
  await page.evaluate(()=>document.documentElement.setAttribute('data-ui-size','md'));
  await page.waitForTimeout(200);

  /* ---- 4) 行間は文字まで詰められる ---- */
  const rowH=async g=>{
   await page.evaluate(x=>WL.rowGap.apply(x),g);
   await page.waitForTimeout(200);
   return page.evaluate(()=>{
    const rows=[...document.querySelectorAll('#grid tbody tr')].slice(0,10);
    const hs=[...new Set(rows.map(r=>Math.round(r.getBoundingClientRect().height)))];
    const btn=document.querySelector('#grid .measurement-action-button');
    const cell=btn?btn.closest('td'):null;
    return {hs,btn:btn?btn.getBoundingClientRect().height:null,
            /* ボタンが実際に置かれている**セルの内側**の高さ。行の外寸では
               ないので注意——行の上下の余白と罫線はここに入らない。 */
            cell:cell?cell.clientHeight:null};
   });
  };
  const dense=await rowH(1),normal=await rowH(3),loose=await rowH(5);
  /* 「明確に低い」は**割合**で見る。px差で見ると表示サイズごとに意味が
     変わるうえ、以前の閾値(6px差)は行内ボタンが行を膨らませていた頃の
     数字で、そこが直ると同じ「明確さ」でも差が縮む(§9.112)。 */
  rec('最密の行は既定より明確に低い',dense.hs[0]<=normal.hs[0]*0.85,
   `最密${dense.hs[0]}px / 既定${normal.hs[0]}px / 最疎${loose.hs[0]}px`
   +` (最密は既定の${(dense.hs[0]/normal.hs[0]*100).toFixed(0)}%)`);
  rec('最密でも文字1行は入る',dense.hs[0]>=tokens.fs*tokens.lh,`${dense.hs[0]}px`);
  /* **行内ボタンが行からはみ出さない**(§9.112)。セルは overflow:hidden
     なので、はみ出したぶんは押せるが**見えない**。以前 --row-ctl-h は
     行の**外寸**から作られており、行の上下の余白ぶん(7〜9px)必ず器より
     高くなっていた——実機で「操作ボタンと文字が見切れている」と報告された。
     行間を変えても入れる高さは変わらない(変わるのは余白のほう)ので、
     「縮むこと」ではなく「**どの行間でも収まっていること**」で固定する。 */
  const overflowed=[['最密',dense],['既定',normal],['最疎',loose]]
   .filter(([,x])=>x.btn!==null&&x.cell!==null&&x.btn>x.cell+1);
  rec('行内のボタンはどの行間でもセルに収まる',overflowed.length===0,
   overflowed.length?overflowed.map(([n,x])=>`${n}: ボタン${x.btn.toFixed(1)} > セル${x.cell}`).join(' / ')
                    :`最密${dense.btn.toFixed(1)}/${dense.cell} 既定${normal.btn.toFixed(1)}/${normal.cell}`);
  rec('どの行間でも行の高さは揃う',dense.hs.length===1&&normal.hs.length===1&&loose.hs.length===1,
   JSON.stringify([dense.hs,normal.hs,loose.hs]));
  await page.evaluate(()=>WL.rowGap.apply(3));

  /* ---- 5) コントロールの文字が切れていない ---- */
  const clipped=await page.evaluate(()=>{
   const out=[];
   const cv=document.createElement('canvas').getContext('2d');
   document.querySelectorAll('#listToolbar button,#listToolbar select,.hd-actions button').forEach(el=>{
    const r=el.getBoundingClientRect();if(r.width<=0)return;
    const cs=getComputedStyle(el);
    cv.font=`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const txt=(el.tagName==='SELECT'?(el.selectedOptions[0]?.textContent||''):el.textContent||'').trim();
    if(!txt)return;
    const need=cv.measureText(txt).width;
    const room=r.width-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)
               -(el.tagName==='SELECT'?18:0);
    if(need-room>2)out.push(`${el.id||el.className}:"${txt}" 必要${Math.round(need)}px/器${Math.round(room)}px`);
   });
   return out;
  });
  rec('ツールバー・ヘッダーの文字が器から切れていない',clipped.length===0,clipped.slice(0,4).join(' / '));

  /* ---- 6) タイムラインも同じ決まりで揃う ---- */
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  await page.waitForTimeout(1800);
  const scBad=await mismatch('.sc-row-line');
  rec('作業スケジュール: 行の中の文字が値と同じ大きさ',scBad.length===0,scBad.slice(0,5).join(' / '));
  const scFs=await page.evaluate(()=>{
   const row=document.querySelector('.sc-row-line');
   const px=v=>Math.round(parseFloat(v)*10)/10;
   return {row:px(getComputedStyle(row).fontSize),
           title:px(getComputedStyle(row.querySelector('.sc-row-title')).fontSize),
           time:px(getComputedStyle(row.querySelector('.sc-row-time')).fontSize)};
  });
  rec('内容欄と時刻欄が同じ大きさ',scFs.title===scFs.time&&scFs.title===scFs.row,JSON.stringify(scFs));

  console.log('\n=== SUMMARY ===');
  const bad=R.filter(r=>!r.ok);console.log(`${R.length-bad.length}/${R.length} passed`);
  bad.forEach(x=>console.log(' -',x.n,x.d||''));
  await b.close();b=null;
  process.exit(bad.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  if(b)await b.close().catch(()=>{});
  process.exit(2);
 }
})();
