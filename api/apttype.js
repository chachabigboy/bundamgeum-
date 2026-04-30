export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { bjdCode, bun, bldNm, kaptCode } = req.query;
  const KEY    = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';
  const DETAIL = 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV4';
  const LIST3  = 'https://apis.data.go.kr/1613000/AptListService3';
  const H      = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Referer': 'https://www.data.go.kr/' };

  try {
    // ── Mode A: kaptCode 직접 상세 조회 ────────────────────
    if (kaptCode) {
      const url  = `${DETAIL}/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${kaptCode}&_type=json`;
      const r    = await fetch(url, { headers: H });
      const txt  = await r.text();
      try {
        const d    = JSON.parse(txt);
        const item = d?.response?.body?.item;
        if (!item?.kaptCode) return res.status(200).json({ result: null, message: 'kaptCode 없음', status: r.status, raw: txt.slice(0,200) });
        return res.status(200).json({ result: buildResult(item), raw: item });
      } catch(e) {
        return res.status(200).json({ result: null, parseError: e.message, raw: txt.slice(0,200) });
      }
    }

    // ── Mode B: 법정동코드로 단지 목록 검색 ────────────────
    if (!bjdCode) return res.status(400).json({ error: 'bjdCode 또는 kaptCode 필요' });

    // loadCode 파라미터로 getLegaldongAptList3 호출
    const listUrl = `${LIST3}/getLegaldongAptList3?serviceKey=${KEY}&loadCode=${bjdCode}&_type=json&numOfRows=100&pageNo=1`;
    const r2  = await fetch(listUrl, { headers: H });
    const txt2 = await r2.text();

    let complexList = [];
    try {
      const d2  = JSON.parse(txt2);
      const cnt = d2?.response?.body?.totalCount || 0;
      const raw = d2?.response?.body?.items?.item;
      complexList = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
      if (!complexList.length) {
        return res.status(200).json({
          result: null, message: '단지 목록 없음',
          debug: { loadCode: bjdCode, totalCount: cnt, status: r2.status, preview: txt2.slice(0,200) }
        });
      }
    } catch(e) {
      return res.status(200).json({ result: null, message: '파싱 실패', raw: txt2.slice(0,300) });
    }

    // 번지 + 건물명으로 매칭
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
    const r3  = await fetch(detUrl, { headers: H });
    const d3  = await r3.json();
    const item = d3?.response?.body?.item;
    if (!item?.kaptCode) return res.status(200).json({
      result: { kaptCode: matched.kaptCode, kaptName: matched.kaptName,
                kaptAddr: matched.kaptAddr||'', platArea:0, totArea:0,
                vlRat:0, bcRat:0, hhldCnt:0, dongCnt:0, types:null }
    });
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
  // 언더스코어 포함 필드명: kaptMparea_60, kaptMparea_85, kaptMparea_135, kaptMparea_136
  const areaKeys = ['60','85','135','136'];
  areaKeys.forEach(key => {
    const cnt = parseInt(item[`kaptMparea_${key}`] || item[`kaptMparea${key}`] || 0);
    if (cnt > 0) {
      types.push({ dedicArea: parseFloat(key), hhldCnt: cnt, pyeong: Math.round(parseFloat(key)/3.3058) });
    }
  });
  // privArea 파싱 (전용면적 목록)
  if (!types.length && item.privArea) {
    item.privArea.split(',').forEach(s => {
      const a = parseFloat(s.trim());
      if (a > 0) types.push({ dedicArea: a, hhldCnt: 0, pyeong: Math.round(a/3.3058) });
    });
  }
  return types.length ? types.sort((a,b)=>a.dedicArea-b.dedicArea) : null;
}
