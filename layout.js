'use strict';
const L=LayoutCore, pc=$('photo'),px=pc.getContext('2d');
let project=L.defaults(), selection=new Set(), history=[],future=[],backgroundImage=null,layoutReady=false,layoutInit=null,photoDrag=null,marquee=null,panMode=false,libraryMode=false,restoreTicket=0;
let saveTimer=null,saveChain=Promise.resolve(),saveRevision=0,savedRevision=0,exporting=false;
const previewCache=new Map();
const assetFor=p=>assets.find(a=>a.id===p.id&&a.status==='ready');
const dims=p=>L.dimensions(p,assetFor(p),project.ratio);
const selectedPeople=()=>project.people.filter(p=>selection.has(p.uid));
const editingPeople=()=>selectedPeople().filter(p=>!p.locked);
const uid=()=>crypto.randomUUID();
function tell(s){$('layoutNotice').textContent=s;}
function snapshot(){return L.copy(project);}
function checkpoint(before=snapshot()){history.push(before);if(history.length>40)history.shift();future=[];}
function change(fn){if(exporting)return;const before=snapshot();try{fn();checkpoint(before);commit();}catch(e){project=before;tell(e.message);}}
function commit(){selection=new Set([...selection].filter(id=>project.people.some(p=>p.uid===id)));syncLayout();drawPhoto();scheduleSave();}
function scheduleSave(){
  saveRevision++;$('saveState').textContent='待保存…';clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{saveTimer=null;persist();},650);
}
function persist(){
  const value=snapshot(),revision=saveRevision;
  saveChain=saveChain.catch(()=>{}).then(async()=>{try{await api('/api/project',value);savedRevision=revision;if(savedRevision===saveRevision)$('saveState').textContent='已自动保存到本机';}catch(e){$('saveState').textContent='保存失败，请下载工程';tell(e.message);}});
  return saveChain;
}
function undoLayout(){if(!history.length||exporting)return;future.push(snapshot());project=history.pop();restoreScene();}
function redoLayout(){if(!future.length||exporting)return;history.push(snapshot());project=future.pop();restoreScene();}
async function restoreScene(){const ticket=++restoreTicket;try{const im=project.background?await image(project.background):null;if(ticket!==restoreTicket)return;backgroundImage=im;await loadPhotoImages();if(ticket===restoreTicket)commit();}catch(e){tell(e.message);}}
async function ensureLayout(){
  if(layoutReady)return;
  if(layoutInit)return layoutInit;
  layoutInit=(async()=>{try{const saved=await api('/api/project');if(saved)project=L.validate(saved);backgroundImage=project.background?await image(project.background):null;await loadPhotoImages();layoutReady=true;syncLayout();drawPhoto();$('saveState').textContent='草稿已读取';}catch(e){tell('草稿读取失败：'+e.message);layoutInit=null;throw e;}})();return layoutInit;
}
$('cutTab').onclick=()=>{$('cutPage').hidden=false;$('photoPage').hidden=true;$('cutTab').classList.add('active');$('photoTab').classList.remove('active');};
$('photoTab').onclick=async()=>{$('cutPage').hidden=true;$('photoPage').hidden=false;$('photoTab').classList.add('active');$('cutTab').classList.remove('active');try{await refresh();await ensureLayout();}catch(e){tell(e.message);}};
async function loadPhotoImages(){
  const needed=new Set(project.people.map(p=>p.id));
  for(const a of assets.filter(a=>a.status==='ready'&&needed.has(a.id))){
    const key=a.id+':'+a.updated;if(!previewCache.has(key)){
      const im=await image(`/asset/${a.id}/preview.png?v=${a.updated}`);
      for(const old of previewCache.keys())if(old.startsWith(a.id+':'))previewCache.delete(old);
      const preview=offscreen(im.width,im.height);preview.getContext('2d').drawImage(im,0,0);im.src='';previewCache.set(key,preview);
    }
  }
  for(const key of previewCache.keys())if(!needed.has(key.split(':')[0]))previewCache.delete(key);
  if(layoutReady){renderLayers();drawPhoto();}
}
function setValue(id,value){const e=$(id);if(document.activeElement!==e)e.value=value;}
function syncLayout(){
  if(![...$('ratio').options].some(option=>Number(option.value)===project.ratio))$('ratio').add(new Option(`自定义 ${project.ratio.toFixed(2)}:1`,String(project.ratio)));
  for(const id of ['areaWidth','areaTop','areaBottom'])setValue(id,Math.round(project[id]*100));$('labelFollow').checked=project.labelFollow;
  const map={preset:'preset',rowCustom:'rowCustom',rows:'rows',ratio:'ratio',photoColor:'color',backgroundMode:'backgroundMode',labelDirection:'direction',labelSize:'labelSize',labelColor:'labelColor',photoTitle:'title',photoSubtitle:'subtitle',titleY:'titleY',overlap:'overlap'};
  for(const [id,key]of Object.entries(map))setValue(id,project[key]);
  setValue('gap',Math.round(project.gap*100));setValue('horizontalOverlap',project.horizontalOverlap??.35);setValue('stagger',project.stagger??.6);setValue('bodyHeight',+((project.bodyHeight??.28)*100).toFixed(1));setValue('bgScale',project.bg.scale);setValue('bgX',project.bg.x);setValue('bgY',project.bg.y);$('labels').checked=project.labels;
  $('peopleCount').textContent=project.people.length+' 人';
  const chosen=selectedPeople();$('selectedCount').textContent=chosen.length;
  $('chosen').textContent=chosen.length===1?((chosen[0].label||assetFor(chosen[0])?.label||'缺失素材')+(chosen[0].locked?' · 已锁定':'')):chosen.length?`已选 ${chosen.length} 人，其中 ${chosen.filter(p=>p.locked).length} 人锁定`:'从画布或图层列表选择角色';
  $('selectionStatus').textContent=`${project.people.filter(p=>!p.hidden).length} 人可见 · 已选 ${chosen.length} 人`;
  const single=chosen.length===1?chosen[0]:null;
  $('calibrateBody').disabled=!single||single.locked;
  $('calibrationState').textContent=single&&((single.bodyTop??0)>0||(single.bodyBottom??1)<1)?'已校准：统一大小按人物身高计算。':'尚未校准：暂按图片可见范围计算，帽子或雨伞可能影响大小。';
  setValue('personSize',single?+(single.h*100).toFixed(1):'');
  const groups=positionRows(),ri=single?groups.findIndex(row=>row.some(p=>p.uid===single.uid)):-1,ci=ri<0?-1:groups[ri].findIndex(p=>p.uid===single.uid);
  setValue('positionRow',ri<0?'':ri+1);setValue('positionCol',ci<0?'':ci+1);for(const id of ['positionRow','positionCol','swapPosition'])$(id).disabled=!single||single.locked||single.hidden;
  $('positionHint').textContent=`${ri<0?'选中人物查看坐标':`当前：第 ${ri+1} 排、第 ${ci+1} 位`}；共 ${groups.length} 排，各排人数：${groups.map(g=>g.length).join('、')}。后排起，左侧起；坐标不导出。`;

  setValue('personLabel',single?(single.label||assetFor(single)?.label||''):'');
  setValue('labelX',single?+(single.lx*100).toFixed(1):0);setValue('labelY',single?+(single.ly*100).toFixed(1):0);
  for(const id of ['personSize','personLabel','labelX','labelY'])$(id).disabled=!single||single.locked;
  $('layoutUndo').disabled=!history.length;$('layoutRedo').disabled=!future.length;
  renderLayers();
}
function selectPerson(id,add=false){if(add){selection.has(id)?selection.delete(id):selection.add(id);}else selection=new Set(id?[id]:[]);syncLayout();drawPhoto();}
function renderLayers(){
  const list=$('layersList');list.replaceChildren();const term=$('searchPeople').value.trim().toLowerCase();
  if(libraryMode){
    for(const a of assets.filter(a=>a.status==='ready'&&(!term||(a.label+' '+a.name).toLowerCase().includes(term)))){
      const row=node('div','material-row'),im=node('img');im.src=`/asset/${a.id}/thumb.png?v=${a.updated}`;im.alt='';im.loading='lazy';
      const label=node('span','',a.label),add=node('button','','＋');add.title='加入合照：'+a.label;add.onclick=()=>addAsset(a);row.append(im,label,add);list.append(row);
    }
  }else{
    for(const p of [...project.people].reverse()){
      const a=assetFor(p),name=p.label||a?.label||'缺失素材';if(term&&!name.toLowerCase().includes(term))continue;
      const row=node('div','material-row'+(selection.has(p.uid)?' selected':'')),im=node('img');
      if(a)im.src=`/asset/${a.id}/thumb.png?v=${a.updated}`;im.alt='';im.loading='lazy';
      const pick=node('button','layer-pick',name+(p.locked?' 🔒':''));pick.title=name;pick.onclick=e=>selectPerson(p.uid,e.shiftKey||e.ctrlKey||e.metaKey);
      const eye=node('button','icon',p.hidden?'○':'●');eye.title=p.hidden?'显示角色':'隐藏角色';eye.onclick=()=>change(()=>p.hidden=!p.hidden);
      row.append(im,pick,eye);list.append(row);
    }
  }
  if(!list.children.length)list.append(node('p','side-note',libraryMode?'还没有可用素材，请先导入透明 PNG 或完成抠图。':'画布为空。可载入五人示例，或从素材库加入角色。'));
}
function addAsset(a){
  if(project.people.length>=500){tell('当前工程最多 500 个角色');return;}
  change(()=>{const p={uid:uid(),id:a.id,x:.4,y:.35,h:.5,label:'',locked:false,hidden:false,lx:0,ly:0};L.fit(p,a,project.ratio);project.people.push(p);selection=new Set([p.uid]);});loadPhotoImages().catch(e=>tell(e.message));
}
$('layersTab').onclick=()=>{libraryMode=false;$('layersTab').classList.add('active');$('libraryTab').classList.remove('active');renderLayers();};
$('libraryTab').onclick=()=>{libraryMode=true;$('libraryTab').classList.add('active');$('layersTab').classList.remove('active');renderLayers();};
$('searchPeople').oninput=renderLayers;
$('selectAll').onclick=()=>{selection=new Set(project.people.map(p=>p.uid));syncLayout();drawPhoto();};
$('deselectAll').onclick=()=>selectPerson('');
$('layoutFiles').onchange=async e=>{
 if(importBusy){tell('上一批仍在导入，请等待完成。');e.target.value='';return;}
 importBusy=true;const files=[...e.target.files],rows=[];
 try{for(const [i,f] of files.entries()){
  tell(`正在导入 ${i+1}/${files.length}：${f.name}`);
  try{if(f.size>20*1024*1024)throw Error('超过 20MB');const a=await api('/api/upload',{name:f.name,image:await readFile(f),engine:'anime'});await refresh();if(a.status==='ready'){addAsset(a);rows.push({name:f.name,status:'已加入画布'});}else rows.push({name:f.name,status:'已接收，未加入画布',reason:'图片没有透明背景，已进入抠图队列；完成后请从素材库添加'});}
  catch(error){rows.push({name:f.name,status:'导入失败',reason:error.message});}
 }await loadPhotoImages();tell(`选中 ${files.length} 张；加入画布 ${rows.filter(r=>r.status==='已加入画布').length} 张。详见导入结果。`);importReport(rows);}finally{importBusy=false;e.target.value='';}
};
$('loadFive').onclick=async()=>{try{await ensureLayout();const demo=await api('/api/demo');await refresh();if(!demo?.ids?.length)throw Error('未找到五人示例素材');
  change(()=>{project=L.defaults();project.preset='line';project.rows=1;project.gap=0;project.direction='horizontal';project.title='我们的魔法合照';project.subtitle='五位巫师 · 站在同一个故事里';project.people=demo.ids.map(id=>({uid:uid(),id,x:0,y:0,h:.5,label:'',locked:false,hidden:false,lx:0,ly:0}));project.people=L.arrange(project,assetFor);selection.clear();backgroundImage=null;});
  await loadPhotoImages();tell('已载入这次抠好的五位角色；显示名称是素材名称，可在 ID 标签中改成游戏 ID。');}catch(e){tell(e.message);}};

