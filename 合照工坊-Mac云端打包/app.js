'use strict';
const $ = id => document.getElementById(id);
let assets = [], bg = 'checker', current = null, pollBusy = false;
const imageCache = new Map();
const pendingLabels = new Map();
const statusNames = {queued:'等待处理',processing:'AI 正在抠图',ready:'可检查 / 可导出',failed:'处理失败'};
async function api(path, body) {
  const r = await fetch(path, body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {});
  const data = await r.json();
  if (!r.ok) throw Error(data.error || '请求失败');
  return data;
}
function notice(message) {$('notice').textContent = message;}
function url(a, kind='result') {return `/asset/${a.id}/${kind}.png?v=${a.updated}`;}
function image(src) {return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('图片加载失败'));im.src=src;});}
function readFile(file) {return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('文件读取失败'));r.readAsDataURL(file);});}
function download(href, filename) {const a=document.createElement('a');a.href=href;a.download=filename;document.body.append(a);a.click();a.remove();}
function node(tag, cls, text) {const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
async function refresh() {
  if(pollBusy)return;pollBusy=true;
  try {
    const next=await api('/api/assets');
    const changed=JSON.stringify(next)!==JSON.stringify(assets);
    assets=next;
    if(changed){render();if(!$('photoPage').hidden)await loadPhotoImages();}
    const h=await api('/api/health');
    $('sample').hidden=h.sample===false;
    $('loadFive').hidden=h.demo===false;
    $('engine').textContent=h.model ? `${h.engine} · 模型已就绪` : '模型未安装，请运行 setup_model.py';
    if($('notice').textContent.startsWith('本地服务未连接'))notice('本地服务已连接，可以继续操作。');
  } catch(e){notice('本地服务未连接：'+e.message);} finally{pollBusy=false;}
}
function render() {
  $('grid').replaceChildren();$('drop').hidden=assets.length>0;
  const done=assets.filter(a=>a.status==='ready').length;
  $('stats').textContent=`${assets.length} 个角色 · ${done} 个已完成`;
  for(const a of assets) {
    const card=node('article','card'), views=node('div','images');
    for(const [kind,title] of [['source','原图'],['result','透明结果']]) {
      const pane=node('div',kind==='result'?bg:'');
      if(kind==='source'||a.status==='ready') {const im=node('img');im.src=url(a,kind);im.alt=a.name;pane.append(im);}
      else pane.append(node('span','status',statusNames[a.status]));
      pane.append(node('em','',title));views.append(pane);
    }
    const body=node('div','card-body'), input=node('input');input.value=pendingLabels.has(a.id)?pendingLabels.get(a.id):a.label;input.placeholder='填写游戏 ID';input.setAttribute('aria-label','角色 ID');
    input.oninput=()=>pendingLabels.set(a.id,input.value);
    const saveID=node('button','','保存 ID');
    saveID.onclick=async()=>{saveID.disabled=true;try{await api('/api/label',{id:a.id,label:input.value});pendingLabels.delete(a.id);notice('角色 ID 已保存。');await refresh();}catch(e){notice(e.message);}finally{saveID.disabled=false;}};
    const state=node('p','status'+(a.status==='failed'?' error':''),a.error||`${statusNames[a.status]}${a.seconds!==undefined?' · '+a.seconds+' 秒':''} · ${a.engine==='import'?'透明导入':a.engine==='anime'?'Anime':'BiRefNet'}`);
    const actions=node('div','card-actions'), edit=node('button','',a.status==='failed'?'框选重试':'检查 / 修边');
    edit.disabled=['queued','processing'].includes(a.status);edit.onclick=()=>openEditor(a).catch(e=>notice(e.message));actions.append(edit);
    if(!edit.disabled){const retry=node('button','','重新抠图');retry.onclick=async()=>{if(!confirm('使用当前选择的模型重新抠图？会覆盖这个角色的修边结果。'))return;try{await api('/api/retry',{id:a.id,engine:$('model').value});await refresh();}catch(e){notice(e.message);}};actions.append(retry);}
    if(a.status==='ready'){const save=node('a','button','↓ PNG');save.href=url(a);save.download=(a.label||'角色')+'.png';actions.append(save);}
    const idRow=node('div','id-row');idRow.append(input,saveID);body.append(idRow,state,actions);card.append(views,body);$('grid').append(card);
  }
}
async function upload(files) {
  let failed=0;
  for(let i=0;i<files.length;i++) {
    const f=files[i];notice(`正在导入 ${i+1}/${files.length}：${f.name}`);
    try{if(f.size>20*1024*1024)throw Error('超过 20MB');await api('/api/upload',{name:f.name,image:await readFile(f),engine:$('model').value});await refresh();}
    catch(e){failed++;notice(`${f.name}：${e.message}`);}
  }
  notice(`已导入 ${files.length-failed} 张${failed?'，失败 '+failed+' 张':''}。模型会逐张处理，可继续操作。`);
}
$('files').onchange=async e=>{await upload([...e.target.files]);e.target.value='';};
document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
document.addEventListener('drop',e=>{if(!e.dataTransfer.files.length)return;e.preventDefault();if(!$('cutPage').hidden)upload([...e.dataTransfer.files]);});
$('bg').onchange=e=>{bg=e.target.value;render();if(current)drawEditor();};
$('sample').onclick=async()=>{try{const r=await fetch('/sample.png');if(!r.ok)throw Error('示例不可用');await upload([new File([await r.blob()],'已有角色示例.png',{type:'image/png'})]);}catch(e){notice(e.message);}};

// Editing always works in original image coordinates; history is one snapshot per stroke.
let tool='inspect', original=null, mask=null, startMask=null, undo=[], stroke=null, dirty=false, editBusy=false;
const edit=$('editCanvas'), ec=edit.getContext('2d');
function offscreen(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function maskSnapshot(){return mask.getContext('2d').getImageData(0,0,mask.width,mask.height);}
function remember(){undo.push(maskSnapshot());const limit=Math.max(1,Math.min(10,Math.floor(64*1024*1024/(mask.width*mask.height*4))));while(undo.length>limit)undo.shift();}
async function openEditor(a) {
  if(current&&dirty&&!confirm('放弃尚未保存的修边？'))return;
  original=await image(url(a,'source'));mask=offscreen(original.width,original.height);
  const mc=mask.getContext('2d');mc.fillStyle='white';mc.fillRect(0,0,mask.width,mask.height);
  if(a.status==='ready')mc.drawImage(await image(url(a,'mask')),0,0);
  current=a;startMask=maskSnapshot();undo=[];dirty=false;stroke=null;
  edit.width=mask.width;edit.height=mask.height;$('zoom').value='1';
  $('editorTitle').textContent=a.label+' · 检查与修边';$('editor').showModal();setTool(a.status==='failed'?'crop':'inspect');resizeEditor();drawEditor();
}
function setTool(t){tool=t;document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));edit.style.cursor=t==='inspect'?'default':'crosshair';if(current)drawEditor();}
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
function resizeEditor(){if(!current)return;const fit=Math.min(($('editor').clientWidth-65)/edit.width,window.innerHeight*.58/edit.height,2);edit.style.width=edit.width*fit*Number($('zoom').value)+'px';edit.style.height=edit.height*fit*Number($('zoom').value)+'px';}
$('zoom').onchange=resizeEditor;
function drawEditor(){
  if(!original||!mask)return;
  const mc=mask.getContext('2d'), data=mc.getImageData(0,0,mask.width,mask.height);
  const alpha=offscreen(mask.width,mask.height),ac=alpha.getContext('2d');
  for(let i=0;i<data.data.length;i+=4)data.data[i+3]=data.data[i];
  ac.putImageData(data,0,0);ac.globalCompositeOperation='source-in';ac.drawImage(original,0,0);
  ec.clearRect(0,0,edit.width,edit.height);
  if(bg==='checker'){const size=Math.max(6,Math.round(edit.width/40));for(let y=0;y<edit.height;y+=size)for(let x=0;x<edit.width;x+=size){ec.fillStyle=((x/size+y/size)%2<1)?'#fff':'#dfe4dd';ec.fillRect(x,y,size,size);}}
  else {ec.fillStyle={white:'#fff',dark:'#26303a',green:'#63966e'}[bg];ec.fillRect(0,0,edit.width,edit.height);}
  if(tool==='crop'){ec.globalAlpha=.5;ec.drawImage(original,0,0);ec.globalAlpha=1;}
  ec.drawImage(alpha,0,0);
  if(stroke&&tool==='crop'){ec.strokeStyle='#f4aa31';ec.lineWidth=Math.max(2,edit.width/250);ec.strokeRect(stroke.x,stroke.y,stroke.last.x-stroke.x,stroke.last.y-stroke.y);}
}
function point(e,c=edit){const r=c.getBoundingClientRect();return {x:(e.clientX-r.left)*c.width/r.width,y:(e.clientY-r.top)*c.height/r.height};}
function brush(p,q){const ctx=mask.getContext('2d');ctx.strokeStyle=tool==='erase'?'black':'white';ctx.fillStyle=ctx.strokeStyle;ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=Number($('brush').value)*edit.width/edit.getBoundingClientRect().width;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();ctx.beginPath();ctx.arc(q.x,q.y,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();dirty=true;drawEditor();}
edit.onpointerdown=e=>{if(editBusy||tool==='inspect')return;edit.setPointerCapture(e.pointerId);const p=point(e);stroke={...p,last:p};if(tool!=='crop'){remember();brush(p,p);}};
edit.onpointermove=e=>{if(!stroke)return;const p=point(e);if(tool!=='crop')brush(stroke.last,p);stroke.last=p;if(tool==='crop')drawEditor();};
edit.onpointercancel=()=>{stroke=null;drawEditor();};
edit.onpointerup=async()=>{
  if(!stroke)return;const s=stroke;stroke=null;
  if(tool==='crop'){
    const box=[Math.round(Math.min(s.x,s.last.x)),Math.round(Math.min(s.y,s.last.y)),Math.round(Math.max(s.x,s.last.x)),Math.round(Math.max(s.y,s.last.y))];
    if(box[2]-box[0]<8||box[3]-box[1]<8){drawEditor();return;}
    if(!confirm('用框选区域重新抠图？这将替换当前蒙版。')){drawEditor();return;}
    editBusy=true;
    try{await api('/api/retry',{id:current.id,box,engine:$('model').value});dirty=false;current=null;$('editor').close();await refresh();notice('已加入框选重抠队列。框外会透明，请包含完整帽子、魔杖和衣摆。');}
    catch(e){alert(e.message);}finally{editBusy=false;}
  }
};
$('undo').onclick=()=>{if(undo.length){mask.getContext('2d').putImageData(undo.pop(),0,0);dirty=true;drawEditor();}};
$('resetMask').onclick=()=>{remember();mask.getContext('2d').putImageData(startMask,0,0);dirty=true;drawEditor();};
$('saveMask').onclick=async()=>{if(!current||editBusy)return;editBusy=true;$('saveMask').disabled=true;try{await api('/api/mask',{id:current.id,image:mask.toDataURL()});dirty=false;current=null;$('editor').close();await refresh();}catch(e){alert(e.message);}finally{editBusy=false;$('saveMask').disabled=false;}};
function closeEditor(){if(editBusy)return;if(dirty&&!confirm('放弃尚未保存的修边？'))return;dirty=false;current=null;$('editor').close();}
$('closeEditor').onclick=closeEditor;$('editor').addEventListener('cancel',e=>{e.preventDefault();closeEditor();});

