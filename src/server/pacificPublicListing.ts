const ORIGIN = 'https://www.pacific.com.tw';
const MAX_BODY_BYTES = 512_000;

export type PacificVisibleListing = {
  name: string; address: string; price: string; previousPrice: string; specifications: string;
};
type PublicResult = { status: 'ok'; visible: PacificVisibleListing } |
  { status: 'not_found' | 'unavailable' };

function positive(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
function label(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

// Mirror only public specification fields displayed by the official Object page.
// Never infer zero from an absent value or expose the API's employee/contact fields.
export function mapPacificPublicListing(data: Record<string, unknown>, listingId: string): PublicResult {
  if (data.idx === 0 && !data.saleID && !data.objectName) return { status: 'not_found' };
  if (label(data.saleID) !== listingId || !positive(data.idx) || Number(data.hasSellAndRent) !== 1 ||
      Number(data.objectCate) === 1 || !label(data.objectName) || !positive(data.sellTotalPrice)) {
    return { status: 'unavailable' };
  }
  const company = label(data.company).toUpperCase();
  const floor2 = (value: number) => Math.floor((value + Number.EPSILON) * 100) / 100;
  const area = (key: string) => {
    const number = positive(data[key]);
    return number === null ? null : company === 'PRMS' ? floor2(number * 0.3025) : number;
  };
  const componentKeys = ['mainBuildArea', 'outbuildingArea', 'pubFacilityArea', 'pubStallArea', 'ownerStallArea'];
  const components = componentKeys.map(key => positive(data[key]));
  const rawTotal = componentKeys.every(key => data[key] !== null && data[key] !== undefined && data[key] !== '' &&
      Number.isFinite(Number(data[key])) && Number(data[key]) >= 0)
    ? components.reduce<number>((sum, number) => sum + (number || 0), 0) : null;
  let total: number | null = null;
  if (['SI', 'HB'].includes(company)) total = positive(data.totalArea);
  else if (rawTotal !== null) {
    total = company === 'PRMS' ? floor2(rawTotal * 0.3025) :
      company === 'SMART' ? Math.round(rawTotal * 100) / 100 : floor2(rawTotal);
  }

  const specs: string[] = [];
  const add = (name: string, value: unknown) => { if (label(value)) specs.push(name + '：' + label(value)); };
  if (total !== null && total > 0) add('權狀總坪數', total + '坪');
  for (const [key, title] of [['mainBuildArea', '主建物坪數'], ['outbuildingArea', '附屬建物坪數'], ['pubFacilityArea', '公共設施坪數']]) {
    const value = area(key);
    if (value !== null) add(title, value + '坪');
  }
  if ([data.layoutRoom, data.layoutHall, data.layoutToilet].every(value => positive(value) !== null)) {
    add('格局', `${data.layoutRoom}房${data.layoutHall}廳${data.layoutToilet}衛`);
  }
  add('物件型態', data.attributName);
  if (positive(data.objectAge)) add('屋齡', data.objectAge + '年');
  else if (/^\d+(?:\.\d+)?年/.test(label(data.objectAge))) add('屋齡', data.objectAge);
  const floor = Number(data.onWhichFloor);
  const above = positive(data.buildingAboveFloor);
  if (data.onWhichFloor !== null && data.onWhichFloor !== undefined && data.onWhichFloor !== '' &&
      Number.isInteger(floor) && floor !== -99 && floor !== 0) {
    const max = positive(data.maxFloor);
    const floorLabel = floor < 0 ? 'B' + Math.abs(floor) : String(floor);
    add('樓層', floorLabel + (max && max !== floor ? '-' + max : '') + '樓' + (above ? '/' + above + '樓' : ''));
  } else if (data.onWhichFloor !== null && data.onWhichFloor !== undefined && data.onWhichFloor !== '' &&
      floor === 0 && above) {
    add('樓層', '1-' + above + '樓/' + above + '樓');
  }
  if (Number(data.hasStall) === 2) add('車位', '無車位');
  if (Number(data.hasStall) === 1) {
    // A positive hasStall says a space exists; it does not establish its price or ownership.
    add('車位', label(data.stallTypeName) || '有車位');
  }
  const fee = positive(data.adminFee);
  if (fee !== null) add('管理費', fee + '元' + (label(data.payAdminFeeTypeName) ? '/' + label(data.payAdminFeeTypeName) : ''));
  return {
    status: 'ok',
    visible: {
      name: label(data.objectName),
      address: label(data.address),
      price: label(data.sellTotalPrice) + '萬',
      previousPrice: positive(data.firstSellTotalPrice) ? label(data.firstSellTotalPrice) + '萬' : '',
      specifications: specs.join('\n'),
    },
  };
}

async function readLimitedJson(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new Error('Pacific response too large');
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

export async function readPacificPublicListing(
  listingId: string, publicPageHtml: string, signal: AbortSignal, request: typeof fetch = fetch,
): Promise<PublicResult> {
  if (!/^[A-Z]{0,3}\d{5,}$/.test(listingId) || signal.aborted) return { status: 'unavailable' };
  // This header is published in the same public HTML for the site's own Angular client.
  // Read it per request, never persist it or forward application/member credentials.
  const baseTag = publicPageHtml.match(/<base\b(?=[^>]*\bid=["']baseAuthorization["'])[^>]*>/i)?.[0];
  const authorization = baseTag?.match(/\bhref=["']([^"']*)["']/i)?.[1];
  if (!authorization || authorization.length > 4096 || /[\r\n]/.test(authorization)) return { status: 'unavailable' };
  try {
    const response = await request(ORIGIN + '/api/ObjectAPI/GetObjectDetail/' + encodeURIComponent(listingId), {
      headers: { Accept: 'application/json', Authorization: authorization },
      signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
      redirect: 'error',
    });
    if (!response.ok || !/application\/json/i.test(response.headers.get('content-type') || '')) return { status: 'unavailable' };
    const data = await readLimitedJson(response);
    if (!data || Array.isArray(data) || typeof data !== 'object') return { status: 'unavailable' };
    return mapPacificPublicListing(data as Record<string, unknown>, listingId);
  } catch {
    return { status: 'unavailable' };
  }
}

