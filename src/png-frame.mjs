import { inflateSync } from 'node:zlib';

const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const paeth=(left,up,upperLeft)=>{
 const estimate=left+up-upperLeft,dl=Math.abs(estimate-left),du=Math.abs(estimate-up),dul=Math.abs(estimate-upperLeft);
 return dl<=du&&dl<=dul?left:du<=dul?up:upperLeft;
};

// Weston emits ordinary 8-bit PNGs. Decode only enough scanline state to
// distinguish its uniform pre-paint surface from a real (possibly tiny)
// browser page. Malformed or unfamiliar PNGs are treated as real so this
// guard can never suppress valid output merely because decoding is unknown.
export function isUniformPng(value){
 try{
  const png=Buffer.from(value);if(png.length<33||!png.subarray(0,8).equals(signature))return false;
  let offset=8,width=0,height=0,depth=0,colorType=-1,interlace=-1,sawEnd=false;const compressed=[];
  while(offset+12<=png.length){
   const size=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8),start=offset+8,end=start+size;if(end+4>png.length)return false;
   if(type==='IHDR'){if(size!==13)return false;width=png.readUInt32BE(start);height=png.readUInt32BE(start+4);depth=png[start+8];colorType=png[start+9];interlace=png[start+12];}
   else if(type==='IDAT')compressed.push(png.subarray(start,end));
   else if(type==='IEND'){sawEnd=true;break;}
   offset=end+4;
  }
  const channels={0:1,2:3,4:2,6:4}[colorType];if(!sawEnd||!compressed.length||!channels||depth!==8||interlace!==0||width<1||height<1||width>4096||height>4096)return false;
  const rowBytes=width*channels,raw=inflateSync(Buffer.concat(compressed));if(raw.length!==height*(rowBytes+1))return false;
  let previous=Buffer.alloc(rowBytes),reference=null;
  for(let row=0;row<height;row++){
   const start=row*(rowBytes+1),filter=raw[start];if(filter>4)return false;const current=Buffer.allocUnsafe(rowBytes);
   for(let x=0;x<rowBytes;x++){
    const source=raw[start+1+x],left=x>=channels?current[x-channels]:0,up=previous[x]||0,upperLeft=x>=channels?(previous[x-channels]||0):0;
    const predictor=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,upperLeft);
    current[x]=(source+predictor)&255;
    if(!reference&&x===channels-1)reference=Buffer.from(current.subarray(0,channels));
    else if(reference&&(row>0||x>=channels)&&current[x]!==reference[x%channels])return false;
   }
   previous=current;
  }
  return true;
 }catch{return false;}
}
