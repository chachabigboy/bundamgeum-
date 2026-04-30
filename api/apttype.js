import db from '../kapt-db.json' with { type: 'json' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { bjdCode, bun, bldNm, kaptCode, sigunguCd: sggParam } = req.query;
  const KEY    = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';
  const DETAIL = 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV4';
  const TRADE  = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
  const H      = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };

  try {
    // ── Mode A: kaptCode 직접 조회 + 실거래가로 타입 보완 ──
    if (kaptCode) {
      const item = await fetchDetail(DETAIL, KEY, kaptCode, H);
      if (!item) return res.status(200).json({ result: null, message: 'kaptCode 없음' });

      // 실거래가로 실제 전용면적 타입 조회
      const sgg  = (item.bjdCode || '').slice(0, 5) || sggParam || '';
      const name = item.kaptName || '';
      const types = await fetchTypesFromTrade(TRADE, KEY, sgg, name, H);

      return res.status(200).json({
        result: { ...buildResult(item), types: types || extractTypes(item) }
      });
    }

    if (!bjdCode && !bldNm) return res.status(400).json({ error: 'bjdCode 또는 kaptCode 필요' });

    const bunNum = parseInt(bun || '0', 10);
    const nameKw = (bldNm || '').replace(/\s/g,'').replace(/아파트/g,'');
    const bjd8   = bjdCode ? bjdCode.slice(0, 8) : '';
    const sgg5   = bjdCode ? bjdCode.slice(0, 5) : '';

    // ── Mode B: kapt-db에서 단지 검색 ──────────────────────
    let matched = null;

    // 1단계: 건물명 + 시군구 매칭
    if (nameKw && sgg5) {
      const sggList = db.filter(c => c.b.startsWith(sgg5));
      matched = sggList.find(c => {
        const cn = (c.n||'').replace(/\s/g,'').replace(/아파트/g,'');
        return cn.includes(nameKw) || nameKw.includes(cn);
      });
    }

    // 2단계: bjd8 + 번지 매칭
    if (!matched && bjd8 && bunNum > 0) {
      matched = db.find(c => c.b.startsWith(bjd8) && c.a.includes(String(bunNum)));
    }

    // 3단계: sgg5 + 번지 매칭
    if (!matched && sgg5 && bunNum > 0) {
      matched = db.find(c => c.b.startsWith(sgg5) && c.a.includes(String(bunNum)));
    }

    if (!matched) {
      const candidates = db
        .filter(c => c.b.startsWith(bjd8 || sgg5))
        .slice(0, 15)
        .map(c => ({ kaptCode: c.c, name: c.n, addr: c.a, bjdCode: c.b }));
      return res.status(200).json({ result: null, message: '자동 매칭 실패', candidates });
    }

    // 상세 조회
    const item = await fetchDetail(DETAIL, KEY, matched.c, H);
    if (!item) return res.status(200).json({
      result: { kaptCode: matched.c, kaptName: matched.n, kaptAddr: matched.a,
                platArea:0, totArea:0, vlRat:0, bcRat:0, hhldCnt:0, dongCnt:0, types:null }
    });

    // 실거래가로 실제 전용면적 타입 조회
    const tradeSgg = (item.bjdCode||'').slice(0,5) || sgg5;
    const types = await fetchTypesFromTrade(TRADE, KEY, tradeSgg, item.kaptName, H);

    return res.status(200).json({
      result: { ...buildResult(item), types: types || extractTypes(item) }
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

// ── 실거래가 API에서 실제 전용면적 타입 추출 ──────────────
async function fetchTypesFromTrade(TRADE, KEY, sgg5, aptName, H) {
  if (!sgg5 || !aptName) return null;

  const areaCount = {};
  const now = new Date();

  // 최근 24개월 조회 (충분한 거래 데이터 확보)
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;

    try {
      const url = `${TRADE}?serviceKey=${KEY}&LAWD_CD=${sgg5}&DEAL_YMD=${ym}&_type=json&numOfRows=1000`;
      const r   = await fetch(url, { headers: H });
      const txt = await r.text();
      const d2  = JSON.parse(txt);
      const raw = d2?.response?.body?.items?.item;
      const list = raw ? (Array.isArray(raw) ? raw : [raw]) : [];

      // 단지명 매칭
      const nameKw = aptName.replace(/아파트/g,'').replace(/\s/g,'');
      list.forEach(t => {
        const tName = (t['아파트']||'').replace(/아파트/g,'').replace(/\s/g,'');
        if (!tName.includes(nameKw) && !nameKw.includes(tName)) return;
        const area = parseFloat(t['전용면적'] || 0);
        if (area > 0) areaCount[area] = (areaCount[area] || 0) + 1;
      });

      // 충분한 타입이 나오면 조기 종료
      if (Object.keys(areaCount).length >= 3 && i >= 5) break;
    } catch(e) { continue; }
  }

  if (!Object.keys(areaCount).length) return null;

  // 면적별 거래 횟수 기준으로 세대수 추정
  const totalTrades = Object.values(areaCount).reduce((a,b) => a+b, 0);
  const types = Object.entries(areaCount)
    .map(([area, cnt]) => ({
      dedicArea: parseFloat(area),
      hhldCnt:   cnt, // 거래 횟수 (세대수 아님)
      pyeong:    Math.round(parseFloat(area) / 3.3058),
      tradeCount: cnt,
    }))
    .sort((a, b) => a.dedicArea - b.dedicArea);

  return types.length ? types : null;
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
