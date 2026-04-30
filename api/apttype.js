export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { bjdCode, bun, bldNm, kaptCode, sigunguCd } = req.query;
  const KEY    = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';
  const DETAIL = 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV4';
  const LIST3  = 'https://apis.data.go.kr/1613000/AptListService3';
  const H      = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };

  try {
    // ── Mode A: kaptCode 직접 조회 ──────────────────────────
    if (kaptCode) {
      const url  = `${DETAIL}/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${kaptCode}&_type=json`;
      const r    = await fetch(url, { headers: H });
      const d    = await r.json();
      const item = d?.response?.body?.item;
      if (!item?.kaptCode) return res.status(200).json({ result: null, message: 'kaptCode 없음' });
      return res.status(200).json({ result: buildResult(item) });
    }

    if (!bjdCode && !sigunguCd) return res.status(400).json({ error: 'bjdCode 또는 kaptCode 필요' });

    // sigunguCd 추출 (bjdCode 앞 5자리)
    const sgg = sigunguCd || bjdCode.slice(0, 5);

    // ── Mode B: getSigunguAptList3로 시군구 전체 단지 검색 ──
    // 페이지당 100개씩 최대 3페이지 (300개) 조회
    let complexList = [];
    for (let page = 1; page <= 3; page++) {
      const url = `${LIST3}/getSigunguAptList3?serviceKey=${KEY}&sigunguCd=${sgg}&_type=json&numOfRows=100&pageNo=${page}`;
      const r   = await fetch(url, { headers: H });
      const txt = await r.text();
      try {
        const d   = JSON.parse(txt);
        const raw = d?.response?.body?.items?.item;
        const arr = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
        complexList.push(...arr);
        const total = d?.response?.body?.totalCount || 0;
        if (complexList.length >= total) break;
      } catch(e) { break; }
    }

    if (!complexList.length) {
      return res.status(200).json({ result: null, message: '시군구 단지 목록 없음', debug: { sgg } });
    }

    // 번지 + 법정동 + 건물명으로 매칭
    const bunNum  = parseInt(bun || '0', 10);
    const dongCode = bjdCode ? bjdCode.slice(5, 8) : ''; // 읍면동 3자리
    let matched   = null;

    // 1순위: 번지 매칭
    if (bunNum > 0) {
      matched = complexList.find(c => {
        const addr = c.kaptAddr || '';
        return addr.includes(`${bunNum}번지`) || addr.includes(` ${bunNum}-`) ||
               addr.endsWith(` ${bunNum}`)    || addr.includes(` ${bunNum} `);
      });
    }

    // 2순위: 건물명 매칭
    if (!matched && bldNm) {
      const kw = bldNm.replace(/\s/g,'').replace(/아파트/g,'');
      matched = complexList.find(c => {
        const cn = (c.kaptName||'').replace(/\s/g,'').replace(/아파트/g,'');
        return cn.includes(kw) || kw.includes(cn);
      });
    }

    // 3순위: bjdCode 앞 8자리로 좁히기 (같은 동)
    if (!matched && bjdCode) {
      const dongList = complexList.filter(c => {
        const code = c.bjdCode || c.kaptBjdCode || '';
        return code.startsWith(bjdCode.slice(0,8));
      });
      if (dongList.length === 1) matched = dongList[0];
      else if (dongList.length > 1 && bunNum > 0) {
        matched = dongList.find(c => {
          const addr = c.kaptAddr || '';
          return addr.includes(String(bunNum));
        });
        if (!matched) matched = dongList[0];
      }
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
  ['60','85','135','136'].forEach(key => {
    const cnt = parseInt(item[`kaptMparea${key}`] || 0);
    if (cnt > 0) types.push({ dedicArea: parseFloat(key), hhldCnt: cnt, pyeong: Math.round(parseFloat(key)/3.3058) });
  });
  if (!types.length && item.privArea) {
    item.privArea.split(',').forEach(s => {
      const a = parseFloat(s.trim());
      if (a > 0) types.push({ dedicArea: a, hhldCnt: 0, pyeong: Math.round(a/3.3058) });
    });
  }
  return types.length ? types.sort((a,b)=>a.dedicArea-b.dedicArea) : null;
}
