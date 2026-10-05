export const SLOTS=['A','B','C'];
export const MAX_BYTES=128*1024*1024;
export const MAX_OBSERVATIONS=12000;
export function validateSelection(selections){
  const chosen=selections.filter(x=>x.deviceId);
  if(chosen.length<2||chosen.length>3)throw new Error('異なるカメラを2〜3台選択してください。');
  if(new Set(chosen.map(x=>x.deviceId)).size!==chosen.length)throw new Error('同じカメラを複数の枠に選択できません。');
  return chosen;
}
export function observation(now,metadata,index){
  const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
  return {observation_id:index,host_callback_ms:now,presentation_time_ms:finite(metadata.presentationTime),media_pts_s:finite(metadata.mediaTime),capture_time_ms:finite(metadata.captureTime),presented_frames:finite(metadata.presentedFrames),width:finite(metadata.width),height:finite(metadata.height),timestamp_kind:'BROWSER_OBSERVATION_NOT_VERIFIED_EXPOSURE'};
}
export function pairDiagnostic(reference,other){
  const target=reference.at(-1);if(target?.presentation_time_ms==null)return null;
  const candidates=other.filter(o=>o.presentation_time_ms!=null);
  if(!candidates.length)return null;
  const match=candidates.reduce((a,b)=>Math.abs(a.presentation_time_ms-target.presentation_time_ms)<=Math.abs(b.presentation_time_ms-target.presentation_time_ms)?a:b);
  const delta=match.presentation_time_ms-target.presentation_time_ms;
  return {reference_observation_id:target.observation_id,other_observation_id:match.observation_id,delta_ms:delta,status:'PRESENTATION_ONLY',exposure_sync:'UNVERIFIED'};
}
export function observedFps(rows){
  if(rows.length<2)return null;
  const span=rows.at(-1).host_callback_ms-rows[0].host_callback_ms;
  return span>0?(rows.length-1)*1000/span:null;
}
export function median(values){if(!values.length)return null;const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
export function csv(rows,columns){
  const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  return '\uFEFF'+[columns.map(cell).join(','),...rows.map(row=>columns.map(k=>cell(row[k])).join(','))].join('\r\n');
}
export const OBSERVATION_COLUMNS=['observation_id','host_callback_ms','presentation_time_ms','media_pts_s','capture_time_ms','presented_frames','width','height','timestamp_kind'];
