export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { sigunguCd, bjdongCd, bun, ji } = req.query;
  const KEY = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';

  if (!sigunguCd || !bjdongCd || !bun) {
    return res.status(400).json({ error: '파라미터 누락' });
  }

  const bunVal = String(bun).padStart(4, '0');
  const jiVal  = (ji && ji !== '0') ? String(ji).padStart(4, '0') : '0000';

  // 전유공용면적 조회 — 호별 전용면적 목록
  const url = new URL('https://apis.data.go.kr/1613000/BldRgstHubService/getBrExposPubuseAreaInfo');
  url.searchParams.set('serviceKey',  KEY);
  url.searchParams.set('sigunguCd',   sigunguCd);
  url.searchParams.set('bjdongCd',    bjdongCd);
  url.searchParams.set('platGbCd',    '0');
  url.searchParams.set('bun',         bunVal);
  url.searchParams.set('ji',          jiVal);
  url.searchParams.set('_type',       'json');
  url.searchParams.set('numOfRows',   '1000');
  url.searchParams.set('pageNo',      '1');

  try {
    const r    = await fetch(url.toString());
    const text = await r.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch(e) {
      return res.status(200).json({ result: null, message: 'JSON 파싱 실패', raw: text.slice(0, 300) });
    }

    const totalCount = data?.response?.body?.totalCount || 0;
    const raw  = data?.response?.body?.items?.item;
    const list = raw ? (Array.isArray(raw) ? raw : [raw]) : [];

    if (!list.length) {
      return res.status(200).json({
        result: null,
        message: '데이터 없음',
        totalCount,
        debug: { sigunguCd, bjdongCd, bunVal, jiVal }
      });
    }

    // 전용면적(areaExcluUse)별로 세대수 집계
    // 전용구분(exposPubuseGbCd): 1=전유, 2=공용 → 전유만 필터
    const areaMap = {};
    list.forEach(item => {
      // 전유부만
      if (item.exposPubuseGbCd && item.exposPubuseGbCd !== '1') return;
      const area = parseFloat(item.areaExcluUse || item.area || 0);
      if (area <= 0) return;
      const key = Math.round(area * 10) / 10;
      areaMap[key] = (areaMap[key] || 0) + 1;
    });

    const types = Object.entries(areaMap)
      .filter(([, cnt]) => cnt >= 1)
      .map(([area, cnt]) => ({
        dedicArea:  parseFloat(area),
        hhldCnt:    cnt,
        pyeong:     Math.round(parseFloat(area) / 3.3058),
      }))
      .sort((a, b) => a.dedicArea - b.dedicArea);

    return res.status(200).json({
      result: { types, totalRows: list.length },
      debug: { areaMap, sample: list[0] }
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
