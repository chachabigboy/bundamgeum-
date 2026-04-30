import db from '../kapt-db.json' assert { type: 'json' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { bjdCode, bun, bldNm, kaptCode } = req.query;
  const KEY    = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';
  const DETAIL = 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV4';
  const H      = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };

  try {
    // ── Mode A: kaptCode 직접 조회 ──────────────────────────
    if (kaptCode) {
      const item = await fetchDetail(DETAIL, KEY, kaptCode, H);
      if (!item) return res.status(200).json({ result: null, message: 'kaptCode 없음' });
      return res.status(200).json({ result: buildResult(item) });
    }

    if (!bjdCode && !bldNm) return res.status(400).json({ error: 'bjdCode 또는 kaptCode 필요' });

    // ── Mode B: kapt-db.json에서 검색 ──────────────────────
    const bunNum   = parseInt(bun || '0', 10);
    const nameKw   = (bldNm || '').replace(/\s/g,'').replace(/아파트/g,'');
    const bjd8     = bjdCode ? bjdCode.slice(0,8) : '';
    const sgg5     = bjdCode ? bjdCode.slice(0,5) : '';

    // 1단계: 법정동코드 8자리 + 번지로 매칭
    let matched = null;
    if (bjd8 && bunNum > 0) {
      const dongFiltered = db.filter(c => c.b.startsWith(bjd8));
      matched = dongFiltered.find(c =>
        c.a.includes(`${bunNum}번지`) || c.a.includes(` ${bunNum}-`) ||
        c.a.endsWith(` ${bunNum}`)    || c.a.includes(` ${bunNum} `)
      );
    }

    // 2단계: 건물명으로 매칭
    if (!matched && nameKw) {
      const sggFiltered = db.filter(c => c.b.startsWith(sgg5));
      matched = sggFiltered.find(c => {
        const cn = (c.n||'').replace(/\s/g,'').replace(/아파트/g,'');
        return cn.includes(nameKw) || nameKw.includes(cn);
      });
    }

    // 3단계: 시군구 내 번지 매칭
    if (!matched && bunNum > 0 && sgg5) {
      const sggFiltered = db.filter(c => c.b.startsWith(sgg5));
      matched = sggFiltered.find(c =>
        c.a.includes(`${bunNum}번지`) || c.a.includes(` ${bunNum}-`) ||
        c.a.endsWith(` ${bunNum}`)
      );
    }

    if (!matched) {
      // 같은 법정동 후보 반환
      const candidates = db
        .filter(c => c.b.startsWith(bjd8 || sgg5))
        .slice(0, 15)
        .map(c => ({ kaptCode: c.c, name: c.n, addr: c.a }));
      return res.status(200).json({ result: null, message: '자동 매칭 실패', candidates });
    }

    // 상세 조회
    const item = await fetchDetail(DETAIL, KEY, matched.c, H);
    if (!item) return res.status(200).json({
      result: { kaptCode: matched.c, kaptName: matched.n, kaptAddr: matched.a,
                platArea:0, totArea:0, vlRat:0, bcRat:0, hhldCnt:0, dongCnt:0, types:null }
    });
    return res.status(200).json({ result: buildResult(item) });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

async function fetchDetail(DETAIL, KEY, code, H) {
  const url = `${DETAIL}/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${code}&_type=json`;
  const r   = await fetch(url, { headers: H });
  const d   = await r.json();
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
    types:    extractTypes(item),
  };
}

function extractTypes(item) {
  if (!item) return null;
  const types = [];
  ['60','85','135','136'].forEach(key => {
    const cnt = parseInt(item[`kaptMparea${key}`] || 0);
    if (cnt > 0) types.push({ dedicArea: parseFloat(key), hhldCnt: cnt, pyeong: Math.round(parseFloat(key)/3.3058) });
  });
  if (!types.length && item.privArea) {
    item.privArea.split(',').forEach(s => {
      const a = parseFloat(s.trim());
      if (a > 0) types.push({ dedicArea: a, hhldCnt: 0, pyeong: Math.round(a/3.3058) });
    });
  }
  return types.length ? types.sort((a,b) => a.dedicArea-b.dedicArea) : null;
}
