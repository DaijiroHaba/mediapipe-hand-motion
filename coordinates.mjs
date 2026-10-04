export const JOINT_NAMES=['手首','母指 CMC','母指 MCP','母指 IP','母指先','示指 MCP','示指 PIP','示指 DIP','示指先','中指 MCP','中指 PIP','中指 DIP','中指先','環指 MCP','環指 PIP','環指 DIP','環指先','小指 MCP','小指 PIP','小指 DIP','小指先'];
export function relativePoints(points,origin='wrist'){
  if(points?.length!==21||!points.every(p=>[p.x,p.y,p.z].every(Number.isFinite)))return [];
  const base=origin==='wrist'?points[0]:{x:0,y:0,z:0};
  return points.map(p=>({x:p.x-base.x,y:p.y-base.y,z:p.z-base.z}));
}
export const wrapDegrees=value=>((value%360)+360)%360;
