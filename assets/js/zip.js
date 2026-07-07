/* ===========================================================================
   의존성 없는 ZIP 생성기 (store 방식 · 무압축)
   - 이미지(jpg/png/webp)는 이미 압축돼 있어 무압축 저장으로 충분합니다.
   - makeZip([{name, blob}]) -> Promise<Blob>
   =========================================================================== */
const CRC_TABLE = (()=>{ const t=new Uint32Array(256);
  for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = c&1 ? 0xEDB88320 ^ (c>>>1) : c>>>1; t[n]=c>>>0; } return t; })();
function crc32(u8){ let c=0xFFFFFFFF; for(let i=0;i<u8.length;i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c>>>8); return (c ^ 0xFFFFFFFF)>>>0; }

async function makeZip(files){
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = ((now.getHours()&31)<<11) | ((now.getMinutes()&63)<<5) | ((now.getSeconds()/2)&31);
  const dosDate = (((now.getFullYear()-1980)&127)<<9) | (((now.getMonth()+1)&15)<<5) | (now.getDate()&31);

  const parts=[]; const central=[]; let offset=0;
  const push=(u8)=>{ parts.push(u8); offset+=u8.length; };

  for(const f of files){
    const data = new Uint8Array(await f.blob.arrayBuffer());
    const nameB = enc.encode(f.name);
    const crc = crc32(data), size = data.length;

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0x0800,true);
    lh.setUint16(8,0,true); lh.setUint16(10,dosTime,true); lh.setUint16(12,dosDate,true);
    lh.setUint32(14,crc,true); lh.setUint32(18,size,true); lh.setUint32(22,size,true);
    lh.setUint16(26,nameB.length,true); lh.setUint16(28,0,true);
    const localOffset = offset;
    push(new Uint8Array(lh.buffer)); push(nameB); push(data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true);
    ch.setUint16(8,0x0800,true); ch.setUint16(10,0,true); ch.setUint16(12,dosTime,true); ch.setUint16(14,dosDate,true);
    ch.setUint32(16,crc,true); ch.setUint32(20,size,true); ch.setUint32(24,size,true);
    ch.setUint16(28,nameB.length,true); ch.setUint16(30,0,true); ch.setUint16(32,0,true);
    ch.setUint16(34,0,true); ch.setUint16(36,0,true); ch.setUint32(38,0,true); ch.setUint32(42,localOffset,true);
    central.push({ head:new Uint8Array(ch.buffer), name:nameB });
  }

  const cdStart = offset;
  central.forEach(c=>{ push(c.head); push(c.name); });
  const cdSize = offset - cdStart;

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0,0x06054b50,true); eocd.setUint16(8,files.length,true); eocd.setUint16(10,files.length,true);
  eocd.setUint32(12,cdSize,true); eocd.setUint32(16,cdStart,true);
  push(new Uint8Array(eocd.buffer));

  return new Blob(parts,{type:'application/zip'});
}
function downloadBlob(blob, filename){
  const a=el('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
