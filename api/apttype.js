export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { bjdCode, bun, bldNm, kaptCode } = req.query;
  const KEY    = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';
  const DETAIL = 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV4';
  const LIST3  = 'https://apis.data.go.kr/1613000/AptListService3';

  // 공공API 요청 헤더 (IP 차단 우회용)
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://www.data.go.kr/',
  };

  try {
    // ── Mode A: kaptCode 직접 상세 조회 ────────────────────
    if (kaptCode) {
      const url  = `${DETAIL}/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${kaptCode}&_type=json`;
      const r    = await fetch(url, { headers: HEADERS });
      const d    = await r.json();
      const item = d?.response?.body?.item;
      if (!item?.kaptCode) return res.status(200).json({ result: null, message: 'kaptCode 없음', status: r.status });
      return res.status(200).json({ result: buildResult(item) });
    }

    // ── Mode B: 법정동코드로 단지 검색 ─────────────────────
    if (!bjdCode) return res.status(400).json({ error: 'bjdCode 또는 kaptCode 필요' });

    // bjdCode/loadCode 두 파라미터 모두 시도
    const tryUrls = [
      `${LIST3}/getLegaldongAptList3?serviceKey=${KEY}&bjdCode=${bjdCode}&_type=json&numOfRows=100`,
      `${LIST3}/getLegaldongAptList3?serviceKey=${KEY}&loadCode=${bjdCode}&_type=json&numOfRows=100`,
      `${LIST3}/getSigunguAptList3?serviceKey=${KEY}&sigunguCd=${bjdCode.slice(0,5)}&_type=json&numOfRows=200`,
    ];

    let complexList = [];
    let debugInfo   = [];

    for (const url of tryUrls) {
      try {
        const r   = await fetch(url, { headers: HEADERS });
        const txt = await r.text();
        debugInfo.push({ url: url.split('?')[0].split('/').pop(), status: r.status, preview: txt.slice(0, 100) });
        if (r.status !== 200) continue;
        if (txt.includes('Forbidden') || txt.includes('Unexpected') || txt.includes('error')) continue;
        const d   = JSON.parse(txt);
        const raw = d?.response?.body?.items?.item;
        const arr = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
        if (arr.length > 0) { complexList = arr; break; }
      } catch(e) {
        debugInfo.push({ error: e.message });
      }
    }

    if (!complexList.length) {
      return res.status(200).json({ result: null, message: '단지 목록 없음', debug: debugInfo });
    }

    // 번지 + 건물명으로 매칭
    const bunNum = parseInt(bun || '0', 10);
    let matched  = null;

    if (bunNum > 0) {
      matched = complexList.find(c => {
        const addr = c.kaptAddr || c.address || '';
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
    if (!matched) {
      return res.status(200).json({
        result: null, message: '자동 매칭 실패',
        candidates: complexList.slice(0,15).map(c => ({
          kaptCode: c.kaptCode, name: c.kaptName, addr: c.kaptAddr || ''
        }))
      });
    }

    // 상세 조회
    const detUrl = `${DETAIL}/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${matched.kaptCode}&_type=json`;
    const r3  = await fetch(detUrl, { headers: HEADERS });
    const d3  = await r3.json();
    const item = d3?.response?.body?.item;

    if (!item?.kaptCode) {
      return res.status(200).json({
        result: { kaptCode: matched.kaptCode, kaptName: matched.kaptName,
                  kaptAddr: matched.kaptAddr||'', platArea:0, totArea:0,
                  vlRat:0, bcRat:0, hhldCnt:0, dongCnt:0, types:null }
      });
    }
    return res.status(200).json({ result: buildResult(item) });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

function buildResult(item) {
  return {
    kaptCode: item.kaptCode,
    kaptName: item.kaptName,
    kaptAddr: item.doroJuso || item.kaptAddr,
    platArea: parseFloat(item.kaptLarea  || 0),
    totArea:  parseFloat(item.kaptTarea  || 0),
    vlRat:    parseFloat(item.kaptVlRat  || 0),
    bcRat:    parseFloat(item.kaptBcRat  || 0),
    hhldCnt:  parseInt(item.kaptdaCnt    || 0),
    dongCnt:  parseInt(item.kaptDongCnt  || 0),
    types:    extractTypes(item),
  };
}

function extractTypes(item) {
  if (!item) return null;
  const types = [];
  Object.keys(item).filter(k => k.startsWith('kaptMparea')).forEach(key => {
    const area = parseFloat(key.replace('kaptMparea',''));
    const cnt  = parseInt(item[key]||0);
    if (area > 0 && cnt > 0) types.push({ dedicArea:area, hhldCnt:cnt, pyeong:Math.round(area/3.3058) });
  });
  if (!types.length && item.privArea) {
    item.privArea.split(',').forEach(s => {
      const a = parseFloat(s.trim());
      if (a > 0) types.push({ dedicArea:a, hhldCnt:0, pyeong:Math.round(a/3.3058) });
    });
  }
  return types.length ? types.sort((a,b)=>a.dedicArea-b.dedicArea) : null;
}
