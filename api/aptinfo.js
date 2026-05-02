// K-apt 기본 정보만 빠르게 반환 (대지면적, 용적률, 세대수)
import db from '../kapt-db.json' with { type: 'json' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { bjdCode, bun, ji, bldNm, kaptCode } = req.query;
  const KEY    = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';
  const DETAIL = 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV4';
  const H      = { 'User-Agent': 'Mozilla/5.0' };

  try {
    // Mode A: kaptCode 직접
    if (kaptCode) {
      const item = await fetchDetail(DETAIL, KEY, kaptCode, H);
      if (!item) return res.status(200).json({ result: null });
      return res.status(200).json({ result: buildResult(item) });
    }

    const bunNum = parseInt(bun || '0', 10);
    const jiNum  = parseInt(ji  || '0', 10);
    const nameKw = (bldNm || '').replace(/\s/g,'').replace(/아파트/g,'');
    const sgg5   = bjdCode ? bjdCode.slice(0,5) : '';
    const bjd8   = bjdCode ? bjdCode.slice(0,8) : '';

    let matched = null;

    // 건물명으로 매칭
    if (nameKw && sgg5) {
      matched = db.filter(c => c.b.startsWith(sgg5)).find(c => {
        const cn = (c.n||'').replace(/\s/g,'').replace(/아파트/g,'');
        return cn.includes(nameKw) || nameKw.includes(cn);
      });
    }
    // 번지로 매칭
    if (!matched && bunNum > 0) {
      matched = db.filter(c => c.b.startsWith(bjd8||sgg5)).find(c =>
        c.a.includes(String(bunNum))
      );
    }

    if (!matched) {
      // 후보 반환
      const candidates = db
        .filter(c => c.b.startsWith(bjd8||sgg5))
        .slice(0,15)
        .map(c => ({ kaptCode: c.c, name: c.n, addr: c.a }));
      return res.status(200).json({ result: null, candidates });
    }

    const item = await fetchDetail(DETAIL, KEY, matched.c, H);
    if (!item) return res.status(200).json({
      result: { kaptCode: matched.c, kaptName: matched.n, kaptAddr: matched.a,
                platArea:0, totArea:0, vlRat:0, bcRat:0, hhldCnt:0, dongCnt:0 }
    });
    return res.status(200).json({ result: buildResult(item) });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

async function fetchDetail(DETAIL, KEY, code, H) {
  const r = await fetch(`${DETAIL}/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${code}&_type=json`, { headers: H });
  const d = await r.json();
  return d?.response?.body?.item || null;
}

function buildResult(item) {
  return {
    kaptCode: item.kaptCode,
    kaptName: item.kaptName,
    kaptAddr: item.doroJuso || item.kaptAddr,
    platArea: parseFloat(item.kaptLarea  || 0),
    totArea:  parseFloat(item.kaptTarea  || 0),
    vlRat:    parseFloat(item.kaptVlRat  || 0),
    bcRat:    parseFloat(item.kaptBcRat  || 0),
    hhldCnt:  parseInt(item.kaptdaCnt    || 0),
    dongCnt:  parseInt(item.kaptDongCnt  || 0),
  };
}
