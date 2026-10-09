import { MASTS, hullWidth, hullHalfWidthAt, mainDeckHeight } from './ship-layout.js';

const lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const rung=(a,b)=>({a,b,center:lerp(a,b,.5)});
const hatchRungs=Array.from({length:9},(_,i)=>rung([-4.29,.28+i*.25,-.05+i*.075],[-3.71,.28+i*.25,-.05+i*.075]));
const cargoRungs=Array.from({length:17},(_,i)=>{const y=-1.68+i*.25,x=3.5-(y+1.85)/4.45*.6;return rung([x,y,-.38],[x,y,.38]);});
hatchRungs.push(rung([-4.29,2.52,.65],[-3.71,2.52,.65]));
cargoRungs.push(rung([2.9,2.56,-.38],[2.9,2.56,.38]));
const hatchHands=Array.from({length:3},(_,i)=>rung([-4.29,2.85+i*.35,.65],[-3.71,2.85+i*.35,.65]));
const cargoHands=Array.from({length:3},(_,i)=>rung([2.9,2.85+i*.35,-.38],[2.9,2.85+i*.35,.38]));
// Geometry builders and movement use these same rung endpoints, never guessed ladders.
export const CLIMB_PATHS=[
  {id:'hatch',label:'水手舱梯',kind:'down',space:'ship',needsHatch:true,room:'lower',face:[0,0,1],rungs:hatchRungs,handrails:hatchHands,entry:[-4,2.4,.93],exit:[-4,.15,-.4],points:[[-4,.15,-.12],[-4,.65,.08],[-4,1.38,.2],[-4,2.4,.31]],upperExit:[-4,2.4,.93],lowerExit:[-4,.15,-.4],upperMode:'deck',lowerMode:'cabin'},
  {id:'cargo',label:'货舱梯',kind:'down',space:'ship',needsCargo:true,room:'hold',face:[-1,0,0],rungs:cargoRungs,handrails:cargoHands,entry:[4.3,2.4,0],exit:[3.82,-1.85,0],points:[[3.72,-1.85,0],[3.45,.3,0],[3.22,2.4,0]],upperExit:[4.3,2.4,0],lowerExit:[3.82,-1.85,0],upperMode:'deck',lowerMode:'cabin'},
];

export const SHROUD_GEOMETRY=MASTS.map((mast,index)=>{
  const deckY=index===2?4.55:mainDeckHeight(mast.x),startX=mast.x-.3,total=.46*(mast.shrouds-1);
  const feet=Array.from({length:mast.shrouds},(_,j)=>{const x=startX-.46*j;return[x,(index===2?4.25:2.25)+.8,hullWidth(x)*.91+.48];});
  const tops=feet.map((_,j)=>[mast.x-.14-j*.024,mast.nest+.27,.15]);
  const rungs=[];
  for(let y=feet[0][1]+.31;y<mast.nest-2.25;y+=.36){const t=(y-feet[0][1])/(tops[0][1]-feet[0][1]);rungs.push(rung(lerp(feet[0],tops[0],t),lerp(feet.at(-1),tops.at(-1),t)));}
  const center=lerp(feet[0],feet.at(-1),.5),low=[center[0],deckY+.14,center[2]];
  const lowRungs=[];
  for(let y=deckY+.14;y<feet[0][1]+.3;y+=.36)lowRungs.push(rung([center[0]-.27,y,center[2]],[center[0]+.27,y,center[2]]));
  const size=index===1?1:.84,accessZ=[.82,.87,.62][index];
  const nearTop=rungs.at(-1).center;
  const futtockA=[nearTop[0],nearTop[1],nearTop[2]],futtockMid=[mast.x+.25,mast.nest-1.4,Math.max(1.22,accessZ+.3)],futtockB=[mast.x+.25,mast.nest+.30,accessZ+.06];
  const futtock=Array.from({length:10},(_,i)=>{const t=(i+1)/10,c=t<=.3?lerp(futtockA,futtockMid,t/.3):lerp(futtockMid,futtockB,(t-.3)/.7);return rung([c[0]-.24,c[1],c[2]],[c[0]+.24,c[1],c[2]]);});
  const contactRungs=[...lowRungs,...rungs,...futtock].sort((a,b)=>a.center[1]-b.center[1]);
  const points=contactRungs.map(r=>{const h=contactRungs.reduce((a,b)=>Math.abs(b.center[1]-(r.center[1]+1))<Math.abs(a.center[1]-(r.center[1]+1))?b:a);return[(r.center[0]+h.center[0])/2,Math.max(deckY,r.center[1]-.27),(r.center[2]+h.center[2])/2+.22];});
  const upper=[mast.x+.68,mast.nest,.42*size],lower=[...points[0]],safeZ=hullHalfWidthAt(lower[0],2.4)-.60,safeY=index===2?4.55:mainDeckHeight(lower[0],safeZ);
  points.push([futtockB[0],mast.nest+.08,futtockB[2]+.28]);
  const handrails=[rung([futtockB[0]-.24,mast.nest+.74,futtockB[2]],[futtockB[0]+.24,mast.nest+.74,futtockB[2]]),rung([futtockB[0]-.24,mast.nest+1.10,futtockB[2]],[futtockB[0]+.24,mast.nest+1.10,futtockB[2]])];
  const path={id:['fore-shroud','main-shroud','mizzen-shroud'][index],label:['前桅索梯','主桅索梯','后桅索梯'][index],kind:'up',space:'ship',face:[0,0,-1],rungs:contactRungs,handrails,points,entry:lower,exit:upper,upperExit:upper,lowerExit:[lower[0],safeY,safeZ],lowerApproach:[[lower[0],Math.max(deckY,2.4)+.08,safeZ]],upperMode:'deck',lowerMode:'deck',mast:index};
  CLIMB_PATHS.push(path);
  return{mast,index,size,accessZ,feet,tops,rungs,lowRungs,futtock,futtockA,futtockMid,futtockB,handrails,path};
});

