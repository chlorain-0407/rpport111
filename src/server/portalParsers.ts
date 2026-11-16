import { ManagementFeePeriod, FieldVerificationStatus } from '../types/property';
import { computeManagementFeeMonthly } from '../utils/calculator';

export type PortalPageType =
  | 'single_listing'
  | 'listing_index'
  | 'homepage'
  | 'delisted_or_redirected'
  | 'blocked_or_login'
  | 'template_only';

export interface PortalParseResult {
  pageType: PortalPageType;
  pageTypeReason: string;
  sourcePlatform: string;
  sourceListingId: string;
  fetchedAt: string;
  parsedFields: Record<string, any>;
  fieldStatus: Record<string, FieldVerificationStatus>;
  evidenceSummaries: Record<string, string>;
  slimAiSnippet: string;
  rawCleanedText: string;
  parseConfidence: 'high' | 'medium' | 'low';
  needsAiGapFill: boolean;
}

export function detectPlatformAndId(urlStr: string): { platform: string; listingId: string } {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    const full = u.href;

    if (host.includes('hbhousing.com.tw')) {
      const sn = u.searchParams.get('sn') || (full.match(/[?&/](?:sn=)?(BS\d+|[A-Z]{1,3}\d{4,})/i)?.[1] ?? '');
      return { platform: '住商不動產', listingId: sn.toUpperCase() };
    }
    if (host.includes('591.com.tw')) {
      const m = u.pathname.match(/detail\/\d+\/(\d+)\.html/i) || u.pathname.match(/(\d{6,})/);
      return { platform: '591房屋交易', listingId: m ? m[1] : '' };
    }
    if (host.includes('pacific.com.tw')) {
      const m = u.pathname.match(/Object\/(\d+|[A-Z0-9-]+)/i) || u.searchParams.get('id');
      const idVal = Array.isArray(m) ? m[1] : typeof m === 'string' ? m : '';
      if (/MapSearch|Search|List/i.test(idVal)) return { platform: '太平洋房屋', listingId: '' };
      return { platform: '太平洋房屋', listingId: idVal };
    }
    if (host.includes('sinyi.com.tw')) {
      const m = u.pathname.match(/([A-Z0-9]{5,12})/i);
      return { platform: '信義房屋', listingId: m ? m[1] : '' };
    }
    if (host.includes('yungching.com.tw')) {
      const m = u.pathname.match(/(\d{6,})/);
      return { platform: '永慶房仲網', listingId: m ? m[1] : '' };
    }
    if (host.includes('rakuya.com.tw')) {
      const ebh = u.searchParams.get('ehid') || u.pathname.match(/sell_item\/info\?ehid=([^&]+)/i)?.[1] || '';
      return { platform: '樂屋網', listingId: ebh };
    }
    return { platform: host.replace(/^www\./, ''), listingId: '' };
  } catch {
    return { platform: '外部網頁', listingId: '' };
  }
}

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)));
}

/**
 * Strip HTML cleanly WITHOUT splitting numbers when portals (like 591) inject empty paired inline decoy tags:
 * e.g. `3<ujodboj></ujodboj>509元/月` -> `3509元/月`
 */
export function cleanPortalHtml(rawHtml: string): string {
  if (!rawHtml) return '';
  let s = rawHtml;
  // Remove scripts, styles, svg, noscript completely
  s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  s = s.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ');
  s = s.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');

  // Collapse 591-style empty inline decoy tags without introducing spaces (iterate twice for nested empty tags)
  for (let i = 0; i < 3; i++) {
    s = s.replace(/<([a-z][a-z0-9]{2,18})(?:\s[^>]*)?>\s*<\/\1>/gi, '');
  }

  // Convert block boundaries to newlines so tabular/row specs stay distinct
  s = s.replace(/<\/?(?:br|p|div|li|tr|td|th|h[1-6]|section|article|header|footer|dt|dd)\b[^>]*>/gi, '\n');
  // Strip remaining inline tags WITHOUT adding spaces (preserves split text nodes)
  s = s.replace(/<[^>]+>/g, '');
  s = decodeHtmlEntities(s);

  // Strip JS template interpolation noise like ${price}, {{item.name}}
  s = s.replace(/\$\{[^}]+\}/g, '');
  s = s.replace(/\{\{[^}]+\}\}/g, '');

  // Normalize lines
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

export function extractJsonLdObjects(rawHtml: string): any[] {
  const results: any[] = [];
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rawHtml)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) {
        results.push(...parsed);
      } else if (parsed && Array.isArray(parsed['@graph'])) {
        results.push(...parsed['@graph']);
      } else if (parsed && typeof parsed === 'object') {
        results.push(parsed);
      }
    } catch {
      // ignore malformed JSON-LD blocks
    }
  }
  return results;
}

export function flattenPostalAddress(addr: any): string {
  if (!addr) return '';
  if (typeof addr === 'string') {
    const t = addr.trim();
    return t === '[object Object]' ? '' : t;
  }
  if (typeof addr === 'object') {
    const street = (addr.streetAddress || '').toString().trim();
    const locality = (addr.addressLocality || '').toString().trim();
    const region = (addr.addressRegion || '').toString().trim();
    if (street) {
      if (region && !street.startsWith(region)) {
        return `${region}${locality && !street.includes(locality) ? locality : ''}${street}`;
      }
      return street;
    }
    return `${region}${locality}`.trim();
  }
  return '';
}

export function extractCityDistrictFromText(text: string): { cityDistrict: string; remainingAddress: string } {
  if (!text) return { cityDistrict: '', remainingAddress: '' };
  const clean = text.replace(/^台灣/, '').trim();
  const m = clean.match(
    /((?:台北市|臺北市|新北市|桃園市|台中市|臺中市|台南市|臺南市|高雄市|基隆市|新竹市|嘉義市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義縣|屏東縣|宜蘭縣|花蓮縣|台東縣|臺東縣|澎湖縣|金門縣|連江縣)\s*[\u4e00-\u9fa5]{1,4}[區鄉鎮市])/
  );
  if (m) {
    const cd = m[1].replace(/\s+/g, '');
    const rem = clean.slice((m.index || 0) + m[0].length).trim();
    return { cityDistrict: cd, remainingAddress: rem || clean };
  }
  return { cityDistrict: '', remainingAddress: clean };
}

