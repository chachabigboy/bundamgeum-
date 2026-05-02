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
      const sgg5   = (item.bjdCode||'').slice(0,5) || sggParam || '';
      // K-apt 주소에서 지번 본번 추출
      const bonbun = extractBonbun(item.kaptAddr || '');
      const bubun  = extractBubun(item.kaptAddr || '');
      const types  = await fetchTypesByBonbun(TRADE, KEY, sgg5, bonbun, bubun, H);
      return res.status(200).json({
        result: { ...buildResult(item), types: types?.length ? types : extractTypes(item) }
      });
    }

    if (!bjdCode && !bldNm) return res.status(400).json({ error: 'bjdCode 또는 kaptCode 필요' });

    const bunNum = parseInt(bun || '0', 10);
    const jiNum  = req?.query?.ji || '0';
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
    // 카카오 주소의 본번(bun) 우선 사용, 없으면 K-apt 주소에서 추출
    const bonbun = bunNum > 0 ? String(bunNum) : extractBonbun(item.kaptAddr || '');
    const bubun  = jiNum !== '0' ? String(jiNum) : extractBubun(item.kaptAddr || '');
    const types  = await fetchTypesByBonbun(TRADE, KEY, tradeSgg, bonbun, bubun, H);
    return res.status(200).json({
      result: { ...buildResult(item), types: types?.length ? types : extractTypes(item) }
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

// ── 지번 본번으로 실거래 전용면적 타입 추출 ─────────────────
async function fetchTypesByBonbun(TRADE, KEY, sgg5, bonbun, bubun, H) {
  if (!sgg5 || !bonbun) return null;

  const now = new Date();
  const months = Array.from({length: 36}, (_,i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
  });

  const results = await Promise.allSettled(
    months.map(ym =>
      fetch(`${TRADE}?serviceKey=${KEY}&LAWD_CD=${sgg5}&DEAL_YMD=${ym}&numOfRows=1000`, { headers: H })
        .then(r => r.text())
    )
  );

  const areaSet = new Set();
  results.forEach(r => {
    if (r.status !== 'fulfilled') return;
    [...r.value.matchAll(/<item>([\s\S]*?)<\/item>/g)].forEach(m => {
      const block = m[1];
      const bonMatch = block.match(/<bonbun>(\d+)<\/bonbun>/);
      const bubMatch = block.match(/<bubun>(\d+)<\/bubun>/);
      if (!bonMatch) return;
      if (bonMatch[1].replace(/^0+/,'') !== bonbun.replace(/^0+/,'')) return;
      // 부번이 있는 경우 부번도 매칭 (부번 0 또는 없으면 본번만 매칭)
      if (bubun && bubun !== '0' && bubMatch) {
        if (bubMatch[1].replace(/^0+/,'') !== bubun.replace(/^0+/,'')) return;
      }
      const area = Math.round(parseFloat(block.match(/<excluUseAr>([\d.]+)<\/excluUseAr>/)?.[1] || 0) * 100) / 100;
      if (area > 0) areaSet.add(area);
    });
  });

  if (!areaSet.size) return null;

  return [...areaSet]
    .sort((a,b) => a-b)
    .map(area => ({
      dedicArea: area,
      hhldCnt:   0, // 거래 횟수 기반이 아닌 타입만 추출
      pyeong:    Math.round(area / 3.3058),
    }));
}

// 주소에서 지번 본번 추출 (예: "산본동 1119-4" → "1119")
function extractBonbun(addr) {
  const m = addr.match(/(\d+)(?:-\d+)?(?:\s|$)/);
  return m ? m[1] : '';
}
// 주소에서 지번 부번 추출 (예: "산본동 1119-4" → "4")
function extractBubun(addr) {
  const m = addr.match(/\d+-(\d+)(?:\s|$)/);
  return m ? m[1] : '0';
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
