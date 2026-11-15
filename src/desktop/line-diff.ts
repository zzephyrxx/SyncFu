export interface DiffLine { number: number; text: string; changed: boolean }
export interface DiffRow { left: DiffLine | null; right: DiffLine | null }
// Bounded LCS: at most 501² cells, never quadratic in an unbounded file size.
export function compareText(leftText: string, rightText: string, limit = 500) {
  const cap = Math.max(1, Math.min(500, Math.floor(limit)));
  const leftAll=leftText.split('\n'),rightAll=rightText.split('\n');
  const left=leftAll.slice(0,cap),right=rightAll.slice(0,cap),width=right.length+1;
  const lengths=new Uint16Array((left.length+1)*width);
  for(let i=left.length-1;i>=0;i--)for(let j=right.length-1;j>=0;j--)lengths[i*width+j]=left[i]===right[j]?lengths[(i+1)*width+j+1]+1:Math.max(lengths[(i+1)*width+j],lengths[i*width+j+1]);
  const rows:DiffRow[]=[];let i=0,j=0;
  while(i<left.length||j<right.length){
    if(i<left.length&&j<right.length&&left[i]===right[j]){rows.push({left:{number:i+1,text:left[i++],changed:false},right:{number:j+1,text:right[j++],changed:false}});}
    else if(i<left.length&&(j===right.length||lengths[(i+1)*width+j]>=lengths[i*width+j+1])){rows.push({left:{number:i+1,text:left[i++],changed:true},right:null});}
    else{rows.push({left:null,right:{number:j+1,text:right[j++],changed:true}});}
  }
  return {rows,truncated:leftAll.length>cap||rightAll.length>cap};
}