export function extractTitleTag(rawHtml: string): string {
  const m = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeHtmlEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

export function detectPageTypeAndTarget(
  urlStr: string,
  rawHtml: string,
  cleanedText: string
): { pageType: PortalPageType; reason: string; platform: string; listingId: string } {
  const { platform, listingId } = detectPlatformAndId(urlStr);
  const title = extractTitleTag(rawHtml);
  let pathname = '';
  let search = '';
  try {
    const u = new URL(urlStr);
    pathname = u.pathname.toLowerCase();
    search = u.search.toLowerCase();
  } catch {
    // ignore
  }

  // 1. Blocked / Captcha / Login wall check
  const blockSignals = [
    'cf-browser-verification',
    'challenge-running',
    '請進行安全驗證',
    '請登入會員',
    'access denied',
    'enable javascript and cookies to continue',
  ];
  if (blockSignals.some((sig) => rawHtml.toLowerCase().includes(sig))) {
    return {
      pageType: 'blocked_or_login',
      reason: '目標網站回傳安全驗證、防爬蟲挑戰頁或要求會員登入，無法直接自動讀取。',
      platform,
      listingId,
    };
  }

  // 2. MapSearch / Search Index / Category List pages BEFORE calling AI!
  const listUrlPatterns = [
    /\/mapsearch/,
    /\/object\/search/,
    /\/search/,
    /\/list/,
    /\/buyhouse\/?$/,
    /\/rent\/list/,
  ];
  const listTitlePatterns = [/地圖找屋/, /條件找屋/, /買屋搜尋/, /物件列表/, /房屋列表/, /條件搜尋/];
  const isRootHomepage = pathname === '' || pathname === '/' || pathname === '/home' || pathname === '/index.html';

  const hasListShellText =
    /載入中\s*共有\s*筆物件/.test(cleanedText) ||
    (/行政區/.test(cleanedText) && /總價/.test(cleanedText) && /搜尋/.test(cleanedText) && !listingId);

  if (
    listUrlPatterns.some((re) => re.test(pathname)) ||
    listTitlePatterns.some((re) => re.test(title)) ||
    hasListShellText
  ) {
    return {
      pageType: 'listing_index',
      reason: `偵測為「${platform}」的列表搜尋或地圖找屋頁（標題：${title || pathname}），非單一待售物件詳細頁；請點擊具體物件後貼上單一物件詳情網址。`,
      platform,
      listingId,
    };
  }

  if (isRootHomepage && !search.includes('sn=') && !search.includes('id=')) {
    return {
      pageType: 'homepage',
      reason: `網址為「${platform}」網站首頁（${urlStr}），非單一待售物件詳細頁；請貼上具體物件詳細頁面網址。`,
      platform,
      listingId,
    };
  }

  // 3. Delisted / Expired / Redirected to generic notice
  const delistedPatterns = [
    /此物件已下架/,
    /該物件已售出或下架/,
    /查無此物件/,
    /物件不存在或已關閉/,
    /很抱歉，您所查詢的物件已下架/,
  ];
  if (delistedPatterns.some((re) => re.test(cleanedText) || re.test(title))) {
    return {
      pageType: 'delisted_or_redirected',
      reason: `「${platform}」頁面顯示該物件已下架、已成交關閉或查無資料，請確認網址或改貼最新上架頁面。`,
      platform,
      listingId,
    };
  }

  // 4. Template-only SPA check (lots of HTML template variables, no JSON-LD property, minimal real spec)
  const jsonLd = extractJsonLdObjects(rawHtml);
  const hasPropertyJsonLd = jsonLd.some(
    (obj) =>
      obj &&
      ['Product', 'Residence', 'Apartment', 'House', 'SingleFamilyResidence', 'Offer'].includes(
        String(obj['@type'] || '')
      ) &&
      (obj.name || obj.offers || obj.sku || obj.productID)
  );

  if (cleanedText.length < 120 && !hasPropertyJsonLd) {
    return {
      pageType: 'template_only',
      reason: '網頁僅回傳前端動態樣板且無結構化物件資料，靜態內容不足以辨識規格。',
      platform,
      listingId,
    };
  }

  return {
    pageType: 'single_listing',
    reason: `已確認為「${platform}」單一物件頁面${listingId ? `（來源編號：${listingId}）` : ''}。`,
    platform,
    listingId,
  };
}

function parseManagementFeeText(rawLine: string): {
  raw: string;
  amount: number | null;
  period: ManagementFeePeriod;
  monthlyAvg: number | null;
} {
  const clean = rawLine.replace(/\s+/g, '');
  if (/無管理費|免管理費|0元/.test(clean)) {
    return { raw: rawLine.trim(), amount: 0, period: 'monthly', monthlyAvg: 0 };
  }
  const m = clean.match(/([\d,]+)\s*元?(?:[\/／每]?\s*(半年|雙月|季|年|月))?/);
  if (!m) {
    return { raw: rawLine.trim(), amount: null, period: 'unknown', monthlyAvg: null };
  }
  const amount = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(amount)) {
    return { raw: rawLine.trim(), amount: null, period: 'unknown', monthlyAvg: null };
  }

  let period: ManagementFeePeriod = 'unknown';
  const unitToken = m[2] || '';
  if (unitToken === '半年' || /半年/.test(clean)) period = 'half_year';
  else if (unitToken === '季' || /每?季/.test(clean)) period = 'quarterly';
  else if (unitToken === '年' || /[\/／]年|每年/.test(clean)) period = 'yearly';
  else if (unitToken === '月' || /[\/／]每月|[\/／]月|每月|元\/月/.test(clean)) period = 'monthly';

  const monthlyAvg = computeManagementFeeMonthly(amount, period);
  return {
    raw: rawLine.trim(),
    amount,
    period,
    monthlyAvg,
  };
}

function normalizeFloorParts(rawFloor: string): {
  floorRaw: string;
  floor: string;
  totalFloors: string;
} {
  const raw = rawFloor.replace(/\s+/g, ' ').trim();
  if (!raw || /^--$/.test(raw)) return { floorRaw: '', floor: '', totalFloors: '' };

  // Slash or fullwidth slash pair e.g. "5 / 10", "5樓 / 10樓", "10F/14F", "10樓／共14樓", "B1 / 15樓"
  const slashMatch = raw.match(/^([^\/／]+?)\s*[\/／]\s*([^\/／]+?)$/);
  if (slashMatch) {
    const left = slashMatch[1].replace(/[樓F]$/i, '').trim();
    const right = slashMatch[2].replace(/^共/, '').replace(/[樓F]$/i, '').trim();
    return {
      floorRaw: raw,
      floor: left,
      totalFloors: /^\d+$/.test(right) ? right : right,
    };
  }

  return { floorRaw: raw, floor: raw, totalFloors: '' };
}

function mapPropertyTypeToken(rawT: string): string {
  if (/華廈/.test(rawT)) return '華廈';
  if (/電梯大樓|住宅大樓|大樓/.test(rawT)) return '電梯大樓';
  if (/透天|別墅/.test(rawT)) return '透天別墅';
  if (/公寓/.test(rawT)) return '公寓';
  return '';
}

function extractHiddenInputValue(rawHtml: string, idOrName: string): string {
  const re1 = new RegExp(`<input[^>]+(?:id|name)=["']${idOrName}["'][^>]+value=["']([^"']*)["'][^>]*>`, 'i');
  const re2 = new RegExp(`<input[^>]+value=["']([^"']*)["'][^>]+(?:id|name)=["']${idOrName}["'][^>]*>`, 'i');
  const m = rawHtml.match(re1) || rawHtml.match(re2);
  return m ? decodeHtmlEntities(m[1]).trim() : '';
}