function stageBackground(ctx,w,h){
  if(project.backgroundMode==='transparent')ctx.clearRect(0,0,w,h);
  else if(project.backgroundMode==='solid'){ctx.fillStyle=project.color;ctx.fillRect(0,0,w,h);}
  else{
    const g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,'#102d2a');g.addColorStop(.5,project.color);g.addColorStop(1,'#0c2420');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    const light=ctx.createRadialGradient(w*.5,h*.1,0,w*.5,h*.1,w*.75);light.addColorStop(0,'#ceb8863b');light.addColorStop(1,'#ccb67c00');ctx.fillStyle=light;ctx.fillRect(0,0,w,h);
    ctx.strokeStyle='#ddc99b55';ctx.lineWidth=w/1000;ctx.strokeRect(w*.023,h*.035,w*.954,h*.93);
    ctx.strokeStyle='#ddc99b22';ctx.strokeRect(w*.03,h*.048,w*.94,h*.904);
  }
  if(backgroundImage){const scale=Math.max(w/backgroundImage.width,h/backgroundImage.height)*project.bg.scale;const bw=backgroundImage.width*scale,bh=backgroundImage.height*scale;ctx.drawImage(backgroundImage,(w-bw)*project.bg.x,(h-bh)*project.bg.y,bw,bh);}
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#f2e4c1';ctx.shadowColor='#13271e';ctx.shadowBlur=w/300;
  if(project.title){ctx.font=`500 ${w*.035}px "Microsoft YaHei",sans-serif`;ctx.fillText(project.title,w*.5,h*project.titleY,w*.87);}
  if(project.subtitle){ctx.font=`${w*.011}px "Microsoft YaHei",sans-serif`;ctx.fillStyle='#d9d4bb';ctx.fillText(project.subtitle,w*.5,h*project.titleY+w*.035,w*.85);}
  ctx.shadowBlur=0;
}
function drawPerson(ctx,p,im,w,h){
  const a=assetFor(p);if(!a||!im||p.hidden)return;const b=L.bounds(a),d=dims(p),scaleX=im.width/a.width,scaleY=im.height/a.height;
  ctx.drawImage(im,b[0]*scaleX,b[1]*scaleY,(b[2]-b[0])*scaleX,(b[3]-b[1])*scaleY,p.x*w,p.y*h,d.w*w,d.h*h);
}
let labelHitBoxes=[];
function drawLabels(ctx,w,h){
  if(ctx===px)labelHitBoxes=[];
  if(!project.labels)return;const baseFs=project.labelSize*w/1600;ctx.font=`600 ${baseFs}px "Microsoft YaHei",sans-serif`;ctx.lineJoin='round';ctx.lineWidth=Math.max(1,w/1200);ctx.strokeStyle='#10251ded';ctx.fillStyle=project.labelColor;ctx.textBaseline='middle';
  for(const p of project.people){const a=assetFor(p);if(!a||p.hidden)continue;const text=p.label||a.label,d=dims(p),fs=baseFs*(project.labelFollow?L.clamp(p.h*L.bodySpan(p)/.4,.25,1.5):1);ctx.font=`600 ${fs}px sans-serif`;let x,y;
    if(project.direction==='vertical'){
      const chars=Array.from(text),step=fs*1.17;ctx.textAlign='left';x=L.clamp((p.x+d.w*.9+p.lx)*w,fs,w-fs*1.3);y=L.clamp((p.y+p.h*.18+p.ly)*h,fs,Math.max(fs,h-chars.length*step));
      if(ctx===px)labelHitBoxes.push({uid:p.uid,x:x/w,y:(y-fs*.6)/h,w:Math.max(fs,...chars.map(ch=>ctx.measureText(ch).width))/w,h:Math.max(fs,chars.length*step)/h});
      for(const ch of chars){if(y>h-fs/2)break;ctx.strokeText(ch,x,y);ctx.fillText(ch,x,y);y+=step;}
    }else{ctx.textAlign='center';x=(p.x+d.w/2+p.lx)*w;const half=ctx.measureText(text).width/2;x=L.clamp(x,Math.min(half+6,w/2),Math.max(w-half-6,w/2));y=L.clamp((p.y+p.h+p.ly)*h+fs*1.2,fs,h-fs);if(ctx===px)labelHitBoxes.push({uid:p.uid,x:(x-Math.min(half,w*.45))/w,y:(y-fs*.65)/h,w:Math.min(half*2,w*.9)/w,h:fs*1.3/h});ctx.strokeText(text,x,y,w*.9);ctx.fillText(text,x,y,w*.9);}
  }
}
function drawPhoto(){
  const w=1600,h=Math.round(w/project.ratio);if(pc.width!==w||pc.height!==h){pc.width=w;pc.height=h;}
  stageBackground(px,w,h);
  for(const p of project.people){const a=assetFor(p);drawPerson(px,p,a?previewCache.get(a.id+':'+a.updated):null,w,h);}
  drawLabels(px,w,h);
  if($('showGuides').checked){px.save();px.strokeStyle='#e5d9b766';px.lineWidth=1;px.setLineDash([8,9]);px.beginPath();px.moveTo(w/2,0);px.lineTo(w/2,h);px.moveTo(0,h*.91);px.lineTo(w,h*.91);px.stroke();if(project.preset==='wings'&&project.gap){px.strokeRect(w*(.5-project.gap/2),h*.23,w*project.gap,h*.65);}px.restore();}
  for(const p of selectedPeople()){const d=dims(p);px.strokeStyle=p.locked?'#98acbb':'#f4c66b';px.lineWidth=2;px.strokeRect(p.x*w,p.y*h,d.w*w,p.h*h);}
  if(marquee){px.fillStyle='#eac67720';px.strokeStyle='#f4c66b';px.lineWidth=2;px.fillRect(marquee.x*w,marquee.y*h,(marquee.end.x-marquee.x)*w,(marquee.end.y-marquee.y)*h);px.strokeRect(marquee.x*w,marquee.y*h,(marquee.end.x-marquee.x)*w,(marquee.end.y-marquee.y)*h);}
  resizeCanvas();
}
function resizeCanvas(){const viewport=$('canvasViewport');const width=Math.max(300,viewport.clientWidth-44)*Number($('canvasZoom').value);$('canvasSizer').style.width=Math.max(width+44,viewport.clientWidth)+'px';pc.style.width=width+'px';pc.style.height=(width/project.ratio)+'px';}
$('canvasZoom').onchange=resizeCanvas;$('showGuides').onchange=drawPhoto;new ResizeObserver(resizeCanvas).observe($('canvasViewport'));
const normalized=e=>{const p=point(e,pc);return {x:p.x/pc.width,y:p.y/pc.height};};
pc.onpointerdown=e=>{
  if(exporting)return;pc.setPointerCapture(e.pointerId);const q=normalized(e);
  if(panMode||e.button===1){photoDrag={mode:'pan',clientX:e.clientX,clientY:e.clientY,left:$('canvasViewport').scrollLeft,top:$('canvasViewport').scrollTop};return;}
  const labelHit=[...labelHitBoxes].reverse().find(b=>q.x>=b.x&&q.x<=b.x+b.w&&q.y>=b.y&&q.y<=b.y+b.h);
  if(labelHit){const p=project.people.find(p=>p.uid===labelHit.uid);selectPerson(p.uid);if(!p.locked)photoDrag={mode:'label',uid:p.uid,start:q,before:snapshot(),moved:false};return;}
  const hit=[...project.people].reverse().find(p=>{if(p.hidden)return false;const d=dims(p);if(!(q.x>=p.x&&q.x<=p.x+d.w&&q.y>=p.y&&q.y<=p.y+p.h))return false;const a=assetFor(p),im=a&&previewCache.get(a.id+':'+a.updated);if(!im)return true;const b=L.bounds(a);const x=(b[0]+(q.x-p.x)/d.w*(b[2]-b[0]))*im.width/a.width,y=(b[1]+(q.y-p.y)/p.h*(b[3]-b[1]))*im.height/a.height;try{return im.getContext('2d').getImageData(Math.floor(x),Math.floor(y),1,1).data[3]>16;}catch(_){return true;}});
  if(hit){if(e.shiftKey||e.ctrlKey||e.metaKey){selectPerson(hit.uid,true);return;}if(!selection.has(hit.uid))selectPerson(hit.uid);photoDrag={mode:'people',start:q,before:snapshot(),moved:false};}
  else{const keep=e.shiftKey?new Set(selection):new Set();selection=keep;marquee={...q,end:q,keep};syncLayout();drawPhoto();}
};
pc.onpointermove=e=>{
  if(photoDrag?.mode==='pan'){$('canvasViewport').scrollLeft=photoDrag.left-(e.clientX-photoDrag.clientX);$('canvasViewport').scrollTop=photoDrag.top-(e.clientY-photoDrag.clientY);return;}
  const q=normalized(e);
  if(photoDrag?.mode==='label'){
    project=L.copy(photoDrag.before);const p=project.people.find(p=>p.uid===photoDrag.uid);p.lx=L.clamp(p.lx+q.x-photoDrag.start.x,-1,1);p.ly=L.clamp(p.ly+q.y-photoDrag.start.y,-1,1);photoDrag.moved=true;drawPhoto();
  }else if(photoDrag?.mode==='people'){
    project=L.copy(photoDrag.before);L.moveGroup(editingPeople(),q.x-photoDrag.start.x,q.y-photoDrag.start.y,assetFor,project.ratio);photoDrag.moved=true;drawPhoto();
  }else if(marquee){marquee.end=q;drawPhoto();}
};
function finishPointer(cancel=false){
  if(['people','label'].includes(photoDrag?.mode)){if(cancel)project=photoDrag.before;else if(photoDrag.moved){checkpoint(photoDrag.before);commit();}}
  if(marquee&&!cancel){const l=Math.min(marquee.x,marquee.end.x),r=Math.max(marquee.x,marquee.end.x),t=Math.min(marquee.y,marquee.end.y),b=Math.max(marquee.y,marquee.end.y);selection=new Set(marquee.keep);for(const p of project.people){const d=dims(p);if(!p.hidden&&p.x<r&&p.x+d.w>l&&p.y<b&&p.y+p.h>t)selection.add(p.uid);}}
  photoDrag=null;marquee=null;syncLayout();drawPhoto();
}
pc.onpointerup=()=>finishPointer();pc.onpointercancel=()=>finishPointer(true);
$('selectMode').onclick=()=>{panMode=false;$('selectMode').classList.add('active');$('panMode').classList.remove('active');pc.style.cursor='default';};
$('panMode').onclick=()=>{panMode=true;$('panMode').classList.add('active');$('selectMode').classList.remove('active');pc.style.cursor='grab';};
$('layoutUndo').onclick=undoLayout;$('layoutRedo').onclick=redoLayout;

