"use strict";
/* schedule-print.js: 作業予定表の印刷(§9.115)
   ============================================================
   現場へ配って使う紙を出す。

   **画面のタイムラインをそのまま印刷しない。** 画面は15列以上あり、
   横に長い表をA4へ押し込むと文字が読めない大きさになる。紙に要るのは
   「何を・いつ・どの順で流すか」だけなので、専用の割り付けを別に組む。

   紙の決まりごと:
    ・**1設備・1日で1枚**。現場は日ごと・ラインごとに配るので、
      1枚に複数の日や設備が混ざると渡す相手が決まらない。
    ・**実績を書く欄を紙に置く**。配る目的の半分は「書いて戻してもらう」
      ことなので、書く場所が無いと結局手書きの別紙が要る。
    ・A4の割り付けは**mm(用紙)とpx(文字)の固定**。表示サイズ(--ui-scale)へ
      追随させると、画面の拡大率で紙の行数が変わってしまう
      (CLAUDE.mdの「例外はA4帳票だけ」と同じ理由。既存の.rp-pageに揃える)。
    ・**画面に出ている条件をそのまま持っていく**。表示範囲・内容の項目は
      利用者が既に選んでいるので、紙だけ別の条件で出すと突き合わせられない。
   ============================================================ */
(function(){
 const AREA_ID='schedulePrintArea';
 const PRINT_CLASS='sc-print';

 /* 区分の紙での書き方。画面は色と記号で示しているが、**紙は白黒で刷られる**
    ので文字で言い切る(色だけで意味を伝えない、と同じ理由)。 */
 const STATE_LABEL={'予定':'予定','着手':'作業中','完了':'完了','取消':'取消'};

 const two=n=>String(n).padStart(2,'0');
 function hm(iso){
  if(!iso)return '';
  const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
 }
 function dayKey(iso){
  if(!iso)return '';
  const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';
  return `${d.getFullYear()}-${two(d.getMonth()+1)}-${two(d.getDate())}`;
 }
 const WD=['日','月','火','水','木','金','土'];
 function dayLabel(key){
  if(!key)return '日付未定';
  const d=new Date(key+'T00:00:00');
  if(Number.isNaN(d.getTime()))return key;
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${WD[d.getDay()]}）`;
 }
 function rangeLabel(rows){
  const keys=(rows||[]).map(r=>dayKey(r.start)).filter(Boolean).sort();
  if(!keys.length)return '日付未定';
  const a=dayLabel(keys[0]),b=dayLabel(keys[keys.length-1]);
  return a===b?a:`${a} 〜 ${b}`;
 }
 function minutesText(m){
  if(m==null||Number.isNaN(m))return '';
  const n=Math.round(m);
  return n>=60?`${Math.floor(n/60)}:${two(n%60)}`:`${n}分`;
 }
 function stamp(){
  const d=new Date();
  return `${d.getFullYear()}-${two(d.getMonth()+1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
 }

 /* ---------- 印刷する中身を組み立てる ----------
    entriesは画面が持っているものをそのまま受け取る(紙のために取り直さない
    ——取り直すと画面と紙で件数が食い違い、どちらが正か分からなくなる)。 */
 function buildPages(equipment,entries,opt){
  const rows=(entries||[]).filter(e=>{
   if(e.__pending)return false;                  // まだサーバーに無いものは刷らない
   const st=e.state||'予定';
   if(st==='完了'||st==='取消')return !!opt.includeDone;
   return true;
  });
  /* **日付ごとに束ねる。** 並びは画面の順(=実際に流す順)のまま。
     時刻で並べ直さないこと——固定開始や停止の差し込みで、画面の順と
     時刻の順は必ずしも一致しない。現場が見るのは「流す順」。 */
  /* **画面の「まとめ」をそのまま紙へ**(§9.189、利用者の指示)。まとまりの
     判定は画面の1箇所(groupBucketOf)を通す——紙だけ別に組み立てると、
     画面と紙でまとまりが食い違う。「まとめない」ときは見出しを出さない。 */
  const view=WL.scheduleView;
  const grouping=opt.useGroups!==false&&typeof view?.groupMode==='function'
    &&view.groupMode()!=='none'&&typeof view.groupOf==='function';
  const groups=[];const index=new Map();
  rows.forEach(e=>{
   const useActual=(e.state==='完了'||e.state==='着手')&&e.actual&&e.actual.startAt;
   const start=useActual?e.actual.startAt:e.plannedStart;
   const key=opt.pageByDate?dayKey(start):'';
   if(!index.has(key)){const g={key,label:dayLabel(key),rows:[]};index.set(key,g);groups.push(g)}
   let group=null;
   if(grouping){try{group=view.groupOf(e)}catch(_){group=null}}
   index.get(key).rows.push({e,start,end:useActual?e.actual.endAt:e.plannedEnd,group});
  });
  /* 紙の列は**1つの紙の中で変えない**ので、まとめて1回だけ決める。 */
  const cols=paperColumns(equipment,opt);
  return groups.map(g=>({
   cols,
   /* 日付で分けないときは、束ねた中身の**実際の範囲**を書く。
      キーが空だからと「日付未定」にすると、日付を持っている予定まで
      日付不明の紙として配られてしまう。 */
   equipment,day:opt.pageByDate?g.label:rangeLabel(g.rows),rows:g.rows,
   /* 見出しに出す「その日ぶん」の合計。**紙を切り分けても変えない**
      （2枚目に「12件」と出ると、その日が12件だと読まれてしまう）。 */
   count:g.rows.length,
   total:g.rows.reduce((s,x)=>s+((x.e.estimate&&x.e.estimate.minutes)||0),0),
  }));
 }

 /* ---------- 何枚になるかは「測って」決める ----------
    A4へ何行載るかは内容欄の折り返し次第で変わる（1行の日と2行の日で倍違う）。
    **定数で決め打ちにしないこと**——足りなければ最後の数件が次の紙へこぼれ、
    脚の「1 / 4」が嘘になる。配る紙で枚数の表示が違うのは、受け取った側が
    「自分のぶんが足りない」と判断できなくなるので致命的。

    紙と同じ幅の器へ一度描いて、**行の高さを実測してから**切る。
    測るときは高さを固定しないこと——flexの器で高さを決めると表が縮められ、
    実際より多くの行が入るように見える（そのまま刷ると溢れる）。 */
 const SHEET_SLACK_PX=6;   // 罫線と丸めのぶんの余裕。0だと最後の1行が端に噛む
 function splitToSheets(pages,opt){
  const area=ensureArea();
  const keep=area.getAttribute('style');
  const out=[];
  try{
   area.setAttribute('style','display:block;position:fixed;left:-10000px;top:0;width:210mm;visibility:hidden');
   (pages||[]).forEach(p=>{
    if(!p.rows||!p.rows.length){out.push({...p,startNo:1,part:1,parts:1});return}
    area.innerHTML=pageHtml({...p,startNo:1,part:1,parts:1},opt,1,1);
    const pg=area.querySelector('.sp-page'),foot=area.querySelector('.sp-foot');
    const trs=[...area.querySelectorAll('tbody tr')];
    if(!pg||!foot||!trs.length){out.push({...p,startNo:1,part:1,parts:1});return}
    const cs=getComputedStyle(pg);
    /* 表の下に置くもの（申し送りの欄。§9.189）も**高さを引く**——引き忘れると
       行で紙を埋めたあとに欄が押し出し、A4から溢れる（実測1188px > 1123px）。 */
    const note=area.querySelector('.sp-note');
    const noteH=note?(note.getBoundingClientRect().height
      +(parseFloat(getComputedStyle(note).marginTop)||0)):0;
    /* 用紙1枚の高さはmm指定なので、computedStyleがpxへ直したものを借りる
       （mm→pxの換算を自前で持つと、いつか96dpi決め打ちが混ざる）。 */
    const sheetH=parseFloat(cs.minHeight)||0;
    const padBottom=parseFloat(cs.paddingBottom)||0;
    const limit=pg.getBoundingClientRect().top+sheetH-padBottom-foot.offsetHeight-noteH-SHEET_SLACK_PX;
    const hs=trs.map(t=>t.getBoundingClientRect().height);
    /* **まとまりの見出し行は「行」ではない**(§9.189)。高さは数えるが、
       中身の行としては数えない——ここを取り違えると、見出しのぶんだけ
       予定が抜け落ちる(配る紙から作業が消える)。 */
    const rowAt=trs.map(t=>t.dataset.row==null?null:Number(t.dataset.row));
    const avail=limit-trs[0].getBoundingClientRect().top;
    const chunks=[];let cur=[],acc=0;
    hs.forEach((h,i)=>{
     if(cur.length&&acc+h>avail){chunks.push(cur);cur=[];acc=0}
     cur.push(i);acc+=h;
    });
    if(cur.length)chunks.push(cur);
    /* 見出しだけで終わった塊は次の塊へ寄せる(見出しが1枚に取り残されない)。
       見出しは次の枚でpageHtmlが出し直すので、ここでは捨ててよい。 */
    const pages2=chunks.map(idx=>idx.map(i=>rowAt[i]).filter(v=>v!=null))
                       .filter(list=>list.length);
    if(!pages2.length){out.push({...p,startNo:1,part:1,parts:1});return}
    pages2.forEach((idx,i)=>out.push({...p,rows:idx.map(j=>p.rows[j]),
      startNo:idx[0]+1,part:i+1,parts:pages2.length}));
   });
  }finally{
   area.innerHTML='';
   if(keep==null)area.removeAttribute('style');else area.setAttribute('style',keep);
  }
  return out;
 }

 /* ---------- 紙の列(§9.118) ----------
    **画面のレイアウトと紙のレイアウトは別物**にできる。画面は横に広く
    15列以上あり、紙は194mmしかない。同じ設定を使い回すと、どちらかが
    必ず犠牲になる（画面を紙に合わせて削るか、紙を溢れさせるか）。

    仕組みは一覧・タイムラインと同じ**列レイアウトマスタ**に乗せる
    （対象は`print:<設備>`）。紙のためだけの保存先を新しく作らない。

    **キーは保存名なので変えないこと**——変えると、その端末に保存済みの
    紙のレイアウトが黙って既定へ戻る。 */
 const PAPER_FIXED=[
  {key:'no',      label:'#',         mm:7,  cls:'sp-c-no'},
  {key:'state',   label:'区分',      mm:13, cls:'sp-c-state'},
  {key:'date',    label:'日付',      mm:20, cls:'sp-c-date'},
  {key:'time',    label:'予定時刻',  mm:25, cls:'sp-c-time'},
  {key:'shift',   label:'勤務',      mm:11, cls:'sp-c-shift'},
  {key:'lotNo',   label:'ロット番号',mm:26, cls:'sp-c-lot'},
  {key:'content', label:'内容',      mm:0,  cls:'sp-c-content'},   // 0=残りいっぱい
  {key:'estimate',label:'見積',      mm:13, cls:'sp-c-est'},
 ];
 /* 記入欄。**空のまま罫線だけ**にする(薄い下線を入れると書きにくい)。 */
 const PAPER_WRITE=[
  {key:'write:start',label:'実績 開始',mm:20,cls:'sp-c-write',write:true},
  {key:'write:end',  label:'実績 終了',mm:20,cls:'sp-c-write',write:true},
  {key:'write:check',label:'確認',    mm:10,cls:'sp-c-check',write:true},
  {key:'write:note', label:'備考',    mm:30,cls:'sp-c-write',write:true},
 ];
 /* ---------- 記入欄のパターン(§9.191、利用者の指示) ----------
    「開始・終了での入力欄ではなく、備考という形での枠設定や、他カスタム
     できるパターンを追加して、メニューも分かりやすく」。

    記入欄は**現場が紙に書き込む場所**なので、運用ごとに要るものが違う
    （実績を戻してもらう／気付きだけ書ければよい／確認印だけ／見るだけ）。
    以前は「実績を書き込む欄をつける」のチェック1つで、開始・終了・確認の
    3列が一括で付くか付かないかしかなかった。**よく使う形に名前を付けて
    選べる**ようにする——1列ずつ選ぶのは「紙の列を変える」でできるので、
    ここは**選ぶだけで決まる**ことに徹する。 */
 const WRITE_PATTERNS=[
  /* 既定は**紙の列の設定のまま**(§9.118)。ここで形を決め打ちにすると、
     「紙の列を変える」で外した記入欄が刷るたびに戻ってくる。設定していない
     紙では、この選択は今までどおりの3欄になる（既定の並びに入っている）。 */
  {key:'custom',     label:'紙の列で決めたまま',  keys:null,
   note:'「紙の列を変える」で選んだ記入欄をそのまま使います（既定）'},
  {key:'actual',     label:'実績を書いてもらう',  keys:['write:start','write:end','write:check'],
   note:'開始・終了・確認の3欄。配って書いて戻してもらう形'},
  {key:'actualNote', label:'実績＋備考',          keys:['write:start','write:end','write:check','write:note'],
   note:'実績のほかに気付きも書ける'},
  {key:'note',       label:'備考だけ',            keys:['write:note'],
   note:'書くのは気付きだけでよいとき'},
  {key:'check',      label:'確認だけ',            keys:['write:check'],
   note:'流し終わりに印を付けるだけ'},
  {key:'none',       label:'記入欄なし',          keys:[],
   note:'見るための紙（書き込まない）'},
 ];
 const writePatternOf=(opt,hasSaved)=>{
  const k=String(opt&&opt.writePattern||'');
  if(WRITE_PATTERNS.some(p=>p.key===k))return k;
  /* 古い設定(actualColumns)からの読み替え。**設定を触っていない現場の紙が
     更新で変わらないように**、偽＝なしへ落とす。 */
  if(opt&&opt.actualColumns===false)return 'none';
  /* **選んでいないときは、紙の列の設定があればそれに従う**(§9.118)。
     ここで既定のパターンを当ててしまうと、「紙の列を変える」で外した
     記入欄が刷るたびに戻り、載せていない列が勝手に増える（紙は幅が
     有限なので、増えた瞬間に配れない紙になる）。設定の無い紙だけ、
     今までどおりの3欄を既定にする。 */
  return hasSaved?'custom':'actual';
 };
 /* 何も設定していないときの紙。**今までの紙と同じ並び**にしておく
    （設定を触っていない現場の紙が、更新で勝手に変わらないように）。 */
 const DEFAULT_ORDER=['no','state','time','shift','lotNo','content','estimate',
                      'write:start','write:end','write:check'];
 const CONTENT_PREFIX='content:';
 const PAPER_USABLE_MM=210-8*2;        // 用紙210mm - 左右の余白8mmずつ

 const printTarget=eq=>eq?`print:${eq}`:'';
 /* 紙に置ける列の一覧。内容の項目(§9.88 段6)は画面のタイムラインが
    出しているものをそのまま候補にする。 */
 function paperCatalog(){
  /* 出どころを持たせる(§9.105と同じ考え方)。**同じ名前の候補が並ぶ**
     ——予定そのものの「ロット番号」と、内容欄の項目としての「ロット番号」は
     別物なのに名前が同じ。分類を文字で添えないと、どちらを選んだのか
     選んだ本人にも分からない（色だけで伝えないのも同じ理由）。 */
  const out=[...PAPER_FIXED.map(c=>({...c,kind:'plan'})),
             ...PAPER_WRITE.map(c=>({...c,kind:'write'}))];
  const keys=(typeof WL.scheduleView?.contentKeys==='function')?WL.scheduleView.contentKeys():[];
  keys.forEach(k=>out.push({
   key:CONTENT_PREFIX+k, contentKey:k, mm:22, cls:'sp-c-item', kind:'content',
   label:(typeof WL.scheduleView?.contentLabelOf==='function')?WL.scheduleView.contentLabelOf(k):k,
  }));
  return out;
 }
 /* 分類の呼び名。紙の見出しには出さない（紙に「内容: 材質」は冗長）ので、
    レイアウトを組む画面でだけ使う。 */
 const KIND_LABEL={plan:'予定',content:'内容',write:'記入欄'};
 /* いま刷る列。**設定があるときは、そこに載っている列だけ**を出す
    ——一覧は「記録に無い列は末尾へ回す」が、紙は幅が有限なので同じ作りに
    すると、内容の項目を1つ足しただけで紙が溢れて配れなくなる。
    増えた項目はレイアウトの編集画面に「未選択」として出る。 */
 function paperColumns(equipment,opt){
  const target=printTarget(equipment);
  const catalog=paperCatalog();
  const byKey=new Map(catalog.map(c=>[c.key,c]));
  const layout=target?WL.columnLayout.get(target):null;
  const saved=(layout&&layout.order||[]).filter(k=>byKey.has(k));
  const hidden=new Set((layout&&layout.hidden)||[]);
  let keys=saved.length?saved.filter(k=>!hidden.has(k))
                       :DEFAULT_ORDER.filter(k=>byKey.has(k));
  /* 記入欄は**後から効く差し替え**にしておく(§9.191)——レイアウトを作った
     人にも「今回は備考だけで」が効いてほしい。`custom`のときだけ、紙の列で
     選んだ記入欄をそのまま使う。 */
  const pat=WRITE_PATTERNS.find(p=>p.key===writePatternOf(opt,saved.length>0));
  if(pat&&pat.keys){
   const want=pat.keys.filter(k=>byKey.has(k));
   /* 並びは紙の列の順を尊重し、載っていないものは末尾へ足す
      （「備考だけ」を選んだのに欄が出ない、を作らない）。 */
   keys=keys.filter(k=>!k.startsWith('write:')||want.includes(k))
            .concat(want.filter(k=>!keys.includes(k)));
  }
  return keys.map(k=>{
   const c=byKey.get(k);
   const mm=layout&&layout.widths&&layout.widths[k]!=null?Number(layout.widths[k]):c.mm;
   const name=layout&&layout.names&&layout.names[k]?layout.names[k]:c.label;
   return {...c,mm:Number.isFinite(mm)&&mm>0?mm:(c.mm||0),label:name};
  });
 }

 function valueOf(col,item,no,contentMap){
  const e=item.e;
  switch(col.key){
   case 'no':return String(no);
   case 'state':return STATE_LABEL[e.state]||e.state||'';
   case 'date':{
    const k=dayKey(item.start);
    if(!k)return '';
    const d=new Date(k+'T00:00:00');
    return `${d.getMonth()+1}/${d.getDate()}（${WD[d.getDay()]}）`;
   }
   case 'time':
    return item.start?(e.ongoing?`${hm(item.start)}〜継続中`:`${hm(item.start)}〜${hm(item.end)}`):'未定';
   case 'shift':return e.shift||'';
   case 'lotNo':return e.lotNo||'';
   case 'content':
    return (typeof WL.scheduleView?.contentTextOf==='function')
     ? WL.scheduleView.contentTextOf(e) : (e.title||'');
   case 'estimate':{
    /* 見積が実績由来でないときは印を添える(§9.114)。紙でも「この時間は
       どのくらい当てになるのか」が分かるようにしておく。 */
    const src=(e.estimate&&e.estimate.source)||'';
    const mark=(src==='equipment-standard'||src==='default')?'~':'';
    return e.estimate?mark+minutesText(e.estimate.minutes):'';
   }
   default:
    if(col.write)return '';
    if(col.contentKey)return contentMap?(contentMap.get(col.contentKey)||''):'';
    return '';
  }
 }

 function cellsOf(item,no,cols){
  /* 内容の項目は1行ぶんまとめて引く(項目ごとに呼ぶと行×項目の回数だけ
     組み立て直すことになる)。 */
  let map=null;
  if(cols.some(c=>c.contentKey)&&typeof WL.scheduleView?.contentCellsOf==='function'){
   map=new Map((WL.scheduleView.contentCellsOf(item.e)||[]).map(c=>[c.key,c.text]));
  }
  return cols.map(c=>`<td class="${c.cls}">${esc(valueOf(c,item,no,map))}</td>`).join('');
 }

 function pageHtml(page,opt,pageNo,pageCount){
  const cols=page.cols||paperColumns(page.equipment,opt);
  /* 幅は**colgroupで与える**（CSSのクラスに書くと利用者が変えられない）。
     幅0の列は残りいっぱい＝width指定なし。 */
  const group=`<colgroup>${cols.map(c=>
    c.mm>0?`<col style="width:${c.mm}mm">`:'<col>').join('')}</colgroup>`;
  const head=cols.map(c=>`<th class="${c.cls}">${esc(c.label)}</th>`);
  /* **通し番号はその日の頭から数える。** 紙が2枚に分かれても#1へ戻さない
     （現場は番号で呼び合うので、同じ日に#1が2つあると指せなくなる）。 */
  const from=page.startNo||1;
  /* まとまりの見出し(§9.189)。**紙を切り分けた続きの枚にも出す**
     ——2枚目が見出し無しで始まると、どのまとまりの続きなのか読めない。
     `data-row`が付いているのが実際の予定の行で、**枚数を測る側は
     この印で数える**(splitToSheets)。 */
  let lastGroup=null;
  const body=page.rows.map((item,i)=>{
   const g=item.group;
   let head2='';
   if(g&&g.key!==lastGroup){
    lastGroup=g.key;
    /* **同じことを2箇所に出さない**(§9.129)。日付ごとにページを分けていて
       まとめも日付なら、見出しは紙の頭と同じ文字になる。 */
    if(String(g.label)!==String(page.day||'')){
     const n=page.rows.filter(x=>x.group&&x.group.key===g.key).length;
     head2=`<tr class="sp-row-group"><td colspan="${head.length}">${esc(g.label)}`
       +`<span class="sp-group-count">${n}件</span></td></tr>`;
    }
   }
   /* 申し送り(コメント)は**横いっぱいの1行**にする——列に押し込むと
      読めない幅になり、書いた意味が無くなる。 */
   if(item.e.kind==='コメント'){
    return head2+`<tr class="sp-row-comment" data-row="${i}">`
      +`<td colspan="${head.length}">💬 ${esc((item.e.title||'').trim())}</td></tr>`;
   }
   return head2+`<tr class="${item.e.kind!=='作業'?'sp-row-stop':''}" data-row="${i}">`
     +`${cellsOf(item,from+i,cols)}</tr>`;
  }).join('')
   ||`<tr><td class="sp-empty" colspan="${head.length}">この日に出す予定はありません</td></tr>`;
  /* 総見積。紙を受け取った人が最初に見るのは「今日どれだけあるか」。
     **切り分けた紙でもその日の合計を出す**（この紙に載っている数ではない）。 */
  const count=page.count==null?page.rows.length:page.count;
  const total=page.total==null
   ? page.rows.reduce((s,x)=>s+((x.e.estimate&&x.e.estimate.minutes)||0),0)
   : page.total;
  const parts=page.parts||1;
  const cont=parts>1?`（${page.part||1}枚目 / 全${parts}枚）`:'';
  return `<section class="sp-page">
   <header class="sp-head">
    <div class="sp-head-main">
     <span class="sp-title">作業予定表</span>
     <span class="sp-equip">${esc(page.equipment||'')}</span>
    </div>
    <div class="sp-head-sub">
     <span class="sp-day">${esc(page.day)}${esc(cont)}</span>
     <span class="sp-count">${count}件 / 見積計 ${esc(minutesText(total))}</span>
    </div>
   </header>
   <table class="sp-table">${group}<thead><tr>${head.join('')}</tr></thead><tbody>${body}</tbody></table>
   ${opt.commentBox===false?'':`<section class="sp-note">
     <span class="sp-note-label">申し送り・気付き</span>
     <span class="sp-note-area"></span>
    </section>`}
   <footer class="sp-foot">
    <span>出力 ${esc(stamp())}</span>
    <span class="sp-foot-note">「~」の付いた見積は実績がまだ無いための暫定値です</span>
    <span>${pageNo} / ${pageCount}</span>
   </footer>
  </section>`;
 }

 function ensureArea(){
  let el=document.getElementById(AREA_ID);
  if(el)return el;
  el=document.createElement('div');el.id=AREA_ID;el.className='sp-print-area';
  document.body.appendChild(el);
  return el;
 }

 /* ---------- 印刷する ----------
    **描き終えてからダイアログを開く**(同期的にwindow.print()を呼ぶと
    まだ差し込んだDOMが反映されておらず白紙になる。既存の帳票と同じ)。 */
 function printPages(pages,opt,title){
  const area=ensureArea();
  area.innerHTML=pages.map((p,i)=>pageHtml(p,opt,i+1,pages.length)).join('');
  document.body.classList.add(PRINT_CLASS);
  const prevTitle=document.title;
  document.title=title;
  const cleanup=()=>{
   document.body.classList.remove(PRINT_CLASS);
   document.title=prevTitle;area.innerHTML='';
   window.removeEventListener('afterprint',cleanup);
  };
  window.addEventListener('afterprint',cleanup);
  requestAnimationFrame(()=>requestAnimationFrame(()=>window.print()));
 }

 /* ---------- 設定 ----------
    既定は「現場へ配る」ときの形。**毎回選び直させない**ので、選んだ内容は
    この端末に覚える(紙の運用は現場ごとに決まっていて、毎回は変わらない)。 */
 const PREF_KEY='SchedulePrintPrefV1';
 /* useGroups=画面の「まとめ」を紙にも入れる / commentBox=紙の下に
    申し送りの欄を作る(§9.189、利用者の指示)。どちらも既定は入れる。 */
 const DEFAULTS={includeDone:false,actualColumns:true,pageByDate:true,allEquipment:false,
                 useGroups:true,commentBox:true,writePattern:'custom'};
 function loadPref(){
  try{return {...DEFAULTS,...(JSON.parse(localStorage.getItem(PREF_KEY)||'{}')||{})}}
  catch(_){return {...DEFAULTS}}
 }
 function savePref(p){
  try{localStorage.setItem(PREF_KEY,JSON.stringify(p))}catch(_){}
 }

 /* いまの紙が既定のままか、自分で組んだものか。**どちらなのかを言う**
    ——設定したのに効いていないのか、そもそも設定していないのかが
    分からないと、直しようがない。 */
 function layoutNoteText(equipment){
  const t=printTarget(equipment);
  const n=t?((WL.columnLayout.get(t).order||[]).length):0;
  return n?`いまは この設備用に組んだレイアウト（${n}列）で刷ります。`
          :'いまは 既定のレイアウト（区分・時刻・勤務・ロット番号・内容・見積）で刷ります。';
 }

 /* ---------- 印刷はプレビューを先に出す(§9.186) ----------
    以前は「印刷しますか？」＋チェック4つの確認から始まり、**紙を見る前に
    決めさせていた**。日付ごとに分けるか・実績欄を付けるか・完了も載せるかは、
    どれも「刷り上がりを見れば分かる」ことなので、聞く順番が逆だった
    （利用者の指示: いったん今の条件でプレビューを出して、必要なら
    設定を変える。変えた結果はその場で見せる）。

    ・押したら**すぐ今の条件の紙**が出る（設定は覚えてある）
    ・設定を触ると**その場で刷り上がりが変わる**（枚数もその場で出る）
    ・「印刷する」はプレビューで見たものをそのまま出す（組み直さない）

    紙の組み立ては`buildPages`/`splitToSheets`/`pageHtml`の既存の1本を
    そのまま使う。**プレビュー用の別の組み立てを作らないこと**——
    見たものと刷るものが食い違ったら、プレビューの意味が無い。 */
 async function open(){
  const view=WL.scheduleView;
  if(!view||typeof view.entries!=='function'){
   showToast&&showToast('印刷できません','作業スケジュールを開いてからお試しください',4000);return;
  }
  const equipment=view.equipment();
  /* 紙のレイアウトはマスタにあるので、開く前に読む(キャッシュ済みなら即返る)。 */
  try{await WL.columnLayout.load(printTarget(equipment))}catch(_){}
  openPreview(equipment);
 }

 /* 刷る中身を集める。**全設備のときだけ**他の設備を読む(読んだものは
    プレビューを開いている間だけ覚える——チェックを入れ直すたびに
    共有DBへ取りに行くと、そのあいだ画面が固まる)。 */
 const otherEntries=new Map();
 async function collectPages(pref,onProgress){
  const view=WL.scheduleView;
  const opt={...pref};
  let pages=[];
  if(opt.allEquipment&&typeof view.fetchEntries==='function'){
   const names=view.equipmentNames();
   for(const name of names){
    let entries=otherEntries.get(name);
    if(!entries){
     if(onProgress)onProgress(`${name} の予定を集めています…`);
     try{entries=await view.fetchEntries(name)}
     catch(e){
      showToast&&showToast('一部の設備を読めませんでした',`${name}: ${e.message}`,5000);
      continue;
     }
     otherEntries.set(name,entries);
    }
    /* **紙のレイアウトは設備ごと**なので、設備ごとに読む(§9.118)。 */
    try{await WL.columnLayout.load(printTarget(name))}catch(_){}
    pages=pages.concat(buildPages(name,entries,opt));
   }
  }else{
   pages=pages.concat(buildPages(view.equipment(),view.entries(),opt));
  }
  return pages;
 }

 /* ---------- プレビューの画面 ----------
    左に決めること、右に刷り上がり。並びは実際にする順(何を載せる→紙の列→
    枚数の確認→印刷)。 */
 const PREVIEW_ID='schedulePrintPreview';
 let pv={equipment:'',pref:null,sheets:[],busy:false,again:false};

 function ensurePreview(){
  let el=document.getElementById(PREVIEW_ID);
  if(el)return el;
  el=document.createElement('div');
  el.className='sp-preview';el.id=PREVIEW_ID;el.hidden=true;
  el.innerHTML=`
   <div class="sp-pv-box" role="dialog" aria-modal="true" aria-labelledby="spPvTitle">
    <header class="sp-pv-head">
     <div><span class="sp-pv-eyebrow">PRINT PREVIEW</span>
      <h2 id="spPvTitle">作業予定表</h2>
      <small id="spPvSub"></small></div>
     <button type="button" id="spPvClose" title="閉じる（刷りません）">×</button>
    </header>
    <div class="sp-pv-body">
     <aside class="sp-pv-side">
      <section class="sp-pv-sec">
       <h3>① 何を載せるか</h3>
       <div class="sp-options" id="spPvOptions"></div>
      </section>
      <section class="sp-pv-sec">
       <h3>② 紙の列</h3>
       <p class="sp-layout-note" id="spLayoutNote"></p>
       <button type="button" class="sp-layout-open" id="spLayoutOpen">紙の列を変える…</button>
      </section>
      <section class="sp-pv-sec">
       <h3>③ 刷り上がり</h3>
       <p class="sp-pv-facts" id="spPvFacts"></p>
      </section>
     </aside>
     <div class="sp-pv-paper" id="spPvPaper"></div>
    </div>
    <footer class="sp-pv-foot">
     <span class="sp-pv-hint">設定を変えると、右のプレビューがその場で変わります。</span>
     <button type="button" id="spPvCancel">閉じる</button>
     <button type="button" class="sp-pv-print" id="spPvPrint">印刷する</button>
    </footer>
   </div>`;
  document.body.appendChild(el);
  el.querySelector('#spPvClose').onclick=closePreview;
  el.querySelector('#spPvCancel').onclick=closePreview;
  el.querySelector('#spPvPrint').onclick=doPrint;
  el.querySelector('#spLayoutOpen').onclick=()=>openLayoutPanel(pv.equipment,{onSaved:()=>renderPreview()});
  /* 覆いの外を押したら閉じる（刷らない）。中は素通りさせる。 */
  el.addEventListener('mousedown',ev=>{if(ev.target===el)closePreview()});
  return el;
 }
 function optionRows(pref,canAll){
  const cb=(k,label,note)=>`<label class="sp-opt"><input type="checkbox" data-opt="${k}"${pref[k]?' checked':''}>
   <span><b>${esc(label)}</b>${note?`<small>${esc(note)}</small>`:''}</span></label>`;
  /* 「まとめ」は画面で選んでいるものをそのまま使う。**いま何でまとめて
     いるかを書く**——「まとめない」ときに設定だけ出ていると、押しても
     何も変わらないことになる。 */
  const gm=(typeof WL.scheduleView?.groupModeLabel==='function')?WL.scheduleView.groupModeLabel():'';
  const grouped=(typeof WL.scheduleView?.groupMode==='function')&&WL.scheduleView.groupMode()!=='none';
  /* **記入欄はパターンから選ぶ**(§9.191)。チェックの寄せ集めだと
     「開始だけ欲しい」「備考だけ」を作るのに何回も試すことになる。 */
  const cur=writePatternOf(pref);
  const patRows=WRITE_PATTERNS.map(p=>`<label class="sp-pat${cur===p.key?' is-on':''}" title="${esc(p.note)}">
     <input type="radio" name="spWritePattern" value="${p.key}"${cur===p.key?' checked':''}>
     <span><b>${esc(p.label)}</b><small>${esc(p.note)}</small></span></label>`).join('');
  return `<div class="sp-opt-group"><h4>載せるもの</h4>
   ${canAll?cb('allEquipment','すべての設備を続けて印刷する','設備ごとにページを分けます'):''}
   ${cb('includeDone','完了・取消も載せる','ふだんは載せません（これから流すものだけ配るため）')}
   ${grouped?cb('useGroups',`画面のまとめ（${gm}）で見出しを入れる`,'画面と同じまとまりで区切ります')
            :`<p class="sp-opt-note">画面は「まとめない」なので、紙にも見出しは入りません。</p>`}
   ${cb('pageByDate','日付ごとにページを分ける','日ごとに配る場合はこのまま')}
  </div>
  <div class="sp-opt-group"><h4>書き込む欄</h4>
   <div class="sp-pats" id="spWritePatterns">${patRows}</div>
   ${cb('commentBox','紙の下に「申し送り・気付き」の欄をつける','行ごとではなく、紙1枚に1つの欄です')}
  </div>`;
 }
 function openPreview(equipment){
  const view=WL.scheduleView;
  const canAll=typeof view.equipmentNames==='function'&&view.equipmentNames().length>1;
  const pref=loadPref();
  if(!canAll)pref.allEquipment=false;
  pv={equipment:String(equipment||''),pref,sheets:[],busy:false,again:false};
  otherEntries.clear();
  const el=ensurePreview();
  el.querySelector('#spPvTitle').textContent=`作業予定表${pv.equipment?`（${pv.equipment}）`:''}`;
  el.querySelector('#spPvSub').textContent='いま画面に出ている条件（表示範囲・内容の項目）のまま刷ります';
  const box=el.querySelector('#spPvOptions');
  box.innerHTML=optionRows(pref,canAll);
  /* **clickで受ける**（changeはclickの後に飛ぶ。§9.90と同じ理由）。 */
  box.querySelectorAll('[data-opt]').forEach(inp=>inp.onclick=()=>{
   pv.pref[inp.dataset.opt]=!!inp.checked;savePref(pv.pref);renderPreview();
  });
  /* 記入欄のパターン(§9.191)。**選んだらその場で刷り上がりが変わる**。 */
  box.querySelectorAll('input[name="spWritePattern"]').forEach(inp=>inp.onclick=()=>{
   pv.pref.writePattern=inp.value;
   /* 古い設定とも辻褄を合わせる（他の画面が actualColumns を見ている）。 */
   pv.pref.actualColumns=inp.value!=='none';
   savePref(pv.pref);
   box.querySelectorAll('.sp-pat').forEach(l=>l.classList.toggle('is-on',
     l.querySelector('input').value===inp.value));
   renderPreview();
  });
  el.hidden=false;
  renderPreview();
  requestAnimationFrame(()=>el.querySelector('#spPvPrint')?.focus());
 }
 function closePreview(){
  const el=document.getElementById(PREVIEW_ID);if(el)el.hidden=true;
  closeLayoutPanel();
 }
 /* 実寸(210×297mm)を器へ収める倍率。**紙の寸法はmmのまま**にして
    見た目だけ縮める(§9.115の「用紙はmm」を崩さない)。
    **高さも見る**のが要点——幅だけで合わせると1枚が縦に切れ、
    「配る紙が1枚に収まっているか」というプレビューの一番の用が果たせない
    （下が見えないので、溢れているのかどうかが分からない）。 */
 function fitZoom(box){
  const probe=box.querySelector('.sp-page');
  /* **`offsetWidth`で測る。** `getBoundingClientRect()`は`transform`を
     掛けたあとの見かけの寸法を返すので、前回の倍率が掛かった値を基準に
     してしまう（回を重ねるほど縮む）。 */
  const w=probe?probe.offsetWidth:0,h=probe?probe.offsetHeight:0;
  if(!w||!h)return 1;
  const roomW=box.clientWidth-24,roomH=box.clientHeight-56;   // 余白と枚数の見出しぶん
  if(roomW<=0||roomH<=0)return 1;
  return Math.min(1,Math.max(.3,Math.min(roomW/w,roomH/h)));
 }
 async function renderPreview(){
  const el=document.getElementById(PREVIEW_ID);if(!el||el.hidden)return;
  /* 続けて押されたときは**最後の1回だけ**組む(チェックを続けて触ると
     組み立てが重なる)。 */
  if(pv.busy){pv.again=true;return}
  pv.busy=true;
  const paper=el.querySelector('#spPvPaper'),facts=el.querySelector('#spPvFacts');
  const note=el.querySelector('#spLayoutNote');
  if(note)note.textContent=layoutNoteText(pv.equipment);
  try{
   let pages=await collectPages(pv.pref,msg=>{
    paper.innerHTML=`<p class="sp-pv-wait">${esc(msg)}</p>`;
   });
   if(!pages.length||pages.every(p=>!p.rows.length)){
    pv.sheets=[];
    paper.innerHTML=`<p class="sp-pv-empty">${esc(pv.pref.includeDone
      ?'この設備に予定がありません。':'これから流す予定がありません。')}</p>`
     +(pv.pref.includeDone?'':'<p class="sp-pv-empty-how">「完了・取消も載せる」を入れると過去分も出せます。</p>');
    facts.innerHTML='<b>0枚</b>';
    el.querySelector('#spPvPrint').disabled=true;
    return;
   }
   const sheets=splitToSheets(pages,pv.pref);
   pv.sheets=sheets;
   el.querySelector('#spPvPrint').disabled=false;
   paper.innerHTML=sheets.map((p,i)=>
    `<figure class="sp-pv-sheet"><figcaption>${i+1} / ${sheets.length}${
      p.equipment&&pv.pref.allEquipment?`　${esc(p.equipment)}`:''}</figcaption>
     <div class="sp-pv-scale">${pageHtml(p,pv.pref,i+1,sheets.length)}</div></figure>`).join('');
   /* 倍率は**描いてから測って**決める(mm指定の実寸はブラウザに聞くしかない)。 */
   const zoom=fitZoom(paper);
   paper.style.setProperty('--sp-zoom',String(Math.round(zoom*1000)/1000));
   paper.querySelectorAll('.sp-pv-scale').forEach(box=>{
    const pg=box.querySelector('.sp-page');
    if(!pg)return;
    /* 縮めた分だけ器も縮める(transformは場所を空けてくれない)。
       **`offsetWidth`で測ること**——`getBoundingClientRect()`は倍率を
       掛けたあとの寸法なので、そこへもう一度掛けると器が小さくなり、
       紙の右側が切り落とされる(実際に切れた)。 */
    box.style.width=Math.round(pg.offsetWidth*zoom)+'px';
    box.style.height=Math.round(pg.offsetHeight*zoom)+'px';
   });
   const rows=sheets.reduce((n,p)=>n+((p.rows||[]).length),0);
   const eqs=new Set(sheets.map(p=>p.equipment).filter(Boolean));
   facts.innerHTML=`<b>${sheets.length}枚</b>・${rows}件`
    +(eqs.size>1?`・${eqs.size}台ぶん`:'')
    +`<small>実寸の ${Math.round(zoom*100)}% で表示しています</small>`;
  }catch(e){
   paper.innerHTML=`<p class="sp-pv-empty">プレビューを作れませんでした: ${esc(e.message)}</p>`;
   pv.sheets=[];
  }finally{
   pv.busy=false;
   if(pv.again){pv.again=false;renderPreview()}
  }
 }
 /* 見たものをそのまま刷る。**組み直さない**——組み直すと、そのあいだに
    画面が変わっていた場合にプレビューと違う紙が出る。 */
 function doPrint(){
  if(!pv.sheets.length){showToast&&showToast('刷るものがありません','',3000);return}
  const el=document.getElementById(PREVIEW_ID);if(el)el.hidden=true;
  printPages(pv.sheets,pv.pref,`作業予定表_${pv.sheets[0].equipment||''}`);
 }

 /* ---------- 紙のレイアウトを組む(§9.118) ----------
    **画面とは別に**、紙に出す列・並び・幅(mm)・見出しを決める。

    ここで一番大事なのは**幅の合計を見せる**こと。紙幅は194mmしかなく、
    超えると列が潰れて読めない紙が刷り上がる。刷ってから気づくのでは
    紙も時間も無駄になるので、組んでいる最中に「あと何mm」を出す。 */
 const PANEL_ID='schedulePrintLayoutPanel';
 let lp={equipment:'',rows:[]};      // rows=[{key,label,name,mm,on}]

 function layoutRowsOf(equipment){
  const target=printTarget(equipment);
  const catalog=paperCatalog();
  const layout=WL.columnLayout.get(target);
  const order=(layout.order||[]).filter(k=>catalog.some(c=>c.key===k));
  const hidden=new Set(layout.hidden||[]);
  const use=order.length?order:DEFAULT_ORDER.filter(k=>catalog.some(c=>c.key===k));
  const rank=new Map(use.map((k,i)=>[k,i]));
  /* 選んでいる列を先に、残りを後ろに並べる。**候補は全部出す**
     ——出していない列が画面のどこにも無いと、足せることに気づけない。 */
  return catalog.slice()
   .sort((a,b)=>(rank.has(a.key)?rank.get(a.key):9e9)-(rank.has(b.key)?rank.get(b.key):9e9))
   .map(c=>({
    key:c.key,label:c.label,kind:c.kind||'plan',
    name:(layout.names&&layout.names[c.key])||'',
    mm:layout.widths&&layout.widths[c.key]!=null?Number(layout.widths[c.key]):(c.mm||0),
    on:rank.has(c.key)&&!hidden.has(c.key),
   }));
 }
 function ensureLayoutPanel(){
  let el=document.getElementById(PANEL_ID);
  if(el)return el;
  el=document.createElement('div');
  el.className='sc-float-win';el.id=PANEL_ID;el.hidden=true;
  el.innerHTML=`
   <div class="sc-float-header"><div><h2 id="splTitle">紙のレイアウト</h2>
     <small class="spl-sub" id="splSub"></small></div>
    <button type="button" id="splClose" title="閉じる">×</button></div>
   <div class="sc-float-body spl-body">
    <p class="spl-lead">A4の紙に出す列を選び、上から順に並べます。
     <b>画面のタイムラインとは別</b>の設定です。</p>
    <div class="spl-gauge" id="splGauge"></div>
    <div class="spl-rows" id="splRows"></div>
   </div>
   <div class="sc-float-foot">
    <button type="button" id="splReset" class="spl-reset">既定に戻す</button>
    <div class="sc-content-foot-actions">
     <button type="button" id="splCancel">やめる</button>
     <button type="button" id="splSave" class="sc-column-save">保存</button>
    </div>
   </div>
   <div class="sc-float-resize" title="ドラッグで大きさを変えられます"></div>`;
  document.body.appendChild(el);
  el.querySelector('#splClose').onclick=closeLayoutPanel;
  el.querySelector('#splCancel').onclick=closeLayoutPanel;
  el.querySelector('#splSave').onclick=saveLayout;
  el.querySelector('#splReset').onclick=resetLayout;
  if(typeof WL.makeFloatingWindow==='function')
   WL.makeFloatingWindow(el,{storageKey:'schedulePrintLayoutRectV1',defaultWidth:760,defaultHeight:620,
                             defaultTop:80,minWidth:520,minHeight:360});
  else console.error('紙のレイアウト: WL.makeFloatingWindow が見つかりません');
  return el;
 }
 /* 幅の合計。**「残り」を出す**のが要点で、合計だけでは足りるのか
    分からない。内容欄(幅0=残りいっぱい)は合計に数えない。 */
 function renderGauge(){
  const box=document.getElementById('splGauge');if(!box)return;
  const on=lp.rows.filter(r=>r.on);
  const fixed=on.filter(r=>r.mm>0).reduce((s,r)=>s+r.mm,0);
  const auto=on.filter(r=>r.mm<=0).length;
  const left=Math.round((PAPER_USABLE_MM-fixed)*10)/10;
  const over=left<0;
  const note=over?`${Math.abs(left)}mm はみ出しています。幅を減らすか、列を外してください。`
   :auto?`残り ${left}mm を 幅を決めていない ${auto}列 で分け合います。`
        :`残り ${left}mm は余白になります。`;
  box.className='spl-gauge'+(over?' is-over':'');
  box.innerHTML=`<b>${on.length}列 / 幅の合計 ${Math.round(fixed*10)/10}mm</b>
   <span>（A4で使えるのは ${PAPER_USABLE_MM}mm）</span><small>${esc(note)}</small>`;
 }
 function layoutRowHtml(r,i){
  return `<div class="spl-row${r.on?'':' is-off'}" data-row="${i}">
   <label class="spl-on"><input type="checkbox" data-on="${i}"${r.on?' checked':''}></label>
   <span class="spl-kind spl-kind-${esc(r.kind||'plan')}">${esc(KIND_LABEL[r.kind]||'予定')}</span>
   <span class="spl-name" title="${esc(r.key)}">${esc(r.label)}</span>
   <input type="text" class="spl-alias" data-alias="${i}" value="${esc(r.name)}"
    placeholder="${esc(r.label)}" autocomplete="off" title="紙に出す見出し（空欄なら左の名前）">
   <span class="spl-mm"><input type="number" class="spl-w" data-w="${i}" min="0" max="194" step="1"
    value="${r.mm>0?r.mm:''}" placeholder="残り" title="幅(mm)。空欄なら残りいっぱい"> mm</span>
   <button type="button" class="spl-up" data-up="${i}" title="1つ上へ"${i===0?' disabled':''}>▲</button>
   <button type="button" class="spl-down" data-down="${i}" title="1つ下へ"${i===lp.rows.length-1?' disabled':''}>▼</button>
  </div>`;
 }
 function renderLayout(){
  const box=document.getElementById('splRows');if(!box)return;
  box.innerHTML=lp.rows.map(layoutRowHtml).join('');
  box.querySelectorAll('[data-on]').forEach(el=>el.onclick=e=>{
   /* **clickで受ける**（changeはclickの後に飛ぶ。§9.90と同じ理由）。 */
   lp.rows[Number(e.currentTarget.dataset.on)].on=e.currentTarget.checked;
   e.currentTarget.closest('.spl-row').classList.toggle('is-off',!e.currentTarget.checked);
   renderGauge();
  });
  box.querySelectorAll('[data-alias]').forEach(el=>el.oninput=e=>{
   /* 入力中に組み直さない（カーソルが飛ぶ。§9.117と同じ）。 */
   lp.rows[Number(e.currentTarget.dataset.alias)].name=e.currentTarget.value;
  });
  box.querySelectorAll('[data-w]').forEach(el=>el.oninput=e=>{
   const v=Number(e.currentTarget.value);
   lp.rows[Number(e.currentTarget.dataset.w)].mm=Number.isFinite(v)&&v>0?v:0;
   renderGauge();
  });
  box.querySelectorAll('[data-up]').forEach(el=>el.onclick=e=>moveLayout(Number(e.currentTarget.dataset.up),-1));
  box.querySelectorAll('[data-down]').forEach(el=>el.onclick=e=>moveLayout(Number(e.currentTarget.dataset.down),1));
  renderGauge();
 }
 function moveLayout(i,d){
  const to=i+d;
  if(to<0||to>=lp.rows.length)return;
  const [row]=lp.rows.splice(i,1);
  lp.rows.splice(to,0,row);
  renderLayout();
 }
 function openLayoutPanel(equipment,opts={}){
  const eq=String(equipment||'').trim();
  if(!eq){showToast&&showToast('設備を選んでから開いてください','',3200);return}
  /* 保存したらプレビューへ知らせる(§9.186)。**触った結果をその場で見せる**
     のがプレビューの値打ちなので、列を変えたら刷り上がりも変わる。 */
  lp={equipment:eq,rows:layoutRowsOf(eq),onSaved:typeof opts.onSaved==='function'?opts.onSaved:null};
  ensureLayoutPanel();
  document.getElementById('splTitle').textContent=`紙のレイアウト（${eq}）`;
  document.getElementById('splSub').textContent='作業予定表の印刷にだけ効きます';
  renderLayout();
  document.getElementById(PANEL_ID).hidden=false;
 }
 function closeLayoutPanel(){
  const el=document.getElementById(PANEL_ID);if(el)el.hidden=true;
 }
 /* 既定へ戻す＝保存を消す。**その場で消さず、保存を押すまで待つ**
    （やめるで元へ戻せるように）。 */
 function resetLayout(){
  const catalog=paperCatalog();
  const rank=new Map(DEFAULT_ORDER.map((k,i)=>[k,i]));
  lp.rows=catalog.slice()
   .sort((a,b)=>(rank.has(a.key)?rank.get(a.key):9e9)-(rank.has(b.key)?rank.get(b.key):9e9))
   .map(c=>({key:c.key,label:c.label,kind:c.kind||'plan',name:'',mm:c.mm||0,on:rank.has(c.key)}));
  renderLayout();
 }
 async function saveLayout(){
  const target=printTarget(lp.equipment);
  if(!target)return;
  const on=lp.rows.filter(r=>r.on);
  if(!on.length){showToast&&showToast('列が1つも選ばれていません','紙に何も出せません',3600);return}
  const widths={},names={};
  lp.rows.forEach(r=>{
   if(r.mm>0)widths[r.key]=r.mm;
   const t=String(r.name||'').trim();
   if(t&&t!==r.label)names[r.key]=t;
  });
  /* **保存は全置換なので、渡す設定を1つも書き漏らさない**(§9.113)。
     紙では使わない書式・読み替え・計算式も、既にあるものはそのまま返す。 */
  const cur=WL.columnLayout.get(target);
  try{
   await WL.columnLayout.save(target,{
    order:lp.rows.map(r=>r.key),
    hidden:lp.rows.filter(r=>!r.on).map(r=>r.key),
    widths,names,
    formats:cur.formats,rules:cur.rules,formulas:cur.formulas,locks:cur.locks,
   });
   showToast&&showToast('紙のレイアウトを保存しました',`${on.length}列（${lp.equipment}）`,2800);
   const after=lp.onSaved;
   closeLayoutPanel();
   if(after)after();
  }catch(e){showToast&&showToast('保存に失敗しました',e.message,5000)}
 }

 window.WL=window.WL||{};
 WL.schedulePrint={open,buildPages,splitToSheets,pageHtml,
                   paperCatalog,paperColumns,openLayoutPanel,
                   /* 書き込む欄のパターン(§9.191)。名前と並びは画面の文言と
                      同じものを1箇所から出す（テストも同じ表を見る）。 */
                   writePatterns:()=>WRITE_PATTERNS.map(p=>({...p})),
                   /* プレビューは**中身を見て確かめられる**ようにしておく
                      （テストが「何枚になったか」を画面から読むため）。 */
                   openPreview,closePreview,previewSheets:()=>pv.sheets.slice()};
})();