function parseHbhousingDeterministic(
  urlStr: string,
  rawHtml: string,
  cleanedText: string
): Partial<PortalParseResult> {
  const { platform, listingId: urlSn } = detectPlatformAndId(urlStr);
  const jsonLd = extractJsonLdObjects(rawHtml);

  const productNode = jsonLd.find(
    (x) => x && (x['@type'] === 'Product' || (Array.isArray(x['@type']) && x['@type'].includes('Product')))
  );
  const residenceNode = jsonLd.find(
    (x) => x && ['Residence', 'Apartment', 'House', 'SingleFamilyResidence'].includes(String(x['@type']))
  );
  const breadcrumbNode = jsonLd.find((x) => x && x['@type'] === 'BreadcrumbList');

  const listingId = (productNode?.productID || productNode?.sku || urlSn || '').toString().trim();

  const parsedFields: Record<string, any> = {
    sourcePlatform: platform,
    sourceListingId: listingId,
    caseId: listingId ? `HB-${listingId}` : '',
  };
  const fieldStatus: Record<string, FieldVerificationStatus> = {};
  const evidenceSummaries: Record<string, string> = {};

  const setField = (key: string, val: any, status: FieldVerificationStatus, quote?: string) => {
    parsedFields[key] = val;
    fieldStatus[key] = status;
    if (quote) evidenceSummaries[key] = quote;
  };

  // Case Name
  const caseName = (productNode?.name || residenceNode?.name || '').toString().trim();
  if (caseName) {
    setField('caseName', caseName, 'recorded', `JSON-LD / 頁面主標題：「${caseName}」`);
  }

  // City District from BreadcrumbList + Address from Residence/PostalAddress
  let cityDistrict = '';
  let breadcrumbRegion = '';
  let breadcrumbLocality = '';
  if (breadcrumbNode && Array.isArray(breadcrumbNode.itemListElement)) {
    const items = breadcrumbNode.itemListElement.map((el: any) => (el?.name || '').toString().trim()).filter(Boolean);
    for (const item of items) {
      if (/[縣市]$/.test(item) && !breadcrumbRegion) breadcrumbRegion = item;
      else if (/[區鄉鎮市]$/.test(item) && item !== breadcrumbRegion) {
        breadcrumbLocality = item.startsWith(breadcrumbRegion) ? item : `${breadcrumbRegion}${item}`;
      }
    }
    if (breadcrumbLocality) cityDistrict = breadcrumbLocality;
  }

  const rawAddr = flattenPostalAddress(residenceNode?.address || productNode?.address);
  if (rawAddr) {
    const { cityDistrict: parsedCd, remainingAddress } = extractCityDistrictFromText(rawAddr);
    if (!cityDistrict && parsedCd) cityDistrict = parsedCd;
    const cleanAddr =
      cityDistrict && remainingAddress && !remainingAddress.startsWith(cityDistrict)
        ? remainingAddress
        : cityDistrict && rawAddr.startsWith(cityDistrict)
        ? rawAddr.slice(cityDistrict.length).trim() || rawAddr
        : rawAddr;
    setField('address', cleanAddr, 'recorded', `結構化地址：「${rawAddr}」`);
  }
  if (cityDistrict) {
    setField('cityDistrict', cityDistrict, 'recorded', `行政區定位：「${cityDistrict}」`);
  }

  // Isolate main body detail zone BEFORE nearby deals / recommended listings / loan calculator
  // HBHousing puts detail specs between main price block and 房屋簡介 / 推薦物件 / 房貸試算 / 附近成交
  const mainSliceEnd = (() => {
    const markers = ['房屋簡介', '類似物件', '猜你喜歡', '附近成交', '推薦物件', '周邊成交'];
    let minIdx = cleanedText.length;
    for (const mk of markers) {
      const idx = cleanedText.indexOf(mk);
      if (idx > 200 && idx < minIdx) minIdx = idx;
    }
    return minIdx;
  })();
  const primarySection = cleanedText.slice(0, mainSliceEnd);

  // Price: Current asking price + old/struck-through asking price
  // On HBHousing body: e.g. `1,850萬 1,780 萬 (含車位價)` or `1,168萬 1,088 萬 (含車位價)`
  const jsonPrice = productNode?.offers?.price ? Number(productNode.offers.price) : null;
  const pricePairMatch = primarySection.match(
    /([\d,]+(?:\.\d+)?)\s*萬\s+([\d,]+(?:\.\d+)?)\s*萬\s*(?:\(\s*(含車位價|不含車位|含車位)\s*\))?/
  );
  if (pricePairMatch) {
    const firstWan = Number(pricePairMatch[1].replace(/,/g, ''));
    const secondWan = Number(pricePairMatch[2].replace(/,/g, ''));
    const expectedCurrent = jsonPrice && jsonPrice >= 10000 ? Math.round(jsonPrice / 10000) : secondWan;
    if (Math.abs(secondWan - expectedCurrent) <= 1 && firstWan !== secondWan) {
      setField('askingPrice', secondWan, 'recorded', `主頁現行開價：「${pricePairMatch[0].trim()}」`);
      setField('previousAskingPrice', firstWan, 'recorded', `降價前原開價：「${pricePairMatch[1]}萬」`);
    } else if (jsonPrice && jsonPrice >= 10000) {
      setField('askingPrice', Math.round(jsonPrice / 10000), 'recorded', `JSON-LD offers.price：${jsonPrice} 元`);
    }
    if (pricePairMatch[3]) {
      const inc = /含車位/.test(pricePairMatch[3]) && !/不含車位/.test(pricePairMatch[3]);
      setField('parkingIncluded', inc, 'recorded', `價格備註：「(${pricePairMatch[3]})」`);
      setField('hasParking', true, 'recorded', `價格備註：「(${pricePairMatch[3]})」`);
    }
  } else if (jsonPrice && jsonPrice >= 10000) {
    setField('askingPrice', Math.round(jsonPrice / 10000), 'recorded', `JSON-LD offers.price：${jsonPrice} 元`);
    if (/含車位價/.test(primarySection)) {
      setField('parkingIncluded', true, 'recorded', '價格區標註「(含車位價)」');
      setField('hasParking', true, 'recorded', '價格區標註「(含車位價)」');
    }
  }

  // Layout e.g. 3房(室)2廳2衛 -> 3房2廳2衛
  const layoutM = primarySection.match(/(\d+)\s*房(?:\(室\))?\s*(\d+)\s*廳\s*(\d+)\s*衛/);
  if (layoutM) {
    setField('layout', `${layoutM[1]}房${layoutM[2]}廳${layoutM[3]}衛`, 'recorded', `格局欄：「${layoutM[0]}」`);
  }

  // Total Area (建坪 37.2坪 / 權狀坪數)
  const totalAreaM = primarySection.match(/(?:權狀坪數|總坪數|建坪)\s*([\d.]+)\s*坪/);
  if (totalAreaM) {
    setField('totalArea', Number(totalAreaM[1]), 'recorded', `面積欄：「${totalAreaM[0]}」`);
  }

  // Main Area
  const mainAreaM = primarySection.match(/主建物\s*([\d.]+)\s*坪/);
  if (mainAreaM) {
    setField('mainArea', Number(mainAreaM[1]), 'recorded', `面積欄：「${mainAreaM[0]}」`);
  }

  // Aux Area
  const auxAreaM = primarySection.match(/附屬建物\s*([\d.]+)\s*坪/);
  if (auxAreaM) {
    setField('auxArea', Number(auxAreaM[1]), 'recorded', `面積欄：「${auxAreaM[0]}」`);
  }

  // Common Area (e.g. `公共設施 12.91坪 (內含車位6.22坪)` or `公共設施 13.28坪`)
  const commonWithParkM = primarySection.match(
    /公共設施\s*([\d.]+)\s*坪\s*[（(]\s*內含車位\s*([\d.]+)\s*坪\s*[）)]/
  );
  if (commonWithParkM) {
    setField('commonArea', Number(commonWithParkM[1]), 'recorded', `面積欄：「${commonWithParkM[0]}」`);
    setField('parkingArea', Number(commonWithParkM[2]), 'recorded', `公設括號內明確記載：「${commonWithParkM[0]}」`);
    setField('parkingAreaIncludedInCommon', true, 'recorded', `公設括號內明確記載：「${commonWithParkM[0]}」`);
    setField('hasParking', true, 'recorded', `公設括號內明確記載車位坪數 ${commonWithParkM[2]} 坪`);
  } else {
    const commonM = primarySection.match(/公共設施\s*([\d.]+)\s*坪/);
    if (commonM) {
      setField('commonArea', Number(commonM[1]), 'recorded', `面積欄：「${commonM[0]}」`);
    }
  }

  // Dedicated Parking Area line (if not already populated from common area, and not "--")
  const parkAreaRowM = primarySection.match(/車位坪數\s*(--|[\d.]+)\s*坪?/);
  if (parkAreaRowM) {
    if (parkAreaRowM[1] !== '--' && parsedFields.parkingArea == null) {
      const pa = Number(parkAreaRowM[1]);
      if (Number.isFinite(pa) && pa > 0) {
        setField('parkingArea', pa, 'recorded', `車位坪數欄：「${parkAreaRowM[0]}」`);
        setField('parkingAreaIncludedInCommon', false, 'recorded', `車位坪數獨立記載：「${parkAreaRowM[0]}」`);
      }
    }
  }

  // Age
  const ageM = primarySection.match(/屋齡\s*([\d.]+)\s*年/);
  if (ageM) {
    setField('age', Number(ageM[1]), 'recorded', `屋齡欄：「${ageM[0]}」`);
  }

  // Property Type (HB puts "2.2年 華廈屋齡型態" in header spec before basic info table)
  const hbHeaderTypeM = primarySection.match(
    /([\d.]+\s*年\s*(電梯大樓|住宅大樓|華廈|透天別墅|公寓|別墅|大樓)\s*(?:屋齡)?型態)/
  );
  const rowTypeM = primarySection.match(
    /(?:^|\n)(?:建物型態|房屋型態|型態|類型)[\s：:]+([^\n]+)/
  );
  const fallbackTypeM = primarySection.match(/(電梯大樓|華廈|透天別墅|公寓)/);
  if (hbHeaderTypeM) {
    const mapped = mapPropertyTypeToken(hbHeaderTypeM[2]);
    if (mapped) {
      setField('propertyType', mapped, 'recorded', `物件頁首規格：「${hbHeaderTypeM[1].trim()}」`);
    }
  } else if (rowTypeM && rowTypeM[1] && !/^--$/.test(rowTypeM[1].trim())) {
    const mapped = mapPropertyTypeToken(rowTypeM[1].trim());
    if (mapped) {
      setField('propertyType', mapped, 'recorded', `建物型態欄：「${rowTypeM[0].trim()}」`);
    }
  } else if (fallbackTypeM) {
    const mapped = mapPropertyTypeToken(fallbackTypeM[1]);
    if (mapped) {
      setField('propertyType', mapped, 'recorded', `頁面規格記載：「${fallbackTypeM[1]}」`);
    }
  }

  // Floor: Support both standalone table row `\n樓層\n5 / 5` and inline `樓層 5 / 5`, avoiding UI button noise
  const specAnchor = primarySection.includes('基本資料')
    ? primarySection.slice(primarySection.indexOf('基本資料'))
    : primarySection;
  const floorRowM = specAnchor.match(/(?:^|\s)樓層[\s：:]+([^\n]+?)(?=\s+(?:朝向|車位|管理費)|$|\n)/);
  const floorSummaryM = primarySection.match(/(\d+(?:樓)?\s*\/\s*\d+樓?)\s*樓層/);
  const candidateFloor =
    floorRowM && floorRowM[1] && !/分享|列印|加入|收藏/.test(floorRowM[1])
      ? floorRowM[1].trim()
      : floorSummaryM
      ? floorSummaryM[1].trim()
      : '';
  if (candidateFloor && !/^--$/.test(candidateFloor)) {
    const normF = normalizeFloorParts(candidateFloor);
    if (normF.floor || normF.floorRaw) {
      setField('floor', normF.floor, 'recorded', `樓層欄原文：「${normF.floorRaw}」`);
      if (normF.totalFloors) setField('totalFloors', normF.totalFloors, 'recorded', `樓層欄原文：「${normF.floorRaw}」`);
      parsedFields.floorRaw = normF.floorRaw;
    }
  }

  // Parking ownership vs type: Match standalone `車位` label (preceded by start/whitespace, NOT `(含車位價)` or `車位坪數`)
  const parkLineM = specAnchor.match(/(?:^|\s)車位(?!坪數|管理)[\s：:]+([^\n]+?)(?=\s+(?:車位管理|管理費|朝向)|$|\n)/);
  if (parkLineM) {
    const pText = parkLineM[1].trim();
    if (/無車位|^無$/.test(pText)) {
      setField('hasParking', false, 'recorded', `車位欄：「${pText}」`);
      setField('parkingType', '無車位', 'recorded', `車位欄：「${pText}」`);
      fieldStatus.parkingIncluded = 'not_applicable';
      fieldStatus.parkingPrice = 'not_applicable';
      fieldStatus.parkingArea = 'not_applicable';
      fieldStatus.parkingOwnership = 'not_applicable';
    } else if (pText && pText !== '--' && !/^價/.test(pText)) {
      setField('hasParking', true, 'recorded', `車位欄：「${pText}」`);
      // Ownership: 私有 / 共有 / 法定 / 獎勵 / 約定專用
      const ownM = pText.match(/(私有|共有|約定專用|獨立產權)/);
      if (ownM) {
        setField('parkingOwnership', ownM[1], 'recorded', `車位欄權屬原文：「${pText}」`);
      }
      // Type: 坡道平面 / 坡道機械 / 機械機械 / 機械-機械
      if (/坡道\s*平面|坡平/.test(pText)) {
        setField('parkingType', '坡道平面', 'recorded', `車位欄型式原文：「${pText}」`);
      } else if (/坡道\s*機械|坡機/.test(pText)) {
        setField('parkingType', '坡道機械', 'recorded', `車位欄型式原文：「${pText}」`);
      } else if (/機械[\s\-]*機械/.test(pText)) {
        setField('parkingType', '機械機械', 'recorded', `車位欄型式原文：「${pText}」`);
      } else if (/平面式|平面/.test(pText)) {
        setField('parkingType', '平面式', 'recorded', `車位欄型式原文：「${pText}」`);
      } else {
        // Explicit ownership-only line like "私有" -> parkingType MUST remain empty (pending)!
        fieldStatus.parkingType = 'pending';
      }
    }
  }

  // Management Fee: `管理費 5,582元/半年` or `管理費 1,982元/每月`
  const feeM = primarySection.match(/管理費[\s：:]*([^\n]+)/);
  if (feeM && feeM[1] && !/^--$/.test(feeM[1].trim())) {
    const feeParsed = parseManagementFeeText(feeM[1]);
    if (feeParsed.amount !== null) {
      parsedFields.managementFeeRaw = feeParsed.raw;
      parsedFields.managementFeeAmount = feeParsed.amount;
      parsedFields.managementFeePeriod = feeParsed.period;
      parsedFields.managementFee = feeParsed.monthlyAvg;
      fieldStatus.managementFee = feeParsed.monthlyAvg !== null ? 'recorded' : 'pending';
      fieldStatus.managementFeePeriod = feeParsed.period !== 'unknown' ? 'recorded' : 'pending';
      evidenceSummaries.managementFee =
        feeParsed.period !== 'unknown' && feeParsed.monthlyAvg !== null
          ? `管理費欄原文：「${feeParsed.raw}」（換算月均約 ${feeParsed.monthlyAvg.toLocaleString('zh-TW')} 元／月）`
          : `管理費欄原文：「${feeParsed.raw}」（計費週期待確認）`;
    }
  }

  // Mark unparsed advanced fields explicitly as pending
  if (parsedFields.parkingPrice == null && parsedFields.hasParking !== false) {
    fieldStatus.parkingPrice = 'pending';
  }
  if (parsedFields.parkingArea == null && parsedFields.hasParking !== false) {
    fieldStatus.parkingArea = 'pending';
  }

  const slimAiSnippet = [
    `案名：${caseName || '未知'}`,
    `來源：${platform} (${listingId})`,
    primarySection.slice(0, 1200),
  ].join('\n');

  const populatedCount = Object.keys(parsedFields).filter(
    (k) => parsedFields[k] !== null && parsedFields[k] !== '' && k !== 'sourcePlatform' && k !== 'sourceListingId'
  ).length;

  return {
    sourcePlatform: platform,
    sourceListingId: listingId,
    parsedFields,
    fieldStatus,
    evidenceSummaries,
    slimAiSnippet,
    parseConfidence: populatedCount >= 8 ? 'high' : populatedCount >= 4 ? 'medium' : 'low',
    needsAiGapFill: false, // HBHousing deterministic extraction covers spec table accurately
  };
}

