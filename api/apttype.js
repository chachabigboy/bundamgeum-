import db from '../kapt-db.json' with { type: 'json' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { bjdCode, bun, bldNm, kaptCode, sigunguCd: sggParam } = req.query;
  const KEY    = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';
  const DETAIL = 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV4';
  const TRADE  = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
  const H      = { 'User-Agent': 'Mozilla/5.0' };

  try {
    // ── Mode A: kaptCode 직접 조회 ──────────────────────────
    if (kaptCode) {
      const item = await fetchDetail(DETAIL, KEY, kaptCode, H);
      if (!item) return res.status(200).json({ result: null, message: 'kaptCode 없음' });
      const sgg5 = (item.bjdCode||'').slice(0,5) || sggParam || '';
      const types = await fetchTypesFromTrade(TRADE, KEY, sgg5, item.kaptName, H);
      return res.status(200).json({
        result: { ...buildResult(item), types: types?.length ? types : extractTypes(item) }
      });
    }

    if (!bjdCode && !bldNm) return res.status(400).json({ error: 'bjdCode 또는 kaptCode 필요' });

    const bunNum = parseInt(bun || '0', 10);
    const nameKw = (bldNm || '').replace(/\s/g,'').replace(/아파트/g,'');
    const bjd8   = bjdCode ? bjdCode.slice(0,8) : '';
    const sgg5   = bjdCode ? bjdCode.slice(0,5) : '';

    // kapt-db에서 단지 검색
    let matched = null;
    if (nameKw && sgg5) {
      const sggList = db.filter(c => c.b.startsWith(sgg5));
      matched = sggList.find(c => {
        const cn = (c.n||'').replace(/\s/g,'').replace(/아파트/g,'');
        return cn.includes(nameKw) || nameKw.includes(cn);
      });
    }
    if (!matched && bjd8 && bunNum > 0) {
      matched = db.find(c => c.b.startsWith(bjd8) && c.a.includes(String(bunNum)));
    }
    if (!matched && sgg5 && bunNum > 0) {
      matched = db.find(c => c.b.startsWith(sgg5) && c.a.includes(String(bunNum)));
    }
    if (!matched) {
      const candidates = db
        .filter(c => c.b.startsWith(bjd8 || sgg5))
        .slice(0,15)
        .map(c => ({ kaptCode: c.c, name: c.n, addr: c.a, bjdCode: c.b }));
      return res.status(200).json({ result: null, message: '자동 매칭 실패', candidates });
    }

    const item = await fetchDetail(DETAIL, KEY, matched.c, H);
    if (!item) return res.status(200).json({
      result: { kaptCode: matched.c, kaptName: matched.n, kaptAddr: matched.a,
                platArea:0, totArea:0, vlRat:0, bcRat:0, hhldCnt:0, dongCnt:0, types:null }
    });

    const tradeSgg = (item.bjdCode||'').slice(0,5) || sgg5;
    const types = await fetchTypesFromTrade(TRADE, KEY, tradeSgg, item.kaptName, H);
    return res.status(200).json({
      result: { ...buildResult(item), types: types?.length ? types : extractTypes(item) }
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

// ── 실거래가 XML 파싱으로 실제 전용면적 타입 추출 ───────────
async function fetchTypesFromTrade(TRADE, KEY, sgg5, aptName, H) {
  if (!sgg5 || !aptName) return null;

  const areaCount = {};
  const nameKw = aptName.replace(/아파트/g,'').replace(/\s/g,'');
  const now = new Date();

  for (let i = 0; i < 24; i++) {
    const d  = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;

    try {
      const url = `${TRADE}?serviceKey=${KEY}&LAWD_CD=${sgg5}&DEAL_YMD=${ym}&numOfRows=1000`;
      const r   = await fetch(url, { headers: H });
      const xml = await r.text();

      // XML에서 <item> 블록 추출
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
      let found = 0;

      items.forEach(m => {
        const block = m[1];
        // 아파트명 추출
        const nameMatch = block.match(/<aptNm>([^<]+)<\/aptNm>/);
        if (!nameMatch) return;
        const tName = nameMatch[1].replace(/아파트/g,'').replace(/\s/g,'');
        if (!tName.includes(nameKw) && !nameKw.includes(tName)) return;

        // 전용면적 추출
        const areaMatch = block.match(/<excluUseAr>([\d.]+)<\/excluUseAr>/);
        if (!areaMatch) return;
        const area = parseFloat(areaMatch[1]);
        if (area > 0) {
          // 소수점 2자리로 그룹핑
          const key = Math.round(area * 100) / 100;
          areaCount[key] = (areaCount[key] || 0) + 1;
          found++;
        }
      });

      // 충분한 타입 확인 후 조기 종료
      if (Object.keys(areaCount).length >= 2 && i >= 3) break;
    } catch(e) { continue; }
  }

  if (!Object.keys(areaCount).length) return null;

  return Object.entries(areaCount)
    .map(([area, cnt]) => ({
      dedicArea:  parseFloat(area),
      hhldCnt:    cnt,
      pyeong:     Math.round(parseFloat(area) / 3.3058),
      tradeCount: cnt,
    }))
    .sort((a, b) => a.dedicArea - b.dedicArea);
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
