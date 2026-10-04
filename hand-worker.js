let task;
self.onmessage=async({data})=>{
  try{
    if(data.type==='init'){
      const {FilesetResolver,HandLandmarker}=await import('./vendor/vision_bundle.mjs');
      const files=await FilesetResolver.forVisionTasks(new URL('./vendor/wasm',self.location.href).href);
      const options={baseOptions:{modelAssetPath:new URL('./models/hand_landmarker.task',self.location.href).href,delegate:'GPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.5,minHandPresenceConfidence:.5,minTrackingConfidence:.5};
      let delegate='GPU';
      try{task=await HandLandmarker.createFromOptions(files,options);}catch{options.baseOptions.delegate='CPU';delegate='CPU';task=await HandLandmarker.createFromOptions(files,options);}
      self.postMessage({type:'ready',delegate});
    }else if(data.type==='frame'){
      try{
        const result=task.detectForVideo(data.bitmap,data.time);
        self.postMessage({type:'result',result:{landmarks:result.landmarks,worldLandmarks:result.worldLandmarks,handedness:result.handedness}});
      }finally{data.bitmap.close();}
    }
  }catch(error){self.postMessage({type:'error',message:String(error.message||error)});}
};
