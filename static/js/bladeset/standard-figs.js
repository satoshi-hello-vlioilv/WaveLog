/* ============================================================
   standard-figs.js: 刃組基準値の節ごとの図（§9.533、利用者の指示）

   「刃組基準値マスタはやはり使いにくいです。2ペインで選びながら見ながら設定というようなところや、
     視覚的に表現できるところは可能な限り視覚的に表現し直感的にその部分が何の調整にどう影響するのか、
     わかった状態で触れるような工夫を入れて」「ガイダンスで使う断面3D台車モデルも活用するなど検討して」

   節（`master-defs.js`の`fieldGroup`）ごとに1枚の模式図。**いま効いている値**（打っている途中の値・登録・既定）で
   描き、図の部品は効く欄の鍵を`data-k`で名乗る——盤は欄に入ると同じ鍵の部品を光らせ、部品に乗ると欄を光らせる。
   色は刃組図と同じトークン（`--bs-fig-*`）なので、ガイダンスの図と同じ物が同じ色で見える。
   本物の台車（断面図・立体図）は刃組ガイダンスが持つ。盤はそこへ見本の作業で開く道を置く（`standard-board.js`）。

   1枚の図＝`{say, draw(V)}`。`say`は一覧の2行目（何に効くか）、`draw(V)`は SVG の字（`V(k)`＝いまの値・数）。
   ============================================================ */
