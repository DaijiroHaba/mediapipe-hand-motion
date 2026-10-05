import {project,validateCalibration,PIXEL_CONVENTION} from './fusion-core.mjs';
export const BOARD={squaresX:6,squaresY:8,squareMm:25,markerMm:17.5,dictionary:'DICT_4X4_50'};
let loaded;
export function loadCV(){
  if(!loaded)loaded=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='vendor/opencv-4.11.0.js';
    const timer=setTimeout(()=>reject(Error('OpenCVの初期化が時間切れです。')),45000);
    script.onerror=()=>{clearTimeout(timer);reject(Error('同梱OpenCV.jsを読み込めません。配置を確認してください。'));};
    script.onload=async()=>{try{const cv=await globalThis.cv;if(!cv?.calibrateCameraExtended||!cv?.aruco_CharucoDetector)throw Error('必要な校正APIがありません。');clearTimeout(timer);resolve(cv);}catch(e){clearTimeout(timer);reject(e);}};
    document.head.append(script);
  });return loaded;
}
export class CalibrationEngine{
  constructor(cv){
    this.cv=cv;this.dictionary=cv.getPredefinedDictionary(cv.DICT_4X4_50);
    const ids=new cv.Mat(),charuco=new cv.aruco_CharucoParameters(),detector=new cv.aruco_DetectorParameters(),refine=new cv.aruco_RefineParameters(10,3,true);
    try{this.board=new cv.aruco_CharucoBoard(new cv.Size(6,8),25,17.5,this.dictionary,ids);this.detector=new cv.aruco_CharucoDetector(this.board,charuco,detector,refine);}
    finally{ids.delete();charuco.delete();detector.delete();refine.delete();}
    this.samples=new Map();
  }
  drawBoard(canvas){const cv=this.cv,image=new cv.Mat();try{this.board.generateImage(new cv.Size(900,1200),image,0,1);cv.imshow(canvas,image);}finally{image.delete();}}
  detect(canvas){
    const cv=this.cv,src=cv.imread(canvas),gray=new cv.Mat(),corners=new cv.Mat(),ids=new cv.Mat(),markers=new cv.MatVector(),markerIds=new cv.Mat();
    try{cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);this.detector.detectBoard(gray,corners,ids,markers,markerIds);
      const list=Array.from(ids.data32S),pixels=Array.from(corners.data32F);return {ids:list,pixels:list.map((_,i)=>pixels.slice(i*2,i*2+2)),objects:list.map(id=>[(id%5+1)*25,(Math.floor(id/5)+1)*25,0]),width:canvas.width,height:canvas.height};
    }finally{src.delete();gray.delete();corners.delete();ids.delete();markers.delete();markerIds.delete();}
  }
  add(id,detection){
    if(detection.ids.length<12)throw Error(`カメラ${id}: 校正点が12点以上必要です。`);
    const rows=this.samples.get(id)||[];if(rows.length>=30)throw Error('校正画像は最大30組です。');
    if(rows.length&&rows.some(r=>r.width!==detection.width||r.height!==detection.height))throw Error('途中で解像度が変化しています。');
    rows.push(detection);this.samples.set(id,rows);
  }
  calibrateCamera(id,deviceHash,label){
    const cv=this.cv,rows=this.samples.get(id)||[];if(rows.length<12)throw Error(`カメラ${id}: 静止した校正板を異なる位置・傾きで12組以上取得してください。`);
    const centers=rows.map(r=>[r.pixels.reduce((s,p)=>s+p[0],0)/r.pixels.length,r.pixels.reduce((s,p)=>s+p[1],0)/r.pixels.length]);
    if(Math.max(...centers.map(c=>c[0]))-Math.min(...centers.map(c=>c[0]))<rows[0].width*.18||Math.max(...centers.map(c=>c[1]))-Math.min(...centers.map(c=>c[1]))<rows[0].height*.18)throw Error(`カメラ${id}: 校正板の位置が偏っています。上下左右に動かして取得してください。`);
    const objects=new cv.MatVector(),images=new cv.MatVector(),K=cv.Mat.eye(3,3,cv.CV_64F),dist=cv.Mat.zeros(5,1,cv.CV_64F),rvecs=new cv.MatVector(),tvecs=new cv.MatVector(),sdI=new cv.Mat(),sdE=new cv.Mat(),per=new cv.Mat();
    try{
      for(const r of rows){const o=cv.matFromArray(r.objects.length,1,cv.CV_32FC3,r.objects.flat()),p=cv.matFromArray(r.pixels.length,1,cv.CV_32FC2,r.pixels.flat());objects.push_back(o);images.push_back(p);o.delete();p.delete();}
      const rms=cv.calibrateCameraExtended(objects,images,new cv.Size(rows[0].width,rows[0].height),K,dist,rvecs,tvecs,sdI,sdE,per,cv.CALIB_FIX_K3,new cv.TermCriteria(cv.TermCriteria_COUNT+cv.TermCriteria_EPS,60,1e-9));
      const normals=[];for(let i=0;i<rvecs.size();i++){const rv=rvecs.get(i),R=new cv.Mat();cv.Rodrigues(rv,R);normals.push([R.data64F[2],R.data64F[5],R.data64F[8]]);rv.delete();R.delete();}
      let spread=0;for(const a of normals)for(const b of normals)spread=Math.max(spread,Math.acos(Math.max(-1,Math.min(1,a.reduce((s,v,i)=>s+v*b[i],0))))*180/Math.PI);
      const k=Array.from(K.data64F),d=Array.from(dist.data64F).slice(0,5);
      if(!Number.isFinite(rms)||rms>1.5||spread<15||k[0]<rows[0].width*.2||k[0]>rows[0].width*10||k[4]<rows[0].height*.2||k[4]>rows[0].height*15)throw Error(`カメラ${id}: 校正の誤差/傾き範囲が基準外です（RMS=${rms.toFixed(2)}px、傾き幅=${spread.toFixed(1)}°）。`);
      return {id,deviceHash,label,width:rows[0].width,height:rows[0].height,K:k,dist:d,rmsPx:rms,intrinsicSamples:rows.length,normalSpreadDeg:spread,perViewRmsPx:Array.from(per.data64F)};
    }finally{for(const obj of [objects,images,K,dist,rvecs,tvecs,sdI,sdE,per])obj.delete();}
  }
  pose(detection,intrinsic){
    const cv=this.cv,o=cv.matFromArray(detection.objects.length,1,cv.CV_32FC3,detection.objects.flat()),p=cv.matFromArray(detection.pixels.length,1,cv.CV_32FC2,detection.pixels.flat()),K=cv.matFromArray(3,3,cv.CV_64F,intrinsic.K),dist=cv.matFromArray(5,1,cv.CV_64F,intrinsic.dist),rv=new cv.Mat(),tv=new cv.Mat(),rotation=new cv.Mat();
    try{if(detection.ids.length<12||!cv.solvePnP(o,p,K,dist,rv,tv,false,cv.SOLVEPNP_ITERATIVE))throw Error('共通座標の校正板を推定できません。');cv.Rodrigues(rv,rotation);const cam={...intrinsic,R:Array.from(rotation.data64F),t:Array.from(tv.data64F)};
      const errors=detection.objects.map((point,i)=>{const pred=project(point,cam);return pred?Math.hypot(pred[0]-detection.pixels[i][0],pred[1]-detection.pixels[i][1]):Infinity;});cam.originRmsPx=Math.sqrt(errors.reduce((a,b)=>a+b*b,0)/errors.length);if(cam.originRmsPx>1.5)throw Error('共通座標の再投影誤差が基準外です。');return cam;
    }finally{for(const item of [o,p,K,dist,rv,tv,rotation])item.delete();}
  }
  reset(){this.samples.clear();}
}
export function stableDetections(first,second){
  if(second.ids.length<12)return false;const differences=[];first.ids.forEach((id,i)=>{const j=second.ids.indexOf(id);if(j>=0)differences.push(Math.hypot(first.pixels[i][0]-second.pixels[j][0],first.pixels[i][1]-second.pixels[j][1]));});return differences.length>=12&&Math.max(...differences)<1;
}
export function makeCalibration(cameras){return validateCalibration({schema:'handmotion-calibration-1',id:crypto.randomUUID(),createdAt:new Date().toISOString(),units:'mm',board:BOARD,pixelConvention:PIXEL_CONVENTION,coordinateSystem:'fixed ChArUco board: X along columns, Y along rows, Z by right-hand rule; NOT anatomical axes',cameras,exposureSync:'UNVERIFIED',scientificValidity:'UNVERIFIED'});}
