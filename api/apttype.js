export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { bjdCode, bun, bldNm, kaptCode, test } = req.query;
  const KEY = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';

  // ── 진단 모드: ?test=1 ──────────────────────────────────
  if (test) {
    const code = bjdCode || '4117110300';
    const endpoints = [
      // 1611000 계열
      `https://apis.data.go.kr/1611000/AptListService/getLegaldongAptList?serviceKey=${KEY}&loadCode=${code}&_type=json&numOfRows=3`,
      `https://apis.data.go.kr/1611000/AptListService2/getLegaldongAptList?serviceKey=${KEY}&loadCode=${code}&_type=json&numOfRows=3`,
      // 1613000 계열
      `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4?serviceKey=${KEY}&bjdCode=${code}&_type=json&numOfRows=3`,
      `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4?serviceKey=${KEY}&loadCode=${code}&_type=json&numOfRows=3`,
      // 단지 목록 서비스
      `https://apis.data.go.kr/1613000/AptListService/getAptList?serviceKey=${KEY}&bjdCode=${code}&_type=json&numOfRows=3`,
      `https://apis.data.go.kr/1613000/RtmsDataSvcAptRent/getRTMSDataSvcAptRent?serviceKey=${KEY}&LAWD_CD=${code.slice(0,5)}&DEAL_YMD=202401&_type=json&numOfRows=3`,
    ];

    const results = {};
    for (const url of endpoints) {
      const ep = url.split('?')[0].split('/').slice(-2).join('/');
      try {
        const r   = await fetch(url);
        const txt = await r.text();
        const ok  = !txt.includes('Unexpected') && !txt.includes('NOT_FOUND') && !txt.includes('allowlist');
        try {
          const d = JSON.parse(txt);
          const cnt = d?.response?.body?.totalCount || d?.response?.body?.items?.item?.length || 0;
          results[ep] = { ok, status: r.status, totalCount: cnt, sample: txt.slice(0, 150) };
        } catch(e) {
          results[ep] = { ok: false, status: r.status, raw: txt.slice(0, 150) };
        }
      } catch(e) {
        results[ep] = { ok: false, error: e.message };
      }
    }
    return res.status(200).json({ diagnostic: true, bjdCode: code, results });
  }

  try {
    // ── Mode A: kaptCode 직접 조회 ──────────────────────────
    if (kaptCode) {
      const url = `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${kaptCode}&_type=json`;
      const r   = await fetch(url);
      const d   = await r.json();
      const item = d?.response?.body?.item;
      if (!item?.kaptCode) return res.status(200).json({ result: null, message: 'kaptCode 없음' });
      const types = extractTypes(item);
      return res.status(200).json({
        result: {
          kaptCode: item.kaptCode,
          kaptName: item.kaptName,
          kaptAddr: item.doroJuso || item.kaptAddr,
          platArea: parseFloat(item.kaptLarea || 0),
          totArea:  parseFloat(item.kaptTarea || 0),
          vlRat:    parseFloat(item.kaptVlRat || 0),
          bcRat:    parseFloat(item.kaptBcRat || 0),
          hhldCnt:  parseInt(item.kaptdaCnt   || 0),
          dongCnt:  parseInt(item.kaptDongCnt || 0),
          types,
        },
        raw: item
      });
    }

    // ── Mode B: 법정동코드로 단지 검색 ─────────────────────
    if (!bjdCode) return res.status(400).json({ error: 'bjdCode 또는 kaptCode 필요. 진단: ?test=1&bjdCode=4117110300' });

    // 작동하는 엔드포인트 순서대로 시도
    const searchUrls = [
      `https://apis.data.go.kr/1611000/AptListService/getLegaldongAptList?serviceKey=${KEY}&loadCode=${bjdCode}&_type=json&numOfRows=100`,
      `https://apis.data.go.kr/1611000/AptListService2/getLegaldongAptList?serviceKey=${KEY}&loadCode=${bjdCode}&_type=json&numOfRows=100`,
      `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4?serviceKey=${KEY}&bjdCode=${bjdCode}&_type=json&numOfRows=100`,
    ];

    let complexList = [];
    let usedUrl     = '';

    for (const url of searchUrls) {
      try {
        const r   = await fetch(url);
        const txt = await r.text();
        if (txt.includes('Unexpected') || txt.includes('allowlist')) continue;
        const d   = JSON.parse(txt);
        const raw = d?.response?.body?.items?.item;
        const arr = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
        if (arr.length > 0) { complexList = arr; usedUrl = url.split('?')[0]; break; }
      } catch(e) { continue; }
    }

    if (!complexList.length) {
      return res.status(200).json({ result: null, message: '단지 목록 없음 — ?test=1 로 진단 실행', debug: { bjdCode } });
    }

    const bunNum = parseInt(bun || '0', 10);
    let matched  = null;

    if (bunNum > 0) {
      matched = complexList.find(c => {
        const addr = c.kaptAddr || c.address || c.doroJuso || '';
        return addr.includes(`${bunNum}번지`) || addr.includes(` ${bunNum}-`) || addr.endsWith(` ${bunNum}`) || addr.includes(` ${bunNum} `);
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
        result: null, message: '자동 매칭 실패', usedUrl,
        candidates: complexList.slice(0,15).map(c => ({ kaptCode: c.kaptCode, name: c.kaptName, addr: c.kaptAddr||c.doroJuso||'' }))
      });
    }

    const detUrl = `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${matched.kaptCode}&_type=json`;
    const r3 = await fetch(detUrl);
    const d3 = await r3.json();
    const item = d3?.response?.body?.item || matched;
    const types = extractTypes(item);

    return res.status(200).json({
      result: {
        kaptCode: item.kaptCode || matched.kaptCode,
        kaptName: item.kaptName || matched.kaptName,
        kaptAddr: item.doroJuso || item.kaptAddr || matched.kaptAddr,
        platArea: parseFloat(item.kaptLarea || 0),
        totArea:  parseFloat(item.kaptTarea || 0),
        vlRat:    parseFloat(item.kaptVlRat || 0),
        bcRat:    parseFloat(item.kaptBcRat || 0),
        hhldCnt:  parseInt(item.kaptdaCnt   || 0),
        dongCnt:  parseInt(item.kaptDongCnt || 0),
        types,
      }
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

function extractTypes(item) {
  if (!item) return null;
  const types = [];
  Object.keys(item).filter(k => k.startsWith('kaptMparea')).forEach(key => {
    const area = parseFloat(key.replace('kaptMparea',''));
    const cnt  = parseInt(item[key]||0);
    if (area > 0 && cnt > 0) types.push({ dedicArea: area, hhldCnt: cnt, pyeong: Math.round(area/3.3058) });
  });
  if (!types.length && item.privArea) {
    item.privArea.split(',').forEach(s => {
      const a = parseFloat(s.trim());
      if (a > 0) types.push({ dedicArea: a, hhldCnt: 0, pyeong: Math.round(a/3.3058) });
    });
  }
  return types.length ? types.sort((a,b)=>a.dedicArea-b.dedicArea) : null;
}