function parse591Deterministic(
  urlStr: string,
  rawHtml: string,
  cleanedText: string
): Partial<PortalParseResult> {
  const { platform, listingId: urlId } = detectPlatformAndId(urlStr);
  const jsonLd = extractJsonLdObjects(rawHtml);

  const listingNode = jsonLd.find((x) => {
    if (!x || !(x.name || x.offers || x.sku)) return false;
    const types = Array.isArray(x['@type']) ? x['@type'] : [x['@type']];
    return types.some((t: any) =>
      ['Apartment', 'House', 'Residence', 'Product', 'SingleFamilyResidence'].includes(String(t || ''))
    );
  });

  const hidPostId = extractHiddenInputValue(rawHtml, 'hid_postId');
  const listingId = (
    (listingNode?.sku || '').toString().replace(/^[A-Z]/, '') ||
    urlId ||
    hidPostId ||
    ''
  ).trim();

  const parsedFields: Record<string, any> = {
    sourcePlatform: platform,
    sourceListingId: listingId,
    caseId: listingId ? `591-${listingId}` : '',
  };
  const fieldStatus: Record<string, FieldVerificationStatus> = {};
  const evidenceSummaries: Record<string, string> = {};

  const setField = (key: string, val: any, status: FieldVerificationStatus, quote?: string) => {
    parsedFields[key] = val;
    fieldStatus[key] = status;
    if (quote) evidenceSummaries[key] = quote;
  };

  // Isolate target listing body BEFORE community cards / recommended listings / nearby deals
  const targetZoneEnd = (() => {
    const stopMarkers = [
      '熱門成交社區',
      '熱門社區在售',
      '猜你喜歡',
      '類似物件',
      '附近類似物件',
      '周邊成交行情',
      '推薦物件',
      '屋主推薦',
    ];
    let minIdx = cleanedText.length;
    for (const mk of stopMarkers) {
      const idx = cleanedText.indexOf(mk);
      if (idx > 200 && idx < minIdx) minIdx = idx;
    }
    return minIdx;
  })();
  const primarySection = cleanedText.slice(0, targetZoneEnd);

  if (listingNode) {
    if (listingNode.name) {
      setField('caseName', String(listingNode.name).trim(), 'recorded', `591 JSON-LD / 標題：「${listingNode.name}」`);
    }

    const rawAddr = flattenPostalAddress(listingNode.address);
    if (rawAddr) {
      const { cityDistrict, remainingAddress } = extractCityDistrictFromText(rawAddr);
      if (cityDistrict) {
        setField('cityDistrict', cityDistrict, 'recorded', `591 JSON-LD 行政區：「${cityDistrict}」`);
      }
      const cleanAddr =
        cityDistrict && rawAddr.startsWith(cityDistrict)
          ? rawAddr.slice(cityDistrict.length).trim() || rawAddr
          : remainingAddress || rawAddr;
      setField('address', cleanAddr, 'recorded', `591 JSON-LD 地址：「${rawAddr}」`);
    }

    const rawPrice = listingNode.offers?.price ? Number(listingNode.offers.price) : null;
    if (rawPrice && rawPrice >= 10000) {
      const wan = Math.round(rawPrice / 10000);
      setField('askingPrice', wan, 'recorded', `591 JSON-LD offers.price：${rawPrice.toLocaleString('zh-TW')} 元（${wan} 萬元）`);
    }

    if (listingNode.floorSize?.value) {
      const totalPing = Number(listingNode.floorSize.value);
      if (Number.isFinite(totalPing) && totalPing > 0) {
        setField('totalArea', totalPing, 'recorded', `591 JSON-LD floorSize：${totalPing} ${listingNode.floorSize.unitText || '坪'}`);
      }
    }
  }

  // Static hidden inputs verified strictly for this target listing ID
  const matchesTargetPost = !hidPostId || !listingId || hidPostId === listingId;
  if (matchesTargetPost) {
    const hidArea = Number(extractHiddenInputValue(rawHtml, 'hid_area'));
    if (parsedFields.totalArea == null && Number.isFinite(hidArea) && hidArea > 0) {
      setField('totalArea', hidArea, 'recorded', `591 隱藏欄位 (hid_area)：${hidArea} 坪`);
    }
    const hidMainArea = Number(extractHiddenInputValue(rawHtml, 'hid_mainarea'));
    if (Number.isFinite(hidMainArea) && hidMainArea > 0) {
      setField('mainArea', hidMainArea, 'recorded', `591 目標物件靜態隱藏欄位 (hid_mainarea)：${hidMainArea} 坪`);
    }
  }

  // Layout inside target primarySection ONLY (prefer full 房/廳/衛/陽台; if only room count, mark pending!)
  const fullLayoutM = primarySection.match(
    /(\d+)\s*房(?:\(室\))?\s*(\d+)\s*廳\s*(\d+)\s*衛(?:\s*(\d+)\s*陽台)?/
  );
  if (fullLayoutM) {
    const fullStr = `${fullLayoutM[1]}房${fullLayoutM[2]}廳${fullLayoutM[3]}衛${fullLayoutM[4] ? `${fullLayoutM[4]}陽台` : ''}`;
    setField('layout', fullStr, 'recorded', `目標頁面格局：「${fullLayoutM[0].trim()}」`);
  } else if (listingNode?.numberOfRooms) {
    setField(
      'layout',
      `${listingNode.numberOfRooms}房`,
      'pending',
      `591 JSON-LD numberOfRooms 僅載明 ${listingNode.numberOfRooms} 房，廳衛數於靜態頁待確認（未計入完整格局）`
    );
  }

  // Static target area fields inside primarySection (only when statically rendered, never community cards)
  if (parsedFields.auxArea == null) {
    const auxM = primarySection.match(/附屬建物[\s：:]*([\d.]+)\s*坪/);
    if (auxM && Number(auxM[1]) > 0) {
      setField('auxArea', Number(auxM[1]), 'recorded', `591 面積明細：「${auxM[0].trim()}」`);
    }
  }
  if (parsedFields.commonArea == null) {
    const comM = primarySection.match(/(?:共有部分|公共設施|公設)[\s：:]*([\d.]+)\s*坪/);
    if (comM && Number(comM[1]) > 0) {
      setField('commonArea', Number(comM[1]), 'recorded', `591 面積明細：「${comM[0].trim()}」`);
    }
  }

  // Static Floor & Age inside target primarySection
  const floorLabelM = primarySection.match(/樓層[\s：:]+([^\n]+)/);
  const floorSlashM = primarySection.match(/(?:^|\n)((?:地下\d+層|B\d+|\d+)\s*(?:樓|F)\s*[\/／]\s*(?:共\s*)?\d+\s*(?:樓|F))/i);
  const candidateFloor =
    floorLabelM && floorLabelM[1] && !/^--$/.test(floorLabelM[1].trim()) && !/^\s*$/.test(floorLabelM[1])
      ? floorLabelM[1].trim()
      : floorSlashM
      ? floorSlashM[1].trim()
      : '';
  if (candidateFloor && /\d|B\d|地下|整棟/.test(candidateFloor)) {
    const normF = normalizeFloorParts(candidateFloor);
    if (normF.floor || normF.floorRaw) {
      setField('floor', normF.floor, 'recorded', `591 樓層記載：「${normF.floorRaw}」`);
      if (normF.totalFloors) setField('totalFloors', normF.totalFloors, 'recorded', `591 樓層記載：「${normF.floorRaw}」`);
      parsedFields.floorRaw = normF.floorRaw;
    }
  }

  const ageM = primarySection.match(/屋齡[\s：:]*([\d.]+)\s*年/);
  if (ageM && Number.isFinite(Number(ageM[1]))) {
    setField('age', Number(ageM[1]), 'recorded', `591 屋齡欄：「${ageM[0].trim()}」`);
  }

  // Static `.detail-house-item` values after decoy tags stripped
  if (/\(含車位價格?\)/.test(primarySection)) {
    setField('parkingIncluded', true, 'recorded', '價格區標註：「(含車位價格)」');
    setField('hasParking', true, 'recorded', '價格區標註：「(含車位價格)」');
  }

  // 型態
  const typeM = primarySection.match(/型態[\s：:]+(電梯大樓|住宅大樓|華廈|透天別墅|公寓|別墅)/);
  if (typeM) {
    const mapped = mapPropertyTypeToken(typeM[1]);
    if (mapped) {
      setField('propertyType', mapped, 'recorded', `591 型態欄：「${typeM[0].trim()}」`);
    }
  }

  // 管理費：e.g. `管理費：3509元/月`
  const feeLineM = primarySection.match(/管理費[\s：:]+([^\n]+)/);
  if (feeLineM && feeLineM[1] && !/^--$/.test(feeLineM[1].trim())) {
    const feeParsed = parseManagementFeeText(feeLineM[1]);
    if (feeParsed.amount !== null) {
      parsedFields.managementFeeRaw = feeParsed.raw;
      parsedFields.managementFeeAmount = feeParsed.amount;
      parsedFields.managementFeePeriod = feeParsed.period;
      parsedFields.managementFee = feeParsed.monthlyAvg;
      fieldStatus.managementFee = feeParsed.monthlyAvg !== null ? 'recorded' : 'pending';
      fieldStatus.managementFeePeriod = feeParsed.period !== 'unknown' ? 'recorded' : 'pending';
      evidenceSummaries.managementFee = `591 管理費欄原文：「${feeLineM[0].trim()}」`;
    }
  }

  // 車位：e.g. `車位：14.366坪，平面式，已含售金內`
  const parkLineM = primarySection.match(/車位[\s：:]+([^\n]+)/);
  if (parkLineM && parkLineM[1] && !/^無/.test(parkLineM[1].trim())) {
    const pText = parkLineM[1].trim();
    if (/坪|平面|機械|含售金/.test(pText)) {
      setField('hasParking', true, 'recorded', `591 車位欄：「${parkLineM[0].trim()}」`);
      const pAreaM = pText.match(/([\d.]+)\s*坪/);
      if (pAreaM) {
        setField('parkingArea', Number(pAreaM[1]), 'recorded', `591 車位欄：「${parkLineM[0].trim()}」`);
        setField('parkingAreaIncludedInCommon', false, 'recorded', `591 車位欄獨立載明 ${pAreaM[1]} 坪`);
      }
      if (/已含售金內|含於總價/.test(pText)) {
        setField('parkingIncluded', true, 'recorded', `591 車位欄：「${parkLineM[0].trim()}」`);
      }
      if (/坡道\s*平面/.test(pText)) {
        setField('parkingType', '坡道平面', 'recorded', `591 車位欄：「${parkLineM[0].trim()}」`);
      } else if (/平面式|平面/.test(pText)) {
        setField('parkingType', '平面式', 'recorded', `591 車位欄：「${parkLineM[0].trim()}」`);
      } else if (/坡道\s*機械/.test(pText)) {
        setField('parkingType', '坡道機械', 'recorded', `591 車位欄：「${parkLineM[0].trim()}」`);
      } else if (/機械/.test(pText)) {
        setField('parkingType', '機械機械', 'recorded', `591 車位欄：「${parkLineM[0].trim()}」`);
      }
    }
  }

  // Extract 屋況特色 text (clean snippet for AI gap filling, strictly inside targetZoneEnd!)
  const featureIdx = primarySection.indexOf('屋況特色');
  const featureSlice =
    featureIdx >= 0
      ? primarySection.slice(featureIdx, featureIdx + 1000)
      : primarySection.slice(0, 1000);

  const slimAiSnippet = [
    `來源：591 房屋交易 (編號：${listingId || '未知'})`,
    parsedFields.caseName ? `案名：${parsedFields.caseName}` : '',
    parsedFields.cityDistrict ? `縣市區：${parsedFields.cityDistrict}` : '',
    parsedFields.askingPrice ? `開價：${parsedFields.askingPrice} 萬` : '',
    parsedFields.totalArea ? `權狀總坪：${parsedFields.totalArea} 坪` : '',
    parsedFields.mainArea ? `主建物：${parsedFields.mainArea} 坪` : '',
    featureSlice,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 1500);

  // Check if feature text might contain missing layout rooms/livingRooms/bathrooms or floor/age not statically in DOM
  const hasFeatureText = featureIdx >= 0 && featureSlice.length > 40;
  const missingCriticalStatic =
    parsedFields.mainArea == null ||
    !parsedFields.floor ||
    parsedFields.age == null ||
    fieldStatus.layout === 'pending';

  return {
    sourcePlatform: platform,
    sourceListingId: listingId,
    parsedFields,
    fieldStatus,
    evidenceSummaries,
    slimAiSnippet,
    parseConfidence: parsedFields.caseName && parsedFields.askingPrice ? 'medium' : 'low',
    needsAiGapFill: hasFeatureText && missingCriticalStatic,
  };
}

