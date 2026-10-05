import {loadCV,CalibrationEngine} from './fusion-calibration.mjs';
try{const engine=new CalibrationEngine(await loadCV());engine.drawBoard(document.getElementById('board'));document.getElementById('status').textContent='印刷後に実寸を確認してください。';document.getElementById('print').disabled=false;}catch(e){document.getElementById('status').textContent=e.message;}
document.getElementById('print').addEventListener('click',()=>print());
