export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { sigunguCd, bjdongCd, bun, ji } = req.query;
  const KEY = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';

  if (!sigunguCd || !bjdongCd || !bun) {
    return res.status(400).json({ error: '파라미터 누락' });
  }

  const bunVal = bun.padStart(4, '0');
  const jiVal  = (ji && ji !== '0') ? ji.padStart(4, '0') : '0000';
  const base   = `https://apis.data.go.kr/1613000/BldRgstHubService`;
  const common = `?serviceKey=${KEY}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&platGbCd=0&bun=${bunVal}&ji=${jiVal}&numOfRows=100&pageNo=1&_type=json`;

  // 사용 가능한 엔드포인트 목록 시도
  const endpoints = [
    'getBrRecapTitleInfo',   // 표제부
    'getBrFlrOulnInfo',      // 층별개요
    'getBrWclfInfo',         // 위반건축물
    'getBrAtchJibunInfo',    // 부속지번
  ];

  const results = {};

  for (const ep of endpoints) {
    try {
      const r    = await fetch(`${base}/${ep}${common}`);
      const text = await r.text();
      try {
        const json = JSON.parse(text);
        const cnt  = json?.response?.body?.totalCount || 0;
        results[ep] = { ok: true, totalCount: cnt, sample: json?.response?.body?.items?.item ? 
          (Array.isArray(json.response.body.items.item) ? json.response.body.items.item[0] : json.response.body.items.item) 
          : null };
      } catch(e) {
        results[ep] = { ok: false, raw: text.slice(0, 100) };
      }
    } catch(e) {
      results[ep] = { ok: false, error: e.message };
    }
  }

  return res.status(200).json({ debug: true, results });
}