export function parsePortalListingHtml(urlStr: string, rawHtml: string): PortalParseResult {
  const fetchedAt = new Date().toISOString();
  const rawCleanedText = cleanPortalHtml(rawHtml);
  const pageCheck = detectPageTypeAndTarget(urlStr, rawHtml, rawCleanedText);

  if (pageCheck.pageType !== 'single_listing') {
    return {
      pageType: pageCheck.pageType,
      pageTypeReason: pageCheck.reason,
      sourcePlatform: pageCheck.platform,
      sourceListingId: pageCheck.listingId,
      fetchedAt,
      parsedFields: {},
      fieldStatus: {},
      evidenceSummaries: {},
      slimAiSnippet: '',
      rawCleanedText,
      parseConfidence: 'low',
      needsAiGapFill: false,
    };
  }

  if (urlStr.toLowerCase().includes('hbhousing.com.tw')) {
    const hb = parseHbhousingDeterministic(urlStr, rawHtml, rawCleanedText);
    return {
      pageType: 'single_listing',
      pageTypeReason: pageCheck.reason,
      sourcePlatform: hb.sourcePlatform || pageCheck.platform,
      sourceListingId: hb.sourceListingId || pageCheck.listingId,
      fetchedAt,
      parsedFields: hb.parsedFields || {},
      fieldStatus: hb.fieldStatus || {},
      evidenceSummaries: hb.evidenceSummaries || {},
      slimAiSnippet: hb.slimAiSnippet || rawCleanedText.slice(0, 1200),
      rawCleanedText,
      parseConfidence: hb.parseConfidence || 'high',
      needsAiGapFill: Boolean(hb.needsAiGapFill),
    };
  }

  if (urlStr.toLowerCase().includes('591.com.tw')) {
    const f91 = parse591Deterministic(urlStr, rawHtml, rawCleanedText);
    return {
      pageType: 'single_listing',
      pageTypeReason: pageCheck.reason,
      sourcePlatform: f91.sourcePlatform || pageCheck.platform,
      sourceListingId: f91.sourceListingId || pageCheck.listingId,
      fetchedAt,
      parsedFields: f91.parsedFields || {},
      fieldStatus: f91.fieldStatus || {},
      evidenceSummaries: f91.evidenceSummaries || {},
      slimAiSnippet: f91.slimAiSnippet || rawCleanedText.slice(0, 1200),
      rawCleanedText,
      parseConfidence: f91.parseConfidence || 'medium',
      needsAiGapFill: Boolean(f91.needsAiGapFill),
    };
  }

  // Generic JSON-LD extraction for other portals
  const jsonLd = extractJsonLdObjects(rawHtml);
  const parsedFields: Record<string, any> = {
    sourcePlatform: pageCheck.platform,
    sourceListingId: pageCheck.listingId,
    caseId: pageCheck.listingId ? `${pageCheck.platform}-${pageCheck.listingId}` : '',
  };
  const fieldStatus: Record<string, FieldVerificationStatus> = {};
  const evidenceSummaries: Record<string, string> = {};

  const node = jsonLd.find(
    (x) => x && (x.name || x.offers) && String(x['@type'] || '').match(/Product|Residence|Apartment|House/i)
  );
  if (node) {
    if (node.name) {
      parsedFields.caseName = String(node.name).trim();
      fieldStatus.caseName = 'recorded';
      evidenceSummaries.caseName = `結構化標題：「${parsedFields.caseName}」`;
    }
    const rawAddr = flattenPostalAddress(node.address);
    if (rawAddr) {
      const { cityDistrict, remainingAddress } = extractCityDistrictFromText(rawAddr);
      if (cityDistrict) {
        parsedFields.cityDistrict = cityDistrict;
        fieldStatus.cityDistrict = 'recorded';
      }
      parsedFields.address = remainingAddress || rawAddr;
      fieldStatus.address = 'recorded';
      evidenceSummaries.address = `結構化地址：「${rawAddr}」`;
    }
    if (node.offers?.price && Number(node.offers.price) >= 10000) {
      parsedFields.askingPrice = Math.round(Number(node.offers.price) / 10000);
      fieldStatus.askingPrice = 'recorded';
      evidenceSummaries.askingPrice = `結構化開價：${parsedFields.askingPrice} 萬元`;
    }
  }

  return {
    pageType: 'single_listing',
    pageTypeReason: pageCheck.reason,
    sourcePlatform: pageCheck.platform,
    sourceListingId: pageCheck.listingId,
    fetchedAt,
    parsedFields,
    fieldStatus,
    evidenceSummaries,
    slimAiSnippet: rawCleanedText.slice(0, 1500),
    rawCleanedText,
    parseConfidence: parsedFields.caseName ? 'medium' : 'low',
    needsAiGapFill: true,
  };
}

