export const abortError=()=>new DOMException('解析を停止しました','AbortError');
export function waitEvent(target,event,signal,timeout=15000){return new Promise((resolve,reject)=>{
  const finish=(error)=>{clearTimeout(timer);target.removeEventListener(event,ok);target.removeEventListener('error',bad);signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
  const ok=()=>finish(),bad=()=>finish(Error('動画を復号できません。Chrome/Edge対応のMP4またはWebMを選択してください。')),abort=()=>finish(abortError());
  const timer=setTimeout(()=>finish(Error('動画の読み込みが時間切れです。')),timeout);
  target.addEventListener(event,ok,{once:true});target.addEventListener('error',bad,{once:true});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
});}
export async function openVideo(file,signal,video=document.createElement('video')){
  if(!file||!file.size)throw Error('空ではない動画ファイルを選択してください。');
  const url=URL.createObjectURL(file);video.muted=true;video.playsInline=true;video.preload='auto';
  const close=()=>{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);};
  try{const ready=waitEvent(video,'loadeddata',signal);video.src=url;video.load();await ready;signal?.throwIfAborted();
    if(video.duration===Infinity){const end=waitEvent(video,'seeked',signal);video.currentTime=1e9;await end;signal?.throwIfAborted();}
    if(!Number.isFinite(video.duration)||video.duration<=0||!video.videoWidth||!video.videoHeight)throw Error('有限の動画長と映像サイズが必要です。再エンコードしたMP4/WebMで確認してください。');
    return {video,close,file,duration:video.duration,width:video.videoWidth,height:video.videoHeight};
  }catch(e){close();throw e;}
}
export async function seekVideo(video,time,signal){
  signal?.throwIfAborted();if(!Number.isFinite(time)||time<0||time>=video.duration)throw Error('動画の範囲外の時刻です。');
  if(Math.abs(video.currentTime-time)<1e-7&&video.readyState>=2)return {requestedTime:time,mediaTime:video.currentTime,timestampKind:'SEEK_POSITION_UNVERIFIED'};
  let callback,timer,abort,resolveFrame;
  const frame=new Promise(resolve=>{resolveFrame=resolve;});
  if(video.requestVideoFrameCallback)callback=video.requestVideoFrameCallback((_,m)=>resolveFrame({requestedTime:time,mediaTime:m.mediaTime,timestampKind:'DECODED_MEDIA_TIME_NOT_EXPOSURE'}));
  timer=setTimeout(()=>resolveFrame(null),1500);abort=()=>resolveFrame(null);signal?.addEventListener('abort',abort,{once:true});
  try{const ready=waitEvent(video,'seeked',signal);video.currentTime=time;await ready;const observed=await frame;signal?.throwIfAborted();return observed||{requestedTime:time,mediaTime:video.currentTime,timestampKind:'SEEK_POSITION_UNVERIFIED'};}
  finally{clearTimeout(timer);if(callback!==undefined)video.cancelVideoFrameCallback(callback);signal?.removeEventListener('abort',abort);}
}
export function videoWindow(sources,fps,limit=3000){
  if(!Number.isFinite(fps)||fps<.5||fps>30)throw Error('sample fpsは0.5〜30で指定してください。');
  if(!sources.length||sources.some(s=>!Number.isFinite(s.duration)||s.duration<=0||!Number.isFinite(s.offset)||Math.abs(s.offset)>86400))throw Error('動画長と開始オフセットを確認してください。');
  const start=Math.max(0,...sources.map(s=>-s.offset)),end=Math.min(...sources.map(s=>s.duration-s.offset));
  if(end<=start)throw Error('動画間に共通の時間区間がありません。開始オフセットを確認してください。');
  const total=Math.ceil((end-start)*fps);return {start,end,total,count:Math.min(total,limit),fps,limit};
}
export const safeStem=name=>(name.replace(/\.[^.]+$/,'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/^\.+/,'').slice(0,100)||'video');
