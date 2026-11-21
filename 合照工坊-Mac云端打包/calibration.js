'use strict';
let calibrationAssetId='',calibrationImage=null,calibrationTop=null,calibrationBottom=null,calibrationStep=0;
const calibrationCanvas=$('calibrationCanvas'),calibrationContext=calibrationCanvas.getContext('2d');
function drawCalibration(){
  if(!calibrationImage)return;const ctx=calibrationContext,w=calibrationCanvas.width,h=calibrationCanvas.height;ctx.clearRect(0,0,w,h);ctx.drawImage(calibrationImage,0,0);
  for(const [value,color,title]of [[calibrationTop,'#f3bb4b','头顶'],[calibrationBottom,'#53d3be','脚底']])if(value!==null){ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,value*h);ctx.lineTo(w,value*h);ctx.stroke();ctx.fillStyle=color;ctx.font='13px sans-serif';ctx.fillText(title,5,Math.max(15,value*h-5));}
}
$('calibrateBody').onclick=()=>{
  const item=selectedPeople();if(item.length!==1||item[0].locked)return;const a=assetFor(item[0]);if(!a)return;
  const preview=previewCache.get(a.id+':'+a.updated);if(!preview){tell('图片仍在加载，请稍后重试');return;}
  const b=L.bounds(a),sx=preview.width/a.width,sy=preview.height/a.height;calibrationCanvas.width=Math.max(1,Math.round((b[2]-b[0])*sx));calibrationCanvas.height=Math.max(1,Math.round((b[3]-b[1])*sy));
  calibrationImage=offscreen(calibrationCanvas.width,calibrationCanvas.height);calibrationImage.getContext('2d').drawImage(preview,b[0]*sx,b[1]*sy,(b[2]-b[0])*sx,(b[3]-b[1])*sy,0,0,calibrationImage.width,calibrationImage.height);
  calibrationAssetId=a.id;calibrationTop=null;calibrationBottom=null;calibrationStep=0;$('saveCalibration').disabled=true;$('calibrationHint').textContent='先点人物头顶（不含帽子、雨伞），再点脚底。';$('bodyCalibration').showModal();drawCalibration();
};
calibrationCanvas.onclick=e=>{
  const box=calibrationCanvas.getBoundingClientRect(),value=L.clamp((e.clientY-box.top)/box.height,0,1);
  if(calibrationStep===0){calibrationTop=value;calibrationBottom=null;calibrationStep=1;$('calibrationHint').textContent='现在点人物脚底。';}
  else if(value<(calibrationTop??0)+.2){$('calibrationHint').textContent='脚底需要在头顶下方，请重新点脚底。';return;}
  else{calibrationBottom=value;$('saveCalibration').disabled=false;$('calibrationHint').textContent='两条线之间为人物身高；保存后再点“统一身高”。';}
  drawCalibration();
};
$('resetCalibration').onclick=()=>{calibrationTop=null;calibrationBottom=null;calibrationStep=0;$('saveCalibration').disabled=true;$('calibrationHint').textContent='先点人物头顶，再点脚底。';drawCalibration();};
$('closeCalibration').onclick=()=>$('bodyCalibration').close();
$('saveCalibration').onclick=()=>{if(calibrationTop===null||calibrationBottom===null)return;change(()=>project.people.filter(p=>p.id===calibrationAssetId&&!p.locked).forEach(p=>{p.bodyTop=calibrationTop;p.bodyBottom=calibrationBottom;}));$('bodyCalibration').close();};
