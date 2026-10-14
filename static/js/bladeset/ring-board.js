/* ============================================================
   ring-board.js: ゴムリングマスタの盤（§9.528 → §9.529 で2ペインへ）

   「ゴムリングの管理は、色ごとに外径内径は共通にして、幅毎に本数を管理できるように…
     色はコードではわかりにくいのでカラーピッカーなど直感的に色が判断できるもの、
     今まで登録した色と被らないようにしたいのでそれらの登録状況がわかるもの、
     色ごとにゴムリングをまとめて表示できるようにしてください。」（§9.528）
   「①色の被り判定の中に潤滑リングが入っていません。②新規の色を追加する際に色名を付けられません。
     ③マスタが使いにくい。」（§9.529・②の状況は「色名の欄が見つからない」）
   利用者の選択（§9.529）: 刃と同じ形——「一覧＋詳細の2ペイン」（`board-kit.js`）。

   ・左＝登録済みの色を**外径の順に全部**（見本・色名・外径／内径・幅と本数）。押すとその色。
     「＋ 色を追加」は空いている標準の色（無ければ登録済みの色からいちばん離れた色）で開く。
   ・右＝選んだ色: **色名がいちばん上**（新しい色では焦点もここ）→ 色（ピッカー）・外径・内径は
     **1回だけ**（その色の幅ぜんぶに効く）→ 幅ごとの本数は表の中で直す。§9.603 で保存は足元の1つ（属性も本数も）、
     輪の図は欄の右（寸法線と名前だけ・外径／内径の欄に入ると同じ寸法が光る）。
   ・被り: 色・色名・外径を触るたびにサーバーへ聞く（`ring_color_conflicts()`の1箇所・潤滑リングも
     見えている紫で比べる）。断る被りは保存を止めて理由を字で、近い色は注意として一覧の見本にも印。
   ============================================================ */
