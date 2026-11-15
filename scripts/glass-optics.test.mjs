import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clearGlassOpticsCache,getGlassOpticalMap,getGlassOpticsCacheStats} from '../src/desktop/glass/optics.ts';

function readMap(map) {
  assert.ok(map.url.startsWith('data:image/bmp;base64,'));
  const bytes=Buffer.from(map.url.split(',')[1],'base64');
  assert.equal(bytes.toString('ascii',0,2),'BM');
  assert.equal(bytes.readUInt32LE(2),bytes.length);
  assert.equal(bytes.readUInt32LE(10),54);
  assert.equal(bytes.readInt32LE(18),map.width);
  assert.equal(bytes.readInt32LE(22),map.height);
  assert.equal(bytes.readUInt16LE(28),24);
  const stride=Math.ceil(map.width*3/4)*4;
  assert.equal(bytes.length,54+stride*map.height);
  return (x,y)=>{
    const at=54+(map.height-y-1)*stride+x*3;
    return {r:bytes[at+2],g:bytes[at+1],mask:bytes[at]};
  };
}

test('glass fields keep the face and pixels outside rounded corners neutral',()=>{
  const map=getGlassOpticalMap(121,81,22);
  const pixel=readMap(map);
  for(const [x,y] of [[60,40],[30,30],[90,50],[0,0],[120,0],[0,80],[120,80]]) {
    assert.deepEqual(pixel(x,y),{r:128,g:128,mask:0});
  }
  assert.equal(map.scale,16);
  assert.equal(map.edgeWidth,16);
});

test('opposite edges sample inward and fade smoothly to an undisplaced face',()=>{
  const map=getGlassOpticalMap(101,81,22);
  const pixel=readMap(map);
  assert.ok(pixel(0,40).r>128);
  assert.ok(pixel(100,40).r<128);
  assert.equal(pixel(0,40).g,128);
  assert.ok(pixel(50,0).g>128);
  assert.ok(pixel(50,80).g<128);
  assert.equal(pixel(50,0).r,128);
  let previous=256;
  for(let x=0;x<=16;x++) {
    const left=pixel(x,40),right=pixel(100-x,40);
    assert.equal(left.r+right.r,256);
    assert.equal(left.mask,right.mask);
    assert.ok(left.mask<=previous);
    previous=left.mask;
  }
  assert.deepEqual(pixel(16,40),{r:128,g:128,mask:0});
});

test('rounded corners are continuous and symmetric, including BMP row orientation',()=>{
  const map=getGlassOpticalMap(120,120,30);
  const pixel=readMap(map);
  for(let y=5;y<30;y++)for(let x=5;x<30;x++) {
    const a=pixel(x,y),transpose=pixel(y,x),right=pixel(119-x,y),bottom=pixel(x,119-y);
    assert.equal(a.r,transpose.g);
    assert.equal(a.g,transpose.r);
    assert.equal(a.mask,transpose.mask);
    assert.equal(a.r+right.r,256);
    assert.equal(a.g+bottom.g,256);
    assert.equal(a.mask,right.mask);
  }
  // Follow the inside corner into its straight top edge, away from the clip boundary.
  for(let x=20;x<35;x++) {
    const a=pixel(x,8),b=pixel(x+1,8);
    assert.ok(Math.abs(a.r-b.r)<12);
    assert.ok(Math.abs(a.g-b.g)<12);
    assert.ok(Math.abs(a.mask-b.mask)<20);
  }
});

test('small and invalid geometry remains finite, clamped and decodable',()=>{
  for(const geometry of [[0,0,-2,-1],[NaN,Infinity,NaN,Infinity],[3,7,200,200],[7,3,200,200],[1,1,0,16]]) {
    const map=getGlassOpticalMap(...geometry);
    readMap(map);
    assert.ok(Number.isFinite(map.scale)&&map.scale>=0&&map.scale<=16);
    assert.ok(map.edgeWidth>0&&map.edgeWidth<=18);
    assert.ok(map.width>=1&&map.height>=1);
  }
  const tiny=getGlassOpticalMap(3,7,200,200);
  assert.equal(tiny.edgeWidth,1.5);
  assert.equal(tiny.scale,1.5);
});

test('large maps preserve the geometry aspect ratio within rounding and stay bounded',()=>{
  for(const [width,height] of [[4096,3072],[8000,1000],[1000,8000],[900,900]]) {
    const map=getGlassOpticalMap(width,height,40,18);
    readMap(map);
    assert.ok(map.width<=1024&&map.height<=768);
    assert.ok(map.width*map.height<=400_000);
    assert.ok(Math.abs(map.width/width-map.height/height)<=Math.max(1/width,1/height));
  }
  const map=getGlassOpticalMap(97,73,24,18),pixel=readMap(map);
  for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++) {
    const {r,g}=pixel(x,y);
    const dx=(r-128)/254*map.scale,dy=(g-128)/254*map.scale;
    // Each RG channel is quantized to one byte; allow its half-step error.
    assert.ok(Math.hypot(dx,dy)<=8.05);
  }
});

test('cache reuses geometry, promotes hits and bounds count and retained string bytes',()=>{
  clearGlassOpticsCache();
  const first=getGlassOpticalMap(100,80,20);
  getGlassOpticalMap(110,80,20);
  getGlassOpticalMap(120,80,20);
  getGlassOpticalMap(130,80,20);
  assert.equal(getGlassOpticalMap(100,80,20),first);
  getGlassOpticalMap(140,80,20);
  assert.equal(getGlassOpticsCacheStats().entries,4);
  assert.equal(getGlassOpticalMap(100,80,20),first);
  for(let i=0;i<6;i++) {
    getGlassOpticalMap(1400+i*17,1000+i*13,22+i);
    const stats=getGlassOpticsCacheStats();
    assert.ok(stats.entries<=4);
    assert.ok(stats.bytes<=4*1024*1024);
  }
  clearGlassOpticsCache();
  assert.equal(getGlassOpticsCacheStats().entries,0);
  assert.equal(getGlassOpticsCacheStats().bytes,0);
});
