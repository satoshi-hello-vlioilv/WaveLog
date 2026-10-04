/* test_theme.js: 配色・文字サイズの統一（トークン化）と、
   作業スケジュールの削除ボタン表記・アクセス権限の対象設備（複数/すべて）。
   ------------------------------------------------------------
   「統一感」は主観になりやすいので、**実測できる形**に落として固定する:
    - 文字サイズは表示サイズ(--ui-scale)へ必ず追随する＝拡大で全部が変わる
    - 同じ役割の色は同じ値になる（枠線・補助文字の種類数が増えていない）
    - 測定画面の地色が一覧画面と同じ（以前は選択項目が常時琥珀だった） */
const API='http://127.0.0.1:5029';
const setMode=async m=>{await fetch(`${API}/api/access-mode`,
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
/* 待ちは「時間」ではなく「条件」（§9.102・3-15 ③・§9.347）。骨組み
   （起動・rec・pageerror・素のダイアログ・集計・閉じる）は tests/lib/harness.js。
   置き換え前後で全PASS行（測った値ごと）を突き合わせてある。 */
const {run}=require('./lib/harness.js');
run('test_theme: 色と文字サイズはトークンから',async({page,rec,W,idle,paint})=>{
  await setMode('edit');
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#grid',{timeout:20000});
  await W.booted(page);await idle();

  /* ---- 1) 実際に配られたCSSを1枚として取る ---- */
  /* CSSは static/css/ 配下へ分割されている(§9.72)。読み込み順=カスケード順
     なので、document.styleSheets の順に取って1枚として見る。
     **「文字サイズのリテラルpxは印刷物とサイズ見本だけ」はここでは見ない**
     （§9.249 ④）——まったく同じ検査を `tests/test_csslint.py` が
     **ブラウザを立てずに1秒で**やっており、しかもあちらは常に回る
     （pick_tests の ALWAYS）。同じ約束を2箇所で持つと、片方だけ直した
     状態が作れる。ここが見るのは**描画してみないと分からないこと**だけ。 */
  const css=await page.evaluate(async()=>{
   const links=[...document.styleSheets].map(s=>s.href).filter(h=>h&&h.includes('app.css'));
   const parts=[];
   for(const h of links) parts.push(await (await fetch(h)).text());
   return parts.join('\n');
  });
  const noComment=css.replace(/\/\*[\s\S]*?\*\//g,'');

  /* ---- 2) 表示サイズを変えると測定画面の文字も全部変わる ---- */
  const sizes=await page.evaluate(async()=>{
   const pick=()=>{
    /* §9.286 ②③: 表示件数は一覧ツールバーへ移った。ヘッダーに残るのは検索欄。 */
    const ids=['#search','#pageSize','.list-count'];
    const els=[...document.querySelectorAll('.nav-item span'),...ids.map(s=>document.querySelector(s))].filter(Boolean);
    return els.slice(0,6).map(e=>parseFloat(getComputedStyle(e).fontSize));
   };
   document.documentElement.dataset.uiSize='md';const md=pick();
   document.documentElement.dataset.uiSize='lg';const lg=pick();
   document.documentElement.dataset.uiSize='md';
   return {md,lg};
  });
  rec('表示サイズの変更が全体の文字へ効く',
   sizes.md.length>0&&sizes.md.every((v,i)=>sizes.lg[i]>v),
   `中=${sizes.md.join(',')} / 大=${sizes.lg.join(',')}`);

  /* ---- 3) 中間色の種類が増えていない（同じ役割は同じ値） ---- */
  const neutrals=[...noComment.matchAll(/#([0-9a-fA-F]{6})\b/g)].map(m=>m[1].toLowerCase())
   .filter(h=>{const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
    return Math.max(r,g,b)-Math.min(r,g,b)<=22});
  const kinds=new Set(neutrals).size;
  rec('中間色(枠線・面・補助文字)の種類が抑えられている',kinds<=95,`${kinds}種`);

  /* ---- 3.5) 濃い地（左メニュー）の控えめな行き先がマウスオーバーでも読めるか（§9.409） ----
     元は「アプリ終了ボタンがマウスオーバーの際に視認できないコントラスト」（利用者の指摘④）。
     終了ボタンは§9.556で外した（×で閉じる）ので、同じ控えめな字（`--nav-ink-2`）で置く
     管理系の行き先（マスタ管理）で測る。目で見て直すのではまた戻るので、**実際に重ねて測る**。
     4.5:1 はWCAG AAの本文の線。 */
  const lum=c=>{const [r,g,b]=c.slice(0,3)
    .map(v=>{const x=v/255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4)});
   return 0.2126*r+0.7152*g+0.0722*b};
  /* **重ねた結果の色**を読む（§9.386）。`transition`を持つ値は当てた直後だと
     途中の値が返るので、**同じ値が2回続くまで**待つ。透けている面は親の地へ
     重ねて畳む——alphaを捨てて測ると、薄い面を濃い面として数えてしまう。 */
  const paintedColors=sel=>page.evaluate(async s=>{
   const rgba=v=>(v.match(/[\d.]+/g)||[0,0,0]).map(Number);
   const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const read=()=>{
    const el=document.querySelector(s);
    const fg=rgba(getComputedStyle(el).color).slice(0,3);
    let out=null,node=el;
    while(node){
     const c=rgba(getComputedStyle(node).backgroundColor);
     const a=c.length>3?c[3]:1;
     if(a>0){
      out=out?out:{c:[c[0],c[1],c[2]],a};
      if(out.a>=1)break;
      // 手前の面を奥の面へ重ねる（source-over）
      out={c:out.c.map((v,i)=>v*out.a+c[i]*(1-out.a)*a),a:out.a+(1-out.a)*a};
      if(out.a>=1)break;
     }
     node=node.parentElement;
    }
    const bg=out?out.c.map(v=>Math.round(v)):[255,255,255];
    return {fg,bg,key:fg.join()+'|'+bg.join()};
   };
   let prev=read();
   for(let i=0;i<40;i++){
    await frame();
    const now=read();
    if(now.key===prev.key)return now;
    prev=now;
   }
   return prev;
  },sel);
  const restQ=await paintedColors('#openMasterMaint');
  await page.hover('#openMasterMaint');
  const hoverQ=await paintedColors('#openMasterMaint');
  const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)};
  rec('管理系の行き先は重ねてもコントラストが保たれる（4.5:1以上）',
   ratio(hoverQ.fg,hoverQ.bg)>=4.5,
   `重ね ${ratio(hoverQ.fg,hoverQ.bg).toFixed(2)}:1 (rgb(${hoverQ.fg}) on rgb(${hoverQ.bg}))`
   +` / 素 ${ratio(restQ.fg,restQ.bg).toFixed(2)}:1`);
  rec('重ねると見た目が変わる（押せることが分かる）',
   hoverQ.key!==restQ.key,`${restQ.bg}→${hoverQ.bg}`);
  /* 素の状態も本文の線を割らない。**控えめに置くことと、読めないことは別**
     （以前は明るい地用の`--muted`をそのまま濃いナビへ載せて 2.55:1）。 */
  rec('管理系の行き先は素の状態でも読める（4.5:1以上）',
   ratio(restQ.fg,restQ.bg)>=4.5,`素 ${ratio(restQ.fg,restQ.bg).toFixed(2)}:1`);
  await page.mouse.move(0,0);

  /* ---- 4) 測定画面の地色が一覧画面と同じ ---- */
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:20000});
  const started=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(r)r.querySelector('.sc-row-start').click();return !!r;
  });
  rec('予定から測定画面を開ける',started);
  if(!started)throw Error('開始できる行が無い');
  await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:20000});
  await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,null,{timeout:30000}).catch(()=>{});

  const bg=await page.evaluate(()=>{
   const cs=id=>{const el=document.getElementById(id);return el?getComputedStyle(el).backgroundColor:''};
   return {chosen:cs('widthOrder'),chosen2:cs('unwind'),burr:cs('burr'),
           pending:cs('inspector'),
           pendingShadow:(()=>{const el=document.getElementById('inspector');return el?getComputedStyle(el).boxShadow:''})()};
  });
  rec('選択済みのコントロールは白（一覧画面と同じ地色）',
   bg.chosen==='rgb(255, 255, 255)'&&bg.chosen2==='rgb(255, 255, 255)'&&bg.burr==='rgb(255, 255, 255)',
   JSON.stringify(bg));
  rec('未選択だけが淡い色で、面ではなく左のバーで合図する',
   bg.pending!=='rgb(255, 255, 255)'&&/inset/.test(bg.pendingShadow),JSON.stringify(bg));
  // 以前の琥珀(#fff0d6 = rgb(255,240,214))そのままではないこと
  rec('未選択の色は警告色そのままではない（淡い）',
   bg.pending!=='rgb(255, 240, 214)',bg.pending);

  const blue=await page.evaluate(()=>{
   /* @layerで入れ子になっているので再帰で集める(VER1.83.0) */
   const all=rules=>[...rules].flatMap(r=>r.cssRules?[r.cssText||'',...all(r.cssRules)]:[r.cssText||'']);
   const st=[...document.styleSheets].flatMap(s=>{try{return all(s.cssRules)}catch(e){return []}}).join('\n');
   return /0b79c9/i.test(st);
  });
  rec('一覧の選択色がパレット外の原色ではない',!blue,String(blue));

  /* ---- 4b) 幅分割情報パネルの文字サイズが左ペインの他と揃っている ----
     このパネルだけ表と補足行を12pxで組んでおり、基本情報(14px)・作業時間
     (14/15px)・測定データ分析(14px)と並べると一段沈んで見えていた。 */
  const splitPanel=await page.evaluate(async()=>{
   const lots=[{lot:'AAA111',width:100,count:2},{lot:'BBB222',width:150,count:2},{lot:'CCC333',width:200,count:2}];
   const groups=lots.map(g=>({lot:g.lot,count:g.count,base:{width:g.width},tol:null,missing:false}));
   const pos=[];groups.forEach((g,gi)=>{for(let k=0;k<g.count;k++)pos.push(gi)});
   S.measure.settings.splitGroups=groups;S.measure.settings.splitPositionGroup=pos;
   S.measure.basic.originalWidth=940;
   document.getElementById('horizontalCount').value='6';
   refreshSplitStatusPanel();WL.measureInput.renderMeasureGrid();
   document.querySelector('[data-infotab="split"]')?.click();
   await new Promise(r=>setTimeout(r,300));
   const fs=s=>{const e=document.querySelector(s);return e?parseFloat(getComputedStyle(e).fontSize):0};
   const bg=s=>[...document.querySelectorAll(s)].map(e=>getComputedStyle(e).backgroundColor);
   return {
    body:fs('.basic-card .field label'),          // 左ペインの本文基準
    analysis:fs('.analysis .an-body'),            // 同じペインの別の面（§9.214で表を解体）
    status:fs('.split-panel-status-applied'),
    scrap:fs('.split-scrap-line'),
    /* 「1段」は**トークンで決まる**（`--fs`14px→`--fs-sm`12px）。px差の
       決め打ちにすると、表示サイズ倍率でも段の定義でも合わなくなる。
       **カスタムプロパティは生の文字列で返る**（`calc(12px * var(--ui-scale))`）
       ので、実際に当てた要素を測る。 */
    一段下:(()=>{const p=document.createElement('span');p.style.fontSize='var(--fs-sm)';
      document.body.appendChild(p);const v=parseFloat(getComputedStyle(p).fontSize);p.remove();return v})(),
    /* **まとめ帯（`.split-band-seg`）は廃止**（§9.156、利用者の指示
       「条のまとめ表示は不要、図は1つに統合して並べ替えができるものを」）。
       色で結び付けるという値打ちは残るので、**残った1条ずつの帯**で見る。
       色はJSが`--split-block-bg`で渡すので`background-color`に出る。 */
    帯:bg('#splitVisualStrip .split-visual-block:not(.empty)'),
    バッジ:bg('.strip-lot-badge'),
   };
  });
  /* 条の設計カードは**状態1行＋帯**（§9.145でモーダルを廃止し、候補の表は
     編集面が持つようになった）。文字は本文より小さくても1段まで。 */
  rec('パネル内の文字が本文より小さくても1段まで',
   [splitPanel.status,splitPanel.scrap].every(v=>v>=splitPanel.一段下&&v<=splitPanel.body+1.5),
   JSON.stringify(splitPanel));
  /* **帯グラフと測定表のロット列は同じ配色**（§9.146）。色で結び付けている
     のが値打ちなので、片方だけ配色を変えたら落ちること。 */
  rec('帯グラフのロット色が測定表のバッジと一致する',
   new Set(splitPanel.帯).size===3&&new Set(splitPanel.バッジ).size===3
   &&[...new Set(splitPanel.バッジ)].every(c=>splitPanel.帯.includes(c)),
   JSON.stringify({帯:[...new Set(splitPanel.帯)],バッジ:[...new Set(splitPanel.バッジ)]}));

  /* ---- 4c) 分割ありのとき、専用のロット列へ下3桁バッジ（§9.146） ----
     **入力欄の中ではなく1列にまとめる。** ロット番号は条で決まり丈位置では
     変わらないので、丈の数だけ同じバッジを並べても情報が増えない。 */
  const badges=await page.evaluate(()=>{
   const got=[...document.querySelectorAll('.strip-lot-badge')].map(b=>({
    t:b.textContent.trim(),title:b.title,
    bg:getComputedStyle(b).backgroundColor,
    列:b.closest('td')?.className||'',
    /* **並びはDOMの順で見る**——この時点の測定表は①の裏（`display:none`）に
       あり、座標はどれも0になる。0<0で「そろっている」と読めてしまう。 */
    列番:[...(b.closest('tr')?.children||[])].indexOf(b.closest('td')),
    値の列番:[...(b.closest('tr')?.children||[])].indexOf(
      b.closest('tr')?.querySelector('td:not(.mx-lot)'))}));
   return {n:got.length,got:got.slice(0,6),
    行:document.querySelectorAll('.measure-matrix tbody tr').length,
    ロット列:document.querySelectorAll('.measure-matrix td.mx-lot').length,
    入力欄の中:document.querySelectorAll('.strip-input-wrap .strip-lot-badge').length};
  });
  rec('分割ありの条にロット番号バッジが付く',badges.n===6&&badges.ロット列===6,JSON.stringify(badges).slice(0,180));
  rec('バッジは専用のロット列に置き、入力欄の中には入れない',
   badges.入力欄の中===0&&badges.got.every(b=>b.列.includes('mx-lot')),
   JSON.stringify({入力欄の中:badges.入力欄の中,列:badges.got.map(b=>b.列)}));
  rec('バッジはロット番号の下3桁',
   badges.got.slice(0,6).map(b=>b.t).join(',')==='111,111,222,222,333,333',
   badges.got.map(b=>b.t).join(','));
  rec('ツールチップはロット番号の全体',
   badges.got.every(b=>/^[A-Z]{3}\d{3}$/.test(b.title)),
   badges.got.map(b=>b.title).join(','));
  rec('ロットごとに色を変える(条割の帯グラフと同じ配色)',
   new Set(badges.got.map(b=>b.bg)).size===3,
   [...new Set(badges.got.map(b=>b.bg))].join(' / '));
  rec('ロット列は測定値の列より左（条の見出し側）に置く',
   badges.got.every(b=>b.列番>=0&&b.列番<b.値の列番),
   JSON.stringify(badges.got[0]));

  // 分割が無い(単一ロット)ならバッジは出さない
  const single=await page.evaluate(async()=>{
   S.measure.settings.splitGroups=[{lot:'AAA111',count:6,base:{width:100},tol:null,missing:false}];
   S.measure.settings.splitPositionGroup=[0,0,0,0,0,0];
   WL.measureInput.renderMeasureGrid();
   await new Promise(r=>setTimeout(r,200));
   const n=document.querySelectorAll('.strip-lot-badge').length;
   S.measure.settings.splitGroups=null;S.measure.settings.splitPositionGroup=null;
   WL.measureInput.renderMeasureGrid();
   await new Promise(r=>setTimeout(r,200));
   return {single:n,none:document.querySelectorAll('.strip-lot-badge').length};
  });
  rec('単一ロット・分割なしではバッジを出さない',
   single.single===0&&single.none===0,JSON.stringify(single));

  /* ---- 5) 作業スケジュールの削除ボタン表記 ----
     実績削除のボタンは「実績のある行」にしか出ない。フィクスチャの予定には
     実績が無いので、いま開いている測定画面を「編集中」で保存して作業中に
     してから、スケジュールを開き直して確かめる(test_scsyncと同じ手順)。 */
  // 開始を打刻してから保存する（打刻の無い一時保存は「実績のある行」にならない。§9.351）
  await page.evaluate(()=>document.querySelector('#stampWorkStart').click());
  rec('開始を打刻できる',await page.evaluate(()=>!!(S.measure&&S.measure.workTime&&S.measure.workTime.startAt)));
  const draftId=await page.evaluate(()=>S.measure&&S.measure.id);  // 後始末用（スケジュールへ戻ると S.measure は空になる）
  await page.click('#saveDraft');
  await idle(400,15000);
  await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,null,{timeout:30000}).catch(()=>{});
  await page.waitForFunction(()=>document.querySelector('#measureModal')?.hidden,null,{timeout:20000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:20000});
  await idle(400,15000);await paint();
  const labels=await page.evaluate(()=>{
   const btns=[...document.querySelectorAll('.sc-row-delete-history')];
   return {n:btns.length,texts:[...new Set(btns.map(b=>b.textContent.trim()))],
           titles:[...new Set(btns.map(b=>b.title))]};
  });
  rec('実績のある行に削除ボタンが出る',labels.n>0,JSON.stringify(labels));
  rec('実績削除のボタンが「削除」と読める',
   labels.texts.length>0&&labels.texts.every(t=>/削除/.test(t)&&!/実績/.test(t)),
   JSON.stringify(labels.texts));
  rec('ボタンの説明に何を消すのか書いてある',
   labels.titles.length>0&&labels.titles.every(t=>/測定データ/.test(t)&&/削除/.test(t)),
   JSON.stringify(labels.titles));

  await page.evaluate(async()=>{
   if(typeof S!=='undefined'&&S.measure&&typeof WL.records.reliableDelete==='function')
    await WL.records.reliableDelete(S.measure.id);
  }).catch(()=>{});
  /* 上の削除はスケジュールへ戻った時点で S.measure が空なので実際には効かず、
     作った一時保存（記録ID）が records.sqlite3 に残っていた（§9.351）。控えたIDで消す。 */
  if(draftId)await fetch(`${API}/api/measurement/backup/delete`,{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[draftId]})}).catch(()=>{});

  /* ---- 5b) 画面名の重複と、画面ごとの操作列のヘッダー相乗り ----
     各画面が「ヘッダーと同じ画面名＋操作」の見出しバーを持っていた。名前は
     二重、バー1本ぶん本文の高さを食う。名前はヘッダーだけが持ち、操作は
     #headerViewBar へ移す(WL.enterView→mountViewToolbar)。 */
  const views=await page.evaluate(async()=>{
   const out={};
   const wait=ms=>new Promise(r=>setTimeout(r,ms));
   const snap=async(name)=>{
    await wait(1200);
    const bar=document.getElementById('headerViewBar');
    const title=(document.getElementById('fileName')?.textContent||'').trim();
    // 本文側に画面名と同じ文字を持つ見出しが残っていないか
    const dupes=[...document.querySelectorAll('main .sc-title,main #recordTitle,#schedulePanel h2,#dashboardPanel h2,#masterMaintPanel .mm-head-title')]
      .map(e=>e.textContent.trim()).filter(t=>t&&title.includes(t));
    // 画面ごとの操作列に並ぶコントロールの寸法。‹ ›のようなアイコンのみの
    // ボタンは「文字」ではなく記号なので、文字サイズの揃いからは外す。
    const vis=e=>e.offsetParent!==null;
    /* 検索欄（`.lt-search`・§9.505／§9.507）の中の入力は枠なしで、高さは器（label）が持つ——器を数える。 */
    const ctls=[...document.querySelectorAll('#headerViewBar button,#headerViewBar select,#headerViewBar input:not(.lt-search>input),#headerViewBar .lt-search')].filter(vis);
    out[name]={title,mounted:bar?bar.children.length:-1,dupes,
      /* §9.286 ④: 再読込は一覧ツールバーの鮮度チップへ移した（読む場所と
         打つ手を同じ場所に置く）。§9.505: 検索欄も一覧の帯の先頭へ移した——ヘッダーに居ると
         一覧の無い画面（実績など）にも出て、打っても何も起きなかった。 */
      /* 作業スケジュールの仕掛一覧（分割・ポップアップ）には帯ごと運ばれて出る——それは一覧の中なので数えない。 */
      listActions:[...document.querySelectorAll('#search')].filter(e=>vis(e)&&!e.closest('.sc-split-wrap,.sc-float-body')).length,
      inHeader:[...document.querySelectorAll('header #search')].length,
      sizeBtn:!!document.getElementById('uiSizeBadge')?.offsetParent,
      ctlH:[...new Set(ctls.map(e=>Math.round(e.getBoundingClientRect().height)))].sort((a,b)=>a-b),
      ctlFs:[...new Set(ctls.filter(e=>!e.classList.contains('rp-btn-icon'))
                            .map(e=>getComputedStyle(e).fontSize))]};
   };
   document.getElementById('openSchedule').click();await snap('schedule');
   document.getElementById('openDashboard').click();await snap('dashboard');
   document.getElementById('openCalendar').click();await snap('calendar');
   document.getElementById('openMasterMaint').click();await snap('master');
   document.getElementById('homeDrafts').click();await snap('records');
   document.querySelector('aside [data-db-key="SIKALOTNOW"]').click();await snap('list');
   return out;
  });
  rec('画面名はヘッダーだけが持つ(本文側に同じ見出しを残さない)',
   Object.values(views).every(v=>v.dupes.length===0),
   JSON.stringify(Object.fromEntries(Object.entries(views).map(([k,v])=>[k,v.dupes]))));
  for(const [key,label] of [['schedule','作業スケジュール'],['dashboard','ダッシュボード'],
                            ['calendar','測定実績カレンダー'],['master','マスタ管理'],['records','測定データ一覧']]){
   rec(`${label}の操作列がヘッダーへ載る`,views[key].mounted===1,JSON.stringify(views[key]));
  }
  rec('一覧画面へ戻ると操作列は元へ戻る(持ち越さない)',views.list.mounted===0,JSON.stringify(views.list));
  rec('データ一覧の見出しは絞り込みの状態を表す',
   /データ一覧/.test(views.records.title),views.records.title);
  rec('一覧専用の操作（一覧を検索）は一覧画面でだけ出す・ヘッダーには置かない',
   ['schedule','dashboard','calendar','master','records'].every(k=>views[k].listActions===0)
   &&views.list.listActions>0&&Object.values(views).every(v=>v.inHeader===0),
   JSON.stringify(Object.fromEntries(Object.entries(views).map(([k,v])=>[k,[v.listActions,v.inHeader]]))));
  rec('表示サイズの切替はどの画面でも出す(全体に効く操作のため)',
   Object.values(views).every(v=>v.sizeBtn),
   JSON.stringify(Object.fromEntries(Object.entries(views).map(([k,v])=>[k,v.sizeBtn]))));

  /* ---- 5c) ヘッダーに並ぶコントロールの高さ・文字の揃い ----
     どの画面でも、操作列のボタン・選択欄・入力欄は
     --ctl-h-sm(=30px)か、その中に入れ子になる2択(-4px=26px)のどちらか。
     文字は--fs-sm一本(アイコンのみのボタンは記号なので除く)。 */
  const bars=['schedule','dashboard','calendar','master','records'];
  const badH=bars.filter(k=>{
   const h=views[k].ctlH;return !(h.length>0&&h.every(v=>v===30||v===26));
  });
  rec('どの画面でも操作列の高さがトークン(30/26px)に収まる',badH.length===0,
   JSON.stringify(Object.fromEntries(bars.map(k=>[k,views[k].ctlH]))));
  const allFs=[...new Set(bars.flatMap(k=>views[k].ctlFs))];
  rec('どの画面でも操作列の文字サイズが1種類に揃う',allFs.length===1,
   JSON.stringify(Object.fromEntries(bars.map(k=>[k,views[k].ctlFs]))));
  const ctl=await page.evaluate(async()=>{
   document.getElementById('openSchedule').click();
   await new Promise(r=>setTimeout(r,1500));
   return [...document.querySelectorAll('.global-actions .hd-btn')].filter(e=>e.offsetParent!==null)
     .map(e=>Math.round(e.getBoundingClientRect().height));
  });
  const actH=[...new Set(ctl)];
  rec('全体操作のボタンも高さが揃う',ctl.length>0&&actH.length===1,JSON.stringify(actH));

  /* ---- 6) アクセス権限: 対象設備の複数指定と「すべての設備」 ---- */
  const rule=await page.evaluate(()=>({
   none:WL.fieldReorderAllows('','テスト設備A'),
   one:WL.fieldReorderAllows('テスト設備A','テスト設備A'),
   oneNg:WL.fieldReorderAllows('テスト設備A','テスト設備B'),
   many:WL.fieldReorderAllows('テスト設備A,テスト設備B','テスト設備B'),
   manyNg:WL.fieldReorderAllows('テスト設備A,テスト設備B','テスト設備C'),
   all:WL.fieldReorderAllows('*','どの設備でも'),
   labelAll:WL.fieldReorderLabel('*'),
   labelMany:WL.fieldReorderLabel('テスト設備A,テスト設備B'),
   labelNone:WL.fieldReorderLabel(''),
  }));
  rec('未設定は権限なし（空欄＝全許可ではない）',rule.none===false,JSON.stringify(rule));
  rec('1設備の指定はその設備だけ',rule.one===true&&rule.oneNg===false,JSON.stringify(rule));
  rec('複数設備を指定できる',rule.many===true&&rule.manyNg===false,JSON.stringify(rule));
  rec('「すべての設備」はどの設備でも許可',rule.all===true,String(rule.all));
  rec('表示名が読める形になる',
   rule.labelAll==='すべての設備'&&rule.labelMany==='テスト設備A / テスト設備B'&&rule.labelNone==='',
   JSON.stringify([rule.labelAll,rule.labelMany,rule.labelNone]));

  // マスタ管理の入力欄
  await setMode('edit');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:20000});
  await W.booted(page);
  await page.click('#openMasterMaint');await idle();
  await page.click('#masterMaintNav [data-master="accessPermission"]');await idle(400,15000);
  const form=await page.evaluate(()=>{
   const btn=document.querySelector('#masterMaintPanel .mm-new,#masterMaintPanel [data-mm-new]')
    ||[...document.querySelectorAll('#masterMaintPanel button')].find(b=>/新規|追加/.test(b.textContent));
   if(btn)btn.click();
   const all=document.querySelector('[data-equipment-all="fieldReorderEquipment"]');
   const box=document.querySelector('[data-equipment-box="fieldReorderEquipment"]');
   const legacy=document.querySelector('select[data-field="fieldReorderEquipment"]');
   return {hasAll:!!all,hasBox:!!box,legacySelect:!!legacy,
           label:(all?.closest('label')?.textContent||'').trim()};
  });
  rec('対象設備の欄に「すべての設備」がある',form.hasAll&&/すべての設備/.test(form.label),JSON.stringify(form));
  rec('対象設備は複数選べるタグ入力になっている',form.hasBox&&!form.legacySelect,JSON.stringify(form));
  const toggled=await page.evaluate(()=>{
   const all=document.querySelector('[data-equipment-all="fieldReorderEquipment"]');
   all.checked=true;all.dispatchEvent(new Event('change',{bubbles:true}));
   const box=document.querySelector('[data-equipment-box="fieldReorderEquipment"]');
   const search=document.querySelector('[data-equipment-search="fieldReorderEquipment"]');
   return {disabled:box.classList.contains('is-disabled'),searchDisabled:!!search.disabled};
  });
  rec('「すべての設備」を選ぶと個別選択は触れなくなる',
   toggled.disabled&&toggled.searchDisabled,JSON.stringify(toggled));
});
