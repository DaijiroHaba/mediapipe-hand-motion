export const VERSION = '0.2.0';
export const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
export const MAX_FRAMES = 3000;
export function roiRect(width, height, scale, cx=.5, cy=.5) {
  const w=Math.max(1,Math.round(width*scale)), h=Math.max(1,Math.round(height*scale));
  return {x:Math.max(0,Math.min(width-w,Math.round(width*cx-w/2))),y:Math.max(0,Math.min(height-h,Math.round(height*cy-h/2))),w,h};
}
export function mapLandmarks(points, roi, width, height) {
  return points.map(p=>({x:(roi.x+p.x*roi.w)/width,y:(roi.y+p.y*roi.h)/height,z:p.z*roi.w/width}));
}
export function quality(result, expected, roi, width, height, brightFraction) {
  const flags=[];
  if(result.landmarks.length<expected)flags.push('MISSING_HAND');
  if(brightFraction>.1)flags.push('BRIGHT_PIXELS');
  for(const hand of result.landmarks){
    if(hand.length!==21||hand.some(p=>![p.x,p.y,p.z].every(Number.isFinite))){flags.push('INVALID_LANDMARKS');continue;}
    if(hand.some(p=>p.x<.02||p.x>.98||p.y<.02||p.y>.98))flags.push('ROI_EDGE');
    const span=Math.max(...hand.map(p=>p.x))-Math.min(...hand.map(p=>p.x));
    if(span*roi.w/width<.12)flags.push('SMALL_HAND');
  }
  return [...new Set(flags)];
}
export const FLAG_LABELS={MISSING_HAND:'手の未検出',BRIGHT_PIXELS:'明るい画素が多い',ROI_EDGE:'解析範囲の端',SMALL_HAND:'手が小さい',INVALID_LANDMARKS:'座標異常'};
export function csv(rows) {
  const cell=value=>{
    let s=value==null?'':String(value);
    if(typeof value==='string'&&/^[=+@\-\t\r]/.test(s))s="'"+s;
    return '"'+s.replaceAll('"','""')+'"';
  };
  return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
export function makeFrame(result, meta) {
  return {...meta,hands:result.landmarks.map((points,i)=>({
    hand_index:i, handedness:result.handedness?.[i]?.[0]?.categoryName??'Unknown',
    handedness_score:result.handedness?.[i]?.[0]?.score??null,
    image:mapLandmarks(points,meta.roi,meta.width,meta.height),world:result.worldLandmarks?.[i]??[]
  }))};
}
export function bundle(session) {
  const rows=[['frame','time_s','hand_index','handedness','handedness_score_NOT_joint_confidence','joint','x_norm_source','y_norm_source','z_relative_source','world_x_model_m','world_y_model_m','world_z_model_m']];
  const qc=[['frame','time_s','detected_hands','expected_hands','qc_flags','bright_fraction_roi','roi_x_px','roi_y_px','roi_width_px','roi_height_px','source_width','source_height','processed_at_utc','inference_ms']];
  const flagged={};let detected=0;
  for(const f of session.frames){
    if(f.hands.length)detected++;
    qc.push([f.index,f.time_s,f.hands.length,session.settings.expected,f.flags.join('|'),f.brightFraction,f.roi.x,f.roi.y,f.roi.w,f.roi.h,f.width,f.height,f.processed_at_utc,f.inference_ms]);
    for(const flag of f.flags)flagged[flag]=(flagged[flag]||0)+1;
    for(const hand of f.hands)hand.image.forEach((p,j)=>{const w=hand.world[j];rows.push([f.index,f.time_s,hand.hand_index,hand.handedness,hand.handedness_score,j,p.x,p.y,p.z,w?.x,w?.y,w?.z]);});
  }
  const summary={app_version:VERSION,created_at:session.created_at,data_kind:session.kind,source:session.source,settings:session.settings,
    frames:session.frames.length,frames_with_any_hand:detected,any_hand_detection_rate:session.frames.length?detected/session.frames.length:null,
    all_expected_hands_frames:session.frames.filter(f=>f.hands.length>=session.settings.expected).length,
    qc_counts:flagged,completion:session.completion,error:session.error??null,model:session.kind==='SYNTHETIC_DEMO'?'none (synthetic)':'MediaPipe Hand Landmarker float16/1',runtime:'tasks-vision 0.10.21',delegate:session.delegate,
    physical_depth_mm:null,physical_depth_status:'NOT_MEASURED',pressure_integration:'PENDING_DEVICE_SPECIFICATION',
    coordinate_notes:['Source image coordinates are unmirrored. z_relative_source is wrist-relative, not camera distance.',
      'world_*_model_m is learned hand-centered geometry, not validated displacement.','hand_index is a per-frame slot, NOT a persistent hand ID.',
      'Handedness score is NOT landmark accuracy or per-joint visibility.','No interpolation, smoothing or missing-value filling is applied.'],
    scientific_status:'NOT_VALIDATED',video_uploaded:false,video_recorded:false};
  const json=x=>JSON.stringify(x,null,2);
  const files={
    'coordinates/landmarks_raw.csv':csv(rows),'qc/frames.csv':csv(qc),'reports/summary.json':json(summary),
    'reports/README_RESULTS_ja.txt':'最初に reports/summary.json を確認してください。\ncoordinates/: 未加工の推定座標。qc/: 検出なしを含む全処理フレーム。\n検出率は精度ではありません。hand_indexは永続IDではありません。\nworld座標はモデルによる手中心の推定。押し込み量(mm)は未計測です。\nSYNTHETIC_DEMO は人工データで、実測・精度検証に使用できません。\n映像は保存・同梱されません。圧との統合は機器仕様確認後です。\nCSVはUTF-8 BOM付きです。\n',
  };
  files['reports/manifest.json']=json({app_version:VERSION,files:Object.keys(files).concat('reports/manifest.json'),data_kind:session.kind,upload:false,measurement_validated:false});
  return files;
}
export function syntheticHand(t=0) {
  const pts=[{x:.5,y:.84,z:0}];
  for(let finger=0;finger<5;finger++)for(let k=1;k<=4;k++){
    const flex=.045*Math.sin(t*2+finger);
    pts.push({x:.29+finger*.105+(finger===0?-.018*k:0),y:.76-k*(finger===0?.075:.12)+flex*k/4,z:Math.sin(t*2+finger)*.03*k/4});
  }
  return {landmarks:[pts],worldLandmarks:[pts.map(p=>({x:(p.x-.5)*.25,y:(p.y-.84)*.25,z:p.z*.25}))],handedness:[[{categoryName:'Right',score:1}]]};
}
