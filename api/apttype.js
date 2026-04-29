export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { sigunguCd, bun, ji, bldNm, kaptCode } = req.query;
  const KEY  = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';
  const BASE = 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV4';

  try {
    // ── Mode A: kaptCode로 단지 상세 조회 ──────────────────
    if (kaptCode) {
      const url = `${BASE}/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${kaptCode}&_type=json`;
      const r   = await fetch(url);
      const d   = await r.json();
      const item = d?.response?.body?.item;

      if (!item || !item.kaptCode) {
        return res.status(200).json({ result: null, message: 'kaptCode 데이터 없음' });
      }

      // 평형별 면적 추출 (kaptMparea60, kaptMparea85, kaptMparea135 등)
      const types = extractTypes(item);

      return res.status(200).json({
        result: {
          kaptCode: item.kaptCode,
          kaptName: item.kaptName,
          kaptAddr: item.kaptAddr  || item.doroJuso,
          platArea: parseFloat(item.kaptLarea  || 0),  // 대지면적 ㎡
          totArea:  parseFloat(item.kaptTarea  || 0),  // 연면적 ㎡
          vlRat:    parseFloat(item.kaptVlRat  || 0),  // 용적률
          bcRat:    parseFloat(item.kaptBcRat  || 0),  // 건폐율
          hhldCnt:  parseInt(item.kaptdaCnt    || 0),  // 총세대수
          dongCnt:  parseInt(item.kaptDongCnt  || 0),  // 동수
          types,
        },
        raw: item
      });
    }

    // ── Mode B: sigunguCd로 단지 목록 조회 후 매칭 ─────────
    if (!sigunguCd) return res.status(400).json({ error: 'sigunguCd 또는 kaptCode 필요' });

    // 시군구 내 전체 단지 목록 (최대 1000개)
    const listUrl = `${BASE}/getAphusBassInfoV4?serviceKey=${KEY}&sigunguCd=${sigunguCd}&_type=json&numOfRows=1000&pageNo=1`;
    const r2  = await fetch(listUrl);
    const d2  = await r2.json();
    const raw = d2?.response?.body?.items?.item;
    const complexList = raw ? (Array.isArray(raw) ? raw : [raw]) : [];

    if (!complexList.length) {
      return res.status(200).json({
        result: null,
        message: '시군구 내 단지 없음',
        debug: { sigunguCd }
      });
    }

    // 번지로 매칭
    const bunNum = parseInt(bun || '0', 10);
    const jiNum  = parseInt(ji  || '0', 10);
    let matched  = null;

    if (bunNum > 0) {
      matched = complexList.find(c => {
        const addr = c.kaptAddr || c.doroJuso || '';
        return addr.includes(`${bunNum}번지`) ||
               addr.includes(` ${bunNum}-${jiNum}`) ||
               addr.endsWith(` ${bunNum}`) ||
               addr.includes(` ${bunNum} `);
      });
    }

    // 건물명으로 추가 매칭
    if (!matched && bldNm) {
      const kw = bldNm.replace(/\s/g,'').replace(/아파트/g,'');
      matched = complexList.find(c => {
        const cn = (c.kaptName||'').replace(/\s/g,'').replace(/아파트/g,'');
        return cn.includes(kw) || kw.includes(cn);
      });
    }

    if (!matched) {
      return res.status(200).json({
        result: null,
        message: '자동 매칭 실패 — 후보 선택',
        candidates: complexList.slice(0, 15).map(c => ({
          kaptCode: c.kaptCode,
          name:     c.kaptName,
          addr:     c.kaptAddr || c.doroJuso,
        }))
      });
    }

    // 매칭 단지 상세 조회
    const detUrl = `${BASE}/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${matched.kaptCode}&_type=json`;
    const r3  = await fetch(detUrl);
    const d3  = await r3.json();
    const item = d3?.response?.body?.item || matched;
    const types = extractTypes(item);

    return res.status(200).json({
      result: {
        kaptCode: item.kaptCode,
        kaptName: item.kaptName,
        kaptAddr: item.kaptAddr || item.doroJuso,
        platArea: parseFloat(item.kaptLarea || 0),
        totArea:  parseFloat(item.kaptTarea || 0),
        vlRat:    parseFloat(item.kaptVlRat || 0),
        bcRat:    parseFloat(item.kaptBcRat || 0),
        hhldCnt:  parseInt(item.kaptdaCnt   || 0),
        dongCnt:  parseInt(item.kaptDongCnt || 0),
        types,
      },
      raw: item
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

// kaptMparea60, kaptMparea85, kaptMparea135, kaptMparea138 등에서 평형 추출
function extractTypes(item) {
  const types = [];
  const keys  = Object.keys(item || {}).filter(k => k.startsWith('kaptMparea'));
  keys.forEach(key => {
    const area = parseFloat(key.replace('kaptMparea', ''));
    const cnt  = parseInt(item[key] || 0);
    if (area > 0 && cnt > 0) {
      types.push({
        dedicArea: area,
        hhldCnt:   cnt,
        pyeong:    Math.round(area / 3.3058),
      });
    }
  });

  // kaptMparea 없으면 privArea(전용면적합계) 문자열 파싱 시도
  if (!types.length && item.privArea) {
    const areas = item.privArea.split(',').map(s => parseFloat(s.trim())).filter(n => n > 0);
    areas.forEach(area => {
      types.push({ dedicArea: area, hhldCnt: 0, pyeong: Math.round(area / 3.3058) });
    });
  }

  return types.length ? types.sort((a,b) => a.dedicArea - b.dedicArea) : null;
}
