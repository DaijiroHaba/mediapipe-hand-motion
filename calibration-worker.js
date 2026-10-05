self.onmessage=async({data})=>{
  let engine;
  try{
    importScripts('./vendor/opencv-4.11.0.js');const cv=await self.cv;
    const {CalibrationEngine}=await import('./fusion-calibration.mjs');engine=new CalibrationEngine(cv);engine.samples=new Map(data.samples);
    const results=[];for(const c of data.cameras){self.postMessage({type:'progress',id:c.id});results.push(engine.calibrateCamera(c.id,c.deviceHash,c.label));}
    self.postMessage({type:'result',results});
  }catch(e){self.postMessage({type:'error',message:String(e.message||e)});}
};
