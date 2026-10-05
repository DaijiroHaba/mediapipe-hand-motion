import {SLOTS,MAX_BYTES,MAX_OBSERVATIONS,validateSelection,observation,pairDiagnostic,observedFps,median,csv,OBSERVATION_COLUMNS} from './multicamera-core.mjs';
const $=id=>document.getElementById(id);
let phase='idle',generation=0,cameras=[],session=null,exporting=false,refreshing=false;
let stopPromise=null,finishPromise=null,recordTimer=null,urls=[];
const pairWindows=new Map();
const downloadUrls=new Map();
const message=text=>{$('error').textContent=text;$('error').hidden=!text;};
const activeRecording=()=>session&&['recording','stopping'].includes(session.state);
const number=(v,d=1)=>Number.isFinite(v)?v.toFixed(d):'--';
const settingsForExport=t=>{const s=t.getSettings();return {width:s.width??null,height:s.height??null,frame_rate:s.frameRate??null,aspect_ratio:s.aspectRatio??null};};

for(const id of SLOTS){
  const label=document.createElement('label');label.textContent=`カメラ ${id}${id==='C'?'（任意）':''}`;
  const select=document.createElement('select');select.id=`select${id}`;select.add(new Option('未選択',''));label.append(select);$('cameraSelectors').append(label);
  const view=document.createElement('section');view.className='camera-view';view.id=`view${id}`;
  view.innerHTML=`<h2>カメラ ${id}<span id="state${id}">未接続</span></h2><div class="camera-stage"><video id="video${id}" autoplay muted playsinline></video><span class="placeholder" id="empty${id}">未接続</span><span class="record-indicator" id="rec${id}" hidden>● 録画中</span></div><dl><dt>取得設定</dt><dd id="size${id}">--</dd><dt>観測 fps</dt><dd id="rate${id}">--</dd><dt>表示フレーム番号</dt><dd id="frame${id}">--</dd><dt>captureTime</dt><dd id="capture${id}">未取得</dd><dt>最終観測から</dt><dd id="age${id}">--</dd></dl>`;
  $('cameraGrid').append(view);
}
function renderControls(){
  const recording=activeRecording();
  $('settings').disabled=phase!=='idle'||refreshing||exporting;
  $('start').disabled=phase!=='idle'||refreshing||exporting;
  $('stop').disabled=!['opening','live'].includes(phase);
  const fresh=cameras.length>=2&&cameras.every(c=>c.rows.length&&performance.now()-c.last<2000);
  $('record').disabled=phase!=='live'||!fresh||recording||!!session||exporting;
  $('recordStop').disabled=session?.state!=='recording';
  $('duration').disabled=!!recording;
  $('mark').disabled=session?.state!=='recording';
  const done=session?.state==='done';
  for(const id of ['zip','logs','discard'])$(id).disabled=!done||exporting;
  $('privacy').classList.toggle('is-recording',!!recording);
  $('privacy').querySelector('img').src=recording?'vendor/icons/video.svg':'vendor/icons/video-off.svg';
  $('privacy').querySelector('span').textContent=recording?(session.state==='stopping'?'録画を終了しています':'録画中・端末内に一時保存'):'録画していません';
  for(const id of SLOTS)$(`rec${id}`).hidden=!recording||!session.entries.some(e=>e.id===id&&e.recorder?.state==='recording');
}
async function refreshDevices(){
  if(phase!=='idle'||refreshing)return;
  if(!navigator.mediaDevices?.getUserMedia){message('カメラにはHTTPSまたはlocalhostが必要です。');return;}
  refreshing=true;renderControls();message('');let temporary;
  try{
    temporary=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
    temporary.getTracks().forEach(t=>t.stop());temporary=null;
    const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput'&&d.deviceId);
    const previous=SLOTS.map(id=>$(`select${id}`).value);
    SLOTS.forEach((id,i)=>{const s=$(`select${id}`);s.replaceChildren(new Option('未選択',''),...devices.map((d,j)=>new Option(d.label||`カメラ ${j+1}`,d.deviceId)));s.value=devices.some(d=>d.deviceId===previous[i])?previous[i]:(i<2?devices[i]?.deviceId||'':'');});
    $('status').textContent=`カメラ ${devices.length} 台を検出`;
    if(devices.length<2)message('2台以上のカメラを接続してください。1台のみでは複数カメラ撮影を開始できません。');
  }catch(e){message(`カメラ一覧を取得できません：${e.message}`);}
  finally{temporary?.getTracks().forEach(t=>t.stop());refreshing=false;renderControls();}
}
function observe(cam){
  const next=(now,metadata)=>{
    if(!cameras.includes(cam)||cam.track.readyState!=='live')return;
    const row=observation(now,metadata,++cam.count);cam.last=now;cam.rows.push(row);if(cam.rows.length>120)cam.rows.shift();
    const entry=session?.state==='recording'?session.entries.find(e=>e.id===cam.id):null;
    if(entry){
      if(entry.observations.length<MAX_OBSERVATIONS)entry.observations.push(row);
      else void finishRecording('OBSERVATION_LIMIT');
    }
    cam.callback=cam.video.requestVideoFrameCallback(next);
  };
  cam.callback=cam.video.requestVideoFrameCallback(next);
}
async function startCameras(){
  if(phase!=='idle'||refreshing)return;
  message('');let selected;
  try{
    if(!('requestVideoFrameCallback' in HTMLVideoElement.prototype))throw new Error('フレーム時刻の取得に対応する最新版Chrome/Edgeを使用してください。');
    selected=validateSelection(SLOTS.map(id=>({id,deviceId:$(`select${id}`).value,label:$(`select${id}`).selectedOptions[0].textContent})));
  }catch(e){message(e.message);return;}
  const token=++generation;phase='opening';renderControls();$('status').textContent='カメラを接続中';pairWindows.clear();
  const [width,height]=$('resolution').value.split('x').map(Number);
  try{
    for(const item of selected){
      const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{deviceId:{exact:item.deviceId},width:{ideal:width},height:{ideal:height},frameRate:{ideal:Number($('fps').value)}}});
      if(token!==generation||document.hidden){stream.getTracks().forEach(t=>t.stop());throw new Error('カメラ開始を取り消しました。');}
      const track=stream.getVideoTracks()[0];
      if(!track||track.getSettings().deviceId!==item.deviceId){stream.getTracks().forEach(t=>t.stop());throw new Error('要求したカメラと取得機器の一致を確認できません。');}
      const video=$(`video${item.id}`),cam={...item,stream,track,video,rows:[],count:0,last:performance.now(),callback:null};
      cameras.push(cam);video.srcObject=stream;
      track.addEventListener('ended',()=>{if(cameras.includes(cam)){message(`カメラ ${cam.id} が切断されました。全映像を停止します。`);void stopCameras('CAMERA_ENDED');}});
      await Promise.race([video.play(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('映像の開始がタイムアウトしました。')),10000))]);
      if(token!==generation)throw new Error('カメラ開始を取り消しました。');
      observe(cam);$(`empty${item.id}`).hidden=true;
      const s=settingsForExport(track);$(`size${item.id}`).textContent=`${s.width} × ${s.height} / ${number(s.frame_rate)} fps`;
    }
    phase='live';$('status').textContent=`${cameras.length}台の映像を表示中`;
  }catch(e){if(token===generation){message(e.message);await stopCameras('OPEN_FAILED');}}
  finally{renderControls();}
}
function releaseCameras(){
  for(const c of cameras){c.video.cancelVideoFrameCallback(c.callback);c.stream.getTracks().forEach(t=>t.stop());c.video.srcObject=null;$(`empty${c.id}`).hidden=false;$(`state${c.id}`).textContent='停止';}
  cameras=[];pairWindows.clear();
}
async function stopCameras(reason='USER_STOP'){
  if(stopPromise)return stopPromise;
  ++generation;phase='stopping';renderControls();
  stopPromise=(async()=>{try{await finishRecording(reason);}finally{releaseCameras();phase='idle';$('status').textContent='全カメラ停止';stopPromise=null;renderControls();}})();
  await stopPromise;
}
function pickMime(){
  if(!window.MediaRecorder)throw new Error('このブラウザでは録画できません。Chrome/Edgeを使用してください。');
  const mime=['video/webm;codecs=vp8','video/webm;codecs=vp9','video/webm'].find(m=>MediaRecorder.isTypeSupported(m));
  if(!mime)throw new Error('WebM録画に対応していません。映像表示のみ利用できます。');return mime;
}
function startRecording(){
  if(phase!=='live'||session||exporting)return;message('');
  try{
    const mime=pickMime();
    if(cameras.some(c=>!c.rows.length||performance.now()-c.last>2000))throw new Error('すべてのカメラで新しい映像を受信してから録画してください。');
    session={id:`multicam_${new Date().toISOString().replace(/[:.]/g,'-')}`,state:'recording',started_utc:new Date().toISOString(),time_origin_ms:performance.timeOrigin,requested_at_ms:performance.now(),stop_reason:null,errors:[],events:[],pairs:[],entries:[],bytes:0,max_seconds:Number($('duration').value)};
    const owner=session;
    for(const c of cameras){
      const recorder=new MediaRecorder(c.stream,{mimeType:mime,videoBitsPerSecond:2500000});
      const e={id:c.id,label:c.label,settings:settingsForExport(c.track),recorder,mime_type:recorder.mimeType||mime,observations:[],chunks:[],chunk_events:[],errors:[],started:false,started_call_ms:null,started_event_ms:null,stopped_event_ms:null,blob:null,settled:false};
      e.done=new Promise(resolve=>{e.resolve=resolve;});session.entries.push(e);
      recorder.onstart=()=>{if(session!==owner||e.settled)return;e.started_event_ms=performance.now();renderControls();};
      recorder.ondataavailable=event=>{
        if(session!==owner||e.settled)return;
        e.chunk_events.push({arrival_host_ms:performance.now(),blob_timecode_ms:Number.isFinite(event.timecode)?event.timecode:null,bytes:event.data.size});
        if(event.data.size){e.chunks.push(event.data);session.bytes+=event.data.size;}
        if(session.bytes>=MAX_BYTES)void finishRecording('MEMORY_LIMIT');
      };
      recorder.onerror=event=>{if(session!==owner||e.settled)return;e.errors.push(event.error?.message||'録画エラー');void stopCameras('RECORDER_ERROR');};
      recorder.onstop=()=>{if(session!==owner||e.settled)return;e.stopped_event_ms=performance.now();e.settled=true;e.resolve();if(owner.state==='recording')void stopCameras('RECORDER_STOPPED_UNEXPECTEDLY');};
    }
    for(const e of session.entries){e.started_call_ms=performance.now();try{e.recorder.start(500);e.started=true;}catch(error){e.errors.push(error.message);throw error;}}
    $('resultStatus').textContent='録画中';$('eventCount').textContent='0 件';
    recordTimer=setTimeout(()=>void finishRecording('DURATION_LIMIT'),session.max_seconds*1000);renderControls();
  }catch(e){message(`録画を開始できません：${e.message}`);if(session){session.errors.push(e.message);void stopCameras('START_FAILED');}else renderControls();}
}
async function finishRecording(reason='USER_RECORD_STOP'){
  if(finishPromise)return finishPromise;
  if(!session||session.state!=='recording')return;
  session.state='stopping';session.stop_reason=reason;session.stop_requested_ms=performance.now();clearTimeout(recordTimer);renderControls();
  finishPromise=(async()=>{
    try{
      await Promise.all(session.entries.map(async e=>{
        try{if(e.recorder.state!=='inactive')e.recorder.stop();else if(!e.started){e.settled=true;e.resolve();}}
        catch(error){e.errors.push(error.message);e.settled=true;e.resolve();}
        let timer;
        await Promise.race([e.done,new Promise(resolve=>{timer=setTimeout(()=>{e.errors.push('STOP_TIMEOUT');e.settled=true;e.recorder.onstart=e.recorder.onstop=e.recorder.ondataavailable=e.recorder.onerror=null;releaseCameras();phase='idle';$('status').textContent='全カメラ停止';resolve();},8000);})]);clearTimeout(timer);
        e.blob=new Blob(e.chunks,{type:e.mime_type});e.chunks=[];
        if(!e.blob.size)e.errors.push('EMPTY_RECORDING');
      }));
      session.state='done';session.finished_utc=new Date().toISOString();
      $('resultStatus').textContent=`${session.entries.length}台 / ${number(session.bytes/1048576)} MiB / ${reason}`;
      if(session.entries.some(e=>e.errors.length))message('一部の録画に問題があります。取得済み動画とログを保存し、manifestのerrorsを確認してください。');
      buildDownloads();
    }finally{finishPromise=null;renderControls();}
  })();
  await finishPromise;
}
function markEvent(){
  if(session?.state!=='recording')return;
  const event={id:session.events.length+1,kind:'MANUAL_UI_EVENT_NOT_OPTICAL_SYNC',host_time_ms:performance.now(),latest_observations:cameras.map(c=>({camera:c.id,observation_id:c.rows.at(-1)?.observation_id??null,media_pts_s:c.rows.at(-1)?.media_pts_s??null}))};
  session.events.push(event);$('eventCount').textContent=`${session.events.length} 件`;
}
function manifest(){
  return {schema_version:'1.0',app:'HandMotion multicamera P1',session_id:session.id,started_utc:session.started_utc,finished_utc:session.finished_utc,time_origin_ms:session.time_origin_ms,requested_at_ms:session.requested_at_ms,stop_requested_ms:session.stop_requested_ms,stop_reason:session.stop_reason,errors:session.errors,max_seconds:session.max_seconds,total_video_bytes:session.bytes,audio:false,upload:false,exposure_sync:'UNVERIFIED',recorded_frame_mapping:'NOT_VERIFIED',calibration:'NOT_IMPLEMENTED',geometric_3d:'NOT_IMPLEMENTED',note:'preview observation_id/presented_frames are not decoded recording frame IDs; presentation deltas do not measure exposure synchronization',cameras:session.entries.map(e=>({camera_id:e.id,label:e.label,settings:e.settings,mime_type:e.mime_type,video:e.blob.size?`videos/camera_${e.id}.webm`:null,video_bytes:e.blob.size,video_status:e.errors.length?'ERROR_OR_PARTIAL':'RECORDED_NOT_DECODE_VERIFIED',errors:e.errors,record_start_call_ms:e.started_call_ms,record_start_event_ms:e.started_event_ms,record_stop_event_ms:e.stopped_event_ms,observation_count:e.observations.length,observations:`timing/camera_${e.id}_observations.csv`,chunk_events:e.chunk_events})),manual_events:session.events,presentation_comparisons:session.pairs};
}
function download(blob,name){
  const prior=downloadUrls.get(name);if(prior)URL.revokeObjectURL(prior);
  const url=URL.createObjectURL(blob),a=document.createElement('a');downloadUrls.set(name,url);a.href=url;a.download=name;a.click();setTimeout(()=>{URL.revokeObjectURL(url);if(downloadUrls.get(name)===url)downloadUrls.delete(name);},60000);
}
function buildDownloads(){
  urls.forEach(URL.revokeObjectURL);urls=[];$('downloads').replaceChildren();
  for(const e of session.entries){if(!e.blob.size)continue;const a=document.createElement('a');a.href=URL.createObjectURL(e.blob);urls.push(a.href);a.download=`${session.id}_camera_${e.id}.webm`;a.textContent=`カメラ ${e.id} の動画を保存${e.errors.length?'（要確認）':''}`;$('downloads').append(a);}
}
async function exportZip(){
  if(session?.state!=='done'||exporting)return;exporting=true;renderControls();message('');
  try{
    if(!window.JSZip)throw new Error('ZIPライブラリが読み込めません。個別動画とログJSONを保存してください。');
    const zip=new JSZip();
    for(const e of session.entries){if(e.blob.size)zip.file(`videos/camera_${e.id}.webm`,e.blob);zip.file(`timing/camera_${e.id}_observations.csv`,csv(e.observations,OBSERVATION_COLUMNS));}
    zip.file('manifest.json',JSON.stringify(manifest(),null,2));
    zip.file('README_RESULTS_ja.txt','複数カメラ P1\n動画: videos/（カメラ別WebM・音声なし）\n時刻: timing/（UTF-8 BOM付きCSV）\nmanifest.json: 設定・エラー・手動イベント・表示時刻比較\n\n露光同期は未検証。表示時刻差が小さくても同期成功ではありません。\nCSVはプレビューの観測ログで、録画を復号した各フレームとの対応は未検証です。\n手動イベントは操作時刻であり光同期ではありません。\n撮影時刻補正、校正、ランドマーク、幾何3Dはこの画面では未実装です。\n録画の切断・空データ・部分保存はmanifestのerrors/video_statusを確認してください。\n動画とログは端末内で処理されます。保存後の個人情報管理は利用者側で行ってください。\n');
    const blob=await zip.generateAsync({type:'blob',compression:'STORE'});download(blob,`${session.id}.zip`);
  }catch(e){message(`ZIP保存に失敗しました：${e.message}`);}finally{exporting=false;renderControls();}
}
function discard(){
  if(session?.state!=='done'||exporting||!confirm('保存していない動画・ログもメモリから破棄します。続けますか？'))return;
  urls.forEach(URL.revokeObjectURL);urls=[];downloadUrls.forEach(URL.revokeObjectURL);downloadUrls.clear();session=null;$('downloads').replaceChildren();$('resultStatus').textContent='未録画';$('elapsed').textContent='0.0 秒';$('eventCount').textContent='0 件';renderControls();
}
function updateDiagnostics(){
  const now=performance.now();
  for(const c of cameras){const last=c.rows.at(-1),age=now-c.last;$(`state${c.id}`).textContent=age>2000?'映像更新なし':c.track.muted?'映像ミュート':'表示中';$(`rate${c.id}`).textContent=number(observedFps(c.rows));$(`frame${c.id}`).textContent=last?.presented_frames??'--';$(`capture${c.id}`).textContent=last?.capture_time_ms!=null?'取得あり・未検証':'未取得';$(`age${c.id}`).textContent=`${number(age,0)} ms`;}
  if(phase==='live'&&cameras.some(c=>now-c.last>5000)){message('映像の更新が5秒以上止まったため、全カメラを停止します。');void stopCameras('FRAME_STALL');}
  if(cameras.length>=2){
    const ref=cameras[0],rows=[];
    for(const c of cameras.slice(1)){
      const key=`${ref.id}-${c.id}`,p=pairDiagnostic(ref.rows,c.rows),window=pairWindows.get(key)||[];
      const fresh=now-ref.last<2000&&now-c.last<2000;
      if(p&&fresh&&window.at(-1)?.reference_observation_id!==p.reference_observation_id){window.push(p);if(window.length>100)window.shift();pairWindows.set(key,window);if(session?.state==='recording')session.pairs.push({pair:key,host_time_ms:now,...p});}
      const tr=document.createElement('tr');for(const val of [key,p&&fresh?`${number(p.delta_ms)} ms`:'未取得 / 更新なし',fresh?`${number(median(window.map(x=>Math.abs(x.delta_ms))))} ms（絶対値）`:'--',window.length]){const td=document.createElement('td');td.textContent=val;tr.append(td);}rows.push(tr);
    }$('syncRows').replaceChildren(...rows);
  }else $('syncRows').innerHTML='<tr><td colspan="4">2台以上の映像を開始すると表示します</td></tr>';
  if(activeRecording())$('elapsed').textContent=`${number((now-session.requested_at_ms)/1000)} 秒`;
  renderControls();
}
$('refresh').addEventListener('click',refreshDevices);$('start').addEventListener('click',startCameras);$('stop').addEventListener('click',()=>void stopCameras());$('record').addEventListener('click',startRecording);$('recordStop').addEventListener('click',()=>void finishRecording());$('mark').addEventListener('click',markEvent);$('zip').addEventListener('click',exportZip);$('discard').addEventListener('click',discard);
$('logs').addEventListener('click',()=>{if(session?.state==='done')download(new Blob([JSON.stringify({...manifest(),preview_observations:session.entries.map(e=>({camera_id:e.id,rows:e.observations}))},null,2)],{type:'application/json'}),`${session.id}_logs.json`);});
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch(e){message(e.message);}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&phase!=='idle')void stopCameras('TAB_HIDDEN');});
window.addEventListener('beforeunload',event=>{if(session||phase==='opening'||phase==='live'){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{for(const c of cameras)c.stream.getTracks().forEach(t=>t.stop());});
navigator.mediaDevices?.addEventListener('devicechange',()=>{if(phase==='idle')$('status').textContent='カメラ構成が変わりました。一覧を確認してください。';});
setInterval(updateDiagnostics,250);renderControls();
