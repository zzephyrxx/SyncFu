// Adapted from EasyUI LiquidToggle (MIT, Suraj Maurya 2026).
// Source and exact commit: docs/material-redesign/sources.json.
// Kept the 12-anchor quadratic midpoint contour; clamped travel/shape for small controls.
export function buildBlobPath(width:number,height:number,progress:number,stretch:number) {
  const t=Math.max(0,Math.min(1,progress));const amount=Math.max(0,Math.min(.5,stretch));
  const padding=4, radius=(height-padding*2)/2, cy=height/2;
  const cx=padding+radius+(width-padding*2-radius*2)*t;
  const points:[number,number][]=[];
  for(let i=0;i<12;i++){
    const angle=Math.PI*2*i/12-Math.PI/2;
    const wobble=1+amount*.12*Math.sin(angle*3+t*Math.PI*2);
    const x=cx+Math.cos(angle)*radius*(1+amount*.25)*wobble;
    const y=cy+Math.sin(angle)*radius*(1-amount*.12)*wobble;
    points.push([Math.max(2,Math.min(width-2,x)),Math.max(2,Math.min(height-2,y))]);
  }
  const mid=(a:[number,number],b:[number,number])=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
  const start=mid(points[11],points[0]);let d=`M ${start[0].toFixed(2)} ${start[1].toFixed(2)}`;
  for(let i=0;i<12;i++){const c=points[i],end=mid(c,points[(i+1)%12]);d+=` Q ${c[0].toFixed(2)} ${c[1].toFixed(2)} ${end[0].toFixed(2)} ${end[1].toFixed(2)}`;}
  return d+' Z';
}
