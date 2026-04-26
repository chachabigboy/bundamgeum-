export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { complexNo, keyword } = req.query;
  const KEY = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';

  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': 'https://new.land.naver.com/',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'ko-KR,ko;q=0.9',
    'authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  };

  try {
    // Mode 1: 단지번호로 상세 조회
    if (complexNo) {
      const url = `https://new.land.naver.com/api/complexes/${complexNo}/overview`;
      const r   = await fetch(url, { headers: HEADERS });
      const txt = await r.text();
      try {
        const data = JSON.parse(txt);
        // 평형 목록 추출
        const pyeongList = data?.complexPyeongDetailList || data?.pyeongList || [];
        const types = pyeongList.map(p => ({
          name:      p.pyeongName     || p.pyeongTypeName || '',
          dedicArea: parseFloat(p.exclusiveArea || p.dedicArea || 0),
          supplyArea: parseFloat(p.supplyArea || 0),
          hhldCnt:   parseInt(p.householdCountByPyeong || p.hhldCnt || 0),
          pyeong:    Math.round(parseFloat(p.exclusiveArea || 0) / 3.3058),
        })).filter(t => t.dedicArea > 0);

        return res.status(200).json({
          result: {
            complexNo,
            complexName: data?.complexName || data?.name || '',
            types: types.length > 0 ? types : null,
          },
          raw: data
        });
      } catch(e) {
        return res.status(200).json({ result: null, raw: txt.slice(0, 300) });
      }
    }

    // Mode 2: 키워드로 단지 검색
    if (keyword) {
      const url = `https://new.land.naver.com/api/complexes/single-markers/2.0?complexNo=${keyword}`;
      const r2  = await fetch(
        `https://new.land.naver.com/api/search?keyword=${encodeURIComponent(keyword)}&pageSize=5`,
        { headers: HEADERS }
      );
      const txt2 = await r2.text();
      try {
        const d2 = JSON.parse(txt2);
        return res.status(200).json({ result: null, searchResult: d2 });
      } catch(e) {
        return res.status(200).json({ result: null, raw: txt2.slice(0, 300) });
      }
    }

    return res.status(400).json({ error: 'complexNo 또는 keyword 파라미터 필요' });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
