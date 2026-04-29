export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { sigunguCd, bjdongCd, bun, ji, kaptCode } = req.query;
  const KEY = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';
  const BASE = 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV4';

  try {
    // ── Mode A: kaptCode 직접 조회 ──────────────────────────
    if (kaptCode) {
      const url = `${BASE}/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${kaptCode}&_type=json`;
      const r   = await fetch(url);
      const txt = await r.text();
      try {
        const d    = JSON.parse(txt);
        const item = d?.response?.body?.item;
        if (!item) return res.status(200).json({ result: null, message: '단지 정보 없음' });

        // 전용면적별 세대현황 파싱 (예: "59㎡:120세대|84㎡:80세대")
        const types = parseTypeStr(item.hhldCountHouseSpace || item.exclArea || '');

        return res.status(200).json({
          result: {
            kaptCode:   item.kaptCode,
            kaptName:   item.kaptName,
            kaptAddr:   item.kaptAddr,
            totArea:    parseFloat(item.kaptTarea  || 0),  // 건축물대장 연면적
            platArea:   parseFloat(item.kaptLarea  || 0),  // 대지면적
            vlRat:      parseFloat(item.kaptVlRat  || 0),  // 용적률
            bcRat:      parseFloat(item.kaptBcRat  || 0),  // 건폐율
            hhldCnt:    parseInt(item.kaptdaCnt    || 0),  // 총세대수
            dongCnt:    parseInt(item.kaptdongCnt  || 0),  // 동수
            types,
          },
          raw: item
        });
      } catch(e) {
        return res.status(200).json({ result: null, raw: txt.slice(0, 300) });
      }
    }

    // ── Mode B: 법정동코드로 단지 목록 조회 후 매칭 ────────
    if (!sigunguCd) return res.status(400).json({ error: '파라미터 누락' });

    // 법정동코드 10자리 = sigunguCd(5) + bjdongCd(5)
    const bjdCode = sigunguCd + (bjdongCd || '');

    // 법정동코드로 단지 목록 검색
    const listUrl = `${BASE}/getAphusBassInfoV4?serviceKey=${KEY}&bjdCode=${bjdCode}&_type=json&numOfRows=100&pageNo=1`;
    const r2  = await fetch(listUrl);
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
      return res.status(200).json({
        result: null,
        message: '단지 목록 없음',
        debug: { bjdCode, listUrl }
      });
    }

    // 번지로 단지 매칭
    const bunNum = parseInt(bun || '0', 10);
    let matched  = null;

    if (bunNum > 0) {
      matched = complexList.find(c => {
        const addr = c.kaptAddr || '';
        return addr.includes(`${bunNum}번지`) ||
               addr.includes(` ${bunNum}-`)   ||
               addr.endsWith(` ${bunNum}`)     ||
               addr.includes(` ${bunNum} `);
      });
    }

    // 번지 매칭 실패 시 후보 목록 반환
    if (!matched) {
      return res.status(200).json({
        result: null,
        message: '단지 자동 매칭 실패 — 후보 목록 반환',
        candidates: complexList.slice(0, 10).map(c => ({
          kaptCode: c.kaptCode,
          name:     c.kaptName,
          addr:     c.kaptAddr,
        }))
      });
    }

    // 매칭된 단지의 상세 조회
    const detailUrl = `${BASE}/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${matched.kaptCode}&_type=json`;
    const r3   = await fetch(detailUrl);
    const txt3 = await r3.text();
    try {
      const d3   = JSON.parse(txt3);
      const item = d3?.response?.body?.item || matched;
      const types = parseTypeStr(item.hhldCountHouseSpace || item.exclArea || '');

      return res.status(200).json({
        result: {
          kaptCode: item.kaptCode,
          kaptName: item.kaptName,
          kaptAddr: item.kaptAddr,
          totArea:  parseFloat(item.kaptTarea || 0),
          platArea: parseFloat(item.kaptLarea || 0),
          vlRat:    parseFloat(item.kaptVlRat || 0),
          bcRat:    parseFloat(item.kaptBcRat || 0),
          hhldCnt:  parseInt(item.kaptdaCnt   || 0),
          dongCnt:  parseInt(item.kaptdongCnt || 0),
          types,
        },
        raw: item
      });
    } catch(e) {
      return res.status(200).json({ result: null, raw: txt3.slice(0, 300) });
    }

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

// 전용면적별 세대현황 문자열 파싱
// 형식 예: "59.99㎡:120/84.98㎡:80" 또는 "59.99 84.98" 등
function parseTypeStr(str) {
  if (!str) return null;
  const types = [];

  // 숫자 추출
  const matches = str.match(/[\d.]+/g);
  if (!matches) return null;

  // 면적만 추출 (200 이하 값)
  const areas = [...new Set(
    matches
      .map(Number)
      .filter(n => n > 10 && n < 200)
  )].sort((a, b) => a - b);

  areas.forEach(area => {
    types.push({
      dedicArea: area,
      pyeong:    Math.round(area / 3.3058),
      hhldCnt:   0, // 상세 조회에서 채워질 예정
    });
  });

  return types.length > 0 ? types : null;
}