/**
 * Deterministic extractor for pasted listing specification text (e.g. copied from 591/HB browser page)
 * Supports 3房2廳2衛1陽台, 10F/14F or 10樓／14樓, 屋齡5年, 主建物/附屬建物/共有部分, management fee period, parking ownership/type.
 */
export function parsePastedListingTextDeterministic(rawText: string): {
  parsedFields: Record<string, any>;
  fieldStatus: Record<string, FieldVerificationStatus>;
  evidenceSummaries: Record<string, string>;
} {
  const text = (rawText || '').replace(/\r\n/g, '\n');
  const parsedFields: Record<string, any> = {};
  const fieldStatus: Record<string, FieldVerificationStatus> = {};
  const evidenceSummaries: Record<string, string> = {};

  const setField = (key: string, val: any, status: FieldVerificationStatus, quote: string) => {
    parsedFields[key] = val;
    fieldStatus[key] = status;
    evidenceSummaries[key] = quote;
  };

  const fullLayoutM = text.match(
    /(\d+)\s*房(?:\(室\))?\s*(\d+)\s*廳\s*(\d+)\s*衛(?:\s*(\d+)\s*陽台)?/
  );
  if (fullLayoutM) {
    const val = `${fullLayoutM[1]}房${fullLayoutM[2]}廳${fullLayoutM[3]}衛${fullLayoutM[4] ? `${fullLayoutM[4]}陽台` : ''}`;
    setField('layout', val, 'recorded', `貼上文字格局：「${fullLayoutM[0].trim()}」`);
  }

  const floorLineM =
    text.match(/樓層[\s：:]*([^\n]+)/) ||
    text.match(/((?:地下\d+層|B\d+|\d+)\s*(?:樓|F)?\s*[\/／]\s*(?:共\s*)?\d+\s*(?:樓|F))/i);
  if (floorLineM) {
    const rawFloor = (floorLineM[1] || floorLineM[0]).trim();
    const norm = normalizeFloorParts(rawFloor);
    if (norm.floor || norm.floorRaw) {
      setField('floor', norm.floor, 'recorded', `貼上文字樓層：「${norm.floorRaw}」`);
      if (norm.totalFloors) {
        setField('totalFloors', norm.totalFloors, 'recorded', `貼上文字樓層：「${norm.floorRaw}」`);
      }
      parsedFields.floorRaw = norm.floorRaw;
    }
  }

  const ageM = text.match(/屋齡[\s：:]*([\d.]+)\s*年/) || text.match(/(?:^|\s)([\d.]+)\s*年(?=\s*(?:電梯大樓|華廈|透天|公寓|屋齡型態|\n))/);
  if (ageM && Number.isFinite(Number(ageM[1]))) {
    setField('age', Number(ageM[1]), 'recorded', `貼上文字屋齡：「${ageM[0].trim()}」`);
  }

  const totalAreaM = text.match(/(?:權狀(?:總)?坪數|權狀坪|總坪數|建坪)[\s：:]*([\d.]+)\s*坪/);
  if (totalAreaM) {
    setField('totalArea', Number(totalAreaM[1]), 'recorded', `貼上文字總坪：「${totalAreaM[0].trim()}」`);
  }

  const mainAreaM = text.match(/主建物[\s：:]*([\d.]+)\s*坪/);
  if (mainAreaM) {
    setField('mainArea', Number(mainAreaM[1]), 'recorded', `貼上文字主建物：「${mainAreaM[0].trim()}」`);
  }

  const auxAreaM = text.match(/附屬建物[\s：:]*([\d.]+)\s*坪/);
  if (auxAreaM) {
    setField('auxArea', Number(auxAreaM[1]), 'recorded', `貼上文字附屬建物：「${auxAreaM[0].trim()}」`);
  }

  const commonWithParkM = text.match(
    /(?:共有部分|公共設施|公設)[\s：:]*([\d.]+)\s*坪\s*[（(]\s*內含車位\s*([\d.]+)\s*坪\s*[）)]/
  );
  if (commonWithParkM) {
    setField('commonArea', Number(commonWithParkM[1]), 'recorded', `貼上文字共有部分：「${commonWithParkM[0].trim()}」`);
    setField('parkingArea', Number(commonWithParkM[2]), 'recorded', `貼上文字公設內含車位：「${commonWithParkM[0].trim()}」`);
    setField('parkingAreaIncludedInCommon', true, 'recorded', `貼上文字公設內含車位：「${commonWithParkM[0].trim()}」`);
    setField('hasParking', true, 'recorded', `貼上文字公設內含車位：「${commonWithParkM[0].trim()}」`);
  } else {
    const commonM = text.match(/(?:共有部分|公共設施|公設)[\s：:]*([\d.]+)\s*坪/);
    if (commonM) {
      setField('commonArea', Number(commonM[1]), 'recorded', `貼上文字共有部分：「${commonM[0].trim()}」`);
    }
  }

  const feeM = text.match(/管理費[\s：:]*([^\n]+)/);
  if (feeM && feeM[1] && !/^--$/.test(feeM[1].trim())) {
    const parsedFee = parseManagementFeeText(feeM[1]);
    if (parsedFee.amount !== null) {
      parsedFields.managementFeeRaw = parsedFee.raw;
      parsedFields.managementFeeAmount = parsedFee.amount;
      parsedFields.managementFeePeriod = parsedFee.period;
      parsedFields.managementFee = parsedFee.monthlyAvg;
      fieldStatus.managementFee = parsedFee.monthlyAvg !== null ? 'recorded' : 'pending';
      fieldStatus.managementFeePeriod = parsedFee.period !== 'unknown' ? 'recorded' : 'pending';
      evidenceSummaries.managementFee =
        parsedFee.period !== 'unknown' && parsedFee.monthlyAvg !== null
          ? `貼上文字管理費：「${parsedFee.raw}」（換算月均約 ${parsedFee.monthlyAvg.toLocaleString('zh-TW')} 元／月）`
          : `貼上文字管理費：「${parsedFee.raw}」（計費週期待確認）`;
    }
  }

  const typeM = text.match(/(?:建物型態|型態|類型)[\s：:]*(電梯大樓|住宅大樓|華廈|透天別墅|公寓|別墅)/) ||
    text.match(/([\d.]+\s*年\s*(電梯大樓|住宅大樓|華廈|透天別墅|公寓|別墅)\s*(?:屋齡)?型態)/);
  if (typeM) {
    const mapped = mapPropertyTypeToken(typeM[2] || typeM[1]);
    if (mapped) {
      setField('propertyType', mapped, 'recorded', `貼上文字建物型態：「${typeM[0].trim()}」`);
    }
  }

  const parkLineM = text.match(/車位(?!坪數|管理)[\s：:]*([^\n]+)/);
  if (parkLineM && parkLineM[1] && !/^無/.test(parkLineM[1].trim())) {
    const pText = parkLineM[1].trim();
    if (/坪|平面|機械|含售金|含在總價|私有|共有/.test(pText)) {
      setField('hasParking', true, 'recorded', `貼上文字車位：「${parkLineM[0].trim()}」`);
      const paM = pText.match(/([\d.]+)\s*坪/);
      if (paM && parsedFields.parkingArea == null) {
        setField('parkingArea', Number(paM[1]), 'recorded', `貼上文字車位：「${parkLineM[0].trim()}」`);
      }
      if (/已含售金內|含於總價|含車位價/.test(pText)) {
        setField('parkingIncluded', true, 'recorded', `貼上文字車位：「${parkLineM[0].trim()}」`);
      }
      const ownM = pText.match(/(私有|共有|約定專用|獨立產權)/);
      if (ownM) {
        setField('parkingOwnership', ownM[1], 'recorded', `貼上文字車位權屬：「${parkLineM[0].trim()}」`);
      }
      if (/坡道\s*平面/.test(pText)) setField('parkingType', '坡道平面', 'recorded', `貼上文字車位：「${parkLineM[0].trim()}」`);
      else if (/平面式|平面/.test(pText)) setField('parkingType', '平面式', 'recorded', `貼上文字車位：「${parkLineM[0].trim()}」`);
      else if (/坡道\s*機械/.test(pText)) setField('parkingType', '坡道機械', 'recorded', `貼上文字車位：「${parkLineM[0].trim()}」`);
      else if (/機械/.test(pText)) setField('parkingType', '機械機械', 'recorded', `貼上文字車位：「${parkLineM[0].trim()}」`);
    }
  }

  return { parsedFields, fieldStatus, evidenceSummaries };
}

