import {CONNECTIONS} from './core.mjs';
import {FUSION_VERSION,QC,PIXEL_CONVENTION,validateCalibration,selectFrames,fuseFrames,deviceHash} from './fusion-core.mjs';
import {CalibrationEngine,loadCV,stableDetections,makeCalibration} from './fusion-calibration.mjs';
import {FusionView} from './fusion-view.mjs';
import {csv} from './multicamera-core.mjs';
const $=id=>document.getElementById(id),ids=['A','B','C'];
let cameras=[],phase='idle',generation=0,calibration=null,intrinsics=null,engine=null,busyCalibration=false,calWorker=null,rejectCalibration=null,lastKey='',lastGood=0,logs2d=[],logs3d=[],logCounts={},framedCalibration=null,view;
const buffers=new Map(),calibrationHistory=new Map(),say=text=>$('message').textContent=text;
let opencvAvailable=false;
let sessionMeta=null;
fetch('vendor/opencv-4.11.0.js',{method:'HEAD',cache:'no-store',signal:AbortSignal.timeout(5000)}).then(r=>{opencvAvailable=r.ok;$('dependencyStatus').textContent=r.ok?'校正ライブラリ配置あり（初期化は校正開始時）':'校正機能は準備中：OpenCV.js未同梱。各視点の2D推定と、既存校正JSONによる統合は利用可能です。';controls();}).catch(()=>{$('dependencyStatus').textContent='校正ライブラリの配置を確認できません。';});
function retainCalibration(c){calibrationHistory.set(c.id,structuredClone(c));}
try{view=new FusionView($('scene'));}catch(e){say(`3D表示を初期化できません: ${e.message}`);}
for(const id of ids){
  const label=document.createElement('label');label.textContent=`カメラ ${id}${id==='C'?'（任意）':''}`;const select=document.createElement('select');select.id='select'+id;select.add(new Option('未選択',''));label.append(select);$('selectors').append(label);
  const section=document.createElement('section');section.className='camera';section.id='cam'+id;section.hidden=id==='C';section.innerHTML=`<h2>カメラ ${id}<span id="state${id}">未接続</span></h2><video id="video${id}" muted playsinline></video><canvas id="canvas${id}" width="640" height="480" aria-label="カメラ${id}と手指ランドマーク"></canvas><p id="info${id}">未接続</p>`;$('cameras').append(section);
}
const missingRows=()=>{ $('points').replaceChildren();for(const [name,id]of [['母指',4],['示指',8],['中指',12],['環指',16],['小指',20]]){const tr=document.createElement('tr');tr.dataset.joint=id;for(const v of [name,'--','--','--','--','--']){const td=document.createElement('td');td.textContent=v;tr.append(td);}$('points').append(tr);}};missingRows();
function controls(){
  const live=phase==='live';$('cameraSettings').disabled=phase!=='idle';$('start').disabled=phase!=='idle';$('stop').disabled=phase==='idle';
  $('captureCalibration').disabled=!live||busyCalibration||!opencvAvailable||!$('boardConfirmed').checked;$('solveCalibration').disabled=!live||busyCalibration||!opencvAvailable||cameras.some(c=>(engine?.samples.get(c.id)?.length||0)<12);$('setOrigin').disabled=!live||busyCalibration||!opencvAvailable||!intrinsics||!$('boardConfirmed').checked;
  $('resetCalibration').disabled=busyCalibration;$('loadCalibration').disabled=busyCalibration||phase==='opening';$('saveCalibration').disabled=!calibration;$('export').disabled=!logs2d.length&&!logs3d.length;
  $('calibrationRows').replaceChildren();for(const c of cameras){const cal=calibration?.cameras.find(v=>v.id===c.id)||intrinsics?.find(v=>v.id===c.id),tr=document.createElement('tr');for(const v of [c.id,engine?.samples.get(c.id)?.length||0,cal?.rmsPx?.toFixed(3)||'--',cal?.originRmsPx?.toFixed(3)||'--']){const td=document.createElement('td');td.textContent=v;tr.append(td);}$('calibrationRows').append(tr);}
}
async function refresh(){
  if(phase!=='idle')return;let temporary;phase='permission';controls();
  try{temporary=await navigator.mediaDevices.getUserMedia({video:true,audio:false});temporary.getTracks().forEach(t=>t.stop());temporary=null;const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput'&&d.deviceId);
    ids.forEach((id,i)=>{const s=$('select'+id),prior=s.value;s.replaceChildren(new Option('未選択',''),...devices.map((d,j)=>new Option(d.label||`カメラ${j+1}`,d.deviceId)));s.value=devices.some(d=>d.deviceId===prior)?prior:i<2?devices[i]?.deviceId||'':'';});say(`${devices.length}台を確認しました。内蔵・USBの名前と映像を確認してください。`);
  }catch(e){say(e.message);}finally{temporary?.getTracks().forEach(t=>t.stop());phase='idle';controls();}
}
async function start(){
  if(phase!=='idle')return;const chosen=ids.map(id=>({id,deviceId:$('select'+id).value,label:$('select'+id).selectedOptions[0]?.textContent})).filter(c=>c.deviceId);
  if(chosen.length<2||new Set(chosen.map(c=>c.deviceId)).size!==chosen.length){say('異なるカメラを2〜3台選択してください。');return;}
  if(!('requestVideoFrameCallback'in HTMLVideoElement.prototype)){say('最新版のChromeまたはEdgeが必要です。');return;}
  if((logs2d.length||logs3d.length)&&!confirm('新しい取得を開始すると未保存の座標ログが消えます。保存済みですか？'))return;
  const token=++generation;phase='opening';buffers.clear();engine?.reset();intrinsics=null;logs2d=[];logs3d=[];logCounts={};lastKey='';$('logging').checked=false;$('rigConfirmed').checked=false;controls();say('カメラと各視点の推定器を準備しています。');
  sessionMeta={startedAt:new Date().toISOString(),timeOriginMs:performance.timeOrigin,requestedInferenceFps:Number($('inferenceFps').value),cameras:[]};
  $('cameras').dataset.count=String(chosen.length);ids.forEach(id=>$('cam'+id).hidden=!chosen.some(c=>c.id===id));
  const [width,height]=$('resolution').value.split('x').map(Number);
  try{for(const item of chosen){
    const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{deviceId:{exact:item.deviceId},width:{ideal:width},height:{ideal:height},frameRate:{ideal:30}}});
    if(token!==generation||document.hidden){stream.getTracks().forEach(t=>t.stop());throw Error('開始を取り消しました。');}
    const track=stream.getVideoTracks()[0];if(track.getSettings().deviceId!==item.deviceId){stream.getTracks().forEach(t=>t.stop());throw Error('選択機器と取得機器が一致しません。');}
    const c={...item,stream,track,video:$('video'+item.id),canvas:$('canvas'+item.id),snapshot:document.createElement('canvas'),work:document.createElement('canvas'),ready:false,busy:false,last:performance.now(),lastDispatch:-Infinity,count:0};cameras.push(c);c.deviceHash=await deviceHash(c.deviceId);if(token!==generation)throw Error('停止済みです。');
    c.video.srcObject=stream;await Promise.race([c.video.play(),new Promise((_,reject)=>setTimeout(()=>reject(Error('映像取得が時間切れです。')),10000))]);if(token!==generation)throw Error('停止済みです。');
    for(const canvas of [c.canvas,c.snapshot,c.work]){canvas.width=c.video.videoWidth;canvas.height=c.video.videoHeight;}
    sessionMeta.cameras.push({id:c.id,label:c.label,deviceHash:c.deviceHash,width:c.canvas.width,height:c.canvas.height,frameRate:c.track.getSettings().frameRate??null});
    c.worker=new Worker('hand-worker.js');c.initTimer=setTimeout(()=>fail(`カメラ${c.id}: モデル初期化が時間切れです。`),45000);
    c.worker.onerror=()=>fail(`カメラ${c.id}: 推定器エラー`);
    c.worker.onmessage=({data})=>{if(token!==generation)return;if(data.type==='ready'){clearTimeout(c.initTimer);c.ready=true;$('state'+c.id).textContent=`推定 ${data.delegate}`;return;}if(data.type==='error'){fail(`カメラ${c.id}: ${data.message}`);return;}if(data.type==='result'&&c.pending){const frame={...c.pending,landmarks:data.result.landmarks,handedness:data.result.handedness};c.pending=null;c.busy=false;receive(c,frame);}};
    c.worker.postMessage({type:'init'});track.addEventListener('ended',()=>{if(cameras.includes(c))fail(`カメラ${c.id}が切断されました。`);});$('cam'+c.id).hidden=false;
    const observe=(now,metadata)=>{
      if(token!==generation)return;if(c.video.videoWidth!==c.canvas.width||c.video.videoHeight!==c.canvas.height){fail(`カメラ${c.id}の実解像度が途中で変化したため停止しました。再校正してください。`);return;}c.last=now;c.metadata={hostMs:now,presentationMs:Number.isFinite(metadata.presentationTime)?metadata.presentationTime:now,mediaTime:metadata.mediaTime,captureTime:Number.isFinite(metadata.captureTime)?metadata.captureTime:null,presentedFrames:metadata.presentedFrames};c.snapshot.getContext('2d').drawImage(c.video,0,0,c.snapshot.width,c.snapshot.height);
      if(c.ready&&!c.busy&&now-c.lastDispatch>=1000/Number($('inferenceFps').value))void infer(c,token);
      c.callback=c.video.requestVideoFrameCallback(observe);
    };c.callback=c.video.requestVideoFrameCallback(observe);
    $('info'+c.id).textContent=`${c.label} / ${c.canvas.width} × ${c.canvas.height} / 左右反転なし`;
  }phase='live';$('status').textContent=`${cameras.length}視点・手指推定中`;say('各画像の同じ片手を確認してください。共通XYZにはカメラ校正が必要です。');}
  catch(e){if(token===generation)fail(e.message);}finally{controls();}
}
async function infer(c,token){
  c.busy=true;c.lastDispatch=performance.now();c.work.getContext('2d').drawImage(c.snapshot,0,0);c.pending={id:c.id,frame:++c.count,width:c.canvas.width,height:c.canvas.height,...c.metadata,alignedMs:c.metadata.presentationMs,timestampKind:'PRESENTATION_TIME_NOT_EXPOSURE'};
  try{const bitmap=await createImageBitmap(c.work);if(token!==generation){bitmap.close();return;}c.worker.postMessage({type:'frame',bitmap,time:c.pending.hostMs},[bitmap]);}catch(e){if(token===generation)fail(e.message);}
}
function receive(c,frame){
  const ctx=c.canvas.getContext('2d');ctx.drawImage(c.work,0,0);ctx.strokeStyle='#27e9b0';ctx.fillStyle='#ffcd49';ctx.lineWidth=2;
  for(const hand of frame.landmarks){ctx.beginPath();for(const[a,b]of CONNECTIONS){if(!hand[a]||!hand[b])continue;ctx.moveTo(hand[a].x*c.canvas.width,hand[a].y*c.canvas.height);ctx.lineTo(hand[b].x*c.canvas.width,hand[b].y*c.canvas.height);}ctx.stroke();for(const p of hand){ctx.beginPath();ctx.arc(p.x*c.canvas.width,p.y*c.canvas.height,3,0,Math.PI*2);ctx.fill();}}
  $('state'+c.id).textContent=`${frame.landmarks.length}手 / ${Math.round(performance.now()-frame.hostMs)}ms処理`;const list=buffers.get(c.id)||[];list.push(frame);if(list.length>8)list.shift();buffers.set(c.id,list);
  if($('logging').checked){if((logCounts[c.id]||0)>=1000){$('logging').checked=false;say('座標記録の上限に達しました。ログを保存してください。');}else{logCounts[c.id]=(logCounts[c.id]||0)+1;logs2d.push({...frame,calibrationId:calibration?.id||null});}}
  updateFusion();$('logStatus').textContent=`2D ${logs2d.length}推定 / 統合 ${logs3d.length}組`;controls();
}
function clear3D(reason){lastGood=0;view?.update([]);missingRows();$('fusionStatus').textContent=reason;}
function logFusion(selection,result){
  if(!$('logging').checked)return;
  if(logs3d.length>=1000){$('logging').checked=false;say('統合座標ログの上限です。保存してください。');return;}
  const frames=selection?.frames||[...buffers.values()].map(list=>list.at(-1)).filter(Boolean),key=frames.map(f=>`${f.id}:${f.frame}`).join('|');
  if(logs3d.at(-1)?.key===key)return;
  logs3d.push({sample:logs3d.length+1,key,calibrationId:calibration.id,toleranceMs:Number($('tolerance').value),frames:frames.map(f=>({id:f.id,frame:f.frame,hostMs:f.hostMs,presentationMs:f.presentationMs})),sourceObservations:structuredClone(frames),...result,points:result.points.length?result.points:Array.from({length:21},(_,joint)=>({joint,valid:false,reason:result.reason}))});
}
function calibrationMatches(){return calibration&&cameras.length===calibration.cameras.length&&cameras.every(c=>calibration.cameras.some(k=>k.id===c.id&&k.deviceHash===c.deviceHash&&k.width===c.canvas.width&&k.height===c.canvas.height));}
function updateFusion(){
  if(busyCalibration){clear3D('校正処理中');return;}if(!calibrationMatches()){clear3D(calibration?'校正時と機器・解像度・視点数が一致しません':'校正が必要です');return;}
  if(!$('rigConfirmed').checked||!$('explore').checked){clear3D('カメラ配置と探索表示の確認が必要です');return;}
  const selection=selectFrames(buffers,performance.now(),Number($('tolerance').value)),result=fuseFrames(selection,calibration);
  if(!selection||result.status==='MISSING'){clear3D(result.reason||'対応フレームなし');logFusion(selection,result);return;}
  const key=selection.frames.map(f=>`${f.id}:${f.frame}`).join('|');if(key===lastKey)return;lastKey=key;lastGood=performance.now();view?.update(result.points);
  if(result.valid>=3&&framedCalibration!==calibration.id){view?.fit();framedCalibration=calibration.id;}
  $('fusionStatus').textContent=`有効 ${result.valid}/21点 / 表示時刻差 ${result.deltaMs.toFixed(1)}ms / 同期未検証`;
  for(const row of $('points').rows){const p=result.points[Number(row.dataset.joint)];for(let i=0;i<3;i++)row.cells[i+1].textContent=p.valid?p.xyz[i].toFixed(2):'欠測';row.cells[4].textContent=p.valid?p.views.join('+'):p.reason;row.cells[5].textContent=p.valid?p.reprojectionPx.toFixed(2):'--';}
  logFusion(selection,result);
}
function stop(){++generation;phase='idle';calWorker?.terminate();calWorker=null;rejectCalibration?.(Error('停止しました。'));rejectCalibration=null;busyCalibration=false;
  for(const c of cameras){clearTimeout(c.initTimer);c.worker?.terminate();c.video.cancelVideoFrameCallback(c.callback);c.stream.getTracks().forEach(t=>t.stop());c.video.srcObject=null;for(const canvas of [c.canvas,c.snapshot,c.work])canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);$('state'+c.id).textContent='停止';}if(sessionMeta)sessionMeta.stoppedAt=new Date().toISOString();cameras=[];buffers.clear();lastKey='';clear3D('停止中');$('status').textContent='全停止';$('rigConfirmed').checked=false;controls();}
