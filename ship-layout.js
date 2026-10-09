// Modelling coordinates in the brief map into the existing game as (x, y, z)=(-Z, Y, X).
// One unit is one metre; +x is the bow, +z is starboard. Physics and visual builders share these curves.
export const HULL_STATIONS = [[-16,2.3],[-13,2.8],[-10,3.4],[-6,4],[0,4.25],[6,4],[10,3],[14,1.2],[16,.025]];
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
function smoothTable(table,x) {
  const slope=(i)=>{
    if(i===0)return(table[1][1]-table[0][1])/(table[1][0]-table[0][0]);
    if(i===table.length-1)return(table[i][1]-table[i-1][1])/(table[i][0]-table[i-1][0]);
    const a=(table[i][1]-table[i-1][1])/(table[i][0]-table[i-1][0]),b=(table[i+1][1]-table[i][1])/(table[i+1][0]-table[i][0]);
    return a*b<=0?0:2*a*b/(a+b);
  };
  for(let i=1;i<table.length;i++)if(x<=table[i][0]){
    const[a,wa]=table[i-1],[b,wb]=table[i],t=clamp((x-a)/(b-a),0,1),h=b-a;
    return(2*t**3-3*t*t+1)*wa+(t**3-2*t*t+t)*h*slope(i-1)+(-2*t**3+3*t*t)*wb+(t**3-t*t)*h*slope(i);
  }
  return table[table.length-1][1];
}
export function hullWidth(x) {
  return smoothTable(HULL_STATIONS,x);
}
export function keelHeight(x) { return -3.5 + 2.2*Math.pow(Math.abs(x/16),3.1); }
export function sheerHeight(x) { return .16*Math.pow(Math.abs(x/16),2.2)+.08*Math.pow(Math.max(0,x/16),3); }
export function hullHalfWidthAt(x,y) {
  const k=keelHeight(x), top=2.4+sheerHeight(x), t=clamp((y-k)/(top-k),0,1);
  const rings=[[0,.015],[.12,.34],[.30,.73],[.52,.94],[.72,1],[.88,.96],[1,.91]];
  return hullWidth(x)*smoothTable(rings,t);
}
export function mainDeckHeight(x,z=0) { return 2.4 - .12*Math.pow(clamp(Math.abs(z)/Math.max(.1,hullWidth(x)*.91),0,1),2); }
// The sea surface stays outside the closed hull, including when seen through a hatch.
export const HULL_WATERLINE_GLSL = `float shipWaterlineWidth(float x){if(x < -16.0 || x > 16.0)return 0.0;${Array.from({length:32},(_,i)=>{
  const x=i-16,a=hullHalfWidthAt(x,0),b=hullHalfWidthAt(x+1,0);
  return `if(x < ${(x+1).toFixed(1)})return mix(${a.toFixed(5)},${b.toFixed(5)},x-(${x.toFixed(1)}));`;
}).join('')}return 0.0;}`;
export const GUN_X = [5,2,-1,-4,-7];
export const MASTS = [{x:7.5,top:26,nest:12.8,radius:.325,shrouds:5},{x:-1,top:30,nest:14,radius:.375,shrouds:6},{x:-10,top:21,nest:10.5,radius:.225,shrouds:4}];
export const MODEL_LAYOUT = {main:2.4,quarter:4.55,fore:3.1,lower:.15,hold:-1.85,hatch:{x:-4,z:.25,width:1,length:.8},cargo:{x:3,z:0,width:1.6,length:2},boat:{x:-11,z:-4.6,y:2.4},captainDoor:{x:-8,z:0}};
