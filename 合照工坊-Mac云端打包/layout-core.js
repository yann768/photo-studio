/* Pure composition geometry shared by the editor and its regression checks. */
(function(root){
  'use strict';
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const defaults=()=>({version:2,ratio:16/9,color:'#243832',background:'',backgroundMode:'stage',bg:{scale:1,x:.5,y:.5},rows:3,gap:.18,overlap:.28,preset:'wings',rowCustom:'',bodyHeight:.28,horizontalOverlap:.35,stagger:.6,labels:true,direction:'vertical',labelSize:17,labelColor:'#ffffff',title:'社团合照',subtitle:'留下属于我们的魔法时刻',titleY:.13,people:[]});
  function copy(p){return {...p,bg:{...p.bg},people:p.people.map(x=>({...x}))};}
  function bounds(a){return a.bounds||[0,0,a.width,a.height];}
  function dimensions(p,a,ratio){if(!a)return {w:0,h:0};const b=bounds(a);return {h:p.h,w:p.h*(b[2]-b[0])/Math.max(1,b[3]-b[1])/ratio};}
  function fit(p,a,ratio){const d=dimensions(p,a,ratio);if(d.w>.96)p.h*=.96/d.w;p.h=clamp(p.h,.025,.9);const n=dimensions(p,a,ratio);p.x=clamp(p.x,0,1-n.w);p.y=clamp(p.y,0,1-n.h);return p;}
  function rowCounts(total,rows,custom){
    if(custom&&custom.trim()){
      if(!/^\d+(\s*[,，]\s*\d+)*$/.test(custom.trim()))throw Error('每排人数请填写类似 12,14,16 的数字');
      const counts=custom.split(/[,，]/).map(Number);
      if(counts.length>20||counts.some(n=>n<1)||counts.reduce((a,b)=>a+b,0)!==total)throw Error('每排人数相加必须等于当前角色数量');
      return counts;
    }
    rows=clamp(Math.round(rows)||1,1,Math.min(20,total));
    return Array.from({length:rows},(_,i)=>Math.floor(total/rows)+(i>=rows-total%rows?1:0));
  }
  const bodyTop=p=>p.bodyTop??0,bodyBottom=p=>p.bodyBottom??1;
  const bodySpan=p=>bodyBottom(p)-bodyTop(p);
  function uniformSize(people,height,lookup,ratio){
    const items=people.filter(p=>!p.locked);if(!items.length)throw Error('请先选择未锁定的人物');
    let actual=height;
    for(const p of items){const b=bounds(lookup(p)),span=bodySpan(p);actual=Math.min(actual,.9*span,.95*ratio*span*(b[3]-b[1])/(b[2]-b[0]));}
    for(const p of items){const d=dimensions(p,lookup(p),ratio),cx=p.x+d.w/2,foot=p.y+p.h*bodyBottom(p);p.h=actual/bodySpan(p);p.x=cx-dimensions(p,lookup(p),ratio).w/2;p.y=foot-p.h*bodyBottom(p);fit(p,lookup(p),ratio);}
    return actual;
  }
  function resizeInPlace(people,factor,lookup,ratio){
    const items=people.filter(p=>!p.locked);if(!items.length)throw Error('没有可调整的未锁定人物');
    factor=Math.min(factor,...items.map(p=>.9/p.h),...items.map(p=>.95/Math.max(.001,dimensions(p,lookup(p),ratio).w)));
    factor=Math.max(factor,...items.map(p=>.025/p.h));
    for(const p of items){const d=dimensions(p,lookup(p),ratio),cx=p.x+d.w/2,foot=p.y+p.h*bodyBottom(p);p.h*=factor;p.x=cx-dimensions(p,lookup(p),ratio).w/2;p.y=foot-p.h*bodyBottom(p);fit(p,lookup(p),ratio);}
  }
  function crowd(project,lookup,custom){
    const free=project.people.filter(p=>!p.locked),counts=rowCounts(free.length,project.rows,custom),rows=counts.length;
    const overlap=clamp(project.overlap,0,.78),horizontal=clamp(project.horizontalOverlap??.35,0,.65),gap=clamp(project.gap,0,.45);
    const stagger=clamp(project.stagger??.6,0,1),segments=[];let cursor=0;
    const widthFactor=p=>{const b=bounds(lookup(p));return (b[2]-b[0])/(b[3]-b[1])/project.ratio/bodySpan(p);};
    const coefficient=group=>group.length?widthFactor(group[0])/2+group.slice(1).reduce((sum,p,i)=>sum+(widthFactor(group[i])+widthFactor(p))/2*(1-horizontal),0)+widthFactor(group.at(-1))/2:0;
    let top=1,bottom=0,height=project.bodyHeight??.28;
    for(const p of free){top=Math.max(top,bodyBottom(p)/bodySpan(p));bottom=Math.max(bottom,(1-bodyBottom(p))/bodySpan(p));height=Math.min(height,.9*bodySpan(p));}
    height=Math.min(height,.68/(top+bottom+(rows-1)*(1-overlap)));
    for(let row=0;row<rows;row++){
      const items=free.slice(cursor,cursor+counts[row]);cursor+=counts[row];
      const groups=gap?[items.slice(0,Math.ceil(items.length/2)),items.slice(Math.ceil(items.length/2))]:[items];
      for(let side=0;side<groups.length;side++){
        const group=groups[side];if(!group.length)continue;
        const lo=gap?(side===0?.04:.5+gap/2):.04,hi=gap?(side===0?.5-gap/2:.96):.96;
        const factor=coefficient(group),avg=group.reduce((s,p)=>s+widthFactor(p),0)/group.length;
        height=Math.min(height,(hi-lo)/(factor+avg*stagger*.5));segments.push({row,group,lo,hi,factor,avg});
      }
    }
    if(height<.025)throw Error('当前人数与画布过密，请增加排数、减少中央留空或放宽画布');
    const positioned=new Map();
    for(const s of segments){
      const shift=(s.row%2?.5:-.5)*stagger*s.avg*height*(1-horizontal),used=s.factor*height;
      let left=clamp((s.lo+s.hi-used)/2+shift,s.lo,s.hi-used),previousWidth=0,center=0;
      const baseline=.92-bottom*height-(rows-1-s.row)*height*(1-overlap);
      s.group.forEach((original,i)=>{const p={...original},w=widthFactor(p)*height;if(i===0)center=left+w/2;else center+=(previousWidth+w)/2*(1-horizontal);p.h=height/bodySpan(p);p.x=center-w/2;p.y=baseline-p.h*bodyBottom(p);p.row=s.row;fit(p,lookup(p),project.ratio);positioned.set(p.uid,p);previousWidth=w;});
    }
    return project.people.map(p=>p.locked?p:positioned.get(p.uid));
  }
  function arrange(project,lookup,custom){
    const locked=project.people.filter(p=>p.locked),free=project.people.filter(p=>!p.locked);
    if(!free.length)throw Error('没有可排版的角色，请先加入素材或解锁人物');
    if(free.some(p=>!lookup(p)))throw Error('有角色素材缺失，请先恢复对应素材');
    if(project.preset==='crowd')return crowd(project,lookup,custom);
    const preset=project.preset,counts=rowCounts(free.length,preset==='line'?1:project.rows,custom),rows=counts.length;
    const overlap=clamp(project.overlap,0,.75),gap=preset==='wings'?clamp(project.gap,0,.5):0;
    let cursor=0;const arranged=[];
    // Row spacing is based on shared scale; each row is centered independently.
    const maxHeight=Math.min(.73,.67/(1+(rows-1)*(1-overlap)));
    for(let row=0;row<rows;row++){
      const people=free.slice(cursor,cursor+counts[row]).map(p=>({...p}));cursor+=counts[row];
      const factors=people.map(p=>{const b=bounds(lookup(p));return (b[2]-b[0])/(b[3]-b[1])/project.ratio;});
      const gutters=Math.min(.014,.18/people.length);
      const available=.91-gap-gutters*(people.length-1);
      const height=Math.min(maxHeight,available/Math.max(.001,factors.reduce((a,b)=>a+b,0)));
      const widths=factors.map(f=>f*height),used=widths.reduce((a,b)=>a+b,0)+gutters*(people.length-1)+gap;
      let x=(1-used)/2;
      const baseline=.91-(rows-1-row)*maxHeight*(1-overlap);
      people.forEach((p,i)=>{
        if(gap&&i===Math.ceil(people.length/2))x+=gap;
        const arc=preset==='arc'?Math.sin((i+.5)/people.length*Math.PI)*height*.17:0;
        p.h=height;p.x=x;p.y=baseline-height-arc;p.row=row;
        arranged.push(fit(p,lookup(p),project.ratio));x+=widths[i]+gutters;
      });
    }
    // Locked characters retain their original coordinates and relative layer slots.
    const byUID=new Map(arranged.map(p=>[p.uid,p]));
    return project.people.map(p=>p.locked?p:byUID.get(p.uid));
  }
  function moveGroup(people,dx,dy,lookup,ratio){
    const unlocked=people.filter(p=>!p.locked);
    if(!unlocked.length)return;
    const left=Math.min(...unlocked.map(p=>p.x)),right=Math.max(...unlocked.map(p=>p.x+dimensions(p,lookup(p),ratio).w));
    const top=Math.min(...unlocked.map(p=>p.y)),bottom=Math.max(...unlocked.map(p=>p.y+p.h));
    dx=clamp(dx,-left,1-right);dy=clamp(dy,-top,1-bottom);
    unlocked.forEach(p=>{p.x+=dx;p.y+=dy;});
  }
  function scaleGroup(people,factor,lookup,ratio){
    const items=people.filter(p=>!p.locked);if(!items.length)return;
    const left=Math.min(...items.map(p=>p.x)),right=Math.max(...items.map(p=>p.x+dimensions(p,lookup(p),ratio).w));
    const top=Math.min(...items.map(p=>p.y)),bottom=Math.max(...items.map(p=>p.y+p.h));
    factor=Math.max(.025/Math.min(...items.map(p=>p.h)),Math.min(factor,.9/Math.max(...items.map(p=>p.h)),1/Math.max(.001,right-left),1/Math.max(.001,bottom-top)));
    const cx=(left+right)/2,by=bottom;
    const changed=items.map(p=>({...p,x:cx+(p.x-cx)*factor,y:by+(p.y-by)*factor,h:p.h*factor}));
    const l=Math.min(...changed.map(p=>p.x)),r=Math.max(...changed.map(p=>p.x+dimensions(p,lookup(p),ratio).w));
    const t=Math.min(...changed.map(p=>p.y)),b=Math.max(...changed.map(p=>p.y+p.h));
    const dx=l<0?-l:r>1?1-r:0,dy=t<0?-t:b>1?1-b:0;
    changed.forEach((p,i)=>Object.assign(items[i],p,{x:p.x+dx,y:p.y+dy}));
  }
  function validate(raw){
    if(!raw||![1,2].includes(raw.version)||!Array.isArray(raw.people)||raw.people.length>500)throw Error('工程格式无效或超过 500 个角色');
    const p={...defaults(),bodyHeight:.28,horizontalOverlap:.35,stagger:.6,...raw,bg:{...defaults().bg,...raw.bg},people:raw.people.map((x,i)=>({...x,uid:x.uid||'legacy-'+i,label:x.label||'',locked:!!x.locked,hidden:!!x.hidden,lx:Number(x.lx)||0,ly:Number(x.ly)||0,bodyTop:x.bodyTop??0,bodyBottom:x.bodyBottom??1}))};p.version=2;
    if(!Number.isFinite(p.ratio)||p.ratio<.5||p.ratio>3||!/^#[0-9a-f]{6}$/i.test(p.color))throw Error('画布尺寸或颜色无效');
    if(p.background&&(!p.background.startsWith('data:image/')||p.background.length>29e6))throw Error('背景图片无效');
    if(!['stage','solid','transparent'].includes(p.backgroundMode))throw Error('背景类型无效');
    if(typeof p.rowCustom!=='string'||p.rowCustom.length>100)throw Error('每排人数格式无效');
    if(!['line','rows','arc','wings','crowd'].includes(p.preset)||!['horizontal','vertical'].includes(p.direction))throw Error('布局参数无效');
    if(![p.bodyHeight,p.horizontalOverlap,p.stagger].every(Number.isFinite)||p.bodyHeight<.025||p.bodyHeight>.8||p.horizontalOverlap<0||p.horizontalOverlap>.65||p.stagger<0||p.stagger>1)throw Error('密集合照参数无效');
    if(![p.rows,p.gap,p.overlap,p.labelSize,p.titleY,p.bg.scale,p.bg.x,p.bg.y].every(Number.isFinite)||p.labelSize<8||p.labelSize>40||p.bg.scale<1||p.bg.scale>4)throw Error('排版参数无效');
    if(!/^#[0-9a-f]{6}$/i.test(p.labelColor)||typeof p.title!=='string'||typeof p.subtitle!=='string'||p.title.length>80||p.subtitle.length>120)throw Error('文字参数无效');
    const ids=new Set();
    for(const a of p.people){if(typeof a.id!=='string'||typeof a.uid!=='string'||ids.has(a.uid)||![a.x,a.y,a.h,a.lx,a.ly,a.bodyTop,a.bodyBottom].every(Number.isFinite)||a.bodyTop<0||a.bodyBottom>1||a.bodyBottom-a.bodyTop<.2||a.h<.025||a.h>.9||Math.abs(a.x)>2||Math.abs(a.y)>2||typeof a.label!=='string'||a.label.length>64)throw Error('角色数据无效');ids.add(a.uid);}
    return p;
  }
  const api={defaults,copy,bounds,dimensions,fit,rowCounts,arrange,moveGroup,scaleGroup,validate,clamp,uniformSize,resizeInPlace,bodyTop,bodyBottom,bodySpan};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LayoutCore=api;
})(typeof window!=='undefined'?window:globalThis);