(function(){
 const K=()=>WL.bsKit;
 const NEW='__new';
 const WIDTH_SEED=[50,30,20,15,10];
 const rs={equipment:'',colors:[],cycle:[],kinds:[],suggest:null,nearDe:20,sel:'',draft:null,
           check:{hard:[],near:[],text:''},busy:false,loaded:false,edits:{}};
 let checkTimer=0,checkSeq=0;

 const colorOf=name=>rs.colors.find(g=>g.color===name)||null;
 const num=v=>(String(v??'').trim()===''?null:Number(v));
 const fmt=v=>(v==null||v===''?'—':String(+(+v).toFixed(2)));
 const swatch=(hex,lube)=>`<i class="rb-sw${lube?' is-lube':''}"${hex?` style="--sw:${esc(hex)}"`:''} aria-hidden="true"></i>`;
 const post=(path,body)=>K().post(path,body);

 /* ---------- 下書き（カードの中身） ---------- */
 function draftOf(g){
  if(g)return {current:g.color,color:g.color,hex:g.hex||g.tone||'',od:g.od,bore:g.bore,lube:!!g.lube,integ:!!g.integ};
  const s=rs.suggest||{};
  const ws=[...new Set(rs.colors.filter(x=>!x.lube).flatMap(x=>x.widths.map(w=>w.width)))].sort((a,b)=>b-a);
  /* 色は**サーバーの候補**（空いている標準の色、無ければ登録済みの色からいちばん離れた色・§9.529）。 */
  return {current:'',color:s.color||'',hex:s.hex||'#808080',od:s.od??'',bore:s.bore??'',lube:false,integ:false,
          widths:(ws.length?ws:WIDTH_SEED).map(w=>({width:w,qty:''}))};
 }
 const isDirty=()=>{const d=rs.draft,g=colorOf(d&&d.current);
  return !!d&&(!g||d.color!==g.color||(d.hex||'')!==(g.hex||'')||num(d.od)!==g.od||num(d.bore)!==g.bore)};

 /* 色の属性（色名・色・外径・内径）のうち変えた欄の数（足元の「変更 N件」）。 */
 const attrCount=()=>{const d=rs.draft,g=colorOf(d&&d.current);if(!d||!g)return 0;
  return [d.color!==g.color,(d.hex||'')!==(g.hex||''),num(d.od)!==g.od,num(d.bore)!==g.bore].filter(Boolean).length};

 /* ---------- 頭と一覧（登録済みの色） ---------- */
 function renderForm(){
  K().head({primary:rs.loaded?{id:'rbAdd',label:'色を追加',title:'空いている標準の色で新しい色を開きます',onClick:async()=>{if(await leaveOk())select(NEW)}}:null});
 }
 const swOf=g=>swatch(g.tone||g.hex,g.lube);
 function itemOf(g){
  return {key:g.color,on:g.color===rs.sel,mark:swOf(g),title:g.color,
   sub:`外径 ${fmt(g.od)}・${g.total}本`,title2:`${g.color}　外径 ${fmt(g.od)}／内径 ${fmt(g.bore)}　幅 ${g.widths.length}種・${g.total}本`,
   tags:g.lube?[{text:'潤滑',tone:'violet'}]:g.integ?[{text:'一体型',tone:'teal'}]:[]};
 }
 /* 被りの印は一覧の見本へ（断る＝赤の枠・近い＝橙の枠）。字は title と詳細の中が持つ。 */
 function paintMarks(){
  const hard=new Set(rs.check.hard.map(x=>x.color)),near=new Set(rs.check.near.map(x=>x.color));
  document.querySelectorAll('#masterMaintList .bk-item[data-bk-key]').forEach(b=>{
   const k=b.dataset.bkKey;
   b.classList.toggle('is-hard',hard.has(k));
   b.classList.toggle('is-near',!hard.has(k)&&near.has(k));
  });
 }

 /* ---------- カード（選んだ色） ---------- */
 function select(name){
  rs.sel=name;rs.draft=draftOf(name===NEW?null:colorOf(name));rs.check={hard:[],near:[],text:''};
  renderCard();runCheck();
  /* 新しい色は**色名の欄に焦点**（§9.529 ②「色名の欄が見つからない」——名前を付けるところから始める）。 */
  if(name===NEW){const el=document.querySelector('#masterMaintList [data-k="color"]');if(el){el.focus();el.select()}}
 }
 function renderCard(){
  renderForm();
  if(!rs.loaded)return;
  const items=rs.colors.map(itemOf);
  if(rs.sel===NEW)items.push({key:NEW,on:true,mark:swatch(rs.draft.hex,rs.draft.lube),title:rs.draft.color||'新しい色',sub:'まだ登録していません'});
  const body=K().frame(rs,{key:'ring',label:'ゴムリング',onEquipment:()=>{rs.sel='';load(true)},
   count:()=>attrCount()+K().editCount(rs),dirty:()=>attrCount()>0,isNew:()=>rs.sel===NEW,touched:()=>!!(rs.draft&&rs.draft.touched),
   blocked:()=>rs.check.hard.length?'登録済みの色と被っています（赤の字）':'',
   save:()=>saveAll(),cancel:()=>{if(rs.sel===NEW){select((rs.colors[0]||{}).color||'');return}rs.edits={};select(rs.sel)},
   body:K().pane({label:'ゴムリングの色',head:{name:'色',n:items.length},items,empty:'まだ1色もありません。頭の「＋ 色を追加」から登録してください。',detail:cardHtml()})});
  if(!body)return;
  K().wirePane(body,{onPick:async k=>{if(k!==rs.sel&&await leaveOk())select(k)}});
  wireCard(body);paintCheck();paintMarks();
 }
 function cardHtml(){
  const d=rs.draft;
  if(!d)return `<div class="mm-empty">${rs.colors.length?'左の一覧から色を選ぶと、その色の幅と本数が出ます。':'頭の「＋ 色を追加」から最初の色を登録してください。'}</div>`;
  const g=colorOf(d.current),isNew=!g;
  return `<article class="bk-card rb-card${d.lube?' is-lube':''}">
   <header class="bk-card-h">${swatch(d.hex,d.lube)}<div class="bk-card-t">
    <label class="rb-name"><s>色名${isNew?'（必須）':''}</s><input type="text" data-k="color" value="${esc(d.color)}" placeholder="例: 紫" autocomplete="off"></label>
    <small>${isNew?'名前・色・外径を決めて、幅ごとの本数を入れ、足元の「保存」で登録します':`外径・内径は幅 ${g.widths.length}種 すべてで共通`}${d.integ
     ?'。<b>スペーサー一体型</b>——幅が軸の寸法になり、外周のゴムが板を押さえます（保持方式の表で「ゴムリング（スペーサー一体型）」に当たったとき使う）':''}</small></div>
    ${isNew?'':K().moreBtn(`この色を消す（${g.widths.length}行）`)}</header>
   <div class="rb-fieldrow"><div class="bk-fields">${attrsHtml(d,isNew)}</div>${ringFig(d)}</div>
   <div class="rb-check" aria-live="polite"></div>
   ${isNew?newWidthsHtml(d):widthTableHtml(g)}
  </article>`;
 }
 /* 輪の寸法の図（§9.603）: 寸法線と名前だけ（数は左の欄が持つ・同じ値を2か所に出さない）。外径・内径の欄に入ると
    同じ寸法が光る（`data-k`で結ぶ）。輪の太さは外径と内径の比のまま（肉厚が薄い色は薄く見える）。 */
 function ringFig(d){
  const o=num(d.od),i=num(d.bore);
  if(!(o>0)||!(i>0)||i>=o)return '<figure class="rb-fig is-none" aria-hidden="true"></figure>';
  const R=60,r=R*i/o,c=64,y=v=>v.toFixed(1);
  const ext=(yy,x2)=>`<line class="rb-ext" x1="${c}" y1="${y(yy)}" x2="${x2}" y2="${y(yy)}"/>`;
  const dim=(k,x,y1,y2,lab)=>`<g class="rb-dim" data-k="${k}"><line x1="${x}" y1="${y(y1)}" x2="${x}" y2="${y(y2)}"/>`
   +`<line x1="${x-4}" y1="${y(y1)}" x2="${x+4}" y2="${y(y1)}"/><line x1="${x-4}" y1="${y(y2)}" x2="${x+4}" y2="${y(y2)}"/><text x="${x}" y="150" text-anchor="middle">${lab}</text></g>`;
  return `<figure class="rb-fig" aria-label="輪の寸法（外径・内径・肉厚）"><svg viewBox="0 0 248 156" width="248" height="156">`
   +`<circle class="rb-ro" data-k="od" cx="${c}" cy="${c}" r="${R}" style="fill:${d.lube?'var(--bs-fig-lube)':esc(d.hex||'var(--muted)')}"/>`
   +`<circle class="rb-ri" data-k="bore" cx="${c}" cy="${c}" r="${y(r)}"/>`
   +ext(c-R,226)+ext(c+R,152)+ext(c-r,226)+ext(c+r,188)
   +dim('od',148,c-R,c+R,'外径')+dim('bore',184,c-r,c+r,'内径')+dim('th',222,c-R,c-r,'肉厚')+`</svg></figure>`;
 }
 function attrsHtml(d,isNew){
  /* 種類の顔ぶれはサーバーの`RING_KINDS`（ゴムリング／潤滑リング／スペーサー一体型・§9.531）。作るときに決める。 */
  const cur=d.lube?rs.kinds[1]:d.integ?rs.kinds[2]:rs.kinds[0];
  const kind=isNew?`<label class="bk-field"><s>種類</s><select data-k="kind">${rs.kinds.map(k=>`<option${k===cur?' selected':''}>${esc(k)}</option>`).join('')}</select></label>`:'';
  const th=num(d.od)!=null&&num(d.bore)!=null?((num(d.od)-num(d.bore))/2).toFixed(2):'—';
  return `${kind}<label class="bk-field rb-pick"><s>色</s><span><input type="color" data-k="hex" value="${esc(d.hex||'#808080')}"><code>${esc(d.hex||'（未設定）')}</code></span></label>
   <label class="bk-field"><s>外径</s><span><input type="number" data-k="od" step="0.1" min="0" value="${esc(d.od??'')}"><u>mm</u></span></label>
   <label class="bk-field"><s>内径</s><span><input type="number" data-k="bore" step="1" min="0" value="${esc(d.bore??'')}"><u>mm</u></span></label>
   <span class="bk-field is-ro"><s>肉厚（計算）</s><span><b data-k="th">${th}</b><u>mm</u></span></span>${isNew?unusedHtml():''}`;
 }
 /* まだ使っていない標準の色（外径1mmごとの周期）。押すと色・色名・外径が入る。 */
 function unusedHtml(){
  const names=new Set(rs.colors.map(g=>g.color)),ods=new Set(rs.colors.filter(g=>!g.lube).map(g=>g.od));
  const free=rs.cycle.filter(x=>!names.has(x.color)&&!ods.has(x.od));
  return free.length?`<div class="rb-free"><s>空いている標準の色</s>${free.map(x=>`<button type="button" class="rb-chip is-sm" data-free="${esc(x.color)}">${swatch(x.hex)}<b>${esc(x.color)}</b><small>${fmt(x.od)}</small></button>`).join('')}</div>`:'';
 }
 function widthTableHtml(g){
  const rows=g.widths.map(w=>{const k=`qty:${w.id}`;
   return `<tr data-id="${w.id}"><th>${fmt(w.width)}<u>mm</u></th>
   <td><input type="number" class="rb-q${K().editCls(rs,k)}" data-f="qty" data-edit="${k}" data-was="${esc(w.qty??'')}" min="0" step="1" value="${esc(K().editOf(rs,k,w.qty??''))}" aria-label="幅${fmt(w.width)}の保有本数"><u>本</u></td>
   <td><button type="button" class="bk-x" data-act="delwidth" data-id="${w.id}" title="この幅を消す" aria-label="幅${fmt(w.width)}を消す">×</button></td></tr>`}).join('');
  const sum=g.widths.reduce((t,w)=>{const v=K().editOf(rs,`qty:${w.id}`,w.qty);return t+(+v||0)},0);
  return `<table class="bk-table"><thead><tr><th>幅</th><th>保有本数</th><th></th></tr></thead>
   <tbody>${rows}</tbody><tfoot><tr><th><input type="number" id="rbNewW" min="0" step="any" placeholder="幅"></th>
   <td><input type="number" id="rbNewQ" min="0" step="1" placeholder="本数"></td>
   <td><button type="button" class="mm-btn-ghost sm" data-act="addwidth">＋ 幅を追加</button></td></tr>
   <tr class="bk-sum"><th>合計</th><td><b data-sum>${sum}本</b></td><td></td></tr></tfoot></table>`;
 }
 function newWidthsHtml(d){
  return `<table class="bk-table"><thead><tr><th>幅</th><th>保有本数</th><th></th></tr></thead><tbody>${
   d.widths.map((w,i)=>`<tr><th><input type="number" data-nw="${i}" data-f="width" min="0" step="any" value="${esc(w.width)}"><u>mm</u></th>
    <td><input type="number" data-nw="${i}" data-f="qty" min="0" step="1" value="${esc(w.qty)}" placeholder="0"></td>
    <td><button type="button" class="bk-x" data-act="dropnew" data-i="${i}" aria-label="この幅を外す">×</button></td></tr>`).join('')}</tbody>
   <tfoot><tr><td colspan="3"><button type="button" class="mm-btn-ghost sm" data-act="addnew">＋ 幅の行を追加</button></td></tr></tfoot></table>`;
 }

 /* ---------- 被り（サーバーへ聞く） ---------- */
 function runCheck(){
  clearTimeout(checkTimer);
  const d=rs.draft;if(!d)return;
  checkTimer=setTimeout(async()=>{
   const seq=++checkSeq;
   try{
    const r=await post('/api/bladeset/ring-colors/check',{equipment:rs.equipment,color:d.color,hex:d.hex,od:d.od,
      lube:d.lube,current:d.current});
    if(seq!==checkSeq)return;   // 古い問い合わせの答えは捨てる（打ち続けている間に届いた分）
    rs.check={hard:r.hard||[],near:r.near||[],text:r.text||''};
   }catch(e){WL.quiet.note('被りの確認に失敗（保存のときにサーバーがもう一度見る）',e)}
   paintCheck();paintMarks();
  },180);
 }
 function paintCheck(){
  const box=document.querySelector('#masterMaintList .rb-check');if(!box)return;
  const c=rs.check;
  box.innerHTML=(c.hard.length?`<p class="rb-hard">${esc(c.text)}</p>`:'')
   +(c.near.length?`<p class="rb-near">見分けにくいほど近い色があります: ${c.near.map(x=>`${swatch(x.hex)}<b>${esc(x.color)}</b>（色差 ${x.de}）`).join('・')}。現場で取り違えないか確かめてください（保存はできます）。</p>`:'')
   +(!c.hard.length&&!c.near.length&&rs.draft?'<p class="rb-ok">登録済みの色と被っていません。</p>':'');
  K().paintFoot();   // 断る被りがあるあいだは足元の保存を押せない（理由は保存の title と上の赤の字）
 }

 /* ---------- 触る ---------- */
 /* 図を描き直す（外径・内径・色を打つたび）。焦点のある寸法は光ったまま。 */
 function paintFig(box){
  const f=box.querySelector('.rb-fig');if(!f)return;
  f.outerHTML=ringFig(rs.draft);
  const a=document.activeElement;if(a&&a.dataset&&box.contains(a))lightFig(box,a.dataset.k);
 }
 function lightFig(box,k){
  box.querySelectorAll('.rb-fig .is-hot').forEach(e=>e.classList.remove('is-hot'));
  if(k==='od'||k==='bore')box.querySelectorAll(`.rb-fig [data-k="${k}"]`).forEach(e=>e.classList.add('is-hot'));
 }
 function wireCard(box){
  box.querySelectorAll('[data-k]').forEach(el=>{
   const k=el.dataset.k;if(k==='th'||el.closest('.rb-fig'))return;
   el.oninput=el.onchange=()=>{
    const d=rs.draft;
    if(k==='kind')Object.assign(d,{lube:el.value===rs.kinds[1],integ:el.value===rs.kinds[2]});
    else d[k]=el.value;
    d.touched=true;
    const g0=colorOf(d.current);
    if(g0&&k!=='kind')el.classList.toggle('is-edited',k==='color'?d.color!==g0.color:k==='hex'?(d.hex||'')!==(g0.hex||''):num(d[k])!==g0[k]);
    if(k==='hex'){const code=el.parentElement.querySelector('code');if(code)code.textContent=el.value;
     box.querySelectorAll('.bk-card-h .rb-sw,.bk-item[data-bk-key="__new"] .rb-sw').forEach(s=>{s.style.setProperty('--sw',el.value)})}
    /* 新しい色の名前は一覧の仮の項目にもその場で映す（描き直さない＝打っている欄の焦点を奪わない）。 */
    if(k==='color'){const t=box.querySelector('.bk-item[data-bk-key="__new"] b');if(t)t.textContent=el.value||'新しい色'}
    const th=box.querySelector('[data-k="th"]');
    if(th)th.textContent=num(d.od)!=null&&num(d.bore)!=null?((num(d.od)-num(d.bore))/2).toFixed(2):'—';
    if(k==='od'||k==='bore'||k==='hex'||k==='kind')paintFig(box);
    paintCheck();runCheck();K().paintFoot();
   };
   el.addEventListener('focus',()=>lightFig(box,k));
   el.addEventListener('blur',()=>lightFig(box,''));
  });
  box.querySelectorAll('[data-free]').forEach(b=>{b.onclick=()=>{
   const x=rs.cycle.find(c=>c.color===b.dataset.free);if(!x)return;
   Object.assign(rs.draft,{color:x.color,hex:x.hex,od:x.od,touched:true});renderCard();runCheck();
  }});
  /* 本数は控えへ（足元の保存）。合計は打った本数で数え直す。 */
  K().bindEdits(box,rs,()=>{const g=colorOf(rs.sel),b=box.querySelector('[data-sum]');
   if(g&&b)b.textContent=`${g.widths.reduce((t,w)=>t+(+K().editOf(rs,`qty:${w.id}`,w.qty)||0),0)}本`});
  box.querySelectorAll('[data-nw]').forEach(el=>{el.oninput=()=>{rs.draft.widths[+el.dataset.nw][el.dataset.f]=el.value;rs.draft.touched=true}});
  box.querySelectorAll('[data-act]').forEach(b=>{b.onclick=()=>act(b.dataset.act,b)});
  const g=colorOf(rs.sel);
  if(g)K().wireMore(box,[{label:`この色を消す（${g.widths.length}行）`,note:`「${g.color}」の幅ぜんぶ・合計 ${g.total}本`,danger:true,data:{bkAct:'delcolor'},onClick:delColor}]);
 }
 async function act(a,b){
  if(a==='addnew'){rs.draft.widths.push({width:'',qty:''});renderCard();return}
  if(a==='dropnew'){rs.draft.widths.splice(+b.dataset.i,1);renderCard();return}
  if(a==='addwidth')return void addWidth();
  if(a==='delwidth')return void delWidth(+b.dataset.id);
 }
 const guarded=(fn,fail)=>K().guarded(rs,fn,fail,paintCheck);
 /* 足元の保存（§9.603）: 新しい色は登録（幅と本数ごと）、登録済みの色は変えた属性と本数をまとめて書く。 */
 async function saveAll(){
  const d=rs.draft;if(!d)return;
  const isNew=rs.sel===NEW,attrs=isNew||attrCount()>0;
  const qty=Object.entries(rs.edits||{}).map(([k,v])=>[+k.split(':')[1],v===''?0:v]);
  if(!attrs&&!qty.length)return;
  const ok=await K().saveEdits(rs,async uid=>{
   if(attrs)await post('/api/bladeset/ring-colors',{equipment:rs.equipment,color:d.color,hex:d.hex,od:d.od,bore:d.bore,
     lube:d.lube,integ:d.integ,current:isNew?'':d.current,user_id:uid,
     widths:isNew?d.widths.filter(w=>String(w.width).trim()!==''):undefined});
   for(const [id,v] of qty)await post('/api/bladeset-ring-master/update',{id,qty:v,user_id:uid});
  },{fail:isNew?'この色を登録できませんでした':'保存できませんでした',done:isNew?`「${d.color}」を登録しました`:`「${d.color}」を保存しました`,
     reload:async()=>{}});
  if(ok)rs.sel=d.color;
  await load(true);
 }
 async function addWidth(){
  const w=document.getElementById('rbNewW').value,q=document.getElementById('rbNewQ').value;
  if(String(w).trim()==='')return void alertModal('追加する幅（mm）を入れてください。');
  const ok=await guarded(async uid=>{
   await post('/api/bladeset-ring-master',{equipment:rs.equipment,color:rs.sel,width:w,qty:q===''?0:q,user_id:uid});
  },'幅を足せませんでした');
  if(ok){WL.mm.headSay(`幅 ${fmt(w)}mm を追加しました`);await load(true)}
 }
 async function delWidth(id){
  const g=colorOf(rs.sel),w=g&&g.widths.find(x=>x.id===id);if(!w)return;
  if(!await confirmModal({title:'この幅を消す',eyebrow:'ゴムリング',
    bodyHtml:`<p class="confirm-modal-message">「${esc(g.color)}」の幅 ${fmt(w.width)}mm（${w.qty||0}本）を消します。</p>`,
    confirmLabel:'削除する'}))return;
  if(await guarded(async()=>{await post('/api/bladeset-ring-master/delete',{id})},'消せませんでした')){delete rs.edits[`qty:${id}`];await load(true)}
 }
 async function delColor(){
  const g=colorOf(rs.sel);if(!g)return;
  if(!await confirmModal({title:'この色を消す',eyebrow:'ゴムリング',
    bodyHtml:`<p class="confirm-modal-message">「${esc(g.color)}」の幅 ${g.widths.length}種（合計 ${g.total}本）をすべて消します。元に戻せません。</p>`,
    confirmLabel:'削除する'}))return;
  if(await guarded(async uid=>{await post('/api/bladeset/ring-colors',{equipment:rs.equipment,current:g.color,delete:true,user_id:uid})},'消せませんでした')){
   rs.sel='';rs.edits={};await load(true);
  }
 }
 /* 直しかけの色を捨てて離れてよいか（保存していない変更があるときだけ聞く）。 */
 /* 本数の控えは行の id で持つので色を移っても残る（足元の保存でまとめて書く）。聞くのは色の属性の直しかけだけ。 */
 const leaveOk=()=>{const d=rs.draft;return K().leave(!!d&&(d.current?isDirty():!!d.touched),'ゴムリング')};

 /* ---------- 読む ---------- */
 async function load(force){
  const box=document.getElementById('masterMaintList');if(!box)return;
  rs.loaded=false;renderForm();
  if(!await K().prologue(rs,force))return;
  await K().loading(async()=>{
   const r=await api('/api/bladeset/ring-colors?equipment='+encodeURIComponent(rs.equipment));
   Object.assign(rs,{colors:r.colors||[],cycle:r.cycle||[],kinds:r.kinds||['ゴムリング','潤滑リング','スペーサー一体型'],
                     suggest:r.suggest||null,nearDe:r.nearDe||20,loaded:true});
   if(rs.sel!==NEW&&!colorOf(rs.sel))rs.sel=(rs.colors[0]||{}).color||'';
   rs.draft=rs.sel===NEW?draftOf(null):(rs.sel?draftOf(colorOf(rs.sel)):null);
   rs.check={hard:[],near:[],text:''};
   renderCard();runCheck();
  });
 }
 WL.mm.registerSpecial('ring-board',{load,dirty:()=>K().editCount(rs)>0||attrCount()>0||(rs.sel===NEW&&!!(rs.draft&&rs.draft.touched))});
 WL.ringBoard={state:rs,load,select};
})();