(function(){
 const W=640;
 const n=(v,d)=>(isFinite(+v)?+v:d);
 const f2=v=>String(+(+v).toFixed(3));
 const svg=(h,body,label)=>`<svg class="sf" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}">${body}</svg>`;
 const t=(x,y,s,o={})=>`<text x="${x}" y="${y}"${o.k?` data-k="${o.k}"`:''} class="sf-t${o.cls?' '+o.cls:''}"${o.a?` text-anchor="${o.a}"`:''}>${esc(s)}</text>`;
 const r=(x,y,w,h,cls,k)=>`<rect x="${x}" y="${y}" width="${Math.max(0.5,w)}" height="${Math.max(0.5,h)}" class="${cls}"${k?` data-k="${k}"`:''}/>`;
 /* 寸法線（端の立て線2本＋あいだ＋値）。図の中の「この長さ」を値と一緒に言う。 */
 function dim(x1,x2,y,text,k,up){
  const d=up?-1:1;
  return `<g data-k="${k}" class="sf-dim"><path d="M${x1} ${y-6*d}V${y+4*d}M${x2} ${y-6*d}V${y+4*d}M${x1} ${y}H${x2}"/>`
   +`${t((x1+x2)/2,up?y-8:y+16,text,{a:'middle'})}</g>`;
 }

 /* ---- 機械の寸法: 軸の横から（有効長・板の中心・押さえ代・刻み）＋軸の端から（軸径・スペーサー外径・リング内径） ---- */
 function machine(V){
  const L=n(V('arborLen'),1600),x0=40,x1=600,px=(x1-x0)/L;
  const c=V('centerFromDatum'),cx=x1-(c==null||c===''?L/2:n(c,L/2))*px;
  let o=r(x0,64,x1-x0,26,'sf-shaft','arborLen')+t(x0-8,82,'OS',{a:'end'})+t(x1+8,82,'◆DS',{});
  for(let i=0;i<9;i++)o+=r(x0+40+i*58,58,56,38,'sf-spacer');
  o+=dim(x0,x1,40,`アーバー有効長 ${f2(L)} mm`,'arborLen',true);
  o+=`<g data-k="centerFromDatum" class="sf-mark"><path d="M${cx} 50V112"/>${t(cx,126,`板の中心（DSから ${f2((x1-cx)/px)} mm）`,{a:'middle'})}</g>`;
  o+=`<g data-k="floatSeatStroke">${r(x0,56,10,42,'sf-fseat')}${t(x0+14,112,`押さえ代 ${f2(n(V('floatSeatStroke'),0.95))} mm`,{})}</g>`;
  return o+machineEnd(V)+machineStep(V);
 }
 /* 軸の端から見た同心円。リング内径がスペーサー外径より大きいので嵌まる（差が小さいほどがたが小さい）。 */
 function machineEnd(V){
  const sd=n(V('shaftDia'),200),so=n(V('spacerOD'),240),rb=n(V('ringBore'),241),k=0.26,cx=150,cy=200;
  const ok=rb>so;
  return `<circle cx="${cx}" cy="${cy}" r="${rb*k/2}" class="sf-ringbore" data-k="ringBore"/>`
   +`<circle cx="${cx}" cy="${cy}" r="${so*k/2}" class="sf-spacer" data-k="spacerOD"/>`
   +`<circle cx="${cx}" cy="${cy}" r="${sd*k/2}" class="sf-shaft" data-k="shaftDia"/>`
   +t(cx+46,172,`リング内径 Φ${f2(rb)}`,{k:'ringBore'})+t(cx+46,192,`スペーサー外径 Φ${f2(so)}`,{k:'spacerOD'})
   +t(cx+46,212,`軸外径 Φ${f2(sd)}`,{k:'shaftDia'})
   +t(cx+46,232,ok?`がた ${f2((rb-so)/2)} mm（リングが嵌まる）`:'リング内径がスペーサー外径以下（嵌まりません）',{cls:ok?'sf-sub':'sf-bad',k:'ringBore'});
 }
 /* 寸法の刻み: 手持ちのスペーサーがそろっている刻み。区間長はこの刻みに合わせる。 */
 function machineStep(V){
  const s=n(V('sizeStep'),0.05);
  let o=t(420,168,'寸法の刻み',{k:'sizeStep'});
  [0,1,2,3].forEach(i=>{o+=r(420+i*44,176,40,22,'sf-spacer','sizeStep')+t(440+i*44,192,f2(10+i*s),{a:'middle',cls:'sf-sm'})});
  return o+t(420,220,`区間長は ${f2(s)} mm ごとに合わせる`,{cls:'sf-sub',k:'sizeStep'});
 }

 /* ---- 刃組の既定値: 上下の刃（刃厚・クリアランス・ラップ）と中抜きの屑条 ---- */
 function blades(V){
  const tk=n(V('bladeThickness'),10),cl=n(V('clearance'),0.15),ov=n(V('overlap'),0.2);
  const s=5,ex=60,x=150,tw=tk*s,cw=cl*s*ex,ow=ov*ex*1.5;
  let o=r(x,30,tw,110+ow/2,'sf-knife','bladeThickness')+r(x+tw+cw,120-ow/2,tw,110,'sf-knife','bladeThickness');
  o+=t(x+tw/2,24,`刃厚 ${f2(tk)}`,{a:'middle',k:'bladeThickness'});
  /* クリアランスは下の刃の上（上の刃の横が空いている高さ）で測る。字は下の刃に被せない。 */
  const cy=Math.min(70,120-ow/2-24);
  o+=`<g data-k="clearance" class="sf-mark"><path d="M${x+tw+cw} ${120-ow/2}V${cy-8}M${x+tw} ${cy}H${x+tw+cw}"/>${t(x+tw+cw+6,cy+4,`クリアランス ${f2(cl)}`,{})}</g>`;
  o+=`<g data-k="overlap" class="sf-mark"><path d="M${x-14} ${120-ow/2}V${140+ow/2}"/>${t(x-20,134,`ラップ ${f2(ov)}`,{a:'end'})}</g>`;
  o+=t(x,236,'クリアランス・ラップは見やすいように大きく描いています',{cls:'sf-sub'});
  return o+bladesStrip(V);
 }
 function bladesStrip(V){
  const nk=V('canNakanuki')!==false,sw=n(V('scrapWidth'),30),x=360;
  let o=t(x,40,nk?'中抜き（製品のあいだに屑条を組む）':'交互反転巻き（中抜きできないライン）',{k:'canNakanukiText'});
  if(nk){
   o+=r(x,60,90,40,'sf-strip')+r(x+92,60,Math.max(14,sw*1.2),40,'sf-scrap','scrapWidth')+r(x+94+Math.max(14,sw*1.2),60,90,40,'sf-strip');
   o+=t(x+45,86,'製品',{a:'middle',cls:'sf-sm'})+t(x+92+Math.max(14,sw*1.2)/2,118,`屑条 ${f2(sw)} mm`,{a:'middle',k:'scrapWidth'});
   o+=t(x,150,`屑条は刃厚×2（${f2(n(V('bladeThickness'),10)*2)}）以上`,{cls:n(V('scrapWidth'),30)<n(V('bladeThickness'),10)*2?'sf-bad':'sf-sub',k:'scrapWidth'});
  } else {
   o+=r(x,60,90,40,'sf-strip')+r(x+94,60,90,40,'sf-strip')+t(x+45,86,'↑バリ',{a:'middle',cls:'sf-sm'})+t(x+139,86,'↓バリ→反転',{a:'middle',cls:'sf-sm'});
  }
  return o;
 }

 /* ---- 板押さえの空き: ゴムリング・フィンガー・スペーサー一体型の区間（刃と刃のあいだ） ---- */
 function zoneFig(x,title,k1,k2,gmin,gmax,body){
  return t(x,26,title,{})+r(x,40,8,120,'sf-knife')+r(x+172,40,8,120,'sf-knife')+r(x+8,120,164,22,'sf-spacer')+body
   +`<g data-k="${k1}">${t(x+90,188,`空き 下限／目標 ${f2(gmin)}`,{a:'middle'})}</g>`
   +`<g data-k="${k2}">${t(x+90,206,gmax>0?`上限 ${f2(gmax)}（超えたら名指し）`:'上限 0（判定しない）',{a:'middle',cls:'sf-sub'})}</g>`;
 }
 function gaps(V){
  const g=(a,b)=>[n(V(a),0),n(V(b),0)];
  const [rmin,rmax]=g('ringGapMin','ringGapMax'),[fmin,fmax]=g('fingerGapMin','fingerGapMax'),[imin,imax]=g('integGapMin','integGapMax');
  const half=v=>Math.min(40,v*6);
  let o=zoneFig(20,'ゴムリング','ringGapMin','ringGapMax',rmin,rmax,
   r(28+half(rmin)/2,76,164-half(rmin),44,'sf-ring','ringGapMin'));
  o+=zoneFig(230,'フィンガー','fingerGapMin','fingerGapMax',fmin,fmax,
   r(238+half(fmin)/2,92,164-half(fmin),26,'sf-finger','fingerGapMin'));
  const lube=V('integLube')===true,lw=lube?14:0;
  o+=zoneFig(440,'スペーサー一体型','integGapMin','integGapMax',imin,imax,
   (lube?r(448,96,lw,24,'sf-lube','integLubeText')+r(612-lw,96,lw,24,'sf-lube','integLubeText'):'')
   +r(448+lw+half(imin)/2,76,164-2*lw-half(imin),44,'sf-integ','integGapMin')
   +t(530,230,lube?'両端に潤滑リング（座は普通のスペーサー）':'潤滑リングは載せない',{a:'middle',cls:'sf-sub',k:'integLubeText'}));
  return o+t(20,232,'空きは刃の両側へ半分ずつ',{cls:'sf-sub'});
 }

 /* ---- 判定の帯: 押上げ・ニップ・上下の左右差を「不適｜要注意｜適正｜要注意｜不適」の帯で ---- */
 function band(y,title,lo,hiv,vals,keys){
  /* vals＝[不適下限, 下限, 上限, 不適上限, 目標?]。帯の幅は値の範囲から。 */
  const [hmin,min,max,hmax,tg]=vals,x0=150,x1=600,px=(x1-x0)/((hiv-lo)||1),X=v=>x0+(v-lo)*px;
  let o=t(20,y+15,title,{});
  o+=r(x0,y,x1-x0,20,'sf-bad-bg')+r(X(hmin),y,X(hmax)-X(hmin),20,'sf-warn-bg')+r(X(min),y,X(max)-X(min),20,'sf-ok-bg');
  [[hmin,keys[0]],[min,keys[1]],[max,keys[2]],[hmax,keys[3]]].forEach(([v,k],i)=>{
   if(!k)return;
   o+=`<g data-k="${k}" class="sf-tick"><path d="M${X(v)} ${y-4}V${y+24}"/>${t(X(v),i%2?y+36:y-8,f2(v),{a:'middle',cls:'sf-sm'})}</g>`;
  });
  if(tg!=null&&keys[4])o+=`<g data-k="${keys[4]}" class="sf-target"><path d="M${X(tg)} ${y-2}V${y+22}"/>${t(X(tg),y+50,`目標 ${f2(tg)}`,{a:'middle',cls:'sf-sm'})}</g>`;
  return o;
 }
 function judge(V){
  const v=k=>n(V(k),0);
  let o=band(30,'押上げ',v('pushHardMin')-0.2,v('pushHardMax')+0.2,
   [v('pushHardMin'),v('pushMin'),v('pushMax'),v('pushHardMax'),v('pushTarget')],['pushHardMin','pushMin','pushMax','pushHardMax','pushTarget']);
  o+=band(110,'板ニップ',v('nipHardMin')-0.2,v('nipHardMax')+0.2,
   [v('nipHardMin'),v('nipMin'),v('nipMax'),v('nipHardMax')],['nipHardMin','nipMin','nipMax','nipHardMax']);
  o+=band(180,'上下の左右差',0,v('offsetHardTol')*1.4||0.1,[0,0,v('offsetTol'),v('offsetHardTol')],[null,null,'offsetTol','offsetHardTol']);
  const gm=v('gapMax');
  return o+`<g data-k="gapMax">${t(20,238,`刃間の隙間は ${f2(gm)} mm まで許す`,{cls:'sf-sub'})}</g>`;
 }

 /* ---- 刃の管理: 刃の径と使用限界径・研磨周期 ---- */
 function knife(V){
  const md=n(V('minDia'),305),cy=n(V('grindCycleDays'),60),nd=n(V('newDia'),0),cx=150,c=110,k=0.36;
  /* 新品径（§9.536）が空なら外の輪は「使用限界径＋20」の見かけの大きさ（値は言わない）。 */
  const od=nd>md?nd:md+20;
  let o=`<circle cx="${cx}" cy="${c}" r="${od*k/2}" class="sf-knife-o" data-k="newDia"/>`
   +t(cx,c-(od*k/2)-8,nd>md?`新品径 Φ${f2(nd)}（径ゲージの満タン）`:'新品径は空欄（いちばん大きい現状径を満タンに）',{a:'middle',k:'newDia'})
   +`<circle cx="${cx}" cy="${c}" r="${md*k/2}" class="sf-limit" data-k="minDia"/>`
   +t(cx,c+(md*k/2)+22,`使用限界径 Φ${f2(md)}（ここまで研磨したら使えない）`,{a:'middle',k:'minDia'});
  o+=t(340,60,`研磨周期 ${f2(cy)} 日`,{k:'grindCycleDays'});
  for(let i=0;i<=4;i++)o+=`<g data-k="grindCycleDays" class="sf-tick"><path d="M${340+i*60} 80V96"/>${t(340+i*60,114,`${i*cy}日`,{a:'middle',cls:'sf-sm'})}</g>`;
  return o+`<path d="M340 88H580" class="sf-axis"/>`+t(340,150,'刃組ガイダンスの「刃の状態」で警告に出ます',{cls:'sf-sub'});
 }

 /* ---- 図の呼び方と向き: ガイダンスの見出しの見え方 ---- */
 function names(V){
  const os=String(V('sideNameOS')||'OS'),ds=String(V('sideNameDS')||'DS'),right=(V('viewDatumPos')||'右')!=='左';
  const L=right?os:'◆'+ds,R=right?'◆'+ds:os;
  return t(20,40,'刃組ガイダンスを開いたときの図の左右',{})
   +r(60,70,520,30,'sf-shaft','viewDatumPos')
   +t(52,90,L,{a:'end',k:right?'sideNameOS':'sideNameDS',cls:'sf-big'})+t(588,90,R,{k:right?'sideNameDS':'sideNameOS',cls:'sf-big'})
   +t(320,130,`◆＝基準面（${ds}）。基準面は${right?'右':'左'}に置く`,{a:'middle',k:'viewDatumPos'})
   +t(320,156,'図の札・端部の表・説明の字も、この呼び方で出ます',{a:'middle',cls:'sf-sub'});
 }

 const FIGS={
  '機械の寸法':{say:'刃の位置・板の中心・リングの嵌まり',h:250,draw:machine},
  '刃組の既定値':{say:'刃の重なりと屑条の初期値',h:250,draw:blades},
  '板押さえの空き':{say:'刃のあいだに残す空き・潤滑リング',h:250,draw:gaps},
  '判定の帯':{say:'押上げ・ニップ・左右差の合否',h:270,draw:judge},
  '刃の管理':{say:'使用限界径・研磨周期',h:230,draw:knife},
  '図の呼び方と向き':{say:'ガイダンスの図の左右と呼び名',h:180,draw:names},
 };
 /* 節の図。知らない節は null（図を出さない）。 */
 function figOf(group,V){
  const x=FIGS[group];if(!x)return null;
  return svg(x.h,x.draw(V),group);
 }
 WL.standardFigs={figOf,sayOf:g=>(FIGS[g]||{}).say||''};
})();
