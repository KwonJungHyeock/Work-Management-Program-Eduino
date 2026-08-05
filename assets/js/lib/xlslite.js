/* ===========================================================================
   XlsLite — 레거시 .xls(OLE2/BIFF8) 최소 판독기 (라이브러리 없이 브라우저에서)
   - 마우저 [프로젝트 매니저] 내보내기가 .xls(CDFV2) 로 떨어져서 필요.
     (.xlsx 는 ZIP 기반이라 XlsxLite 가 담당 · 이 파일은 구형 .xls 전용)
   - 지원 레코드: SST/CONTINUE · LABELSST · LABEL · NUMBER · RK · MULRK · BOUNDSHEET
   - API: XlsLite.parseSheets(File|ArrayBuffer) → Promise<[{name, rows:[[cell,…],…]}]>
     (XlsxLite.parseSheets 와 동일한 형태 → 호출부에서 확장자만 보고 갈아끼움)
   =========================================================================== */
(function(){
  const SIG = [0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1];

  /* ---------- OLE2(CFB) 컨테이너 ---------- */
  function readCFB(buf){
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    for(let i=0;i<8;i++) if(u8[i]!==SIG[i]) throw new Error('OLE2 파일이 아닙니다');
    const secShift = dv.getUint16(30, true), secSize = 1 << secShift;         // 보통 512
    const miniShift = dv.getUint16(32, true), miniSize = 1 << miniShift;      // 보통 64
    const nFat = dv.getUint32(44, true);
    const dirStart = dv.getUint32(48, true);
    const miniCutoff = dv.getUint32(56, true) || 4096;
    const miniFatStart = dv.getUint32(60, true), nMiniFat = dv.getUint32(64, true);
    const difatStart = dv.getUint32(68, true), nDifat = dv.getUint32(72, true);
    const secOff = s => 512 + s * secSize;

    // DIFAT — 헤더 109개 + (있으면) 추가 DIFAT 섹터 체인
    const fatSecs = [];
    for(let i=0;i<109 && i<nFat;i++){ const s = dv.getUint32(76 + i*4, true); if(s<0xFFFFFFFA) fatSecs.push(s); }
    let ds = difatStart;
    for(let k=0;k<nDifat && ds<0xFFFFFFFA;k++){
      const base = secOff(ds), per = (secSize/4) - 1;
      for(let i=0;i<per;i++){ const s = dv.getUint32(base + i*4, true); if(s<0xFFFFFFFA) fatSecs.push(s); }
      ds = dv.getUint32(base + per*4, true);
    }
    // FAT 본체
    const fat = [];
    fatSecs.forEach(fs=>{ const base = secOff(fs); for(let i=0;i<secSize/4;i++) fat.push(dv.getUint32(base + i*4, true)); });
    // miniFAT
    const miniFat = [];
    { let s = miniFatStart;
      for(let g=0; s<0xFFFFFFFA && g<100000; g++){ const base = secOff(s); for(let i=0;i<secSize/4;i++) miniFat.push(dv.getUint32(base + i*4, true)); s = fat[s]; } }

    const chain = (start, table) => { const out=[]; let s=start;
      for(let g=0; s!=null && s<0xFFFFFFFA && g<1000000; g++){ out.push(s); s = table[s]; } return out; };
    const readFromSectors = (start, size) => { const out = new Uint8Array(size); let n=0;
      for(const s of chain(start, fat)){ if(n>=size) break; const len = Math.min(secSize, size-n);
        out.set(u8.subarray(secOff(s), secOff(s)+len), n); n += len; } return out; };

    // 디렉터리 엔트리
    const dirBuf = readFromSectors(dirStart, chain(dirStart, fat).length * secSize);
    const ddv = new DataView(dirBuf.buffer, dirBuf.byteOffset, dirBuf.byteLength);
    const entries = [];
    for(let off=0; off+128<=dirBuf.length; off+=128){
      const nameLen = ddv.getUint16(off+64, true);
      let name=''; for(let i=0;i<Math.max(0,nameLen-2);i+=2) name += String.fromCharCode(ddv.getUint16(off+i, true));
      entries.push({ name, type: dirBuf[off+66], start: ddv.getUint32(off+116, true), size: ddv.getUint32(off+120, true) });
    }
    const root = entries.find(e=>e.type===5) || entries[0];
    const miniStream = root ? readFromSectors(root.start, root.size) : new Uint8Array(0);
    const readMini = (start, size) => { const out = new Uint8Array(size); let n=0;
      for(const s of chain(start, miniFat)){ if(n>=size) break; const len = Math.min(miniSize, size-n);
        out.set(miniStream.subarray(s*miniSize, s*miniSize+len), n); n += len; } return out; };

    const readStream = e => (e.size < miniCutoff && e.type!==5) ? readMini(e.start, e.size) : readFromSectors(e.start, e.size);
    return { entries, readStream };
  }

  /* ---------- BIFF8 유니코드 문자열(CONTINUE 경계 처리) ---------- */
  function makeReader(chunks){
    let ci=0, off=0;
    const cur = ()=>chunks[ci];
    const left = ()=> cur() ? cur().length - off : 0;
    function need(n){ while(cur() && left()===0 && ci<chunks.length-1){ ci++; off=0; } return left()>=n; }
    return {
      eof: ()=> ci>=chunks.length || (ci===chunks.length-1 && left()===0),
      u8(){ need(1); const v=cur()[off]; off+=1; return v; },
      u16(){ need(2); const c=cur(); const v=c[off]|(c[off+1]<<8); off+=2; return v; },
      u32(){ need(4); const c=cur(); const v=(c[off]|(c[off+1]<<8)|(c[off+2]<<16))+(c[off+3]*16777216); off+=4; return v; },
      skip(n){ let r=n; while(r>0){ if(left()===0){ if(ci>=chunks.length-1) return; ci++; off=0; continue; } const t=Math.min(r,left()); off+=t; r-=t; } },
      /* 문자 n개 읽기 — 청크(CONTINUE) 경계를 넘으면 플래그 바이트를 다시 읽어 wide 여부 갱신 */
      chars(n, wide){ let s='';
        for(let i=0;i<n;i++){
          if(left()===0){
            if(ci>=chunks.length-1) break;
            ci++; off=0; wide = (cur()[off] & 1) === 1; off += 1;   // CONTINUE 선두 1바이트 = 플래그
          }
          if(wide){ if(left()<2){ i--; off=left(); continue; } const c=cur(); s+=String.fromCharCode(c[off]|(c[off+1]<<8)); off+=2; }
          else { s += String.fromCharCode(cur()[off]); off+=1; }
        }
        return s; },
    };
  }
  function readUniString(r){
    const cch = r.u16(); const flags = r.u8();
    const wide = (flags & 0x01) === 1, ext = (flags & 0x04) !== 0, rich = (flags & 0x08) !== 0;
    let cRun=0, cbExt=0;
    if(rich) cRun = r.u16();
    if(ext) cbExt = r.u32();
    const s = r.chars(cch, wide);
    if(rich) r.skip(cRun*4);
    if(ext) r.skip(cbExt);
    return s;
  }
  const rkToNum = rk => { const isInt = (rk & 0x02) !== 0, div100 = (rk & 0x01) !== 0; let v;
    if(isInt){ v = rk >> 2; }
    else { const b = new ArrayBuffer(8), d = new DataView(b); d.setUint32(4, rk & 0xFFFFFFFC); v = d.getFloat64(0); }
    return div100 ? v/100 : v; };

  /* ---------- BIFF 레코드 → 시트 ---------- */
  function parseWorkbook(bytes){
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const recs = [];
    for(let p=0; p+4<=bytes.length; ){
      const type = dv.getUint16(p, true), len = dv.getUint16(p+2, true);
      if(p+4+len > bytes.length) break;
      recs.push({ type, start: p+4, len }); p += 4 + len;
    }
    // SST(+CONTINUE)
    const sst = [];
    for(let i=0;i<recs.length;i++){
      if(recs[i].type !== 0x00FC) continue;
      const chunks = [bytes.subarray(recs[i].start, recs[i].start + recs[i].len)];
      for(let j=i+1; j<recs.length && recs[j].type===0x003C; j++) chunks.push(bytes.subarray(recs[j].start, recs[j].start + recs[j].len));
      const r = makeReader(chunks);
      r.u32(); const cUnique = r.u32();
      for(let k=0;k<cUnique;k++){ try{ sst.push(readUniString(r)); }catch(e){ break; } }
      break;
    }
    // 시트 이름(BOUNDSHEET)
    const names = [];
    recs.filter(x=>x.type===0x0085).forEach(x=>{ const p=x.start;
      const cch = bytes[p+6], flags = bytes[p+7], wide=(flags&1)===1; let s='';
      for(let i=0;i<cch;i++) s += wide ? String.fromCharCode(bytes[p+8+i*2]|(bytes[p+9+i*2]<<8)) : String.fromCharCode(bytes[p+8+i]);
      names.push(s); });

    // 셀 — 시트 경계는 BOF(0x0809)/EOF(0x000A) 로 구분(첫 BOF=워크북 전역)
    const sheets = []; let cells = null;
    const put = (r,c,v)=>{ if(!cells) return; (cells[r] = cells[r] || [])[c] = v; };
    let seenGlobal = false;
    for(const rec of recs){
      if(rec.type === 0x0809){ if(!seenGlobal){ seenGlobal = true; continue; } cells = []; continue; }
      if(rec.type === 0x000A){ if(cells){ sheets.push(cells); cells = null; } continue; }
      if(!cells) continue;
      const p = rec.start;
      if(rec.type === 0x00FD){ const row=dv.getUint16(p,true), col=dv.getUint16(p+2,true), idx=dv.getUint32(p+6,true); put(row,col, sst[idx]!=null?sst[idx]:''); }
      else if(rec.type === 0x0203){ put(dv.getUint16(p,true), dv.getUint16(p+2,true), dv.getFloat64(p+6,true)); }
      else if(rec.type === 0x027E){ put(dv.getUint16(p,true), dv.getUint16(p+2,true), rkToNum(dv.getUint32(p+6,true))); }
      else if(rec.type === 0x00BD){ const row=dv.getUint16(p,true), c1=dv.getUint16(p+2,true);
        const n=Math.floor((rec.len-6)/6); for(let i=0;i<n;i++) put(row, c1+i, rkToNum(dv.getUint32(p+4+i*6+2, true))); }
      else if(rec.type === 0x0204){ const row=dv.getUint16(p,true), col=dv.getUint16(p+2,true);
        const chunks=[bytes.subarray(p+6, rec.start+rec.len)]; try{ put(row,col, readUniString(makeReader(chunks))); }catch(e){} }
    }
    if(cells) sheets.push(cells);
    return sheets.map((rows,i)=>({ name: names[i] || ('Sheet'+(i+1)),
      rows: rows.map(r=>{ const out=[]; const n=r?r.length:0; for(let c=0;c<n;c++) out.push(r[c]==null?'':r[c]); return out; }) }));
  }

  function parseBuffer(buf){
    const { entries, readStream } = readCFB(buf);
    const wb = entries.find(e=>/^(Workbook|Book)$/i.test(e.name)) || entries.find(e=>e.type===2 && e.size>0);
    if(!wb) throw new Error('Workbook 스트림을 찾지 못했습니다');
    return parseWorkbook(readStream(wb));
  }
  function parseSheets(input){
    if(input instanceof ArrayBuffer) return Promise.resolve(parseBuffer(input));
    return new Promise((res, rej)=>{ const rd = new FileReader();
      rd.onload = ()=>{ try{ res(parseBuffer(rd.result)); }catch(e){ rej(e); } };
      rd.onerror = ()=>rej(new Error('파일을 읽지 못했습니다'));
      rd.readAsArrayBuffer(input); });
  }
  const api = { parseSheets, parseBuffer };
  if(typeof window!=='undefined') window.XlsLite = api;
  if(typeof module!=='undefined' && module.exports) module.exports = api;
})();
