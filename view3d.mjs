import * as THREE from './vendor/three.module.js';
import {CONNECTIONS} from './core.mjs';
import {relativePoints,wrapDegrees} from './coordinates.mjs';
export class HandView {
  constructor(host){
    this.host=host;this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#e5eded');
    this.camera=new THREE.PerspectiveCamera(40,1,.005,5);
    this.renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xffffff,0x6a8080,2));
    const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(.2,.4,.5);this.scene.add(light);
    const grid=new THREE.GridHelper(.32,8,0xb4c6c5,0xd0dbda);grid.rotation.x=Math.PI/2;grid.position.z=-.10;this.scene.add(grid);
    this.axes=new THREE.Group();this.scene.add(this.axes);this.labels=[];
    const label=(text,position,color,size=.026)=>{
      const canvas=document.createElement('canvas');canvas.width=256;canvas.height=80;
      const ctx=canvas.getContext('2d');ctx.font='bold 46px sans-serif';ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.strokeStyle='#e5eded';ctx.lineWidth=6;ctx.strokeText(text,128,40);ctx.fillText(text,128,40);
      const material=new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:false,sizeAttenuation:false});const sprite=new THREE.Sprite(material);sprite.position.copy(position);sprite.userData.axis=position.clone().normalize();sprite.userData.pixelHeight=/[XYZ]/.test(text)?24:19;this.labels.push(sprite);this.axes.add(sprite);
    };
    const axisDefs=[{name:'X',dir:new THREE.Vector3(1,0,0),color:0xb5293c,css:'#b5293c'}, {name:'Y',dir:new THREE.Vector3(0,-1,0),color:0x236e32,css:'#236e32'}, {name:'Z',dir:new THREE.Vector3(0,0,-1),color:0x254db7,css:'#254db7'}];
    for(const {name,dir,color,css} of axisDefs){
      this.axes.add(new THREE.ArrowHelper(dir,new THREE.Vector3(),.13,color,.009,.005));
      this.axes.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([dir.clone().multiplyScalar(-.12),new THREE.Vector3()]),new THREE.LineBasicMaterial({color,transparent:true,opacity:.4})));
      label('+'+name,dir.clone().multiplyScalar(.143),css,.033);
      label('-'+name,dir.clone().multiplyScalar(-.132),css,.026);
      for(const mm of [-80,-40,40,80]){
        const point=dir.clone().multiplyScalar(mm/1000),cross=name==='X'?new THREE.Vector3(0,.002,0):new THREE.Vector3(.002,0,0);
        this.axes.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([point.clone().sub(cross),point.clone().add(cross)]),new THREE.LineBasicMaterial({color})));
        label(String(mm),point.clone().add(cross.multiplyScalar(4)),css,.024);
      }
    }
    label('0',new THREE.Vector3(-.007,.008,.004),'#25363d',.018);
    this.group=new THREE.Group();this.scene.add(this.group);
    const sphere=new THREE.SphereGeometry(.0034,12,8), material=new THREE.MeshStandardMaterial({color:0x047b6b});
    this.joints=Array.from({length:21},()=>{const m=new THREE.Mesh(sphere,material);this.group.add(m);return m;});
    this.lines=CONNECTIONS.map(()=>{const g=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]);const l=new THREE.Line(g,new THREE.LineBasicMaterial({color:0x294c5a}));this.group.add(l);return l;});
    this.group.visible=false;this.origin='wrist';this.points=[];this.selected=8;this.yaw=20;this.pitch=15;this.distance=.58;this.render();
    let drag=null;
    host.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};host.setPointerCapture(e.pointerId);});
    host.addEventListener('pointermove',e=>{if(!drag)return;this.setAngles(this.yaw-(e.clientX-drag.x)*.6,this.pitch+(e.clientY-drag.y)*.6);drag={x:e.clientX,y:e.clientY};});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])host.addEventListener(event,()=>{drag=null;});
    host.addEventListener('wheel',e=>{e.preventDefault();this.setDistance(this.distance*Math.exp(e.deltaY*.001));},{passive:false});
    this.observer=new ResizeObserver(()=>{const {width,height}=host.getBoundingClientRect();if(!width||!height)return;this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.render();});this.observer.observe(host);
  }
  update(points,origin=this.origin,selected=this.selected){
    this.points=points;this.origin=origin;this.selected=selected;
    const relative=relativePoints(points,origin);this.group.visible=relative.length===21;
    if(this.group.visible){
      const v=relative.map(p=>new THREE.Vector3(p.x,-p.y,-p.z));
      this.joints.forEach((m,i)=>{m.position.copy(v[i]);m.scale.setScalar(i===selected?1.65:1);});
      this.lines.forEach((line,i)=>{const a=CONNECTIONS[i];const attr=line.geometry.attributes.position;attr.setXYZ(0,...v[a[0]].toArray());attr.setXYZ(1,...v[a[1]].toArray());attr.needsUpdate=true;line.geometry.computeBoundingSphere();});
    }
    this.render();
  }
  reset(){this.distance=.58;this.setAngles(20,15);}
  setAngles(yaw,pitch){this.yaw=wrapDegrees(yaw);this.pitch=wrapDegrees(pitch);this.render();this.changed();}
  setDistance(distance){this.distance=Math.max(.28,Math.min(.9,distance));this.render();this.changed();}
  preset(name){const presets={front:[0,0],back:[180,0],right:[90,0],left:[270,0],top:[0,-90],bottom:[0,90]};if(presets[name])this.setAngles(...presets[name]);}
  changed(){this.host.dispatchEvent(new CustomEvent('viewchange',{detail:{yaw:this.yaw,pitch:this.pitch,distance:this.distance}}));}
  render(){
    // Rotate camera and its up vector together, allowing pole crossing without flips.
    const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(this.pitch),THREE.MathUtils.degToRad(this.yaw),0,'YXZ'));
    this.camera.position.set(0,0,this.distance).applyQuaternion(q);this.camera.up.set(0,1,0).applyQuaternion(q);this.camera.lookAt(0,0,0);
    const h=Math.max(1,this.host.clientHeight),direction=this.camera.position.clone().normalize();
    for(const label of this.labels){const scale=2*label.userData.pixelHeight*Math.tan(THREE.MathUtils.degToRad(20))/h;label.scale.set(scale*256/80,scale,1);label.visible=Math.abs(label.userData.axis.dot(direction))<.97;}
    this.host.dataset.yaw=String(this.yaw);this.host.dataset.pitch=String(this.pitch);
    this.renderer.render(this.scene,this.camera);
  }
}