function fail(text){stop();say(text);}
async function withCalibration(work){if(busyCalibration||phase!=='live')return;busyCalibration=true;controls();clear3D('校正処理中');const token=generation;try{engine??=new CalibrationEngine(await loadCV());if(token!==generation)return;await work(token);}catch(e){say(`校正: ${e.message}`);}finally{if(token===generation){busyCalibration=false;controls();}}}
async function stableBoard(token){
  if(cameras.some(c=>performance.now()-c.last>750))throw Error('新しいカメラ映像がありません。');
  const first=cameras.map(c=>engine.detect(c.snapshot));await new Promise(r=>setTimeout(r,400));if(token!==generation)throw Error('停止済みです。');
  const second=cameras.map(c=>engine.detect(c.snapshot));if(second.some((d,i)=>!stableDetections(first[i],d)))throw Error('全カメラで校正板の12点以上を静止状態で検出できません。板を止め、反射・ピンぼけを確認してください。');return second;
}
$('captureCalibration').addEventListener('click',()=>withCalibration(async token=>{const rows=await stableBoard(token);if(cameras.some(c=>(engine.samples.get(c.id)?.length||0)>=30))throw Error('最大30組です。');rows.forEach((d,i)=>engine.add(cameras[i].id,d));intrinsics=null;calibration=null;$('rigConfirmed').checked=false;$('calibrationStatus').textContent='校正画像を収集中';say(`${engine.samples.get(cameras[0].id).length}組を追加。次は位置と傾きを変えて静止してください。`);}));
$('solveCalibration').addEventListener('click',()=>withCalibration(async token=>{
  const result=await new Promise((resolve,reject)=>{rejectCalibration=reject;calWorker=new Worker('calibration-worker.js');const timer=setTimeout(()=>reject(Error('校正計算が120秒以内に終了しません。')),120000);calWorker.onerror=()=>{clearTimeout(timer);reject(Error('校正Workerエラー'));};calWorker.onmessage=({data})=>{if(data.type==='progress')say(`カメラ${data.id}の内部校正を計算中`);else{clearTimeout(timer);data.type==='result'?resolve(data.results):reject(Error(data.message));}};calWorker.postMessage({samples:[...engine.samples],cameras:cameras.map(c=>({id:c.id,deviceHash:c.deviceHash,label:c.label}))});}).finally(()=>{calWorker?.terminate();calWorker=null;rejectCalibration=null;});
  if(token!==generation)return;intrinsics=result;calibration=null;$('calibrationStatus').textContent='内部校正完了・共通原点は未設定';say('板を全カメラの共通領域に静止させて、共通原点を設定してください。');}));
