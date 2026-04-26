export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { sigunguCd, bjdongCd, bun, ji } = req.query;

  if (!sigunguCd || !bjdongCd || !bun) {
    return res.status(400).json({ error: '파라미터 누락' });
  }

  const KEY = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';
  const jiVal = (ji && ji !== '0') ? ji.padStart(4,'0') : '0000';
  const bunVal = bun.padStart(4,'0');

  // 총괄표제부 + 표제부 둘 다 시도
  const urls = [
    // 총괄표제부
    `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?serviceKey=${KEY}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&platGbCd=0&bun=${bunVal}&ji=${jiVal}&numOfRows=10&pageNo=1&_type=json`,
    // 표제부 (동별)
    `https://apis.data.go.kr/1613000/BldRgstHubService/getBrFlrOulnInfo?serviceKey=${KEY}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&platGbCd=0&bun=${bunVal}&ji=${jiVal}&numOfRows=10&pageNo=1&_type=json`,
  ];

  try {
    // 총괄표제부 먼저 시도
    const r1 = await fetch(urls[0]);
    const d1 = await r1.json();

    // 원본 응답 디버깅용으로 포함
    const raw = d1?.response?.body?.items?.item;
    const list = raw ? (Array.isArray(raw) ? raw : [raw]) : [];

    if (list.length > 0) {
      // 아파트 우선, 없으면 첫번째
      const apt = list.find(i => (i.mainPurpsCdNm||'').includes('아파트')) || list[0];

      return res.status(200).json({
        result: {
          platArea:  parseFloat(apt.platArea  || apt.archArea || 0),
          totArea:   parseFloat(apt.totArea   || 0),
          vlRat:     parseFloat(apt.vlRat     || 0),
          bcRat:     parseFloat(apt.bcRat     || 0),
          hhldCnt:   parseInt(apt.hhldCnt     || 0),
          mainPurpsCdNm: apt.mainPurpsCdNm    || '',
          bldNm:     apt.bldNm                || apt.platPlc || '',
          dongNm:    apt.dongNm               || '',
        },
        debug: { sigunguCd, bjdongCd, bun: bunVal, ji: jiVal, rawCount: list.length, firstItem: apt }
      });
    }

    // 데이터 없음
    return res.status(200).json({
      result: null,
      message: '건축물대장 데이터 없음',
      debug: { sigunguCd, bjdongCd, bun: bunVal, ji: jiVal, rawResponse: d1?.response?.body }
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
