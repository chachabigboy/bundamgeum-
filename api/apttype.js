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

// ── 실거래가 XML 병렬 조회로 전용면적 타입 추출 ─────────────
async function fetchTypesFromTrade(TRADE, KEY, sgg5, aptName, H) {
  if (!sgg5 || !aptName) return null;

  const nameKw = aptName.replace(/아파트/g,'').replace(/\s/g,'').trim();
  const now    = new Date();

  // 최근 12개월을 병렬로 한꺼번에 요청
  const months = [];
  for (let i = 0; i < 12; i++) {
    const d  = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`);
  }

  const results = await Promise.allSettled(
    months.map(ym =>
      fetch(`${TRADE}?serviceKey=${KEY}&LAWD_CD=${sgg5}&DEAL_YMD=${ym}&numOfRows=1000`, { headers: H })
        .then(r => r.text())
    )
  );

  const areaCount = {};
  results.forEach(r => {
    if (r.status !== 'fulfilled') return;
    const xml = r.value;
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
    items.forEach(m => {
      const block = m[1];
      const nameMatch = block.match(/<aptNm>([^<]+)<\/aptNm>/);
      if (!nameMatch) return;
      const tName = nameMatch[1].replace(/아파트/g,'').replace(/\s/g,'').trim();

      // 유연한 이름 매칭
      if (!tName.includes(nameKw) && !nameKw.includes(tName)) return;

      const areaMatch = block.match(/<excluUseAr>([\d.]+)<\/excluUseAr>/);
      if (!areaMatch) return;
      const area = Math.round(parseFloat(areaMatch[1]) * 100) / 100;
      if (area > 0) areaCount[area] = (areaCount[area] || 0) + 1;
    });
  });

  if (!Object.keys(areaCount).length) return null;

  return Object.entries(areaCount)
    .map(([area, cnt]) => ({
      dedicArea:  parseFloat(area),
      hhldCnt:    cnt,
      pyeong:     Math.round(parseFloat(area) / 3.3058),
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
