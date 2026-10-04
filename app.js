import {VERSION,MAX_FRAMES,CONNECTIONS,FLAG_LABELS,roiRect,quality,makeFrame,bundle,syntheticHand} from './core.mjs';
import {HandView} from './view3d.mjs';
import {JOINT_NAMES,relativePoints} from './coordinates.mjs';
const $=id=>document.getElementById(id), video=$('video'), canvas=$('overlay'),ctx=canvas.getContext('2d');
const source=document.createElement('canvas'), sourceCtx=source.getContext('2d',{willReadFrequently:true});
const cropped=document.createElement('canvas'),cropCtx=cropped.getContext('2d');
const lightCanvas=document.createElement('canvas');lightCanvas.width=64;lightCanvas.height=64;
const lightCtx=lightCanvas.getContext('2d',{willReadFrequently:true});
let view,session=null,active=false,controller,stream,worker,objectURL,pending=null,lastFrame=null,detectedFrames=0;
try{view=new HandView($('threeView'));}catch(e){showError('3D表示を初期化できません。Chrome/EdgeのWebGL設定を確認してください。 '+e.message);}
function showError(message){$('error').textContent=message;$('error').hidden=false;}
function modeUI(){$('cameraOptions').hidden=$('inputMode').value!=='camera';$('videoOptions').hidden=$('inputMode').value!=='video';}
$('inputMode').addEventListener('change',modeUI);
$('mirror').addEventListener('change',()=>canvas.classList.toggle('mirrored',$('mirror').checked));canvas.classList.toggle('mirrored',$('mirror').checked);
$('joint').replaceChildren(...JOINT_NAMES.map((name,i)=>new Option(`${i}: ${name}`,i)));$('joint').value='8';
function update3D(){
  const hand=lastFrame?.hands[+$('handSlot').value],origin=$('coordinateOrigin').value,joint=+$('joint').value;
  view?.update(hand?.world,origin,joint);const p=relativePoints(hand?.world,origin)[joint];
  for(const axis of ['X','Y','Z'])$('coord'+axis).textContent=p?`${(p[axis.toLowerCase()]*1000).toFixed(1)}`:'--';
  $('coordinateStatus').textContent=p?`${origin==='wrist'?'手首基準':'モデル原点基準'} / モデル相対値（mm換算・実測ではない）`:'未検出 / モデル相対値（mm換算）';
}
for(const id of ['handSlot','coordinateOrigin','joint'])$(id).addEventListener('change',update3D);
$('threeView').addEventListener('viewchange',({detail})=>{
  $('yaw').value=detail.yaw;$('pitch').value=detail.pitch;$('zoom').value=detail.distance*100;
  $('yawValue').textContent=`${Math.round(detail.yaw)}°`;$('pitchValue').textContent=`${Math.round(detail.pitch)}°`;$('viewPreset').value='free';
});
for(const id of ['yaw','pitch'])$(id).addEventListener('input',()=>view?.setAngles(+$('yaw').value,+$('pitch').value));
$('zoom').addEventListener('input',()=>view?.setDistance(+$('zoom').value/100));
$('viewPreset').addEventListener('change',()=>{const preset=$('viewPreset').value;view?.preset(preset);$('viewPreset').value=preset;});
$('reset3d').addEventListener('click',()=>view?.reset());
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch(e){showError('全画面表示できません: '+e.message);}});
$('refresh').addEventListener('click',async()=>{
  try{const cameras=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');$('camera').replaceChildren(new Option('既定のカメラ',''),...cameras.map((d,i)=>new Option(d.label||`カメラ ${i+1}`,d.deviceId)));}
  catch(e){showError('カメラ一覧を取得できません: '+e.message);}
});
function abortError(){return new DOMException('停止しました','AbortError');}
function eventOnce(target,name,signal,timeout=15000){return new Promise((resolve,reject)=>{
  const finish=(error)=>{clearTimeout(timer);target.removeEventListener(name,ok);target.removeEventListener('error',bad);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
  const ok=()=>finish(),bad=()=>finish(new Error('動画を読み込めません。ブラウザ対応のMP4/WebMをお試しください。')),abort=()=>finish(abortError());
  const timer=setTimeout(()=>finish(new Error('動画の読み込みがタイムアウトしました')),timeout);
  target.addEventListener(name,ok,{once:true});target.addEventListener('error',bad,{once:true});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
});}
function wait(ms,signal){return new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(abortError());};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});}
function callWorker(message,transfer=[],timeout=45000){return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending=null;reject(new Error('推定処理がタイムアウトしました'));},timeout);
  pending={resolve:value=>{clearTimeout(timer);pending=null;resolve(value);},reject:error=>{clearTimeout(timer);pending=null;reject(error);}};
  try{worker.postMessage(message,transfer);}catch(error){pending.reject(error);}
});}
async function initWorker(){
  worker=new Worker('./hand-worker.js');
  worker.onmessage=({data})=>{if(data.type==='error')pending?.reject(new Error(data.message));else pending?.resolve(data);};
  worker.onerror=event=>pending?.reject(new Error(event.message||'Workerの実行に失敗しました'));
  return callWorker({type:'init'},[],90000);
}
function setControls(running){$('settings').disabled=running;$('start').disabled=running;$('stop').disabled=!running;for(const id of ['zip','csv','summary'])$(id).disabled=running||!session?.frames.length;}
function release(){
  if(stream){for(const track of stream.getTracks())track.stop();stream=null;}
  video.pause();video.srcObject=null;video.removeAttribute('src');video.load();
  if(objectURL){URL.revokeObjectURL(objectURL);objectURL=null;}
  pending?.reject(abortError());worker?.terminate();worker=null;
}
function stop(reason='USER_STOP'){
  if(!active)return;
  if(session)session.completion=reason;
  controller?.abort();release();
}
$('stop').addEventListener('click',()=>stop());
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop('TAB_HIDDEN');});
window.addEventListener('pagehide',()=>stop('PAGE_CLOSED'));
function settings(){return {fps:+$('fps').value,expected:+$('expected').value,roi_scale:+$('roiScale').value,roi_center_x:+$('roiX').value/100,roi_center_y:+$('roiY').value/100,glove:$('glove').value,notes:$('notes').value,thresholds:{detection:.5,presence:.5,tracking:.5},smoothing:'none',max_frames:MAX_FRAMES};}
function capture(){
  const w=video.videoWidth,h=video.videoHeight;if(!w||!h)throw new Error('映像サイズを取得できません');
  source.width=w;source.height=h;sourceCtx.drawImage(video,0,0);
  const s=session.settings,roi=roiRect(w,h,s.roi_scale,s.roi_center_x,s.roi_center_y);
  cropped.width=roi.w;cropped.height=roi.h;cropCtx.drawImage(source,roi.x,roi.y,roi.w,roi.h,0,0,roi.w,roi.h);
  lightCtx.drawImage(cropped,0,0,64,64);const rgba=lightCtx.getImageData(0,0,64,64).data;let bright=0;
  for(let i=0;i<rgba.length;i+=4)if(rgba[i]>=250&&rgba[i+1]>=250&&rgba[i+2]>=250)bright++;
  return {width:w,height:h,roi,brightFraction:bright/4096};
}
function consume(result,meta){
  const flags=quality(result,session.settings.expected,meta.roi,meta.width,meta.height,meta.brightFraction);
  const frame=makeFrame(result,{...meta,index:session.frames.length,flags});session.frames.push(frame);lastFrame=frame;
  if(frame.hands.length)detectedFrames++;
  canvas.width=meta.width;canvas.height=meta.height;ctx.drawImage(source,0,0);ctx.lineWidth=Math.max(2,meta.width/500);
  ctx.strokeStyle='#f5be42';ctx.setLineDash([8,6]);ctx.strokeRect(meta.roi.x,meta.roi.y,meta.roi.w,meta.roi.h);ctx.setLineDash([]);
  frame.hands.forEach((hand,i)=>{
    ctx.strokeStyle=i?'#ffbd52':'#59ecc4';ctx.fillStyle=ctx.strokeStyle;
    for(const [a,b] of CONNECTIONS){const p=hand.image[a],q=hand.image[b];if(!p||!q)continue;ctx.beginPath();ctx.moveTo(p.x*meta.width,p.y*meta.height);ctx.lineTo(q.x*meta.width,q.y*meta.height);ctx.stroke();}
    for(const p of hand.image){if(!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;ctx.beginPath();ctx.arc(p.x*meta.width,p.y*meta.height,Math.max(3,meta.width/220),0,Math.PI*2);ctx.fill();}
  });
  $('empty').hidden=true;$('sourceTime').textContent=`${meta.time_s.toFixed(2)} s`;$('dimensions').textContent=`${meta.width} × ${meta.height}`;
  $('detected').textContent=`検出 ${frame.hands.length} 手`;$('frameCount').textContent=session.frames.length;
  $('coverage').textContent=`${(100*detectedFrames/session.frames.length).toFixed(1)}%`;
  $('qcState').textContent=flags.length?flags.map(f=>FLAG_LABELS[f]).join(' / '):'警告なし（精度未検証）';
  update3D();
}
async function infer(time_s,signal){
  signal.throwIfAborted();const meta=capture();const bitmap=await createImageBitmap(cropped);
  if(signal.aborted){bitmap.close();throw abortError();}
  const started=performance.now();const data=await callWorker({type:'frame',bitmap,time:time_s*1000+1},[bitmap]);signal.throwIfAborted();consume(data.result,{...meta,time_s,processed_at_utc:new Date().toISOString(),inference_ms:performance.now()-started});
}
async function seek(time,signal){
  if(Math.abs(video.currentTime-time)<.00001&&video.readyState>=2)return;
  const ready=eventOnce(video,'seeked',signal);video.currentTime=time;await ready;
}
async function runVideo(file,signal){
  objectURL=URL.createObjectURL(file);const ready=eventOnce(video,'loadeddata',signal);video.src=objectURL;video.load();await ready;
  if(!Number.isFinite(video.duration)||video.duration<=0)throw new Error('動画長を取得できません。通常のMP4/WebMファイルで再確認してください。');
  session.source={type:'video',filename:file.name,duration_s:video.duration};
  const total=Math.ceil(video.duration*session.settings.fps),count=Math.min(total,MAX_FRAMES);
  for(let i=0;i<count;i++){
    await seek(i/session.settings.fps,signal);await infer(video.currentTime,signal);
    $('progressBar').value=(i+1)/total;$('progressText').textContent=`${i+1} / ${total} フレーム`;
  }
  session.completion=total>MAX_FRAMES?'FRAME_LIMIT':'COMPLETE';
}
async function runCamera(signal){
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('カメラにはlocalhostまたはHTTPSが必要です。');
  const acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{deviceId:$('camera').value?{exact:$('camera').value}:undefined,width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30}}});
  if(signal.aborted){acquired.getTracks().forEach(t=>t.stop());throw abortError();}
  stream=acquired;const ready=eventOnce(video,'loadeddata',signal);video.srcObject=stream;await Promise.all([video.play(),ready]);
  stream.getVideoTracks()[0].addEventListener('ended',()=>stop('CAMERA_ENDED'),{once:true});
  const track=stream.getVideoTracks()[0].getSettings();session.source={type:'camera',width:track.width,height:track.height,requested_fps:30,camera_fps:track.frameRate};
  const origin=video.currentTime;let last=-Infinity;
  while(session.frames.length<MAX_FRAMES){
    signal.throwIfAborted();const t=video.currentTime-origin;
    if(t-last>=1/session.settings.fps){last=t;await infer(t,signal);$('progressText').textContent=`計測中 / ${session.frames.length} フレーム`;$('progressBar').value=session.frames.length/MAX_FRAMES;}
    await wait(10,signal);
  }
  session.completion='FRAME_LIMIT';
}
async function runDemo(signal){
  session.source={type:'synthetic'};session.delegate='none';source.width=960;source.height=720;
  while(session.frames.length<MAX_FRAMES){
    signal.throwIfAborted();const t=session.frames.length/session.settings.fps;
    sourceCtx.fillStyle='#28373a';sourceCtx.fillRect(0,0,960,720);
    consume(syntheticHand(t),{width:960,height:720,roi:{x:0,y:0,w:960,h:720},time_s:t,brightFraction:0});
    $('progressText').textContent='合成動作デモ / 実測データではありません';await wait(1000/session.settings.fps,signal);
  }
  session.completion='FRAME_LIMIT';
}
$('start').addEventListener('click',async()=>{
  if(active)return;
  const mode=$('inputMode').value,file=$('file').files[0],options=settings();
  if(!Number.isInteger(options.fps)||options.fps<1||options.fps>30){showError('sample fpsは1～30の整数にしてください');return;}
  if(mode==='video'&&!file){showError('動画ファイルを選択してください');return;}
  if(session?.frames.length&&!confirm('前の座標データをメモリから置き換えます。必要な結果をダウンロード済みですか？'))return;
  active=true;controller=new AbortController();const signal=controller.signal;
  session={created_at:new Date().toISOString(),kind:mode==='demo'?'SYNTHETIC_DEMO':'MODEL_ESTIMATE',settings:options,frames:[],completion:'RUNNING',delegate:null};
  detectedFrames=0;lastFrame=null;update3D();ctx.clearRect(0,0,canvas.width,canvas.height);$('empty').hidden=false;$('detected').textContent='検出 0 手';$('qcState').textContent='--';$('sourceTime').textContent='0.00 s';$('progressText').textContent='準備中';$('error').hidden=true;$('frameCount').textContent='0';$('coverage').textContent='--';$('progressBar').value=0;setControls(true);
  try{
    if(mode!=='demo'){$('status').textContent='モデル読み込み中';const data=await initWorker();signal.throwIfAborted();session.delegate=data.delegate;}
    $('status').textContent=mode==='demo'?'合成動作デモ（実測ではない）':`推定中 / ${session.delegate}`;
    if(mode==='video')await runVideo(file,signal);else if(mode==='camera')await runCamera(signal);else await runDemo(signal);
  }catch(e){if(e.name!=='AbortError'){session.completion='ERROR';session.error=String(e.message);showError('処理を停止しました: '+e.message);}}
  finally{release();active=false;setControls(false);$('status').textContent=session.completion==='ERROR'?'エラー停止':session.completion==='COMPLETE'?'解析完了':session.completion==='FRAME_LIMIT'?'3,000フレームで停止':'停止';}
});
function save(name,content,type){const blob=content instanceof Blob?content:new Blob([content],{type});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
$('csv').addEventListener('click',()=>save(`${session.kind}_landmarks_raw.csv`,bundle(session)['coordinates/landmarks_raw.csv'],'text/csv;charset=utf-8'));
$('summary').addEventListener('click',()=>save(`${session.kind}_summary.json`,bundle(session)['reports/summary.json'],'application/json'));
$('zip').addEventListener('click',async()=>{
  if(active||!session?.frames.length)return;
  $('zip').disabled=true;$('start').disabled=true;
  try{if(!globalThis.JSZip)throw new Error('ZIPライブラリを読み込めません');const zip=new JSZip();for(const [name,text] of Object.entries(bundle(session)))zip.file(name,text);save(`HandMotion_${session.kind}_${session.created_at.replace(/[:.]/g,'-')}.zip`,await zip.generateAsync({type:'blob',compression:'DEFLATE'}));}
  catch(e){showError('ZIP出力に失敗しました: '+e.message);}finally{setControls(false);}
});
modeUI();
