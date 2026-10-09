import { projectMotion } from './mission_scheduling_and_routes.js';
/* Dependency-free 3D projection. World geometry is depth-sorted and lit in Canvas 2D. */
'use strict';
export class CanvasTwinScene {
  constructor(canvas, onSelect, onCamera) {
    this.canvas=canvas; this.ctx=canvas.getContext('2d'); this.onSelect=onSelect; this.onCamera=onCamera;
    this.camera={yaw:-0.56,elevation:.76,zoom:1.04,x:450,y:250};
    this.layers={routes:true,sensors:false,ghosts:false,grid:true};
    this.follow=false; this.autoOrbit=false; this.transition=null; this.lastDraw=0; this.reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches||false; this.width=800; this.height=570; this.dpr=1; this.polys=[]; this.hits=[]; this.pointers=new Map(); this.dragged=false; this.preset='iso';
    this.bind();
    this.resizeObserver=new ResizeObserver(()=>this.resize()); this.resizeObserver.observe(canvas); this.resize();
  }
  setTheme(theme){this.theme=theme==='bright'?'bright':'dark'}
  resize(){const r=this.canvas.getBoundingClientRect(); if(!r.width||!r.height)return;this.width=r.width;this.height=r.height;this.dpr=Math.min(window.devicePixelRatio||1,2);this.canvas.width=Math.round(r.width*this.dpr);this.canvas.height=Math.round(r.height*this.dpr)}
  bind(){
    const c=this.canvas;
    c.addEventListener('pointerdown',e=>{this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});this.dragged=false;c.setPointerCapture(e.pointerId);this.startPoint={x:e.clientX,y:e.clientY};if(this.pointers.size===2)this.pinch=this.pointerDistance()});
    c.addEventListener('pointermove',e=>{const prev=this.pointers.get(e.pointerId);if(!prev)return;this.transition=null;this.autoOrbit=false;const dx=e.clientX-prev.x,dy=e.clientY-prev.y;this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(Math.hypot(e.clientX-this.startPoint.x,e.clientY-this.startPoint.y)>4)this.dragged=true;if(this.pointers.size===2){const d=this.pointerDistance();if(this.pinch)this.zoomBy(d/this.pinch);this.pinch=d;this.dragged=true}else{this.camera.yaw+=dx*.006;this.camera.elevation=Math.max(.27,Math.min(1.53,this.camera.elevation+dy*.005));this.cameraChanged('custom')}});
    c.addEventListener('pointerup',e=>{if(!this.dragged&&this.pointers.size===1){const r=c.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;const hit=this.hits.filter(p=>Math.hypot(p.x-x,p.y-y)<Math.max(23,p.radius)).sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0];if(hit)this.onSelect(hit.id)}this.pointers.delete(e.pointerId);this.pinch=null;});
    c.addEventListener('pointercancel',e=>{this.pointers.delete(e.pointerId);this.pinch=null});
    c.addEventListener('wheel',e=>{e.preventDefault();this.zoomBy(Math.exp(-e.deltaY*.0012))},{passive:false});
    c.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','0'].includes(e.key)){e.preventDefault();this.transition=null;this.autoOrbit=false;if(e.key==='ArrowLeft')this.camera.yaw-=.12;if(e.key==='ArrowRight')this.camera.yaw+=.12;if(e.key==='ArrowUp')this.camera.elevation=Math.min(1.53,this.camera.elevation+.1);if(e.key==='ArrowDown')this.camera.elevation=Math.max(.27,this.camera.elevation-.1);if(e.key==='+'||e.key==='=')this.zoomBy(1.12);if(e.key==='-')this.zoomBy(1/1.12);if(e.key==='0')this.setView('iso');else this.cameraChanged('custom')}});
  }
  pointerDistance(){const p=[...this.pointers.values()];return p.length===2?Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y):0}
  cameraChanged(preset){this.preset=preset;this.onCamera?.(preset,this.camera)}
  zoomBy(f,smooth=false){const zoom=Math.max(.65,Math.min(2.8,(smooth?this.transition?.to?.zoom??this.camera.zoom:this.camera.zoom)*f)),preset=!smooth&&this.transition?.to?.elevation!==undefined?'custom':this.preset;if(smooth&&!this.reducedMotion)this.transition={from:{...this.camera},to:{...this.transition?.to,zoom},start:performance.now(),duration:240};else{this.transition=null;this.camera.zoom=zoom}this.cameraChanged(preset)}
  setView(name){const from={...this.camera};this.follow=false;this.autoOrbit=false;const to={...this.camera,x:450,y:250,zoom:1.06};if(name==='top'){to.yaw=0;to.elevation=Math.PI/2-.002}else if(name==='close'){to.yaw=-.82;to.elevation=.44;to.zoom=1.05}else{to.yaw=this.width<500?-1.08:-.56;to.elevation=this.width<500?.88:.76}if(this.reducedMotion){Object.assign(this.camera,to);this.transition=null}else this.transition={from,to,start:performance.now(),duration:650};this.cameraChanged(name)}
  focus(){this.autoOrbit=false;this.follow=true;if(this.reducedMotion){this.transition=null;this.camera.zoom=1.7}else this.transition={from:{...this.camera},to:{zoom:1.7},start:performance.now(),duration:650};this.cameraChanged('focus')}
  prepare(){const a=this.camera;this.cy=Math.cos(a.yaw);this.sy=Math.sin(a.yaw);this.ce=Math.cos(a.elevation);this.se=Math.sin(a.elevation);const w=Math.abs(this.cy)*940+Math.abs(this.sy)*550,h=(Math.abs(this.sy)*940+Math.abs(this.cy)*550)*this.se+105*this.ce;this.scale=Math.min((this.width-74)/(w+45),(this.height-100)/(h+65))*a.zoom;this.cx=this.width*.49;this.oy=this.height*.55}
  project(x,y,z=0){const dx=x-this.camera.x,dy=y-this.camera.y;return{x:this.cx+(dx*this.cy-dy*this.sy)*this.scale,y:this.oy+((dx*this.sy+dy*this.cy)*this.se-z*this.ce)*this.scale,depth:(dx*this.sy+dy*this.cy)*this.ce+z*this.se}}
  shade(hex,k){const h=hex.replace('#','');const n=parseInt(h,16),v=[n>>16,(n>>8)&255,n&255].map(v=>Math.min(255,Math.round(v*k)));return`rgb(${v[0]},${v[1]},${v[2]})`}
  polygon(points,fill,stroke=null,width=.6,alpha=1){this.polys.push({points,fill,stroke,width,alpha,depth:points.reduce((s,p)=>s+this.project(...p).depth,0)/points.length})}
  paintPolygon(points,fill,stroke=null,width=1,alpha=1){const ctx=this.ctx;ctx.globalAlpha=alpha;ctx.beginPath();points.forEach((p,i)=>{const q=this.project(...p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke()}ctx.globalAlpha=1}
  flush(){this.polys.sort((a,b)=>a.depth-b.depth);this.polys.forEach(p=>this.paintPolygon(p.points,p.fill,p.stroke,p.width,p.alpha));this.polys=[]}
  prism(points,z,h,color,edge=null,alpha=1){this.polygon(points.map(p=>[p[0],p[1],z+h]),this.shade(color,1.18),edge,.55,alpha);for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);const nx=dy/len,ny=-dx/len;if(nx*this.sy+ny*this.cy<-.001)continue;const light=.66+Math.max(0,nx*-.6+ny*-.6)*.32;this.polygon([[...a,z],[...b,z],[...b,z+h],[...a,z+h]],this.shade(color,light),edge,.55,alpha)}}
  box(x,y,z,w,d,h,color,rotation=0,edge=null,alpha=1){const co=Math.cos(rotation),si=Math.sin(rotation);const points=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([a,b])=>[x+a*co-b*si,y+a*si+b*co]);this.prism(points,z,h,color,edge,alpha)}
  bevel(x,y,z,w,d,h,color,rotation,alpha=1){const r=5,co=Math.cos(rotation),si=Math.sin(rotation);const points=[[-w/2+r,-d/2],[w/2-r,-d/2],[w/2,-d/2+r],[w/2,d/2-r],[w/2-r,d/2],[-w/2+r,d/2],[-w/2,d/2-r],[-w/2,-d/2+r]].map(([a,b])=>[x+a*co-b*si,y+a*si+b*co]);this.prism(points,z,h,color,null,alpha)}
  cylinder(x,y,z,r,h,color,n=12){const p=Array.from({length:n},(_,i)=>[x+Math.cos(i/n*Math.PI*2)*r,y+Math.sin(i/n*Math.PI*2)*r]);this.prism(p,z,h,color)}
  line(points,color,width=1,dash=[],alpha=1){const c=this.ctx;c.globalAlpha=alpha;c.strokeStyle=color;c.lineWidth=width;c.setLineDash(dash);c.beginPath();points.forEach((p,i)=>{let q=this.project(...p);i?c.lineTo(q.x,q.y):c.moveTo(q.x,q.y)});c.stroke();c.setLineDash([]);c.globalAlpha=1}
  circle(x,y,z,r,color,width=1,alpha=1,fill=null){const p=Array.from({length:49},(_,i)=>[x+Math.cos(i/48*Math.PI*2)*r,y+Math.sin(i/48*Math.PI*2)*r,z]);if(fill)this.paintPolygon(p,fill,null,0,alpha);this.line(p,color,width,[],alpha)}
  text(text,x,y,z,color='#b4cbe7',size=10){const p=this.project(x,y,z),c=this.ctx;c.font=`${size}px "IBM Plex Mono", monospace`;c.fillStyle=color;c.textAlign='center';c.fillText(text,p.x,p.y)}
  shadow(x,y,w,d,alpha=.3){const c=this.ctx;const p=[[x-w*.3,y-d*.3,.1],[x+w*.7,y-d*.2,.1],[x+w*.85,y+d*.75,.1],[x-w*.2,y+d*.75,.1]];c.save();c.shadowBlur=20*this.scale;c.shadowColor='#000';this.paintPolygon(p,'#01060c',null,0,alpha);c.restore()}
  floor(state){
    this.box(450,250,-20,930,530,20,'#405a76',0,'#8ba4bf');this.flush();
    this.paintPolygon([[-15,-15,.05],[915,-15,.05],[915,515,.05],[-15,515,.05]],'#6c7f93','#a5bad1',.8);
    if(this.layers.grid){for(let x=0;x<=900;x+=50)this.line([[x,0,.1],[x,500,.1]],'#bdd0e5',.45,[],.27);for(let y=0;y<=500;y+=50)this.line([[0,y,.1],[900,y,.1]],'#bdd0e5',.45,[],.27)}
    this.paintPolygon([[40,209,.2],[828,209,.2],[828,291,.2],[40,291,.2]],'#3c627e');
    this.line([[180,212,.4],[816,212,.4]],'#e5b65a',1,[],.35);this.line([[180,288,.4],[816,288,.4]],'#e5b65a',1,[],.35);this.line([[195,250,.5],[818,250,.5]],'#c7dbed',1,[7,8],.4);
    [420,710].forEach(x=>{this.paintPolygon([[x-30,137,.3],[x+30,137,.3],[x+30,364,.3],[x-30,364,.3]],'#5b7c94',null,0,.65);this.line([[x,143,.5],[x,363,.5]],'#c6d9e9',.7,[3,6],.4)});
    for(let i=0;i<3;i++){const y=170+i*80;this.paintPolygon([[56,y-31,.6],[151,y-31,.6],[151,y+31,.6],[56,y+31,.6]],'#285765','#77acba',.7,.7);this.line([[65,y-24,.7],[146,y-24,.7],[146,y+24,.7],[65,y+24,.7]],'#e9bc60',1,[5,4],.42);this.text('0'+(i+1),85,y+5,1,'#e3eef8',Math.max(6,12*this.scale))}
    this.text('CHARGING / DEPOT',111,95,1,'#e0eafa',Math.max(6,11*this.scale));this.text('TRANSIT CORRIDOR',529,275,1,'#d7e4f3',Math.max(5,8*this.scale));this.text('ASSEMBLY',566,24,1,'#e0eafa',Math.max(6,12*this.scale));this.text('PACKING',566,490,1,'#e0eafa',Math.max(6,12*this.scale));
    for(let x=215;x<840;x+=105){this.line([[x-8,246,1],[x,250,1],[x-8,254,1]],'#e4edf5',1,[],.4)}
    if(state.slow){this.paintPolygon([[320,211,1],[817,211,1],[817,289,1],[320,289,1]],'#dcac56',null,0,.09);this.line([[320,211,1],[817,211,1],[817,289,1],[320,289,1],[320,211,1]],'#d7ac64',1,[4,5],.6)}
    this.line([[-8,-8,0],[-8,-8,90]],'#8ea9c6',.8,[],.4);this.line([[908,-8,0],[908,-8,90]],'#8ea9c6',.8,[],.4);this.line([[-8,508,0],[-8,508,55]],'#8ea9c6',.8,[],.4);this.line([[908,508,0],[908,508,55]],'#8ea9c6',.8,[],.4);
    state.bins.forEach(b=>this.shadow(b.x,b.y<250?79:423,148,65,.22));state.robots.forEach(r=>this.shadow(r.x,r.y,42,35,.4));
  }
  rack(b){const x=b.x,y=b.y<250?76:424,h=82;const beam='#cf711f',steel='#315b82';
    this.box(x,y,0,153,66,3,'#38516c');
    for(const dx of [-72,72])for(const dy of [-29,29]){this.box(x+dx,y+dy,0,5,5,h,steel);this.box(x+dx,y+dy,0,11,10,3,'#b4c4d4')}
    for(const z of [7,36,66]){this.box(x,y,z,145,60,3,'#8da5bb');this.box(x,y-30,z,149,3,4,beam);this.box(x,y+30,z,149,3,4,beam)}
    const n=Math.max(0,Math.ceil(b.stock/100*12));
    for(let i=0;i<n;i++){const level=Math.floor(i/4),col=i%4,xx=x-52+col*35,zz=11+level*29;this.box(xx,y,zz,28,36,21,i%3===0?'#9e876a':'#b29770',0,'#4e4539');this.box(xx,y,zz+21.05,6,36,.4,'#d0ba8d');this.box(xx,y+18.1,zz+7,9,.6,8,'#d2c5a4');for(let j=0;j<3;j++)this.box(xx-3+j*2,y+18.5,zz+8,.65,.3,5,'#514d43')}
  }
  scenery(){
    for(let i=0;i<3;i++){const y=170+i*80;this.box(41,y,0,20,36,43,'#405462');this.box(53,y,22,1,23,13,'#132a36');this.box(53.8,y,28,1,18,2,'#48bda9');this.box(41,y,43,20,36,2,'#8398a3')}
    // Pallet stacks and utility cabinets remain outside travel aisles.
    for(const [x,y]of [[240,63],[245,437],[835,74],[844,424]]){this.box(x,y,0,51,42,5,'#625341');for(let i=0;i<3;i++)this.box(x-16+i*16,y,5,12,44,3,'#957d5e');this.box(x,y,8,43,36,22,'#8b785e',0,'#554a3b');this.box(x,y,30,7,36,1,'#b8a78a');this.box(x,y,31,37,32,20,'#a28b69');this.box(x,y,51,6,32,1,'#c4b18a')}
    // Edge beacons and low warehouse boundary markers.
    for(const [x,y]of [[15,18],[885,18],[15,482],[885,482]]){this.box(x,y,0,12,12,6,'#465f78');this.box(x,y,6,4,4,34,'#aec2d7');this.cylinder(x,y,40,4,4,'#f2c660')}
    for(let y=70;y<=445;y+=75)this.box(894,y,0,5,5,18,'#a18a51');
  }
  heading(r){const target=r.route.find(p=>Math.hypot(p.x-r.x,p.y-r.y)>1);return target?Math.atan2(target.y-r.y,target.x-r.x):(r.heading||0)}
  robot(r,selected,time,ghost=false){const a=this.heading(r),co=Math.cos(a),si=Math.sin(a),local=(dx,dy)=>[r.x+dx*co-dy*si,r.y+dx*si+dy*co];
    if(ghost){const p=[[-22,-16],[22,-16],[22,16],[-22,16]].map(([x,y])=>{const q=local(x,y);return[q[0],q[1],17]});this.polygon(p,r.color,r.color,1,.16);for(let i=0;i<4;i++){const p1=p[i],p2=p[(i+1)%4];this.polygon([[p1[0],p1[1],1],[p2[0],p2[1],1],p2,p1],r.color,r.color,.5,.07)}return}
    this.bevel(r.x,r.y,4,44,34,7,'#172631',a);this.bevel(r.x,r.y,11,44,34,2,r.color,a);this.bevel(r.x,r.y,13,42,32,12,'#c5d3e1',a);
    for(const dx of [-13,13])for(const dy of [-18,18]){const p=local(dx,dy);this.box(...p,2,11,5,11,'#101922',a,'#344552')}
    const front=local(20,0);this.box(...front,17,1,19,4,'#122b35',a);for(const dy of [-10,10]){const p=local(20.9,dy);this.box(...p,18,1,4,2,r.color,a)}
    const lidar=local(7,0);this.cylinder(...lidar,25,7,5,'#3f576d');this.cylinder(...lidar,30,6,2,r.color);this.cylinder(...lidar,32,2,2,'#e9f3ff');
    const panel=local(-9,0);this.box(...panel,25,12,17,1,'#698297',a);for(const dy of [-4,0,4]){const p=local(-9,dy);this.box(...p,26,8,1,.5,'#d8e7f4',a)}
    if(r.task!==null){const p=local(-9,0);this.box(...p,27,18,21,14,'#b09a72',a,'#5e5544');this.box(...p,41,5,21,.5,'#d7c293',a)}
    const pulse=.75+.25*Math.sin(time*.003);if(selected)this.circle(r.x,r.y,.9,35,r.color,1.5,pulse);
  }
  projectedRobot(r,state){if(!r.route.length||state.stopped||['Paused','Stopped'].includes(r.state)||!state.running||r.battery<=0)return null;return{...r,...projectMotion(r,5,state.slow)}}
  overlays(state,time){const selected=state.robots[state.selected];state.robots.forEach(r=>{
      if(this.layers.routes&&r.route.length){const pts=[[r.x,r.y,1.5],...r.route.map(p=>[p.x,p.y,1.5])];this.line(pts,r.color,7,[],.055);this.line(pts,r.color,1.4,[5,5],.85);const end=r.route.at(-1);this.circle(end.x,end.y,1.6,13,r.color,1,.7);this.circle(end.x,end.y,1.6,6,r.color,1,.3,r.color)}
      if(this.layers.sensors){const a=this.heading(r),rad=78,p=[[r.x,r.y,2]];for(let i=0;i<=20;i++){const t=a-.6+i/20*1.2;p.push([r.x+Math.cos(t)*rad,r.y+Math.sin(t)*rad,2])}p.push([r.x,r.y,2]);this.paintPolygon(p,r.color,r.color,.5,.09);this.circle(r.x,r.y,1.2,43,r.color,.5,.18)}
      if(r.id===state.selected)this.circle(r.x,r.y,1,44,r.color,.5,.2);
    });
    if(selected)this.circle(selected.x,selected.y,1,48,selected.color,.5,.15)
  }
  label(text,x,y,z,{color='#d7e7fc',sub='',width=100}={}){
    const c=this.ctx,p=this.project(x,y,z),small=this.width<500;
    const titleFont=`600 ${small?11:12}px "Hanken Grotesk",Arial,sans-serif`;
    const captionFont='400 11px "Hanken Grotesk",Arial,sans-serif';
    c.font=titleFont;const titleWidth=c.measureText(text).width;
    c.font=captionFont;const subWidth=sub?c.measureText(sub).width:0;
    const w=Math.max(small?width*.9:width,Math.ceil(Math.max(titleWidth,subWidth))+18),h=sub?43:27;
    c.fillStyle='#0c1c32f0';c.strokeStyle=color+'66';c.lineWidth=.6;c.beginPath();c.roundRect(p.x-w/2,p.y-h,w,h,4);c.fill();c.stroke();
    c.textAlign='center';c.font=titleFont;c.fillStyle=color;c.fillText(text,p.x,p.y-h+18);
    if(sub){c.fillStyle='#aec4e1';c.font=captionFont;c.fillText(sub,p.x,p.y-9)}
    return p;
  }
  draw(state,time){if(!this.ctx||!state?.robots)return;const c=this.ctx,dt=Math.min(.1,Math.max(0,(time-this.lastDraw)/1000));
    if(this.transition){const t=this.transition,u=Math.max(0,Math.min(1,(time-t.start)/t.duration)),eased=1-Math.pow(1-u,3);for(const k of Object.keys(t.to))this.camera[k]=t.from[k]+(t.to[k]-t.from[k])*eased;if(u===1)this.transition=null;this.onCamera?.(this.preset,this.camera)}
    if(this.autoOrbit){this.camera.yaw+=dt*.075;this.onCamera?.('custom',this.camera)}this.lastDraw=time;
    if(this.follow&&(!state.live||state.robots[state.selected].tracked)){const r=state.robots[state.selected];const blend=this.reducedMotion?1:1-Math.exp(-dt*9);this.camera.x+=(r.x-this.camera.x)*blend;this.camera.y+=(r.y-this.camera.y)*blend}this.prepare();c.setTransform(this.dpr,0,0,this.dpr,0,0);c.clearRect(0,0,this.width,this.height);const bg=c.createRadialGradient(this.width*.5,this.height*.42,10,this.width*.5,this.height*.5,this.width*.72);const bright=this.theme==='bright';bg.addColorStop(0,bright?'#e9f2ff':'#1a385a');bg.addColorStop(.6,bright?'#d4e2f3':'#102640');bg.addColorStop(1,bright?'#afc5df':'#08182d');c.fillStyle=bg;c.fillRect(0,0,this.width,this.height);
    // Subtle technical field behind the floor.
    c.fillStyle=bright?'#667b95':'#a1b2c9';c.globalAlpha=.14;for(let x=15;x<this.width;x+=23)for(let y=15;y<this.height;y+=23)c.fillRect(x,y,1,1);c.globalAlpha=1;
    if(state.live)state={...state,robots:state.robots.filter(r=>r.tracked)};this.floor(state);if(!state.live)this.overlays(state,time);this.scenery();state.bins.forEach(b=>this.rack(b));
    state.robots.forEach(r=>this.robot(r,r.id===state.selected,time));if(!state.live&&this.layers.ghosts)state.robots.forEach(r=>{const ghost=this.projectedRobot(r,state);if(ghost)this.robot(ghost,false,time,true)});this.flush();
    if(!state.live)state.bins.forEach(b=>this.label(this.width<500?b.id+' · '+Math.floor(b.stock):'BIN '+b.id+' / '+Math.floor(b.stock)+' UNITS',b.x,b.y<250?76:424,97,{color:b.stock<35?'#efbd68':'#d7e7fc',width:this.width<500?63:112}));
    this.hits=[];state.robots.forEach(r=>{const p=this.project(r.x,r.y,18);this.hits.push({id:r.id,x:p.x,y:p.y,radius:28*this.scale});if(r.id===state.selected){this.line([[r.x,r.y,35],[r.x,r.y,76]],r.color,.7,[],.6);this.label('AMR–0'+(r.id+1),r.x,r.y,80,{color:r.color,sub:this.width<500?'':(r.battery===null?'—':r.battery.toFixed(0)+'%')+'  /  '+r.state,width:this.width<500?70:101})}else{const q=this.project(r.x,r.y,48);c.font='600 11px "Hanken Grotesk",Arial,sans-serif';c.fillStyle=r.color;c.textAlign='center';c.fillText('0'+(r.id+1),q.x,q.y)}});
    if(!state.live&&this.layers.ghosts)state.robots.forEach(r=>{const g=this.projectedRobot(r,state);if(g)this.text('+5s',g.x,g.y,32,r.color,this.width<500?6:8)});
    // Scale reference: one metre in world coordinates equals 75 model pixels.
    const x=37,y=this.height-53,len=75*this.scale;c.strokeStyle='#7d9dbf';c.lineWidth=1;c.beginPath();c.moveTo(x,y-3);c.lineTo(x,y);c.lineTo(x+len,y);c.lineTo(x+len,y-3);c.stroke();c.fillStyle='#b4cbe7';c.font='10px "IBM Plex Mono",monospace';c.textAlign='left';c.fillText('1 m',x,y-7);
  }
}