$('arrange').onclick=()=>change(()=>{
  const people=project.people.filter(p=>!p.locked&&!p.hidden);if(!people.length)throw Error('请先加入未锁定的角色');
  const config={...project,areaWidth:Number($('areaWidth').value)/100,areaTop:Number($('areaTop').value)/100,areaBottom:Number($('areaBottom').value)/100,preset:$('preset').value,rows:Number($('rows').value)||1,gap:Number($('gap').value)/100,overlap:Number($('overlap').value),bodyHeight:L.clamp(Number($('bodyHeight').value)/100,.025,.8),horizontalOverlap:Number($('horizontalOverlap').value),stagger:Number($('stagger').value)};
  if(config.areaWidth<.3||config.areaWidth>.96||config.areaTop<0||config.areaBottom>1||config.areaBottom-config.areaTop<.15)throw Error('排版区域至少保留 15% 高度，宽度为 30～96%');
  config.rows=L.clamp(Math.round(config.rows),1,20);config.gap=L.clamp(config.gap,0,.5);config.overlap=L.clamp(config.overlap,0,.75);
  if(config.preset==='line')config.rows=1;
  if(!['wings','crowd'].includes(config.preset))config.gap=0;
  const arranged=L.arrange({...config,people},assetFor,$('rowCustom').value);const index=new Map(arranged.map(p=>[p.uid,p]));
  Object.assign(project,{areaWidth:config.areaWidth,areaTop:config.areaTop,areaBottom:config.areaBottom,preset:config.preset,rows:config.rows,gap:config.gap,overlap:config.overlap,bodyHeight:config.bodyHeight,horizontalOverlap:config.horizontalOverlap,stagger:config.stagger,rowCustom:$('rowCustom').value});project.people=project.people.map(p=>index.get(p.uid)||p);tell('已应用站位。身体可以重叠，请放大检查脸部和 ID；当前不自动识别人脸遮挡。');
});
for(const [id,scope]of [['normalizeAll','all'],['normalizeSelected','selected']])$(id).onclick=()=>change(()=>{
  const items=(scope==='all'?project.people: selectedPeople()).filter(p=>!p.locked&&!p.hidden);if(!items.length)throw Error('没有可调整的未锁定角色');
  project.bodyHeight=L.clamp(Number($('bodyHeight').value)/100||.28,.025,.8);const actual=L.uniformSize(items,project.bodyHeight,assetFor,project.ratio);tell(`已统一 ${items.length} 人，实际身高为画布的 ${(actual*100).toFixed(1)}%。`);
});
for(const [id,factor]of [['allSmaller',.95],['allLarger',1.05]])$(id).onclick=()=>change(()=>L.resizeInPlace(project.people.filter(p=>!p.hidden),factor,assetFor,project.ratio));
function bindChange(id,fn){$(id).onchange=e=>change(()=>fn(e.target));}
bindChange('ratio',e=>{project.ratio=Number(e.value);project.people.forEach(p=>L.fit(p,assetFor(p),project.ratio));});
bindChange('photoColor',e=>project.color=e.value);bindChange('backgroundMode',e=>project.backgroundMode=e.value);
bindChange('labelFollow',e=>project.labelFollow=e.checked);
bindChange('labels',e=>project.labels=e.checked);bindChange('labelDirection',e=>project.direction=e.value);
bindChange('labelSize',e=>project.labelSize=L.clamp(Number(e.value)||17,8,40));bindChange('labelColor',e=>project.labelColor=e.value);
bindChange('photoTitle',e=>project.title=e.value);bindChange('photoSubtitle',e=>project.subtitle=e.value);bindChange('titleY',e=>project.titleY=Number(e.value));
bindChange('bgScale',e=>project.bg.scale=Number(e.value));bindChange('bgX',e=>project.bg.x=Number(e.value));bindChange('bgY',e=>project.bg.y=Number(e.value));
$('background').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>20*1024*1024)throw Error('背景不能超过 20MB');const data=await readFile(f),im=await image(data);change(()=>{project.background=data;project.bg={scale:1,x:.5,y:.5};backgroundImage=im;});}catch(e){tell(e.message);}e.target.value='';};
$('clearBackground').onclick=()=>change(()=>{project.background='';backgroundImage=null;});
bindChange('personSize',e=>{const p=editingPeople();if(p.length!==1)throw Error('请只选择一个未锁定角色');p[0].h=L.clamp(Number(e.value)/100,.025,.9);L.fit(p[0],assetFor(p[0]),project.ratio);});
for(const [id,factor]of [['smaller',.95],['larger',1.05]])$(id).onclick=()=>change(()=>L.scaleGroup(editingPeople(),factor,assetFor,project.ratio));
for(const [id,front]of [['front',true],['back',false]])$(id).onclick=()=>change(()=>{const moving=editingPeople(),other=project.people.filter(p=>!moving.includes(p));project.people=front?[...other,...moving]:[...moving,...other];});
$('lockPeople').onclick=()=>change(()=>selectedPeople().forEach(p=>p.locked=true));$('unlockPeople').onclick=()=>change(()=>selectedPeople().forEach(p=>p.locked=false));
$('removePerson').onclick=()=>change(()=>{project.people=project.people.filter(p=>!selection.has(p.uid)||p.locked);});
$('alignFeet').onclick=()=>change(()=>{const items=editingPeople();if(items.length<2)throw Error('请至少选择两名未锁定角色');const y=Math.max(...items.map(p=>p.y+p.h));items.forEach(p=>p.y=y-p.h);});
$('distribute').onclick=()=>change(()=>{const items=editingPeople().sort((a,b)=>a.x-b.x);if(items.length<3)throw Error('等距分布请至少选择三名未锁定角色');const first=items[0].x+dims(items[0]).w/2,last=items.at(-1).x+dims(items.at(-1)).w/2;items.forEach((p,i)=>{p.x=first+(last-first)*i/(items.length-1)-dims(p).w/2;L.fit(p,assetFor(p),project.ratio);});});
bindChange('personLabel',e=>{const p=editingPeople();if(p.length===1)p[0].label=e.value;});
bindChange('labelX',e=>{const p=editingPeople();if(p.length===1)p[0].lx=L.clamp(Number(e.value)/100,-1,1);});
bindChange('labelY',e=>{const p=editingPeople();if(p.length===1)p[0].ly=L.clamp(Number(e.value)/100,-1,1);});
document.addEventListener('keydown',e=>{
  if($('photoPage').hidden||$('editor').open||$('bodyCalibration').open||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redoLayout():undoLayout();return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();$('selectAll').click();return;}
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const d=(e.shiftKey?10:2)/1600;change(()=>L.moveGroup(editingPeople(),e.key==='ArrowLeft'?-d:e.key==='ArrowRight'?d:0,e.key==='ArrowUp'?-d*project.ratio:e.key==='ArrowDown'?d*project.ratio:0,assetFor,project.ratio));}
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();$('removePerson').click();}
});
$('exportPhoto').onclick=async()=>{
  if(exporting)return;exporting=true;$('exportPhoto').disabled=true;
  try{
    const visible=project.people.filter(p=>!p.hidden);if(!visible.length)throw Error('画布没有可见角色');if(visible.some(p=>!assetFor(p)))throw Error('有角色素材缺失，请恢复素材后再导出');
    const w=Number($('exportSize').value),h=Math.round(w/project.ratio);if(w*h>40e6)throw Error('当前比例下导出像素过大，请降低宽度');
    const canvas=offscreen(w,h),ctx=canvas.getContext('2d');stageBackground(ctx,w,h);
    for(let i=0;i<visible.length;i++){
      const p=visible[i],a=assetFor(p);tell(`正在导出 ${i+1}/${visible.length} 个角色…`);
      const im=await image(url(a));drawPerson(ctx,p,im,w,h);im.src='';await new Promise(resolve=>setTimeout(resolve,0));
    }
    drawLabels(ctx,w,h);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('导出失败，请降低尺寸');const u=URL.createObjectURL(blob);download(u,'合照.png');setTimeout(()=>URL.revokeObjectURL(u),15000);tell(`已导出 ${w} × ${h} PNG，包含 ${visible.length} 位角色。`);canvas.width=1;canvas.height=1;
  }catch(e){tell(e.message);}finally{exporting=false;$('exportPhoto').disabled=false;}
};
$('saveProject').onclick=()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(project)],{type:'application/json'}));download(u,'合照工程.json');setTimeout(()=>URL.revokeObjectURL(u),15000);clearTimeout(saveTimer);saveTimer=null;persist();};
$('project').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>35*1024*1024)throw Error('工程文件过大');const candidate=L.validate(JSON.parse(await f.text()));const im=candidate.background?await image(candidate.background):null;change(()=>{project=candidate;backgroundImage=im;selection.clear();});await loadPhotoImages();const missing=project.people.filter(p=>!assetFor(p));tell(missing.length?`${missing.length} 个素材缺失，需复制原工具的 data 目录，完整恢复后才能导出。`:'工程已打开，可以继续调整。');}catch(e){tell(e.message);}e.target.value='';};
window.addEventListener('beforeunload',e=>{if(savedRevision<saveRevision){e.preventDefault();e.returnValue='';}});
refresh();setInterval(refresh,3000);