const shipLadderZ=hullHalfWidthAt(-1.6,2.4)+.24;
const boardExitZ=shipLadderZ-.9,boardExit=[-2.6,mainDeckHeight(-2.6,boardExitZ),boardExitZ];
CLIMB_PATHS.push({id:'board',label:'船侧木梯',kind:'up',space:'ship',face:[0,0,-1],rungs:Array.from({length:21},(_,i)=>rung([-2.2,-.45+i*.26,shipLadderZ],[-1,-.45+i*.26,shipLadderZ])),entry:[-1.6,-.6,shipLadderZ+.46],exit:boardExit,points:[[-1.6,-.6,shipLadderZ+.46],[-1.6,3.46,shipLadderZ+.46]],upperExit:boardExit,upperApproach:[[-2.6,3.46,shipLadderZ+.46],[-2.6,3.46,boardExitZ]],lowerExit:[-1.6,-.6,shipLadderZ+.60],upperMode:'deck',lowerMode:'swim'});
CLIMB_PATHS.push({id:'dock',label:'码头木梯',kind:'up',space:'world',face:[0,0,-1],rungs:Array.from({length:12},(_,i)=>rung([11.8,-2.17+i*.58,-7.3],[13.7,-2.17+i*.58,-7.3])),entry:[12.75,-.6,-7],exit:[12.75,2.5,-8.0],points:[[12.75,-.6,-7],[12.75,2.5,-7]],upperExit:[12.75,2.5,-8],lowerExit:[12.75,-.6,-6.9],upperMode:'land',lowerMode:'swim'});

for(const p of CLIMB_PATHS){p.startGrip=p.kind==='down'?p.rungs.at(-1).center:p.rungs[0].center;p.endGrip=p.kind==='down'?p.rungs[0].center:p.rungs.at(-1).center;p.length=p.points.slice(1).reduce((sum,b,i)=>sum+Math.hypot(...b.map((v,j)=>v-p.points[i][j])),0);}

export function sampleClimbPath(path,progress){
  let distance=Math.max(0,Math.min(1,progress))*path.length;
  for(let i=1;i<path.points.length;i++){const a=path.points[i-1],b=path.points[i],length=Math.hypot(...b.map((v,j)=>v-a[j]));if(distance<=length)return lerp(a,b,length?distance/length:0);distance-=length;}
  return [...path.points.at(-1)];
}
