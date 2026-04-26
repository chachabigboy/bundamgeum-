export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { sigunguCd, bjdongCd, bun, ji } = req.query;
  const KEY = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';

  if (!sigunguCd || !bjdongCd || !bun) {
    return res.status(400).json({ error: '파라미터 누락' });
  }

  const bunVal = bun.padStart(4, '0');
  const jiVal  = (ji && ji !== '0') ? ji.padStart(4, '0') : '0000';

  try {
    // 건축물대장 전유공용면적 API — 동/호별 전용면적 목록
    const url =
      `https://apis.data.go.kr/1613000/BldRgstHubService/getBrExposPubuseAreaInfo` +
      `?serviceKey=${KEY}` +
      `&sigunguCd=${sigunguCd}` +
      `&bjdongCd=${bjdongCd}` +
      `&platGbCd=0` +
      `&bun=${bunVal}` +
      `&ji=${jiVal}` +
      `&numOfRows=1000&pageNo=1&_type=json`;

    const r    = await fetch(url);
    const text = await r.text();

    let data;
    try { data = JSON.parse(text); }
    catch(e) {
      return res.status(200).json({ result: null, message: 'JSON 파싱 실패', raw: text.slice(0, 300) });
    }

    const raw  = data?.response?.body?.items?.item;
    const list = raw ? (Array.isArray(raw) ? raw : [raw]) : [];

    if (list.length === 0) {
      return res.status(200).json({ result: null, message: '전유부 데이터 없음', debug: { sigunguCd, bjdongCd, bunVal, jiVal } });
    }

    // 전용면적만 추출 (주거 전용 + 구분 0: 전유)
    const areaMap = {};
    list.forEach(item => {
      const area = parseFloat(item.areaExclu || item.area || 0);
      if (area <= 0) return;
      // 소수점 첫째 자리까지로 그룹핑
      const key = Math.round(area * 10) / 10;
      if (!areaMap[key]) areaMap[key] = 0;
      areaMap[key]++;
    });

    // 타입 배열로 변환 (세대수 1 이상만)
    const types = Object.entries(areaMap)
      .filter(([, cnt]) => cnt >= 1)
      .map(([area, cnt]) => ({
        dedicArea: parseFloat(area),
        hhldCnt:   cnt,
        pyeong:    Math.round(parseFloat(area) / 3.3058),
      }))
      .sort((a, b) => a.dedicArea - b.dedicArea);

    return res.status(200).json({ result: { types, totalRows: list.length } });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