$('setOrigin').addEventListener('click',()=>withCalibration(async token=>{if(!intrinsics)throw Error('内部校正を先に行ってください。');const rows=await stableBoard(token),cams=rows.map((d,i)=>engine.pose(d,intrinsics.find(k=>k.id===cameras[i].id)));calibration=makeCalibration(cams);retainCalibration(calibration);lastKey='';$('rigConfirmed').checked=false;$('calibrationStatus').textContent=`校正ID: ${calibration.id} / mm尺度・実機精度未検証`;say('共通座標を設定しました。校正JSONを保存し、板を除いて同じ片手を映してください。');}));
$('resetCalibration').addEventListener('click',()=>{if(!confirm('現在の校正をリセットしますか？'))return;engine?.reset();intrinsics=calibration=null;$('rigConfirmed').checked=false;$('calibrationStatus').textContent='未校正';clear3D('校正が必要です');controls();});
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
$('saveCalibration').addEventListener('click',()=>{if(calibration)download(new Blob([JSON.stringify(calibration,null,2)],{type:'application/json'}),'handmotion_calibration.json');});
$('loadCalibration').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>1000000)throw Error('校正JSONが大きすぎます。');const c=validateCalibration(JSON.parse(await file.text()));if(calibrationHistory.has(c.id)&&JSON.stringify(calibrationHistory.get(c.id))!==JSON.stringify(c))throw Error('同じ校正IDに異なる値があります。新しいIDで保存してください。');calibration=c;retainCalibration(c);intrinsics=null;$('rigConfirmed').checked=false;lastKey='';$('calibrationStatus').textContent=`読み込み: ${c.id} / 機器・配置の再確認が必要`;say('校正を読み込みました。カメラID・解像度が一致する必要があります。');}catch(e){say(e.message);}finally{e.target.value='';controls();}});
$('export').addEventListener('click',async()=>{
  $('export').disabled=true;try{const zip=new JSZip(),raw=logs2d.slice(),fused=logs3d.slice();
    for(const id of ids){const rows=[];for(const f of raw.filter(f=>f.id===id)){const base={frame:f.frame,host_ms:f.hostMs,presentation_ms:f.presentationMs,media_pts_s:f.mediaTime,capture_time_ms:f.captureTime,width:f.width,height:f.height,calibration_id:f.calibrationId};if(!f.landmarks.length)rows.push({...base,status:'NO_HAND'});f.landmarks.forEach((hand,h)=>hand.forEach((p,j)=>rows.push({...base,hand_slot:h,joint:j,x_normalized:p.x,y_normalized:p.y,x_px:p.x*f.width,y_px:p.y*f.height,z_model_relative:p.z,status:'MODEL_ESTIMATE'})));}if(rows.length)zip.file(`coordinates/2d_${id}.csv`,csv(rows,['frame','host_ms','presentation_ms','media_pts_s','capture_time_ms','width','height','hand_slot','joint','x_normalized','y_normalized','x_px','y_px','z_model_relative','status','calibration_id']));}
    const rows=fused.flatMap(f=>f.points.map(p=>({sample:f.sample,calibration_id:f.calibrationId,source_frames:f.frames.map(v=>`${v.id}:${v.frame}`).join('|'),joint:p.joint,x_mm:p.valid?p.xyz[0]:null,y_mm:p.valid?p.xyz[1]:null,z_mm:p.valid?p.xyz[2]:null,views:p.views?.join('|'),excluded_views:p.excluded?.join('|'),reprojection_px:p.reprojectionPx,ray_angle_deg:p.rayAngleDeg,frame_delta_ms:f.deltaMs,status:p.valid?f.status:'MISSING',missing_reason:p.reason})));
    zip.file('coordinates/fused_3d.csv',csv(rows,['sample','calibration_id','source_frames','joint','x_mm','y_mm','z_mm','views','excluded_views','reprojection_px','ray_angle_deg','frame_delta_ms','status','missing_reason']));
    zip.file('reports/fusion_qc.json',JSON.stringify(fused,null,2));if(calibration)zip.file('calibration.json',JSON.stringify(calibration,null,2));for(const [id,c]of calibrationHistory)zip.file(`calibrations/${id}.json`,JSON.stringify(c,null,2));
    zip.file('manifest.json',JSON.stringify({app:'HandMotion fusion',version:FUSION_VERSION,exportedAt:new Date().toISOString(),session:sessionMeta,units:'mm',pixelConvention:PIXEL_CONVENTION,recording:false,upload:false,exposureSync:'UNVERIFIED',syncUncertaintyMs:null,physicalIndentation:'NOT_MEASURED',model:'unchanged MediaPipe Hand Landmarker',qc:QC,selectionToleranceMs:Number($('tolerance').value),rawFrames:raw.length,fusionSamples:fused.length,limitations:['One hand only; handedness is not used as identity proof.','AI-inferred points may be occluded.','Low reprojection error does not validate physical accuracy.','No synchronization correction or interpolation.']},null,2));
    zip.file('README_RESULTS_ja.txt','coordinates/2d_*.csv: 各画像の元モデル座標。\ncoordinates/fused_3d.csv: 共通校正座標XYZ(mm)。空欄は欠測。\nreports/fusion_qc.json: 使用フレーム・点別QC。\ncalibration.json: 校正値。\nCSVはUTF-8 BOM付き。幾何推定は同期未検証。押し込み量ではありません。動画は含みません。\n');download(await zip.generateAsync({type:'blob'}),`handmotion_fusion_${Date.now()}.zip`);
  }catch(e){say(`ZIP保存: ${e.message}`);}finally{controls();}
});
$('refresh').addEventListener('click',refresh);$('start').addEventListener('click',start);$('stop').addEventListener('click',stop);$('boardConfirmed').addEventListener('change',controls);for(const id of ['rigConfirmed','explore','tolerance'])$(id).addEventListener('change',()=>{lastKey='';updateFusion();});$('fit').addEventListener('click',()=>view?.fit());$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('geometry').requestFullscreen();}catch(e){say(e.message);}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&phase!=='idle')stop();});window.addEventListener('pagehide',stop);
window.addEventListener('beforeunload',e=>{if(logs2d.length||logs3d.length){e.preventDefault();e.returnValue='';}});
setInterval(()=>{if(phase==='live'){const now=performance.now();if(cameras.some(c=>now-c.last>5000||c.busy&&now-c.lastDispatch>15000))fail('映像または推定の更新が停止しました。');else if(lastGood>0&&now-lastGood>750)clear3D('新しい統合結果を待っています（古い座標は非表示）');}},250);controls();
