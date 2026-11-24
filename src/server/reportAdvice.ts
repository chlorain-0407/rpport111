// AI drafts are advice; the application has no workflow authorizing service promises.
export const REPORT_ADVICE_RULE = '不得代替經紀人、顧問或公司承諾交付時程、案例數量、聯絡客戶或保證結果（例如「顧問將於48小時內提供3-5筆案例」）。後續行動一律以「建議」表達，具體執行內容與時程須由經紀人另行確認。';

export function sanitizeAiAdvice(text: string): string {
  return text.replace(
    /(?:顧問|經紀人|承辦人|本公司|本團隊|我們|我方)(?:將|會|承諾|保證)[^。！？\n]{0,240}|(?:將於|保證於)[^。！？\n]{0,240}/g,
    '建議與經紀人確認後續工作項目、交付內容與回覆時程',
  );
}

export function sanitizeGeneratedAdvice<T>(value: T): T {
  if (typeof value === 'string') return sanitizeAiAdvice(value) as T;
  if (Array.isArray(value)) return value.map(sanitizeGeneratedAdvice) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeGeneratedAdvice(item)])) as T;
  }
  return value;
}

