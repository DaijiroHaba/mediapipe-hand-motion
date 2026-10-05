import {Matrix3,Vector3} from './vendor/three.module.js';

export const FUSION_VERSION='0.3.0';
export const PIXEL_CONVENTION={modelToPixel:'u = x_normalized * width; v = y_normalized * height',halfPixelOffset:0,crossLibraryPixelCentreConvention:'UNVERIFIED',calibrationPixels:'OpenCV integer pixel centres'};
export const QC={maxReprojectionPx:2.5,minRayAngleDeg:3,maxPairDeltaMs:50,maxAgeMs:750};
const vector=a=>new Vector3(...a),matrix=a=>new Matrix3().set(...a);
const finiteArray=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(Number.isFinite);
const clamp=v=>Math.max(-1,Math.min(1,v));
export function validateCalibration(c){
  if(c?.schema!=='handmotion-calibration-1'||c.units!=='mm'||!Array.isArray(c.cameras)||c.cameras.length<2||c.cameras.length>3)throw Error('対応する校正JSON（mm単位、2〜3台）が必要です。');
  if(typeof c.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(c.id))throw Error('校正IDが不正です。');
  if(new Set(c.cameras.map(v=>v.id)).size!==c.cameras.length)throw Error('校正カメラIDが重複しています。');
  for(const cam of c.cameras){
    if(!['A','B','C'].includes(cam.id)||!Number.isInteger(cam.width)||!Number.isInteger(cam.height)||cam.width<100||cam.height<100||!finiteArray(cam.K,9)||!finiteArray(cam.dist,5)||!finiteArray(cam.R,9)||!finiteArray(cam.t,3)||typeof cam.deviceHash!=='string'||cam.deviceHash.length!==64)throw Error('校正データの形式が不正です。');
    if(cam.K[0]<=0||cam.K[4]<=0||Math.abs(cam.K[1])+Math.abs(cam.K[3])+Math.abs(cam.K[6])+Math.abs(cam.K[7])+Math.abs(cam.K[8]-1)>1e-7)throw Error('対応する内部行列はskew=0のピンホールモデルです。');
    const R=matrix(cam.R),orth=R.clone().transpose().multiply(R).elements;
    if(Math.abs(R.determinant()-1)>.001||orth.some((v,i)=>Math.abs(v-([0,4,8].includes(i)?1:0))>.001))throw Error('カメラ回転行列が不正です。');
    if(!Number.isFinite(cam.rmsPx)||cam.rmsPx>1.5||cam.rmsPx<0)throw Error('内部校正の再投影RMSが基準外です。');
    if(!Number.isFinite(cam.originRmsPx)||cam.originRmsPx<0||cam.originRmsPx>1.5)throw Error('共通座標の再投影RMSが基準外です。');
    const boundary=[0,(cam.width-1)/2,cam.width-1].flatMap(x=>[0,(cam.height-1)/2,cam.height-1].map(y=>ray([x,y],cam)));
    if(boundary.some(r=>!r))throw Error('画像境界の歪み補正が収束しません。');
    const radius=Math.max(...boundary.map(r=>Math.hypot(...r.normalized)));
    for(let i=0;i<=20;i++){const r2=(radius*i/20)**2,[k1,k2,,,k3]=cam.dist;if(1+3*k1*r2+5*k2*r2*r2+7*k3*r2*r2*r2<=0)throw Error('レンズ歪みが画角内で非単調です。再校正してください。');}
  }
  return c;
}
export function distort(x,y,d){const[k1,k2,p1,p2,k3]=d,r=x*x+y*y,radial=1+k1*r+k2*r*r+k3*r*r*r;return [x*radial+2*p1*x*y+p2*(r+2*x*x),y*radial+p1*(r+2*y*y)+2*p2*x*y];}
export function project(point,c){const p=vector(point).applyMatrix3(matrix(c.R)).add(vector(c.t));if(p.z<=0)return null;const[x,y]=distort(p.x/p.z,p.y/p.z,c.dist);return [c.K[0]*x+c.K[2],c.K[4]*y+c.K[5]];}
export function ray(pixel,c){
  const xd=(pixel[0]-c.K[2])/c.K[0],yd=(pixel[1]-c.K[5])/c.K[4];let x=xd,y=yd;
  // Invert Brown-Conrady with a numerical Jacobian; reject non-convergence.
  for(let i=0;i<25;i++){
    const p=distort(x,y,c.dist),ex=p[0]-xd,ey=p[1]-yd;if(Math.hypot(ex*c.K[0],ey*c.K[4])<.0001)break;
    const h=1e-6,px=distort(x+h,y,c.dist),py=distort(x,y+h,c.dist),a=(px[0]-p[0])/h,b=(py[0]-p[0])/h,d=(px[1]-p[1])/h,e=(py[1]-p[1])/h,det=a*e-b*d;
    if(Math.abs(det)<1e-12)return null;x-=(e*ex-b*ey)/det;y-=(-d*ex+a*ey)/det;if(!Number.isFinite(x+y)||Math.hypot(x,y)>5)return null;
  }
  const check=distort(x,y,c.dist);if(Math.hypot((check[0]-xd)*c.K[0],(check[1]-yd)*c.K[4])>.01)return null;
  const Rt=matrix(c.R).transpose();return {center:vector(c.t).negate().applyMatrix3(Rt),direction:new Vector3(x,y,1).normalize().applyMatrix3(Rt),normalized:[x,y]};
}
function leastSquares(rays){
  const sums=Array(9).fill(0),b=new Vector3();
  for(const r of rays){const d=r.direction.toArray(),n=Array.from({length:9},(_,i)=>(i%4===0?1:0)-d[Math.floor(i/3)]*d[i%3]);n.forEach((v,i)=>sums[i]+=v);b.add(r.center.clone().applyMatrix3(matrix(n)));}
  const N=matrix(sums);if(Math.abs(N.determinant())<1e-8)return null;const p=b.applyMatrix3(N.invert()).toArray();return p.every(Number.isFinite)?p:null;
}
function angle(rays){let best=0;for(let a=0;a<rays.length;a++)for(let b=a+1;b<rays.length;b++)best=Math.max(best,Math.acos(clamp(Math.abs(rays[a].direction.dot(rays[b].direction))))*180/Math.PI);return best;}
export function triangulate(observations,limits=QC){
  const usable=observations.map(o=>({...o,ray:ray(o.pixel,o.camera)})).filter(o=>o.ray);
  if(usable.length<2)return {valid:false,reason:'FEWER_THAN_TWO_VIEWS'};
  const candidates=[];
  for(let a=0;a<usable.length;a++)for(let b=a+1;b<usable.length;b++){
    const pair=[usable[a],usable[b]],rays=pair.map(o=>o.ray);if(angle(rays)<limits.minRayAngleDeg)continue;
    const p=leastSquares(rays);if(!p)continue;
    const inliers=usable.filter(o=>{const uv=project(p,o.camera);return uv&&Math.hypot(uv[0]-o.pixel[0],uv[1]-o.pixel[1])<=limits.maxReprojectionPx;});
    if(inliers.length<2)continue;const fit=leastSquares(inliers.map(o=>o.ray));if(!fit)continue;
    const errors=inliers.map(o=>{const uv=project(fit,o.camera);return uv?Math.hypot(uv[0]-o.pixel[0],uv[1]-o.pixel[1]):Infinity;});
    if(Math.max(...errors)>limits.maxReprojectionPx)continue;
    candidates.push({valid:true,xyz:fit,views:inliers.map(o=>o.camera.id),excluded:observations.filter(o=>!inliers.some(v=>v.camera.id===o.camera.id)).map(o=>o.camera.id),reprojectionPx:Math.max(...errors),rayAngleDeg:angle(inliers.map(o=>o.ray))});
  }
  candidates.sort((a,b)=>b.views.length-a.views.length||a.reprojectionPx-b.reprojectionPx);
  return candidates[0]||{valid:false,reason:'GEOMETRY_OR_REPROJECTION_REJECTED'};
}
export function selectFrames(buffers,now,tolerance=QC.maxPairDeltaMs){
  const entries=[...buffers.entries()].map(([id,list])=>[id,list.filter(f=>now-f.hostMs<=QC.maxAgeMs)]).filter(([,list])=>list.length);
  if(entries.length<2)return null;
  let best=null;
  for(const[,list]of entries)for(const anchor of list){
    const chosen=entries.map(([,items])=>items.reduce((a,b)=>Math.abs(a.alignedMs-anchor.alignedMs)<=Math.abs(b.alignedMs-anchor.alignedMs)?a:b)).filter(f=>Math.abs(f.alignedMs-anchor.alignedMs)<=tolerance);
    // A single anchor tolerance does not bound max-min; explicitly require the full span.
    const span=Math.max(...chosen.map(f=>f.alignedMs))-Math.min(...chosen.map(f=>f.alignedMs));if(chosen.length<2||span>tolerance)continue;
    const newest=Math.max(...chosen.map(f=>f.alignedMs));if(!best||chosen.length>best.frames.length||chosen.length===best.frames.length&&newest>best.newest)best={frames:chosen,deltaMs:span,newest};
  }return best;
}
export function fuseFrames(selection,calibration){
  if(!selection)return {status:'MISSING',reason:'NO_RECENT_TIME_PAIR',points:[]};
  const frames=selection.frames.filter(f=>f.landmarks.length===1);if(frames.length<2)return {status:'MISSING',reason:'ONE_HAND_REQUIRED_IN_TWO_VIEWS',points:[]};
  const points=Array.from({length:21},(_,joint)=>{
    const obs=frames.flatMap(f=>{const c=calibration.cameras.find(c=>c.id===f.id),p=f.landmarks[0][joint];return c&&p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1?[{camera:c,pixel:[p.x*c.width,p.y*c.height]}]:[];});return {joint,...triangulate(obs)};
  });return {status:'GEOMETRIC_ESTIMATE_SYNC_UNVERIFIED',deltaMs:selection.deltaMs,points,valid:points.filter(p=>p.valid).length};
}
export async function deviceHash(id){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id));return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');}