$('recommendCrowd').onclick=()=>change(()=>{
 const people=project.people.filter(p=>!p.hidden&&!p.locked);if(!people.length)throw Error('请先加入角色');
 let best=null;
 for(let rows=1;rows<=Math.min(12,people.length);rows++){
  try{const config={...project,preset:'roomy',people,rows,gap:0,overlap:.55,horizontalOverlap:.12,stagger:.8};const arranged=L.arrange(config,assetFor,'');const score=Math.min(...arranged.map(p=>p.h*L.bodySpan(p)));if(!best||score>best.score)best={rows,score};}catch(_){}
 }
 if(!best)throw Error('当前区域无法容纳这些人物，请增大区域');
 Object.assign(project,{preset:'roomy',rows:best.rows,gap:0,overlap:.55,horizontalOverlap:.12,stagger:.8,rowCustom:'',direction:'horizontal',labelFollow:true,labelSize:14});
 tell(`推荐 ${best.rows} 排，横向小字标签。可修改参数后点击“应用自动站位”；本按钮不移动人物。`);
});

function positionSlots(){
 return project.people.filter(p=>!p.hidden).slice().sort((a,b)=>{
  const ar=Number.isFinite(a.row)?a.row:Math.round((a.y+a.h)*20),br=Number.isFinite(b.row)?b.row:Math.round((b.y+b.h)*20);
  return ar-br||a.x-b.x||a.uid.localeCompare(b.uid);
 });
}
$('swapPosition').onclick=()=>{
 const rowNumber=Number($('positionRow').value),colNumber=Number($('positionCol').value);
 change(()=>{
  const selected=selectedPeople();if(selected.length!==1)throw Error('请先选中一个人物');
  const source=selected[0],groups=positionRows();
  if(!Number.isInteger(rowNumber)||!Number.isInteger(colNumber)||!groups[rowNumber-1]?.[colNumber-1])throw Error('目标排、位不存在，请参考各排人数');
  const target=groups[rowNumber-1][colNumber-1];if(source.hidden||source.locked||target.locked)throw Error('请先解锁参与交换的两个人物');
  if(source===target)return;
  const anchor=p=>({cx:p.x+dims(p).w/2,foot:p.y+p.h*L.bodyBottom(p),row:p.row});
  const from=anchor(source),to=anchor(target);
  for(const [p,a]of [[source,to],[target,from]]){p.x=a.cx-dims(p).w/2;p.y=a.foot-p.h*L.bodyBottom(p);if(a.row===undefined)delete p.row;else p.row=a.row;L.fit(p,assetFor(p),project.ratio);}
  tell(`已与 第 ${rowNumber} 排、第 ${colNumber} 位交换位置，保留各自大小、ID 和标签偏移。可撤销。`);
 });
};
for(const id of ['positionRow','positionCol'])$(id).onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('swapPosition').click();}};

function positionRows(){
 const groups=new Map();for(const p of positionSlots()){const key=Number.isFinite(p.row)?p.row:Math.round((p.y+p.h)*20);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}return [...groups.values()];
}
