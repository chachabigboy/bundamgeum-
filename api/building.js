export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { sigunguCd, bjdongCd, bun, ji } = req.query;

  if (!sigunguCd || !bjdongCd || !bun) {
    return res.status(400).json({ error: '파라미터 누락' });
  }

  const KEY = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';
  const jiVal = ji || '0000';

  const url =
    `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo` +
    `?serviceKey=${KEY}` +
    `&sigunguCd=${sigunguCd}` +
    `&bjdongCd=${bjdongCd}` +
    `&platGbCd=0` +
    `&bun=${bun.padStart(4,'0')}` +
    `&ji=${jiVal.padStart(4,'0')}` +
    `&numOfRows=10&pageNo=1&_type=json`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    const items = data?.response?.body?.items?.item;

    if (!items) {
      return res.status(200).json({ result: null, message: '데이터 없음' });
    }

    const list = Array.isArray(items) ? items : [items];

    const apt = list.find(i =>
      (i.mainPurpsCdNm || '').includes('아파트')
    ) || list[0];

    return res.status(200).json({
      result: {
        platArea:  parseFloat(apt.platArea  || 0),
        totArea:   parseFloat(apt.totArea   || 0),
        vlRat:     parseFloat(apt.vlRat     || 0),
        bcRat:     parseFloat(apt.bcRat     || 0),
        hhldCnt:   parseInt(apt.hhldCnt     || 0),
        mainPurpsCdNm: apt.mainPurpsCdNm || '',
        bldNm:     apt.bldNm || '',
        dongNm:    apt.dongNm || '',
      }
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
