import * as THREE from './vendor/three.module.js';
import {CONNECTIONS} from './core.mjs';
const display=p=>new THREE.Vector3(p[0]/1000,-p[1]/1000,-p[2]/1000);
export class FusionView{
  constructor(host){
    this.host=host;this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#ecf2f0');this.camera=new THREE.PerspectiveCamera(42,1,.001,10);this.renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.append(this.renderer.domElement);
    this.target=new THREE.Vector3(.075,-.1,0);this.distance=.6;this.yaw=15;this.pitch=15;
    const grid=new THREE.GridHelper(.4,16,0x7b9c92,0xcbd9d4);grid.rotation.x=Math.PI/2;this.scene.add(grid);
    for(const [name,direction,color]of [['X',[1,0,0],0xb52a43],['Y',[0,-1,0],0x25815c],['Z',[0,0,-1],0x3269c4]]){
      const d=new THREE.Vector3(...direction);this.scene.add(new THREE.ArrowHelper(d,new THREE.Vector3(),.15,color,.012,.006));
      const c=document.createElement('canvas');c.width=256;c.height=64;const ctx=c.getContext('2d');ctx.font='bold 30px sans-serif';ctx.fillStyle='#'+color.toString(16);ctx.fillText(`+${name} 150 mm`,2,40);const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),depthTest:false}));sprite.position.copy(d.multiplyScalar(.185));sprite.scale.set(.1,.025,1);this.scene.add(sprite);
    }
    this.points=Array.from({length:21},()=>{const m=new THREE.Mesh(new THREE.SphereGeometry(.003,10,8),new THREE.MeshBasicMaterial({color:0x008779}));m.visible=false;this.scene.add(m);return m;});
    this.lines=CONNECTIONS.map(()=>{const l=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineBasicMaterial({color:0x29517b}));l.visible=false;this.scene.add(l);return l;});
    let drag=null;host.addEventListener('pointerdown',e=>{drag=[e.clientX,e.clientY];host.setPointerCapture(e.pointerId);});host.addEventListener('pointermove',e=>{if(!drag)return;this.yaw-=(e.clientX-drag[0])*.5;this.pitch+=(e.clientY-drag[1])*.5;drag=[e.clientX,e.clientY];this.render();});for(const n of ['pointerup','pointercancel','lostpointercapture'])host.addEventListener(n,()=>drag=null);
    host.addEventListener('wheel',e=>{e.preventDefault();this.distance=Math.max(.15,Math.min(2,this.distance*Math.exp(e.deltaY*.001)));this.render();},{passive:false});
    this.observer=new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.render();});this.observer.observe(host);this.render();
  }
  update(points){this.data=points;this.points.forEach((m,i)=>{m.visible=!!points[i]?.valid;if(m.visible)m.position.copy(display(points[i].xyz));});this.lines.forEach((l,i)=>{const[a,b]=CONNECTIONS[i];l.visible=!!points[a]?.valid&&!!points[b]?.valid;if(l.visible){const pos=l.geometry.attributes.position;pos.setXYZ(0,...display(points[a].xyz).toArray());pos.setXYZ(1,...display(points[b].xyz).toArray());pos.needsUpdate=true;l.geometry.computeBoundingSphere();}});this.render();}
  fit(){const good=(this.data||[]).filter(p=>p.valid);if(good.length){this.target.set(0,0,0);good.forEach(p=>this.target.add(display(p.xyz)));this.target.divideScalar(good.length);}this.distance=.45;this.yaw=15;this.pitch=15;this.render();}
  render(){const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch*Math.PI/180,this.yaw*Math.PI/180,0,'YXZ'));this.camera.position.set(0,0,this.distance).applyQuaternion(q).add(this.target);this.camera.up.set(0,1,0).applyQuaternion(q);this.camera.lookAt(this.target);this.renderer.render(this.scene,this.camera);}
}