/**
 * 固定可重現測試樣本 (與真實網址實測分開列示)
 */
export const PORTAL_TEST_FIXTURES = {
  hbHalfYearFeeAndOldPrice: {
    url: 'https://www.hbhousing.com.tw/detail?sn=FIXTURE56978',
    html: `
      <html><head><title>明新帝寶華廈 | 住商不動產</title>
      <script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"BreadcrumbList","itemListElement":[
          {"@type":"ListItem","name":"首頁"},{"@type":"ListItem","name":"新竹縣"},{"@type":"ListItem","name":"新竹縣新豐鄉"}
        ]},
        {"@type":"Residence","address":{"@type":"PostalAddress","streetAddress":"新竹縣明新街"}},
        {"@type":"Product","productID":"FIXTURE56978","name":"明新帝寶華廈","offers":{"@type":"Offer","price":"17800000"}}
      ]}
      </script></head><body>
        <div>1,850萬 1,780 萬 (含車位價) 房貸月付約 25,958/月</div>
        <div>3房(室)2廳2衛 建坪 37.2坪 主建物 21.88坪 公共設施 13.28坪 附屬建物 2.04坪 車位坪數 --坪</div>
        <div>屋齡 2.2年 華廈 樓層 5 / 5 車位 私有 管理費 5,582元/半年</div>
        <div>nearby 附近成交 999萬 房貸試算 月付 18,000</div>
      </body></html>
    `,
  },
  hbParkingInsideCommonAndFloor: {
    url: 'https://www.hbhousing.com.tw/detail?sn=FIXTURE60832',
    html: `
      <html><head><title>頭份竹南公園美寓 | 住商不動產</title>
      <script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"BreadcrumbList","itemListElement":[
          {"@type":"ListItem","name":"苗栗縣"},{"@type":"ListItem","name":"苗栗縣頭份市"}
        ]},
        {"@type":"Residence","address":{"@type":"PostalAddress","streetAddress":"苗栗縣銀河三街"}},
        {"@type":"Product","productID":"FIXTURE60832","name":"頭份竹南公園美寓","offers":{"@type":"Offer","price":"10880000"}}
      ]}
      </script></head><body>
        <div>1,168萬 1,088 萬 (含車位價)</div>
        <div>3房(室)2廳2衛 建坪 27.38坪 主建物 12.71坪 公共設施 12.91坪 (內含車位6.22坪) 附屬建物 1.76坪 車位坪數 --坪</div>
        <div>屋齡 9.3年 華廈 樓層 5 / 10 車位 私有, 機械-機械 管理費 1,982元/每月</div>
      </body></html>
    `,
  },
  mapSearchIndexPage: {
    url: 'https://www.pacific.com.tw/Object/MapSearch',
    html: `<html><head><title>地圖找屋 - 買屋、購屋、買房、找房 | 太平洋房屋</title></head><body><div>載入中 共有 筆物件 行政區 總價 坪數 型態 搜尋</div></body></html>`,
  },
  portal591TemplateAndDecoyTags: {
    url: 'https://sale.591.com.tw/home/house/detail/2/99900001.html',
    html: `
      <html><head><title>591測試案件</title>
      <script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"Apartment","sku":"S99900001","name":"測試高鐵三房平車","address":{"@type":"PostalAddress","addressRegion":"新竹縣","addressLocality":"竹北市","streetAddress":"新竹縣竹北市隘口二路"},"floorSize":{"value":49.47,"unitText":"坪"},"numberOfRooms":3,"offers":{"price":31880000}}
      ]}
      </script></head><body>
        <div>\${price} 萬 (含車位價格)</div>
        <div>型態：電梯大樓</div>
        <div>管理費：3<ujodboj></ujodboj>509元/月</div>
        <div>車位：14.3<abcxyz></abcxyz>66坪，平面式，已含售金內</div>
        <div>\${item.name}：\${item.value}</div>
        <div>屋況特色：高鐵前精華地段，大三房採光佳。</div>
      </body></html>
    `,
  },
};
