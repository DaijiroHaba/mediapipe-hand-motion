import {openVideo,seekVideo,videoWindow,safeStem,abortError} from './file-video.mjs';
import {CONNECTIONS,csv} from './core.mjs';
import {validateCalibration,fuseFrames,PIXEL_CONVENTION} from './fusion-core.mjs';
import {FusionView} from './fusion-view.mjs';
const $=id=>document.getElementById(id),ids=['A','B','C'];
let active=false,controller,sources=[],workers=[],session=null,view,exporting=false;
try{view=new FusionView($('scene'));}catch(e){$('message').textContent='3D表示を初期化できません: '+e.message;}
for(const id of ids){
  const slot=document.createElement('div');slot.className='file-slot';slot.id='slot'+id;
  slot.innerHTML=`<label>動画 ${id}${id==='A'?'（必須）':'（任意）'}<input id="file${id}" type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v,.avi"></label><label>開始オフセット ${id} (s)<input id="offset${id}" type="number" min="-86400" max="86400" step="0.001" value="0"></label>`;$('inputs').append(slot);
  const section=document.createElement('section');section.className='camera';section.id='view'+id;section.hidden=true;section.innerHTML=`<h2>動画 ${id}<span id="state${id}"></span></h2><video id="video${id}" muted playsinline></video><canvas id="canvas${id}" width="640" height="480"></canvas><p id="info${id}"></p>`;$('videos').append(section);
}
const initial=new URLSearchParams(location.search).get('mode');if(['single','multi','fusion'].includes(initial))$('mode').value=initial;
function ui(){const single=$('mode').value==='single';for(const id of ['B','C'])$('slot'+id).hidden=single;$('fusionOptions').hidden=$('mode').value!=='fusion';$('settings').disabled=active||exporting;$('start').disabled=active||exporting;$('stop').disabled=!active;$('export').disabled=active||exporting||!session?.samples.length;}
$('mode').addEventListener('change',ui);ui();
function workerFor(){
  const worker=new Worker('./hand-worker.js'),entry={worker,pending:null,lastTime:-Infinity};workers.push(entry);
  worker.onmessage=({data})=>{if(!entry.pending)return;const p=entry.pending;entry.pending=null;clearTimeout(p.timer);data.type==='error'?p.reject(Error(data.message)):p.resolve(data);};
  worker.onerror=e=>{entry.pending?.reject(Error(e.message||'推定器エラー'));if(entry.pending)clearTimeout(entry.pending.timer);entry.pending=null;};
  entry.call=(message,transfer=[],signal)=>new Promise((resolve,reject)=>{signal?.throwIfAborted();const timer=setTimeout(()=>{entry.pending=null;reject(Error('手指推定が時間切れです。'));},60000);entry.pending={resolve,reject,timer};try{worker.postMessage(message,transfer);}catch(e){clearTimeout(timer);entry.pending=null;reject(e);}});
  return entry;
}
function release(){for(const s of sources)s.close();sources=[];for(const w of workers){if(w.pending){clearTimeout(w.pending.timer);w.pending.reject(abortError());w.pending=null;}w.worker.terminate();}workers=[];}
function stop(reason='USER_STOP'){if(!active)return;session.completion=reason;controller.abort();release();}
$('stop').addEventListener('click',()=>stop());document.addEventListener('visibilitychange',()=>{if(document.hidden)stop('TAB_HIDDEN');});window.addEventListener('pagehide',()=>stop('PAGE_CLOSED'));
function draw(s,result){const ctx=s.canvas.getContext('2d');ctx.drawImage(s.video,0,0,s.width,s.height);ctx.strokeStyle='#008d78';ctx.fillStyle='#edb329';ctx.lineWidth=Math.max(2,s.width/400);for(const hand of result.landmarks){for(const[a,b]of CONNECTIONS){ctx.beginPath();ctx.moveTo(hand[a].x*s.width,hand[a].y*s.height);ctx.lineTo(hand[b].x*s.width,hand[b].y*s.height);ctx.stroke();}for(const p of hand){ctx.beginPath();ctx.arc(p.x*s.width,p.y*s.height,3,0,Math.PI*2);ctx.fill();}}}
function show3D(points,time,status){view?.update(points);if(points.some(p=>p.valid))view?.fit();$('fusionStatus').textContent=status;$('xyz').replaceChildren();const p=points[8],tr=document.createElement('tr');for(const v of [time.toFixed(3),...(p?.valid?p.xyz.map(x=>x.toFixed(2)):['--','--','--']),status]){const td=document.createElement('td');td.textContent=v;tr.append(td);}$('xyz').append(tr);}
$('fit').addEventListener('click',()=>view?.fit());$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('geometry').requestFullscreen();}catch(e){$('message').textContent=e.message;}});
$('start').addEventListener('click',async()=>{
  if(active||exporting)return;const mode=$('mode').value,chosen=ids.filter(id=>mode!=='single'||id==='A').map(id=>({id,file:$('file'+id).files[0],offset:Number($('offset'+id).value)})).filter(s=>s.file);
  if(!chosen.some(s=>s.id==='A')){$('message').textContent='動画Aを選択してください。';return;}
  if(session?.samples.length&&!confirm('前回の結果を置き換えます。保存済みですか？'))return;
  active=true;controller=new AbortController();const signal=controller.signal;session={version:'0.4.0',startedAt:new Date().toISOString(),mode,sourceType:'recorded_video',completion:'RUNNING',samples:[],sources:[],calibration:null,syncStatus:'USER_OFFSETS_EXPOSURE_UNVERIFIED',cameraIdentity:'USER_MAPPING_UNVERIFIED',pixelConvention:PIXEL_CONVENTION};ui();$('message').textContent='動画とモデルを準備しています。';$('progress').value=0;$('status').textContent='準備中';view?.update([]);$('xyz').replaceChildren();ids.forEach(id=>$('view'+id).hidden=true);
  try{
    for(const item of chosen){const s={...await openVideo(item.file,signal,$('video'+item.id)),...item,canvas:$('canvas'+item.id)};sources.push(s);s.canvas.width=s.width;s.canvas.height=s.height;$('view'+s.id).hidden=false;$('info'+s.id).textContent=`${s.file.name} / ${s.width} × ${s.height} / ${s.duration.toFixed(3)}秒`;
      session.sources.push({id:s.id,filename:s.file.name,bytes:s.file.size,lastModified:s.file.lastModified,width:s.width,height:s.height,duration_s:s.duration,offset_s:s.offset});
    }
    session.window=videoWindow(sources,Number($('fps').value));const metric=mode==='fusion'&&sources.length>=2;
    if(metric){if(!$('mapping').checked||!$('syncConfirmed').checked)throw Error('複数視点の統合には撮影配置の対応と時刻合わせの確認が必要です。');const file=$('calibration').files[0];if(!file||file.size>1024*1024)throw Error('1 MB以下の対応する校正JSONを選択してください。');session.calibration=validateCalibration(JSON.parse(await file.text()));for(const s of sources){const cal=session.calibration.cameras.find(c=>c.id===s.id);if(!cal||cal.width!==s.width||cal.height!==s.height)throw Error(`動画${s.id}の校正IDまたは解像度が一致しません。クロップ・反転・拡大した動画は元の校正を使用できません。`);}}
    session.coordinateKind=metric?'CALIBRATED_GEOMETRIC_MM':sources.length===1?'MODEL_RELATIVE_NOT_METRIC':'PER_VIEW_MODEL_RELATIVE_NOT_FUSED';
    const tolerance=Number($('tolerance').value);if(!Number.isFinite(tolerance)||tolerance<1||tolerance>50)throw Error('時刻差上限は1〜50 msです。');session.toleranceMs=tolerance;
    $('geometryTitle').textContent=metric?'共通座標3D（校正板基準・mm）':sources.length===1?'モデル相対3D（mm換算・実測ではない）':'動画Aのモデル相対3D（視点別・統合なし）';$('geometryNote').textContent=metric?'露光同期とカメラの同一性は未検証。単眼モデル3Dの平均は使用しません。':'単眼の推定形状を表示します。校正した実寸XYZや押し込み量ではありません。';
    for(const s of sources){s.task=workerFor();const init=await s.task.call({type:'init',viewId:s.id},[],signal);signal.throwIfAborted();s.delegate=init.delegate;session.sources.find(v=>v.id===s.id).delegate=init.delegate;}
    $('status').textContent='解析中';
    for(let index=0;index<session.window.count;index++){
      signal.throwIfAborted();const commonTime=session.window.start+index/session.window.fps,frames=[];
      for(const s of sources){const timing=await seekVideo(s.video,commonTime+s.offset,signal),bitmap=await createImageBitmap(s.video);signal.throwIfAborted();const taskTime=Math.max(s.task.lastTime+.001,timing.mediaTime*1000+1);s.task.lastTime=taskTime;const data=await s.task.call({type:'frame',bitmap,time:taskTime},[bitmap],signal);signal.throwIfAborted();draw(s,data.result);
        const frame={id:s.id,frame:index,width:s.width,height:s.height,...timing,alignedMs:(timing.mediaTime-s.offset)*1000,landmarks:data.result.landmarks,worldLandmarks:data.result.worldLandmarks,handedness:data.result.handedness};frames.push(frame);$('state'+s.id).textContent=`${data.result.landmarks.length}手 / ${timing.mediaTime.toFixed(3)}秒`;
      }
      const deltaMs=Math.max(...frames.map(f=>f.alignedMs))-Math.min(...frames.map(f=>f.alignedMs));let fusion=null,points,status;
      if(metric){fusion=frames.some(f=>f.timestampKind!=='DECODED_MEDIA_TIME_NOT_EXPOSURE')?{status:'MISSING',reason:'DECODED_TIMESTAMP_UNAVAILABLE',points:[]}:deltaMs>tolerance?{status:'MISSING',reason:'TIME_DIFFERENCE_EXCEEDED',points:[]}:fuseFrames({frames,deltaMs},session.calibration);points=fusion.points;status=fusion.reason||`${fusion.valid||0}/21点 / 時刻差${deltaMs.toFixed(1)} ms / 露光同期未検証`;}
      else{const hand=frames[0].worldLandmarks?.[0],origin=hand?.[0];points=hand?.map((p,joint)=>({joint,valid:true,xyz:[(p.x-origin.x)*1000,(p.y-origin.y)*1000,(p.z-origin.z)*1000]}))||[];status=points.length?'モデル相対3D・実測ではない':'手指未検出';}
      session.samples.push({index,commonTime,deltaMs,frames,fusion});show3D(points,commonTime,status);$('progress').value=(index+1)/session.window.total;$('progressText').textContent=`${index+1} / ${session.window.total} 組・共通時刻 ${commonTime.toFixed(3)}秒`;
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    session.completion=session.window.total>session.window.count?'FRAME_LIMIT':'COMPLETE';$('message').textContent=session.completion==='COMPLETE'?'解析完了。各視点の座標とQCをZIPで保存できます。':'3,000組の上限で停止しました。解析済みの結果を保存できます。';
  }catch(e){if(e.name!=='AbortError'){session.completion='ERROR';session.error=String(e.message);$('message').textContent='解析を停止しました: '+e.message;}else $('message').textContent='解析を停止しました。解析済みの結果は保存できます。';}
  finally{release();active=false;session.endedAt=new Date().toISOString();$('status').textContent=session.completion;ui();}
});
$('export').addEventListener('click',async()=>{
  if(active||exporting||!session?.samples.length)return;exporting=true;ui();
  try{const zip=new JSZip(),summary={...session,samples:undefined,processedSamples:session.samples.length};
    for(const s of session.sources){const frames=session.samples.flatMap(v=>v.frames.filter(f=>f.id===s.id)),stem=s.id+'_'+safeStem(s.filename),rows=[['共通時刻_秒','動画時刻_秒','視点','フレーム','手スロット','点番号','x_正規化','y_正規化','z_相対','時刻種別']],world=[['共通時刻_秒','動画時刻_秒','手スロット','点番号','x_モデル_m','y_モデル_m','z_モデル_m']];
      for(const sample of session.samples){const f=sample.frames.find(f=>f.id===s.id);if(!f)continue;f.landmarks.forEach((hand,slot)=>hand.forEach((p,j)=>rows.push([sample.commonTime,f.mediaTime,s.id,f.frame,slot,j,p.x,p.y,p.z,f.timestampKind])));f.worldLandmarks?.forEach((hand,slot)=>hand.forEach((p,j)=>world.push([sample.commonTime,f.mediaTime,slot,j,p.x,p.y,p.z])));}
      zip.file(`coordinates/${s.id}/${stem}_2d.csv`,csv(rows));zip.file(`coordinates/${s.id}/${stem}_model_3d.csv`,csv(world));zip.file(`reports/${stem}_summary.json`,JSON.stringify({...s,processed_frames:frames.length,detected_frames:frames.filter(f=>f.landmarks.length).length,coordinateKind:'MODEL_RELATIVE_NOT_METRIC'},null,2));
    }
    if(session.calibration){const rows=[['共通時刻_秒','点番号','X_mm','Y_mm','Z_mm','採用','使用視点','再投影_px','時刻差_ms','理由']];for(const s of session.samples){for(const p of s.fusion.points.length?s.fusion.points:Array.from({length:21},(_,joint)=>({joint,valid:false,reason:s.fusion.reason}))){rows.push([s.commonTime,p.joint,...(p.valid?p.xyz:['','','']),p.valid,(p.views||[]).join('|'),p.reprojectionPx??'',s.deltaMs,p.reason||'']);}}zip.file('coordinates/fused_3d.csv',csv(rows));zip.file('calibrations/'+session.calibration.id+'.json',JSON.stringify(session.calibration,null,2));}
    zip.file('reports/summary_all.json',JSON.stringify(summary,null,2));zip.file('reports/manifest.json',JSON.stringify({...summary,files:[...Object.values(zip.files).filter(f=>!f.dir).map(f=>f.name),'reports/manifest.json','reports/timing_qc.json','reports/README_RESULTS_ja.txt']},null,2));zip.file('reports/timing_qc.json',JSON.stringify(session.samples.map(s=>({index:s.index,commonTime:s.commonTime,deltaMs:s.deltaMs,frames:s.frames.map(({id,requestedTime,mediaTime,alignedMs,timestampKind})=>({id,requestedTime,mediaTime,alignedMs,timestampKind})),fusion:s.fusion})),null,2));
    zip.file('reports/README_RESULTS_ja.txt','coordinates/A・B・Cは各動画の座標です。model_3dはモデル相対値で実寸ではありません。fused_3dは校正JSONと複数動画からの幾何推定です。空欄の理由と同期状態はtiming_qc.jsonをご確認ください。開始オフセットだけでは露光同期やカメラ対応の正しさを証明できません。動画は含まず、ブラウザ内で解析しました。');
    const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='HandMotion_recorded_'+session.startedAt.replace(/[:.]/g,'-')+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }catch(e){$('message').textContent='ZIP出力エラー: '+e.message;}finally{exporting=false;ui();}
});
