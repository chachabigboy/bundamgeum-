export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { bjdCode, bun, bldNm, kaptCode } = req.query;
  const KEY  = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';
  const LIST = 'https://apis.data.go.kr/1613000/AptListService3';
  const DETAIL = 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV4';

  try {
    // ── Mode A: kaptCode 직접 상세 조회 ────────────────────
    if (kaptCode) {
      const url  = `${DETAIL}/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${kaptCode}&_type=json`;
      const r    = await fetch(url);
      const d    = await r.json();
      const item = d?.response?.body?.item;
      if (!item?.kaptCode) return res.status(200).json({ result: null, message: 'kaptCode 데이터 없음' });
      return res.status(200).json({ result: buildResult(item), raw: item });
    }

    // ── Mode B: 법정동코드로 단지 목록 → 매칭 → 상세 조회 ──
    if (!bjdCode) return res.status(400).json({ error: 'bjdCode 또는 kaptCode 필요' });

    // getLegaldongAptList3: 법정동코드로 단지코드 + 단지명 조회
    const listUrl =
      `${LIST}/getLegaldongAptList3?serviceKey=${KEY}` +
      `&bjdCode=${bjdCode}&_type=json&numOfRows=100&pageNo=1`;

    const r2   = await fetch(listUrl);
    const txt2 = await r2.text();

    let complexList = [];
    try {
      const d2  = JSON.parse(txt2);
      const raw = d2?.response?.body?.items?.item;
      complexList = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    } catch(e) {
      return res.status(200).json({ result: null, message: '파싱 실패', raw: txt2.slice(0, 300) });
    }

    if (!complexList.length) {
      return res.status(200).json({ result: null, message: '단지 목록 없음', debug: { bjdCode, listUrl } });
    }

    // 번지 + 건물명으로 단지 매칭
    const bunNum = parseInt(bun || '0', 10);
    let matched  = null;

    if (bunNum > 0) {
      matched = complexList.find(c => {
        const addr = (c.kaptAddr || c.address || '');
        return addr.includes(`${bunNum}번지`) ||
               addr.includes(` ${bunNum}-`)   ||
               addr.endsWith(` ${bunNum}`)     ||
               addr.includes(` ${bunNum} `);
      });
    }
    if (!matched && bldNm) {
      const kw = bldNm.replace(/\s/g,'').replace(/아파트/g,'');
      matched = complexList.find(c => {
        const cn = (c.kaptName||'').replace(/\s/g,'').replace(/아파트/g,'');
        return cn.includes(kw) || kw.includes(cn);
      });
    }

    // 매칭 실패 시 후보 목록 반환
    if (!matched) {
      return res.status(200).json({
        result: null,
        message: '자동 매칭 실패 — 후보 목록',
        candidates: complexList.slice(0, 15).map(c => ({
          kaptCode: c.kaptCode,
          name:     c.kaptName,
          addr:     c.kaptAddr || '',
        }))
      });
    }

    // 매칭된 kaptCode로 상세 조회
    const detUrl =
      `${DETAIL}/getAphusBassInfoV4?serviceKey=${KEY}` +
      `&kaptCode=${matched.kaptCode}&_type=json`;
    const r3  = await fetch(detUrl);
    const d3  = await r3.json();
    const item = d3?.response?.body?.item;

    if (!item?.kaptCode) {
      // 상세 조회 실패 시 목록 데이터만 반환
      return res.status(200).json({
        result: {
          kaptCode: matched.kaptCode,
          kaptName: matched.kaptName,
          kaptAddr: matched.kaptAddr || '',
          platArea: 0, totArea: 0, vlRat: 0, bcRat: 0,
          hhldCnt:  0, dongCnt: 0, types: null,
        }
      });
    }

    return res.status(200).json({ result: buildResult(item), raw: item });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

function buildResult(item) {
  return {
    kaptCode: item.kaptCode,
    kaptName: item.kaptName,
    kaptAddr: item.doroJuso || item.kaptAddr,
    platArea: parseFloat(item.kaptLarea  || 0),  // 대지면적 ㎡
    totArea:  parseFloat(item.kaptTarea  || 0),  // 연면적 ㎡
    vlRat:    parseFloat(item.kaptVlRat  || 0),  // 용적률 %
    bcRat:    parseFloat(item.kaptBcRat  || 0),  // 건폐율 %
    hhldCnt:  parseInt(item.kaptdaCnt    || 0),  // 총세대수
    dongCnt:  parseInt(item.kaptDongCnt  || 0),  // 동수
    types:    extractTypes(item),
  };
}

function extractTypes(item) {
  if (!item) return null;
  const types = [];
  // kaptMparea60, kaptMparea85, kaptMparea135 등 평형별 세대수
  Object.keys(item).filter(k => k.startsWith('kaptMparea')).forEach(key => {
    const area = parseFloat(key.replace('kaptMparea', ''));
    const cnt  = parseInt(item[key] || 0);
    if (area > 0 && cnt > 0) {
      types.push({ dedicArea: area, hhldCnt: cnt, pyeong: Math.round(area / 3.3058) });
    }
  });
  // privArea 필드 파싱 (쉼표 구분 면적)
  if (!types.length && item.privArea) {
    item.privArea.split(',').forEach(s => {
      const a = parseFloat(s.trim());
      if (a > 0) types.push({ dedicArea: a, hhldCnt: 0, pyeong: Math.round(a / 3.3058) });
    });
  }
  return types.length ? types.sort((a, b) => a.dedicArea - b.dedicArea) : null;
}
