export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { sigunguCd, bjdongCd, bun, ji, bldNm } = req.query;
  const KEY = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';

  if (!sigunguCd) {
    return res.status(400).json({ error: '시군구코드 누락' });
  }

  try {
    // Step 1: 시도코드(2자리) + 시군구코드(5자리)로 단지 목록 검색
    const sidoCd  = sigunguCd.slice(0, 2);
    const sggCd   = sigunguCd;

    const listUrl =
      `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphuseInfo` +
      `?serviceKey=${KEY}&sidoCd=${sidoCd}&sggCd=${sggCd}` +
      `&numOfRows=200&pageNo=1&_type=json`;

    const r1   = await fetch(listUrl);
    const d1   = await r1.json();
    const raw  = d1?.response?.body?.items?.item;

    if (!raw) {
      return res.status(200).json({
        result: null,
        message: '단지 목록 없음',
        debug: { sidoCd, sggCd, body: d1?.response?.body }
      });
    }

    const list = Array.isArray(raw) ? raw : [raw];

    // Step 2: 법정동코드 + 번지 + 건물명으로 단지 매칭
    const bunNum  = parseInt(bun  || '0', 10);
    const jiNum   = parseInt(ji   || '0', 10);
    const nameKw  = (bldNm || '').replace(/\s/g, '');

    let matched = null;

    // 우선순위 1: 번지 일치
    if (bunNum > 0) {
      matched = list.find(item => {
        const addr = item.kaptAddr || '';
        return addr.includes(`${bunNum}번지`) || addr.includes(`${bunNum}-${jiNum}`) || addr.endsWith(` ${bunNum}`);
      });
    }

    // 우선순위 2: 건물명 포함
    if (!matched && nameKw) {
      matched = list.find(item =>
        (item.kaptName || '').replace(/\s/g, '').includes(nameKw) ||
        nameKw.includes((item.kaptName || '').replace(/\s/g, ''))
      );
    }

    // 우선순위 3: 법정동코드 일치하는 첫번째
    if (!matched && bjdongCd) {
      matched = list.find(item => (item.bjdCode || '').startsWith(bjdongCd));
    }

    if (!matched) {
      return res.status(200).json({
        result: null,
        message: '매칭 단지 없음',
        candidates: list.slice(0, 5).map(i => ({ name: i.kaptName, addr: i.kaptAddr, code: i.kaptCode }))
      });
    }

    const kaptCode = matched.kaptCode;

    // Step 3: 단지 전용면적별 세대현황 조회
    const typeUrl =
      `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphuseInfo` +
      `?serviceKey=${KEY}&kaptCode=${kaptCode}&_type=json`;

    const r2  = await fetch(typeUrl);
    const d2  = await r2.json();
    const raw2 = d2?.response?.body?.items?.item;
    const typeList = raw2 ? (Array.isArray(raw2) ? raw2 : [raw2]) : [];

    // 전용면적별 세대수 파싱
    const types = typeList
      .filter(t => parseFloat(t.dedicArea || 0) > 0)
      .map(t => ({
        dedicArea: parseFloat(t.dedicArea),           // 전용면적 ㎡
        hhldCnt:   parseInt(t.hhldCnt || t.cnt || 1), // 해당 타입 세대수
        pyeong:    Math.round(parseFloat(t.dedicArea) / 3.3058),
      }))
      .sort((a, b) => a.dedicArea - b.dedicArea);

    return res.status(200).json({
      result: {
        kaptCode,
        kaptName: matched.kaptName,
        kaptAddr: matched.kaptAddr,
        types: types.length > 0 ? types : null,
      }
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
