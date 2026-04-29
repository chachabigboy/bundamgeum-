export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { bjdCode, bun, bldNm, kaptCode, debug } = req.query;
  const KEY    = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';
  const DETAIL = 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV4';
  const LIST3  = 'https://apis.data.go.kr/1613000/AptListService3';
  const H      = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Referer': 'https://www.data.go.kr/' };

  // ── 진단 모드: ?debug=1 ─────────────────────────────────
  if (debug) {
    const code = bjdCode || '4117110300';
    const sgg  = code.slice(0, 5);
    const tests = [
      // loadCode 10자리
      `${LIST3}/getLegaldongAptList3?serviceKey=${KEY}&loadCode=${code}&_type=json&numOfRows=5`,
      // sigunguCd 여러 버전
      `${LIST3}/getSigunguAptList3?serviceKey=${KEY}&sigunguCd=${sgg}&_type=json&numOfRows=5`,
      `${LIST3}/getSigunguAptList3?serviceKey=${KEY}&sigunguCd=41173&_type=json&numOfRows=5`,  // 동안구
      `${LIST3}/getSigunguAptList3?serviceKey=${KEY}&sigunguCd=41171&_type=json&numOfRows=5`,  // 만안구
      `${LIST3}/getSigunguAptList3?serviceKey=${KEY}&sigunguCd=11680&_type=json&numOfRows=5`,  // 강남구(검증용)
      // loadCode 8자리
      `${LIST3}/getLegaldongAptList3?serviceKey=${KEY}&loadCode=${code.slice(0,8)}&_type=json&numOfRows=5`,
    ];
    const results = {};
    for (const url of tests) {
      const key = url.split('?')[0].split('/').pop() + '?' + new URL(url).searchParams.toString().slice(0,60);
      try {
        const r   = await fetch(url, { headers: H });
        const txt = await r.text();
        try {
          const d   = JSON.parse(txt);
          const cnt = d?.response?.body?.totalCount || 0;
          const items = d?.response?.body?.items?.item;
          const sample = items ? (Array.isArray(items) ? items[0] : items) : null;
          results[key] = { status: r.status, totalCount: cnt, sampleName: sample?.kaptName || null };
        } catch(e) {
          results[key] = { status: r.status, raw: txt.slice(0, 80) };
        }
      } catch(e) { results[key] = { error: e.message }; }
    }
    return res.status(200).json({ diagnostic: true, results });
  }

  try {
    // ── Mode A: kaptCode 직접 조회 ──────────────────────────
    if (kaptCode) {
      const r    = await fetch(`${DETAIL}/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${kaptCode}&_type=json`, { headers: H });
      const d    = await r.json();
      const item = d?.response?.body?.item;
      if (!item?.kaptCode) return res.status(200).json({ result: null, message: 'kaptCode 없음' });
      return res.status(200).json({ result: buildResult(item) });
    }

    if (!bjdCode) return res.status(400).json({ error: 'bjdCode 또는 kaptCode 필요. 진단: ?debug=1&bjdCode=4117110300' });

    const sgg = bjdCode.slice(0, 5);

    // loadCode(10자리) → getSigunguAptList3 순서로 시도
    const tryUrls = [
      `${LIST3}/getLegaldongAptList3?serviceKey=${KEY}&loadCode=${bjdCode}&_type=json&numOfRows=100`,
      `${LIST3}/getSigunguAptList3?serviceKey=${KEY}&sigunguCd=${sgg}&_type=json&numOfRows=500`,
      // 동안구 코드가 다를 경우 대비
      `${LIST3}/getSigunguAptList3?serviceKey=${KEY}&sigunguCd=41173&_type=json&numOfRows=500`,
    ];

    let complexList = [], debugInfo = [];
    for (const url of tryUrls) {
      try {
        const r   = await fetch(url, { headers: H });
        const txt = await r.text();
        const ep  = url.split('?')[0].split('/').pop();
        if (!txt || txt.includes('Forbidden')) { debugInfo.push({ ep, status: r.status, result: 'Forbidden' }); continue; }
        const d   = JSON.parse(txt);
        const raw = d?.response?.body?.items?.item;
        const arr = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
        debugInfo.push({ ep, status: r.status, count: arr.length });
        if (arr.length > 0) { complexList = arr; break; }
      } catch(e) { debugInfo.push({ error: e.message }); }
    }

    if (!complexList.length) return res.status(200).json({ result: null, message: '단지 목록 없음', debugInfo });

    const bunNum = parseInt(bun || '0', 10);
    let matched  = null;
    if (bunNum > 0) {
      matched = complexList.find(c => {
        const addr = c.kaptAddr || '';
        return addr.includes(`${bunNum}번지`) || addr.includes(` ${bunNum}-`) ||
               addr.endsWith(` ${bunNum}`)    || addr.includes(` ${bunNum} `);
      });
    }
    if (!matched && bldNm) {
      const kw = bldNm.replace(/\s/g,'').replace(/아파트/g,'');
      matched = complexList.find(c => {
        const cn = (c.kaptName||'').replace(/\s/g,'').replace(/아파트/g,'');
        return cn.includes(kw) || kw.includes(cn);
      });
    }
    if (!matched) return res.status(200).json({
      result: null, message: '자동 매칭 실패', debugInfo,
      candidates: complexList.slice(0,15).map(c => ({ kaptCode: c.kaptCode, name: c.kaptName, addr: c.kaptAddr||'' }))
    });

    const r3  = await fetch(`${DETAIL}/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${matched.kaptCode}&_type=json`, { headers: H });
    const d3  = await r3.json();
    const item = d3?.response?.body?.item;
    if (!item?.kaptCode) return res.status(200).json({
      result: { kaptCode: matched.kaptCode, kaptName: matched.kaptName, kaptAddr: matched.kaptAddr||'', platArea:0, totArea:0, vlRat:0, bcRat:0, hhldCnt:0, dongCnt:0, types:null }
    });
    return res.status(200).json({ result: buildResult(item) });

  } catch(e) { return res.status(500).json({ error: e.message }); }
}

function buildResult(item) {
  return {
    kaptCode: item.kaptCode, kaptName: item.kaptName,
    kaptAddr: item.doroJuso || item.kaptAddr,
    platArea: parseFloat(item.kaptLarea||0), totArea: parseFloat(item.kaptTarea||0),
    vlRat: parseFloat(item.kaptVlRat||0), bcRat: parseFloat(item.kaptBcRat||0),
    hhldCnt: parseInt(item.kaptdaCnt||0), dongCnt: parseInt(item.kaptDongCnt||0),
    types: extractTypes(item),
  };
}
function extractTypes(item) {
  if (!item) return null;
  const types = [];
  Object.keys(item).filter(k=>k.startsWith('kaptMparea')).forEach(key=>{
    const area=parseFloat(key.replace('kaptMparea',''));
    const cnt=parseInt(item[key]||0);
    if(area>0&&cnt>0) types.push({dedicArea:area,hhldCnt:cnt,pyeong:Math.round(area/3.3058)});
  });
  if(!types.length&&item.privArea) item.privArea.split(',').forEach(s=>{
    const a=parseFloat(s.trim());
    if(a>0) types.push({dedicArea:a,hhldCnt:0,pyeong:Math.round(a/3.3058)});
  });
  return types.length?types.sort((a,b)=>a.dedicArea-b.dedicArea):null;
}
