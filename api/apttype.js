export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { sigunguCd, bjdongCd, bun, ji, bldNm } = req.query;
  const KEY = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';

  if (!sigunguCd) return res.status(400).json({ error: '파라미터 누락' });

  try {
    const sidoCd = sigunguCd.slice(0, 2);
    const sggCd  = sigunguCd;

    // Step 1: AptBasisInfoServiceV4로 단지 검색 (시도+시군구 기준)
    const searchUrl =
      `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphuseInfo` +
      `?serviceKey=${KEY}&sidoCd=${sidoCd}&sggCd=${sggCd}` +
      `&numOfRows=200&pageNo=1&_type=json`;

    const r1   = await fetch(searchUrl);
    const txt1 = await r1.text();

    let complexList = [];
    try {
      const d1  = JSON.parse(txt1);
      const raw = d1?.response?.body?.items?.item;
      complexList = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    } catch(e) {
      return res.status(200).json({ result: null, message: 'AptBasisInfo 파싱 실패', raw: txt1.slice(0,200) });
    }

    if (!complexList.length) {
      return res.status(200).json({ result: null, message: '단지 목록 없음', sidoCd, sggCd });
    }

    // Step 2: 건물명으로 단지 매칭
    const nameKw = (bldNm || '').replace(/\s/g,'').replace(/아파트/g,'');
    let matched  = null;

    if (nameKw) {
      matched = complexList.find(c => {
        const cn = (c.kaptName||'').replace(/\s/g,'').replace(/아파트/g,'');
        return cn.includes(nameKw) || nameKw.includes(cn);
      });
    }

    // 번지로 매칭 시도
    if (!matched && bun) {
      const bunNum = parseInt(bun, 10);
      matched = complexList.find(c => {
        const addr = c.kaptAddr || '';
        return addr.includes(`${bunNum}번지`) || addr.includes(` ${bunNum}-`) || addr.endsWith(` ${bunNum}`);
      });
    }

    // 매칭 실패 시 후보 반환
    if (!matched) {
      return res.status(200).json({
        result:     null,
        message:    '단지 자동 매칭 실패',
        candidates: complexList.slice(0,10).map(c => ({
          kaptCode: c.kaptCode,
          name:     c.kaptName,
          addr:     c.kaptAddr,
        }))
      });
    }

    // Step 3: kaptCode로 전용면적별 세대현황 조회
    const typeUrl =
      `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphuseInfo` +
      `?serviceKey=${KEY}&kaptCode=${matched.kaptCode}&_type=json`;

    const r2   = await fetch(typeUrl);
    const txt2 = await r2.text();

    let typeItems = [];
    try {
      const d2  = JSON.parse(txt2);
      const raw = d2?.response?.body?.items?.item;
      typeItems = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    } catch(e) {}

    // 전용면적별 세대수 집계
    const areaMap = {};
    typeItems.forEach(item => {
      const area = parseFloat(item.dedicArea || item.exluUseAr || 0);
      if (area <= 0) return;
      const key = Math.round(area * 10) / 10;
      areaMap[key] = (areaMap[key] || 0) + parseInt(item.hhldCnt || 1, 10);
    });

    const types = Object.entries(areaMap)
      .map(([area, cnt]) => ({
        dedicArea: parseFloat(area),
        hhldCnt:   cnt,
        pyeong:    Math.round(parseFloat(area) / 3.3058),
      }))
      .sort((a, b) => a.dedicArea - b.dedicArea);

    return res.status(200).json({
      result: {
        kaptCode: matched.kaptCode,
        kaptName: matched.kaptName,
        kaptAddr: matched.kaptAddr,
        types:    types.length > 0 ? types : null,
      },
      debug: { typeItemsCount: typeItems.length, areaMap, sample: typeItems[0] }
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
