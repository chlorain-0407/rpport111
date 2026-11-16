import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { getDb, initDbIndexes } from './src/server/db';
import {
  DEMO_PROPERTIES,
  DEFAULT_BROKER,
} from './src/utils/mockData';
import {
  calculateUnitPrice,
  calculatePublicRatio,
  calculateBudgetComparison,
  calculatePropertyCompleteness,
  computeManagementFeeMonthly,
  formatManagementFee,
  formatWan,
  formatPing,
  formatLayout,
  formatFloor,
  normalizeLayoutInput,
  isPartialLayout,
} from './src/utils/calculator';
import {
  parsePortalListingHtml,
  flattenPostalAddress,
  cleanPortalHtml,
  detectPageTypeAndTarget,
  parsePastedListingTextDeterministic,
} from './src/server/portalParsers';
import {
  normalizeReportFontScale,
  type ReportSourceEntry,
  type ComputedReportMetrics,
} from './src/types/report';
import type { FieldVerificationStatus } from './src/types/property';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProd = process.env.NODE_ENV === 'production';
const port = isProd ? Number(process.env.PORT) || 8080 : 3000;

const app = express();
app.use(express.json({ limit: '25mb' }));

// Primary & compatible fallback model per @google/genai skill guidelines
const PRIMARY_AI_MODEL = 'gemini-4-hydrogen';
const FALLBACK_AI_MODEL = 'gemini-3.1-flash-lite';

// In-flight deduplication map keyed by requestId
const inFlightReportGenerations = new Map<string, Promise<any>>();

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    hasApiKey: !!process.env.GEMINI_API_KEY,
    hasMongoUri: !!process.env.MONGODB_URI,
    isProd,
    port,
  });
});

// Initialize server-side Gemini client as per @google/genai guidelines
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (apiKey) {
  ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// -----------------------------------------------------------------------------
// Helpers: SSRF check, Data Normalization (preserving null vs 0), Privacy
// -----------------------------------------------------------------------------
function isSafeUrl(rawUrl: string): { safe: boolean; reason?: string } {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { safe: false, reason: '僅支援 HTTP 或 HTTPS 通訊協定' };
    }
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '169.254.169.254' ||
      hostname === '::1' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      return { safe: false, reason: '禁止存取本機、私有區域網路或雲端中繼資料端點' };
    }
    return { safe: true };
  } catch {
    return { safe: false, reason: '無效的 URL 網址格式' };
  }
}

function parseOptionalNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[^\d.-]/g, '').trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeLayout(layout: any): string {
  return normalizeLayoutInput(layout);
}

function normalizeProperty(p: any): any {
  if (!p || typeof p !== 'object') return p;

  const existingStatus: Record<string, any> =
    p.fieldStatus && typeof p.fieldStatus === 'object' ? { ...p.fieldStatus } : {};

  const caseName =
    (p.caseName ?? p.title ?? p.communityName ?? p.name ?? p.buildingName ?? '')
      .toString()
      .trim();

  // Fix legacy "[object Object]" or structured PostalAddress objects
  const address = flattenPostalAddress(p.address);

  // Legacy DB bug heuristic (e.g. WEB-6898): imported URL docs stored unknown numbers as 0 while status was pending
  const looksLikeLegacyZeroImport =
    Number(p.askingPrice) === 0 &&
    Number(p.totalArea) === 0 &&
    Number(p.mainArea) === 0 &&
    (existingStatus.askingPrice === 'pending' || existingStatus.totalArea === 'pending');

  const parseNumRespectingPending = (rawVal: unknown, fieldKey: string): number | null => {
    const n = parseOptionalNumber(rawVal);
    if (n === 0 && existingStatus[fieldKey] !== 'verified') {
      if (existingStatus[fieldKey] === 'pending' || looksLikeLegacyZeroImport) {
        return null;
      }
      // For real estate core prices/areas, 0 on unverified import without explicit verified/not_applicable means unknown
      if (['askingPrice', 'totalArea', 'mainArea', 'age'].includes(fieldKey) && !existingStatus[fieldKey]) {
        return null;
      }
    }
    return n;
  };

  const askingPrice = parseNumRespectingPending(
    p.askingPrice ?? p.totalPrice ?? p.price ?? p.asking_price,
    'askingPrice'
  );
  const previousAskingPrice = parseOptionalNumber(p.previousAskingPrice);
  const totalArea = parseNumRespectingPending(
    p.totalArea ?? p.buildingArea ?? p.area ?? p.total_area ?? p.ping,
    'totalArea'
  );
  const mainArea = parseNumRespectingPending(p.mainArea ?? p.main_area ?? p.indoorArea, 'mainArea');
  const auxArea = parseNumRespectingPending(
    p.auxArea ?? p.auxiliaryArea ?? p.aux_area ?? p.balconyArea,
    'auxArea'
  );
  const commonArea = parseNumRespectingPending(p.commonArea ?? p.publicArea ?? p.common_area, 'commonArea');
  const parkingPrice = parseNumRespectingPending(p.parkingPrice ?? p.parking_price, 'parkingPrice');
  const parkingArea = parseNumRespectingPending(p.parkingArea ?? p.parking_area, 'parkingArea');
  const age = parseNumRespectingPending(p.age ?? p.buildingAge ?? p.houseAge, 'age');
  const reservePrice = parseOptionalNumber(p.reservePrice);

  // Management fee normalization (amount + period + conditional monthly average)
  const managementFeeAmount = parseOptionalNumber(p.managementFeeAmount);
  const managementFeePeriod = (p.managementFeePeriod ?? '').toString().trim();
  const managementFeeRaw = (p.managementFeeRaw ?? '').toString().trim();
  let managementFee = parseNumRespectingPending(p.managementFee ?? p.manageFee, 'managementFee');
  if (managementFeeAmount !== null && managementFeePeriod) {
    managementFee = computeManagementFeeMonthly(managementFeeAmount, managementFeePeriod);
  } else if (managementFeePeriod === 'unknown') {
    managementFee = null;
  }

  let cityDistrict = (p.cityDistrict ?? '').toString().trim();
  if (cityDistrict === '[object Object]') cityDistrict = '';
  if (!cityDistrict && (p.city || p.district)) {
    cityDistrict = `${p.city || ''}${p.district || ''}`.trim();
  }

  let floor =
    p.floor != null
      ? typeof p.floor === 'object'
        ? String(p.floor.current || p.floor.floor || '')
        : String(p.floor)
      : '';
  let totalFloors = p.totalFloors ?? p.totalFloor ?? p.total_floors ?? '';
  if (typeof totalFloors === 'object') totalFloors = String(totalFloors?.total || '');
  else totalFloors = String(totalFloors || '');
  const floorRaw = (p.floorRaw ?? '').toString().trim();

  let parkingIncluded: boolean | null = null;
  if (typeof p.parkingIncluded === 'boolean') {
    parkingIncluded = p.parkingIncluded;
  }

  const parkingType = (p.parkingType ?? p.parkingSpace ?? '').toString().trim();
  let hasParking: boolean | null = typeof p.hasParking === 'boolean' ? p.hasParking : null;
  if (hasParking === null) {
    if (parkingType === '無車位') hasParking = false;
    else if (parkingType || parkingIncluded === true || (parkingArea !== null && parkingArea > 0) || p.parkingOwnership) {
      hasParking = true;
    }
  }

  const parkingAreaIncludedInCommon: boolean | null =
    typeof p.parkingAreaIncludedInCommon === 'boolean' ? p.parkingAreaIncludedInCommon : null;

  return {
    ...p,
    caseName,
    cityDistrict,
    address,
    propertyType: (p.propertyType ?? p.buildingType ?? '').toString().trim(),
    askingPrice,
    previousAskingPrice,
    hasParking,
    parkingIncluded,
    totalArea,
    mainArea,
    auxArea,
    commonArea,
    parkingArea,
    parkingAreaIncludedInCommon,
    parkingPrice,
    parkingType,
    parkingOwnership: (p.parkingOwnership ?? '').toString().trim(),
    layout: normalizeLayout(p.layout),
    floor: floor.trim(),
    totalFloors: totalFloors.trim(),
    floorRaw,
    age,
    managementFee,
    managementFeeAmount,
    managementFeePeriod,
    managementFeeRaw,
    reservePrice,
    currentUsage: (p.currentUsage ?? '').toString().trim(),
    photos: Array.isArray(p.photos) ? p.photos : [],
    internalNotes: (p.internalNotes ?? '').toString(),
    fieldStatus: existingStatus,
    evidenceSummaries:
      p.evidenceSummaries && typeof p.evidenceSummaries === 'object' ? p.evidenceSummaries : {},
    conflicts: Array.isArray(p.conflicts) ? p.conflicts : [],
    sourcePlatform: (p.sourcePlatform ?? '').toString().trim(),
    sourceListingId: (p.sourceListingId ?? '').toString().trim(),
    fetchedAt: p.fetchedAt || undefined,
  };
}

function evaluateReportReReview(report: any): any {
  if (!report || typeof report !== 'object') return report;
  const reasons: string[] = [];
  const comps = Array.isArray(report.comparables) ? report.comparables : [];
  const isValuation = report.subType !== 'progress';

  if (isValuation && comps.length === 0) {
    const allText = [
      report.summary || '',
      ...(Array.isArray(report.sections)
        ? report.sections.map((s: any) => `${s.contentMarkdown || ''} ${(s.facts || []).join(' ')}`)
        : []),
    ].join('\n');

    if (
      /議價空間|建議成交區間|成交單價.*?\d+\s*[–\-~至]\s*\d+\s*萬|車位(?:行情|約)\s*\d+/.test(allText) ||
      /\d+\s*[–\-~]\s*\d+\s*萬\/坪/.test(allText)
    ) {
      reasons.push('此報告目前可比成交案例為 0 筆，但內文含推估單價區間或議價空間，建議重新審閱核對後再對外提供。');
    }
  }

  return {
    ...report,
    layoutSettings: {
      fontScale: normalizeReportFontScale(report?.layoutSettings?.fontScale),
    },
    propertySnapshot: report.propertySnapshot ? normalizeProperty(report.propertySnapshot) : report.propertySnapshot,
    needsReReview: reasons.length > 0,
    reReviewReasons: reasons,
  };
}

function stripConfidentialFieldsFromReport(report: any): any {
  if (!report || typeof report !== 'object') return report;
  const cloned = JSON.parse(JSON.stringify(report));

  if (cloned.propertySnapshot && typeof cloned.propertySnapshot === 'object') {
    delete cloned.propertySnapshot.reservePrice;
    delete cloned.propertySnapshot.internalNotes;
  }
  if (cloned.buyerRequirements && typeof cloned.buyerRequirements === 'object') {
    delete cloned.buyerRequirements.buyerContact;
    delete cloned.buyerRequirements.privateNotes;
  }
  return cloned;
}

// -----------------------------------------------------------------------------
// Unified Resilient Gemini AI Caller (Timeout + Bounded 503 Retries + Classifier)
// -----------------------------------------------------------------------------
type AiErrorCode =
  | 'AI_TIMEOUT'
  | 'AI_UNAVAILABLE'
  | 'AI_QUOTA'
  | 'AI_CONFIG'
  | 'AI_VALIDATION'
  | 'AI_ABORTED'
  | 'AI_UNKNOWN';

class ClassifiedAiError extends Error {
  code: AiErrorCode;
  httpStatus: number;
  userMessage: string;

  constructor(code: AiErrorCode, httpStatus: number, userMessage: string) {
    super(userMessage);
    this.code = code;
    this.httpStatus = httpStatus;
    this.userMessage = userMessage;
  }
}

function classifyAiError(err: any): ClassifiedAiError {
  if (err instanceof ClassifiedAiError) return err;

  const msg = String(err?.message || '').toLowerCase();
  const status = Number(err?.status || err?.code || 0);

  if (err?.name === 'AbortError' || msg.includes('abort')) {
    if (msg.includes('timeout') || msg.includes('逾時')) {
      return new ClassifiedAiError(
        'AI_TIMEOUT',
        504,
        'AI 服務回應逾時，系統已自動停止等待並保留您的輸入，請重試或改以手動編輯。'
      );
    }
    return new ClassifiedAiError('AI_ABORTED', 499, '已取消目前的 AI 請求。');
  }

  if (status === 503 || msg.includes('503') || msg.includes('unavailable') || msg.includes('overloaded')) {
    return new ClassifiedAiError(
      'AI_UNAVAILABLE',
      503,
      'AI 服務暫時忙碌（503），系統已自動重試但仍未能連線，您的草稿已保留，請稍後再試。'
    );
  }

  if (status === 429 || msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted')) {
    return new ClassifiedAiError(
      'AI_QUOTA',
      429,
      'AI 服務目前請求額度受限（429），請稍候片刻再重試。'
    );
  }

  if (
    status === 401 ||
    status === 403 ||
    msg.includes('api key') ||
    msg.includes('permission') ||
    msg.includes('unauthorized') ||
    msg.includes('not set')
  ) {
    return new ClassifiedAiError(
      'AI_CONFIG',
      500,
      'AI 服務金鑰或權限設定異常，無法完成呼叫，請確認伺服器設定。'
    );
  }

  if (msg.includes('json') || msg.includes('schema') || msg.includes('validation') || msg.includes('欄位')) {
    return new ClassifiedAiError(
      'AI_VALIDATION',
      502,
      'AI 回傳內容格式未通過系統欄位檢核，已保護原有資料不被覆寫，請重新嘗試。'
    );
  }

  return new ClassifiedAiError(
    'AI_UNKNOWN',
    502,
    'AI 分析服務目前發生異常，您的輸入內容已保留，請稍後重試或切換手動編輯。'
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGeminiWithResilience(options: {
  contents: any;
  config?: Record<string, any>;
  timeoutMs?: number;
  perAttemptTimeoutMs?: number;
  max503Retries?: number;
  allowFallbackModel?: boolean;
  externalSignal?: AbortSignal;
  testMode?: string | null;
}): Promise<{ text: string; modelUsed: string; retriedCount: number }> {
  const {
    contents,
    config = {},
    timeoutMs = 35000,
    perAttemptTimeoutMs,
    max503Retries = 2,
    allowFallbackModel = true,
    externalSignal,
    testMode,
  } = options;

  // Deterministic non-prod test double hook for verifying 503/timeout/bad JSON
  if (!isProd && testMode) {
    if (testMode === '503') {
      const fakeErr: any = new Error('503 UNAVAILABLE');
      fakeErr.status = 503;
      throw classifyAiError(fakeErr);
    }
    if (testMode === 'timeout') {
      throw new ClassifiedAiError(
        'AI_TIMEOUT',
        504,
        'AI 服務回應逾時，系統已自動停止等待並保留您的輸入，請重試或改以手動編輯。'
      );
    }
    if (testMode === '429') {
      const fakeErr: any = new Error('429 RESOURCE_EXHAUSTED');
      fakeErr.status = 429;
      throw classifyAiError(fakeErr);
    }
    if (testMode === 'bad_json') {
      return { text: 'NOT_VALID_JSON_RESPONSE', modelUsed: PRIMARY_AI_MODEL, retriedCount: 0 };
    }
  }

  if (!ai) {
    throw new ClassifiedAiError(
      'AI_CONFIG',
      500,
      '伺服器尚未設定 GEMINI_API_KEY，無法呼叫 AI 分析服務。'
    );
  }

  const deadline = Date.now() + timeoutMs;
  const modelsToTry = allowFallbackModel
    ? [PRIMARY_AI_MODEL, FALLBACK_AI_MODEL]
    : [PRIMARY_AI_MODEL];

  let lastErr: any = null;
  let retriedCount = 0;

  for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
    const model = modelsToTry[mIdx];
    const attemptsForModel = mIdx === 0 ? max503Retries + 1 : 1;

    for (let attempt = 0; attempt < attemptsForModel; attempt++) {
      if (externalSignal?.aborted) {
        throw new ClassifiedAiError('AI_ABORTED', 499, '使用者已取消本次 AI 請求。');
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 300) {
        throw new ClassifiedAiError(
          'AI_TIMEOUT',
          504,
          'AI 服務回應逾時，系統已自動停止等待並保留您的輸入，請重試或改以手動編輯。'
        );
      }

      const attemptBudgetMs =
        mIdx === 0 && perAttemptTimeoutMs
          ? Math.min(remainingMs, perAttemptTimeoutMs)
          : remainingMs;

      const attemptController = new AbortController();
      const timer = setTimeout(() => attemptController.abort('timeout'), attemptBudgetMs);
      const onExternalAbort = () => attemptController.abort('client_aborted');
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

      try {
        const modelDefaults = model.startsWith('gemini-4')
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : {};
        const generatePromise = ai.models.generateContent({
          model,
          contents,
          config: {
            ...modelDefaults,
            ...config,
            abortSignal: attemptController.signal,
          },
        });

        const timeoutPromise = new Promise<never>((_resolve, reject) => {
          attemptController.signal.addEventListener(
            'abort',
            () => {
              const reason = attemptController.signal.reason;
              const err = new Error(reason === 'timeout' ? 'timeout' : 'aborted');
              err.name = 'AbortError';
              reject(err);
            },
            { once: true }
          );
        });

        const response = await Promise.race([generatePromise, timeoutPromise]);
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', onExternalAbort);

        return {
          text: response.text || '',
          modelUsed: model,
          retriedCount,
        };
      } catch (err: any) {
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', onExternalAbort);
        lastErr = err;

        const classified = classifyAiError(err);
        // If primary model timed out or hit quota (429) and we still have budget + a fallback model, try fallback
        if (
          (classified.code === 'AI_TIMEOUT' || classified.code === 'AI_QUOTA') &&
          mIdx + 1 < modelsToTry.length &&
          deadline - Date.now() >= 4000
        ) {
          retriedCount += 1;
          console.warn(`[AI Fallback] Model ${model} hit ${classified.code}, switching to ${modelsToTry[mIdx + 1]}`);
          break;
        }

        // Do not retry client cancellation, timeout (with no fallback budget), config, or quota (with no fallback) errors
        if (
          classified.code === 'AI_ABORTED' ||
          classified.code === 'AI_TIMEOUT' ||
          classified.code === 'AI_CONFIG' ||
          classified.code === 'AI_QUOTA'
        ) {
          throw classified;
        }

        const isTransient = classified.code === 'AI_UNAVAILABLE';
        const hasMoreAttempts = attempt + 1 < attemptsForModel || mIdx + 1 < modelsToTry.length;

        if (isTransient && hasMoreAttempts) {
          retriedCount += 1;
          const backoff = Math.min(600 * Math.pow(2, attempt), Math.max(0, deadline - Date.now() - 500));
          if (backoff > 100) {
            await sleep(backoff);
            continue;
          }
        }

        if (!isTransient) {
          throw classified;
        }
      }
    }
  }

  throw classifyAiError(lastErr);
}

// -----------------------------------------------------------------------------
// MongoDB Health & Connection Status
// -----------------------------------------------------------------------------
app.get('/api/database/status', async (_req: Request, res: Response) => {
  const hasUri = !!process.env.MONGODB_URI;
  if (!hasUri) {
    res.json({
      configured: false,
      connected: false,
      statusText: '環境變數 MONGODB_URI 尚未設定',
      database: '',
    });
    return;
  }

  try {
    const start = Date.now();
    const db = await getDb();
    await db.command({ ping: 1 });
    const latencyMs = Date.now() - start;

    const [propCount, reportCount] = await Promise.all([
      db.collection('properties').countDocuments(),
      db.collection('reports').countDocuments(),
    ]);

    res.json({
      configured: true,
      connected: true,
      statusText: '已連線至專屬 MongoDB 資料庫 (e8346c_report)',
      database: 'e8346c_report',
      latencyMs,
      collections: {
        properties: propCount,
        reports: reportCount,
      },
    });
  } catch (err: any) {
    console.error('[MongoDB Status Error]:', err.message);
    res.status(500).json({
      configured: true,
      connected: false,
      statusText: 'MongoDB 連線逾時或認證失敗',
      message: '無法連線至指定資料庫，請檢查伺服器網路或憑證設定',
    });
  }
});

// Seed Initial Taiwanese Property and Profile Data if empty
app.post('/api/database/seed', async (req: Request, res: Response) => {
  const { force } = req.body || {};
  try {
    const db = await getDb();
    const propCount = await db.collection('properties').countDocuments();

    if (propCount > 0 && !force) {
      res.json({ success: true, message: '資料庫已有物件資料，略過初始化', count: propCount });
      return;
    }

    if (force) {
      await db.collection('properties').deleteMany({});
      await db.collection('profiles').deleteMany({});
    }

    const now = new Date();
    const seededProps = DEMO_PROPERTIES.map((p) => ({
      ...p,
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    }));

    await db.collection('properties').insertMany(seededProps);

    // Seed default broker profile
    await db.collection('profiles').updateOne(
      { key: 'default_broker' },
      {
        $set: {
          key: 'default_broker',
          ...DEFAULT_BROKER,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );

    res.json({
      success: true,
      message: '已成功初始化成屋示範物件與經紀人設定至 MongoDB 資料庫',
      count: seededProps.length,
    });
  } catch (err: any) {
    console.error('[MongoDB Seed Error]:', err.message);
    res.status(500).json({ error: '初始化資料庫失敗，請確認資料庫狀態' });
  }
});

// -----------------------------------------------------------------------------
// Properties CRUD (Stored exclusively in MongoDB)
// -----------------------------------------------------------------------------
app.get('/api/properties', async (_req: Request, res: Response) => {
  if (!process.env.MONGODB_URI) {
    res.json(DEMO_PROPERTIES);
    return;
  }
  try {
    const db = await getDb();
    const properties = await db
      .collection('properties')
      .find({})
      .sort({ updatedAt: -1 })
      .toArray();

    const sanitized = properties.map((p) => {
      const { _id, ...rest } = p;
      return normalizeProperty(rest);
    });

    res.json(sanitized.length > 0 ? sanitized : DEMO_PROPERTIES.map(normalizeProperty));
  } catch (err: any) {
    console.error('[Get Properties Error]:', err.message);
    res.json(DEMO_PROPERTIES.map(normalizeProperty));
  }
});

app.get('/api/properties/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const db = await getDb();
    const property = await db.collection('properties').findOne({ id });
    if (!property) {
      res.status(404).json({ error: '找不到指定物件' });
      return;
    }
    const { _id, ...rest } = property;
    res.json(normalizeProperty(rest));
  } catch (err: any) {
    console.error('[Get Property Error]:', err.message);
    res.status(500).json({ error: '讀取物件詳情失敗' });
  }
});

app.post('/api/properties', async (req: Request, res: Response) => {
  const propertyData = req.body;
  if (!propertyData || !propertyData.caseName) {
    res.status(400).json({ error: '物件資料不完整，必須包含案名' });
    return;
  }

  try {
    const db = await getDb();
    const now = new Date();
    const propId = propertyData.id || `prop-${Date.now()}`;
    const newDoc = normalizeProperty({
      ...propertyData,
      id: propId,
      createdAt: propertyData.createdAt ? new Date(propertyData.createdAt) : now,
      updatedAt: now,
    });

    await db.collection('properties').updateOne(
      { id: propId },
      { $set: newDoc },
      { upsert: true }
    );

    res.json({ success: true, property: newDoc });
  } catch (err: any) {
    console.error('[Save Property Error]:', err.message);
    res.status(500).json({ error: '儲存物件資料失敗' });
  }
});

app.put('/api/properties/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const updates = req.body;
  try {
    const db = await getDb();
    const now = new Date();
    const normalizedUpdates = normalizeProperty({
      ...updates,
      id,
      updatedAt: now,
    });
    const { _id, ...safeSet } = normalizedUpdates;
    const result = await db.collection('properties').updateOne(
      { id },
      { $set: safeSet }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ error: '找不到指定更新物件' });
      return;
    }

    res.json({ success: true, message: '物件更新成功', property: safeSet });
  } catch (err: any) {
    console.error('[Update Property Error]:', err.message);
    res.status(500).json({ error: '更新物件失敗' });
  }
});

app.delete('/api/properties/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const db = await getDb();
    await Promise.all([
      db.collection('properties').deleteOne({ id }),
      db.collection('reports').deleteMany({ propertyId: id }),
      db.collection('owner_progress').deleteMany({ propertyId: id }),
      db.collection('buyer_profiles').deleteMany({ propertyId: id }),
      db.collection('comparables').deleteMany({ propertyId: id }),
      db.collection('competing_listings').deleteMany({ propertyId: id }),
    ]);
    res.json({ success: true, message: '已成功刪除物件及關聯報告與紀錄' });
  } catch (err: any) {
    console.error('[Delete Property Error]:', err.message);
    res.status(500).json({ error: '刪除物件失敗' });
  }
});

// -----------------------------------------------------------------------------
// Owner Sales Progress CRUD (Strictly scoped by propertyId + periodStart + periodEnd)
// -----------------------------------------------------------------------------
app.get('/api/properties/:id/progress', async (req: Request, res: Response) => {
  const { id: propertyId } = req.params;
  const periodStart = typeof req.query.periodStart === 'string' ? req.query.periodStart.trim() : '';
  const periodEnd = typeof req.query.periodEnd === 'string' ? req.query.periodEnd.trim() : '';

  if (periodStart && periodEnd && periodStart > periodEnd) {
    res.status(400).json({ error: '回報截止日不可早於回報起始日' });
    return;
  }

  try {
    const db = await getDb();
    const prop = await db.collection('properties').findOne({ id: propertyId });
    if (!prop) {
      res.status(404).json({ error: '找不到指定物件，無法讀取銷售進度' });
      return;
    }

    if (periodStart && periodEnd) {
      const record = await db.collection('owner_progress').findOne({
        propertyId,
        periodStart,
        periodEnd,
      });

      if (!record) {
        res.json({
          exists: false,
          propertyId,
          record: {
            propertyId,
            periodStart,
            periodEnd,
            onlineImpressions: null,
            inquiryCount: null,
            showingCount: null,
            anonymousFeedback: [],
            completedActions: [],
            nextPlannedActions: [],
            isDemo: false,
          },
        });
        return;
      }

      const { _id, ...rest } = record;
      res.json({ exists: true, propertyId, record: rest });
      return;
    }

    const records = await db
      .collection('owner_progress')
      .find({ propertyId })
      .sort({ periodEnd: -1, updatedAt: -1 })
      .toArray();

    res.json({
      propertyId,
      records: records.map(({ _id, ...rest }) => rest),
    });
  } catch (err: any) {
    console.error('[Get Owner Progress Error]:', err.message);
    res.status(500).json({ error: '讀取銷售進度失敗' });
  }
});

app.put('/api/properties/:id/progress', async (req: Request, res: Response) => {
  const { id: propertyId } = req.params;
  const body = req.body || {};

  if (body.propertyId && body.propertyId !== propertyId) {
    res.status(400).json({ error: '進度資料與目標物件 ID 不符，已拒絕跨案寫入' });
    return;
  }

  const periodStart = String(body.periodStart || '').trim();
  const periodEnd = String(body.periodEnd || '').trim();
  if (!periodStart || !periodEnd) {
    res.status(400).json({ error: '請選擇回報起始日與截止日' });
    return;
  }
  if (periodStart > periodEnd) {
    res.status(400).json({ error: '回報截止日不可早於回報起始日' });
    return;
  }

  try {
    const db = await getDb();
    const prop = await db.collection('properties').findOne({ id: propertyId });
    if (!prop) {
      res.status(404).json({ error: '找不到指定物件，無法儲存銷售進度' });
      return;
    }

    const onlineImpressions = parseOptionalNumber(body.onlineImpressions);
    const inquiryCount = parseOptionalNumber(body.inquiryCount);
    const showingCount = parseOptionalNumber(body.showingCount);

    if (
      (onlineImpressions !== null && onlineImpressions < 0) ||
      (inquiryCount !== null && inquiryCount < 0) ||
      (showingCount !== null && showingCount < 0)
    ) {
      res.status(400).json({ error: '曝光數、詢問數與帶看組數不可為負數' });
      return;
    }

    const now = new Date().toISOString();
    const doc = {
      id: body.id || `prog-${propertyId}-${periodStart}-${periodEnd}`,
      propertyId,
      periodStart,
      periodEnd,
      onlineImpressions,
      inquiryCount,
      showingCount,
      anonymousFeedback: Array.isArray(body.anonymousFeedback) ? body.anonymousFeedback : [],
      completedActions: Array.isArray(body.completedActions) ? body.completedActions : [],
      nextPlannedActions: Array.isArray(body.nextPlannedActions) ? body.nextPlannedActions : [],
      isDemo: Boolean(body.isDemo),
      updatedAt: now,
    };

    await db.collection('owner_progress').updateOne(
      { propertyId, periodStart, periodEnd },
      { $set: doc },
      { upsert: true }
    );

    res.json({ success: true, record: doc });
  } catch (err: any) {
    console.error('[Save Owner Progress Error]:', err.message);
    res.status(500).json({ error: '儲存銷售進度失敗' });
  }
});

// -----------------------------------------------------------------------------
// Buyer Requirements CRUD (Strictly scoped by propertyId + buyerId)
// -----------------------------------------------------------------------------
app.get('/api/properties/:id/buyers', async (req: Request, res: Response) => {
  const { id: propertyId } = req.params;
  try {
    const db = await getDb();
    const buyers = await db
      .collection('buyer_profiles')
      .find({ propertyId })
      .sort({ updatedAt: -1 })
      .toArray();
    res.json({
      propertyId,
      buyers: buyers.map(({ _id, ...rest }) => rest),
    });
  } catch (err: any) {
    console.error('[Get Buyers Error]:', err.message);
    res.status(500).json({ error: '讀取買方需求失敗' });
  }
});

app.put('/api/properties/:id/buyers/:buyerId', async (req: Request, res: Response) => {
  const { id: propertyId, buyerId } = req.params;
  const body = req.body || {};

  if (body.propertyId && body.propertyId !== propertyId) {
    res.status(400).json({ error: '買方資料與目標物件 ID 不符' });
    return;
  }

  try {
    const db = await getDb();
    const prop = await db.collection('properties').findOne({ id: propertyId });
    if (!prop) {
      res.status(404).json({ error: '找不到指定物件' });
      return;
    }

    const budgetMin = parseOptionalNumber(body.budgetMin);
    const budgetMax = parseOptionalNumber(body.budgetMax);
    if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) {
      res.status(400).json({ error: '買方預算下限不可高於預算上限' });
      return;
    }

    const now = new Date().toISOString();
    const doc = {
      propertyId,
      buyerId,
      buyerNickname: String(body.buyerNickname || '').trim(),
      buyerContact: String(body.buyerContact || '').trim(),
      budgetMin,
      budgetMax,
      mustHaves: Array.isArray(body.mustHaves) ? body.mustHaves : [],
      preferences: Array.isArray(body.preferences) ? body.preferences : [],
      dealBreakers: Array.isArray(body.dealBreakers) ? body.dealBreakers : [],
      livingCircle: String(body.livingCircle || '').trim(),
      privateNotes: String(body.privateNotes || '').trim(),
      isDemo: Boolean(body.isDemo),
      updatedAt: now,
    };

    await db.collection('buyer_profiles').updateOne(
      { propertyId, buyerId },
      { $set: doc },
      { upsert: true }
    );

    res.json({ success: true, buyer: doc });
  } catch (err: any) {
    console.error('[Save Buyer Error]:', err.message);
    res.status(500).json({ error: '儲存買方需求失敗' });
  }
});

app.delete('/api/properties/:id/buyers/:buyerId', async (req: Request, res: Response) => {
  const { id: propertyId, buyerId } = req.params;
  try {
    const db = await getDb();
    await db.collection('buyer_profiles').deleteOne({ propertyId, buyerId });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: '刪除買方需求失敗' });
  }
});

// -----------------------------------------------------------------------------
// Comparables & Competing Listings CRUD (Strictly scoped per propertyId)
// -----------------------------------------------------------------------------
app.get('/api/properties/:id/market-data', async (req: Request, res: Response) => {
  const { id: propertyId } = req.params;
  try {
    const db = await getDb();
    const [comparables, competingListings] = await Promise.all([
      db.collection('comparables').find({ propertyId }).sort({ createdAt: -1 }).toArray(),
      db.collection('competing_listings').find({ propertyId }).sort({ createdAt: -1 }).toArray(),
    ]);
    res.json({
      propertyId,
      comparables: comparables.map(({ _id, ...rest }) => rest),
      competingListings: competingListings.map(({ _id, ...rest }) => rest),
    });
  } catch (err: any) {
    console.error('[Get Market Data Error]:', err.message);
    res.status(500).json({ error: '讀取成交案例與在售競品失敗' });
  }
});

app.put('/api/properties/:id/comparables', async (req: Request, res: Response) => {
  const { id: propertyId } = req.params;
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  try {
    const db = await getDb();
    await db.collection('comparables').deleteMany({ propertyId });
    if (items.length > 0) {
      const now = new Date();
      const docs = items.map((item: any, idx: number) => ({
        ...item,
        id: item.id || `comp-${propertyId}-${Date.now()}-${idx}`,
        propertyId,
        createdAt: item.createdAt ? new Date(item.createdAt) : now,
        updatedAt: now,
      }));
      await db.collection('comparables').insertMany(docs);
    }
    res.json({ success: true, count: items.length });
  } catch (err: any) {
    console.error('[Save Comparables Error]:', err.message);
    res.status(500).json({ error: '儲存實價成交案例失敗' });
  }
});

app.put('/api/properties/:id/competing-listings', async (req: Request, res: Response) => {
  const { id: propertyId } = req.params;
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  try {
    const db = await getDb();
    await db.collection('competing_listings').deleteMany({ propertyId });
    if (items.length > 0) {
      const now = new Date();
      const docs = items.map((item: any, idx: number) => ({
        ...item,
        id: item.id || `compete-${propertyId}-${Date.now()}-${idx}`,
        propertyId,
        createdAt: item.createdAt ? new Date(item.createdAt) : now,
        updatedAt: now,
      }));
      await db.collection('competing_listings').insertMany(docs);
    }
    res.json({ success: true, count: items.length });
  } catch (err: any) {
    console.error('[Save Competing Listings Error]:', err.message);
    res.status(500).json({ error: '儲存在售競品失敗' });
  }
});

// -----------------------------------------------------------------------------
// Reports CRUD & Export Lock (Stored exclusively in MongoDB)
// -----------------------------------------------------------------------------
app.get('/api/reports', async (req: Request, res: Response) => {
  if (!process.env.MONGODB_URI) {
    res.json([]);
    return;
  }
  const { propertyId, reportType } = req.query;
  const query: any = {};
  if (propertyId) query.propertyId = propertyId;
  if (reportType) query.reportType = reportType;

  try {
    const db = await getDb();
    const reports = await db
      .collection('reports')
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    const sanitized = reports.map((r) => {
      const { _id, ...rest } = r;
      return evaluateReportReReview(rest);
    });

    res.json(sanitized);
  } catch (err: any) {
    console.error('[Get Reports Error]:', err.message);
    res.json([]);
  }
});

app.get('/api/reports/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const db = await getDb();
    const report = await db.collection('reports').findOne({ id });
    if (!report) {
      res.status(404).json({ error: '找不到指定報告' });
      return;
    }
    const { _id, ...rest } = report;
    res.json(evaluateReportReReview(rest));
  } catch (err: any) {
    console.error('[Get Report Error]:', err.message);
    res.status(500).json({ error: '讀取報告內容失敗' });
  }
});

// Client Export / Print Verification Endpoint (Enforces approved status & privacy isolation)
app.get('/api/reports/:id/export', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const db = await getDb();
    const report = await db.collection('reports').findOne({ id });
    if (!report) {
      res.status(404).json({ error: '找不到指定報告書，請先儲存後再匯出' });
      return;
    }

    if (report.status !== 'approved') {
      res.status(403).json({
        code: 'EXPORT_LOCKED_UNREVIEWED',
        status: report.status,
        error: '報告書尚未審閱核准，未審閱草稿禁止列印或匯出客戶版 PDF，請先返回審閱頁確認核准。',
      });
      return;
    }

    const { _id, ...rest } = report;
    const sanitized = stripConfidentialFieldsFromReport(evaluateReportReReview(rest));
    res.json({
      success: true,
      exportedAt: new Date().toISOString(),
      report: sanitized,
    });
  } catch (err: any) {
    console.error('[Export Report Error]:', err.message);
    res.status(500).json({ error: '驗證報告匯出權限失敗' });
  }
});

app.post('/api/reports', async (req: Request, res: Response) => {
  const reportDoc = req.body;
  if (!reportDoc || !reportDoc.propertyId || !reportDoc.title) {
    res.status(400).json({ error: '報告書內容不完整' });
    return;
  }

  try {
    const db = await getDb();

    // Idempotency check if requestId is provided
    if (reportDoc.requestId) {
      const existingByReq = await db.collection('reports').findOne({ requestId: reportDoc.requestId });
      if (existingByReq) {
        const { _id, ...rest } = existingByReq;
        res.json({ success: true, deduplicated: true, report: rest });
        return;
      }
    }

    const now = new Date();
    const reportId = reportDoc.id || `rep-${Date.now()}`;
    const newDoc = {
      ...reportDoc,
      id: reportId,
      layoutSettings: {
        fontScale: normalizeReportFontScale(reportDoc?.layoutSettings?.fontScale),
      },
      createdAt: reportDoc.createdAt ? new Date(reportDoc.createdAt) : now,
      updatedAt: now,
    };

    await db.collection('reports').updateOne(
      { id: reportId },
      { $set: newDoc },
      { upsert: true }
    );

    res.json({ success: true, report: evaluateReportReReview(newDoc) });
  } catch (err: any) {
    console.error('[Save Report Error]:', err.message);
    res.status(500).json({ error: '儲存報告書至資料庫失敗' });
  }
});

app.put('/api/reports/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const updates = req.body;
  try {
    const db = await getDb();
    const now = new Date();
    const { _id, ...safeUpdates } = updates || {};
    const updatePayload: Record<string, any> = {
      ...safeUpdates,
      updatedAt: now,
    };
    if (safeUpdates.layoutSettings !== undefined) {
      updatePayload.layoutSettings = {
        fontScale: normalizeReportFontScale(safeUpdates.layoutSettings?.fontScale),
      };
    }

    const result = await db.collection('reports').updateOne(
      { id },
      {
        $set: updatePayload,
      }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ error: '找不到指定報告書' });
      return;
    }

    const refreshed = await db.collection('reports').findOne({ id });
    const cleanRefreshed = refreshed
      ? (() => {
          const { _id: _omit, ...rest } = refreshed;
          return evaluateReportReReview(rest);
        })()
      : undefined;

    res.json({ success: true, message: '報告書更新成功', report: cleanRefreshed });
  } catch (err: any) {
    console.error('[Update Report Error]:', err.message);
    res.status(500).json({ error: '更新報告書失敗' });
  }
});

app.delete('/api/reports/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const db = await getDb();
    await db.collection('reports').deleteOne({ id });
    res.json({ success: true, message: '報告書已自資料庫刪除' });
  } catch (err: any) {
    console.error('[Delete Report Error]:', err.message);
    res.status(500).json({ error: '刪除報告書失敗' });
  }
});

// -----------------------------------------------------------------------------
// Broker Profile Settings (Stored in MongoDB)
// -----------------------------------------------------------------------------
app.get('/api/profile', async (_req: Request, res: Response) => {
  if (!process.env.MONGODB_URI) {
    res.json(DEFAULT_BROKER);
    return;
  }
  try {
    const db = await getDb();
    const profileDoc = await db.collection('profiles').findOne({ key: 'default_broker' });
    if (!profileDoc) {
      res.json(DEFAULT_BROKER);
      return;
    }
    const { _id, key, createdAt, updatedAt, ...rest } = profileDoc;
    res.json(rest);
  } catch (err: any) {
    console.error('[Get Profile Error]:', err.message);
    res.json(DEFAULT_BROKER);
  }
});

app.post('/api/profile', async (req: Request, res: Response) => {
  const profile = req.body;
  try {
    const db = await getDb();
    const now = new Date();
    await db.collection('profiles').updateOne(
      { key: 'default_broker' },
      {
        $set: {
          key: 'default_broker',
          ...profile,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );
    res.json({ success: true, message: '經紀人與門市設定已儲存至 MongoDB' });
  } catch (err: any) {
    console.error('[Save Profile Error]:', err.message);
    res.status(500).json({ error: '儲存經紀人資料失敗' });
  }
});

// -----------------------------------------------------------------------------
// Gemini AI Property Extraction Endpoints (Separated AI vs Web Fetch Status)
// -----------------------------------------------------------------------------
app.post('/api/extract/url', async (req: Request, res: Response) => {
  const { url, cachedText, priorData } = req.body || {};
  const testMode = (req.headers['x-ai-test-mode'] as string) || null;

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: '請提供有效的物件公開網址' });
    return;
  }

  const safetyCheck = isSafeUrl(url);
  if (!safetyCheck.safe) {
    res.status(400).json({ error: safetyCheck.reason });
    return;
  }

  // Preset Verification Scenarios (explicitly labeled as demo scenarios)
  if (
    url.includes('demo.taiwan-estate.com/listings/zb-highspeed-4r') ||
    url.includes('scenario-full-success') ||
    url.includes('15234567')
  ) {
    const data = normalizeProperty({
      caseName: '竹北高鐵特區水岸景觀四房 (公開物件示範)',
      caseId: 'WEB-ZB-8802',
      sourcePlatform: '示範售屋平台',
      sourceListingId: 'WEB-ZB-8802',
      fetchedAt: new Date().toISOString(),
      cityDistrict: '新竹縣竹北市',
      address: '文興路二段 360 號',
      propertyType: '電梯大樓',
      askingPrice: 3680,
      hasParking: true,
      parkingIncluded: true,
      totalArea: 68.5,
      mainArea: 38.6,
      auxArea: 5.1,
      commonArea: 14.6,
      parkingArea: 10.2,
      parkingPrice: 220,
      parkingType: '坡道平面',
      parkingOwnership: '私有',
      layout: '4房2廳2衛',
      floor: '11',
      totalFloors: '15',
      floorRaw: '11樓/15樓',
      age: 6.2,
      managementFee: 3850,
      managementFeeAmount: 3850,
      managementFeePeriod: 'monthly',
      managementFeeRaw: '3,850元/月',
      currentUsage: '自住',
      isDemo: true,
    });
    const completeness = calculatePropertyCompleteness(data);
    res.json({
      extractionStatus: 'success',
      pageType: 'single_listing',
      webFetchStatus: 'ok',
      aiServiceStatus: 'skipped',
      statusDescription: '示範情境：成功讀取公開售屋物件頁面完整資料',
      evidenceSummary: '示範測試情境資料（竹北高鐵文興路二段）',
      completeness,
      stages: {
        webFetch: 'ok',
        targetMatch: 'ok',
        fieldParse: 'ok',
        fieldValidate: 'ok',
      },
      stageTimingsMs: { webFetch: 5, targetMatch: 1, fieldParse: 2, fieldValidate: 1 },
      data,
    });
    return;
  }

  if (url.includes('demo.taiwan-estate.com/listings/partial-specs') || url.includes('scenario-partial')) {
    const data = normalizeProperty({
      caseName: '竹北文興商圈採光三房 (部分資訊待補)',
      caseId: 'PARTIAL-0912',
      sourcePlatform: '示範售屋平台',
      sourceListingId: 'PARTIAL-0912',
      fetchedAt: new Date().toISOString(),
      cityDistrict: '新竹縣竹北市',
      address: '文興路商圈',
      propertyType: '電梯大樓',
      askingPrice: 2680,
      hasParking: true,
      parkingIncluded: true,
      totalArea: 48.2,
      mainArea: 28.5,
      auxArea: 3.2,
      commonArea: 16.5,
      parkingArea: null,
      parkingPrice: null,
      parkingType: '坡道平面',
      layout: '3房2廳2衛',
      floor: '8',
      totalFloors: '14',
      floorRaw: '8樓/14樓',
      age: 8.5,
      managementFee: 2400,
      managementFeeAmount: 2400,
      managementFeePeriod: 'monthly',
      managementFeeRaw: '2,400元/月',
      currentUsage: '空屋',
      isDemo: true,
    });
    const completeness = calculatePropertyCompleteness(data);
    res.json({
      extractionStatus: 'partial',
      pageType: 'single_listing',
      webFetchStatus: 'ok',
      aiServiceStatus: 'skipped',
      statusDescription: '頁面僅擷取到部分基本資料，車位獨立價款與車位坪數未載明，請於校對表單補充。',
      evidenceSummary: '示範測試情境：部分欄位待補',
      completeness,
      stages: {
        webFetch: 'ok',
        targetMatch: 'ok',
        fieldParse: 'partial',
        fieldValidate: 'ok',
      },
      stageTimingsMs: { webFetch: 5, targetMatch: 1, fieldParse: 2, fieldValidate: 1 },
      data,
    });
    return;
  }

  if (url.includes('demo.taiwan-estate.com/listings/auth-required-login') || url.includes('scenario-blocked')) {
    res.json({
      extractionStatus: 'blocked_or_login',
      pageType: 'blocked_or_login',
      aiServiceStatus: 'skipped',
      webFetchStatus: 'blocked_or_login',
      statusDescription: '該公開網頁設定了會員登入權限或防爬蟲驗證（HTTP 403 / Cloudflare 驗證阻擋），無法直接自動擷取。已為您保留現有輸入，可直接貼上文字、上傳截圖、開啟空白校對表單或先存標題草稿。',
      evidenceSummary: '目標網站回傳防爬蟲驗證或會員權限限制',
      completeness: calculatePropertyCompleteness(null),
      stages: {
        webFetch: 'blocked_or_login',
        targetMatch: 'blocked_or_login',
        fieldParse: 'skipped',
        fieldValidate: 'skipped',
      },
      data: null,
    });
    return;
  }

  const clientAbortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      clientAbortController.abort('client_disconnected');
    }
  });

  const stageTimingsMs: Record<string, number> = {};
  const t0 = Date.now();

  // Stage 1: Direct HTTP fetch of target webpage (or reuse cachedText)
  let rawBody = '';
  let webFetchStatus: 'ok' | 'blocked_or_login' | 'timeout' | 'unreachable' = 'unreachable';
  let webFetchDetail = '';

  if (typeof cachedText === 'string' && cachedText.trim().length > 40) {
    rawBody = cachedText;
    webFetchStatus = 'ok';
    webFetchDetail = '沿用本次已讀取之目標網頁文字進行解析';
    stageTimingsMs.webFetch = 1;
  } else {
    const fetchController = new AbortController();
    const fetchTimeout = setTimeout(() => fetchController.abort(), 11000);
    try {
      const fetchRes = await fetch(url, {
        signal: fetchController.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8',
        },
      });
      clearTimeout(fetchTimeout);

      if (fetchRes.status === 401 || fetchRes.status === 403 || fetchRes.status === 429) {
        webFetchStatus = 'blocked_or_login';
        webFetchDetail = `目標網站回傳 HTTP ${fetchRes.status} 存取限制`;
      } else if (fetchRes.ok) {
        rawBody = await fetchRes.text();
        webFetchStatus = 'ok';
        webFetchDetail = `成功連線並取得目標網頁 (${rawBody.length.toLocaleString('zh-TW')} bytes)`;
      } else {
        webFetchStatus = 'unreachable';
        webFetchDetail = `目標網站回應狀態碼 HTTP ${fetchRes.status}`;
      }
    } catch (fetchErr: any) {
      clearTimeout(fetchTimeout);
      if (fetchErr?.name === 'AbortError') {
        webFetchStatus = 'timeout';
        webFetchDetail = '目標網頁連線讀取逾時';
      } else {
        webFetchStatus = 'unreachable';
        webFetchDetail = '目標網頁無法建立連線';
      }
    }
    stageTimingsMs.webFetch = Date.now() - t0;
  }

  if (webFetchStatus === 'blocked_or_login' && !testMode) {
    res.json({
      extractionStatus: 'blocked_or_login',
      pageType: 'blocked_or_login',
      aiServiceStatus: 'skipped',
      webFetchStatus,
      statusDescription: `${webFetchDetail}。此為目標網站本身之防爬蟲／權限限制（非 AI 模型異常）。您可直接切換「貼上文字／截圖」或開啟空白校對表單。`,
      evidenceSummary: webFetchDetail,
      completeness: calculatePropertyCompleteness(null),
      stages: {
        webFetch: 'blocked_or_login',
        targetMatch: 'skipped',
        fieldParse: 'skipped',
        fieldValidate: 'skipped',
      },
      stageTimingsMs,
      data: null,
    });
    return;
  }

  if (webFetchStatus !== 'ok' && !testMode) {
    res.json({
      extractionStatus: 'web_unreachable',
      pageType: 'unreachable',
      aiServiceStatus: 'skipped',
      webFetchStatus,
      statusDescription: `${webFetchDetail}。建議直接複製網頁上的物件文字或截圖，透過「入口三：手動 / 文字 / 截圖」解析，或直接開啟空白校對表單。`,
      evidenceSummary: webFetchDetail,
      completeness: calculatePropertyCompleteness(null),
      stages: {
        webFetch: webFetchStatus,
        targetMatch: 'skipped',
        fieldParse: 'skipped',
        fieldValidate: 'skipped',
      },
      stageTimingsMs,
      data: null,
    });
    return;
  }

  // Stage 2 & Stage 3: Classify page type, detect target ID, & run deterministic site rules BEFORE AI
  const tParseStart = Date.now();
  const parsedPortal = parsePortalListingHtml(url, rawBody);

  // Merge any deterministic fields preserved from an earlier fetch (e.g. JSON-LD fields on cachedText retry)
  if (priorData && typeof priorData === 'object') {
    const mergedFields: Record<string, any> = { ...priorData, ...parsedPortal.parsedFields };
    for (const [k, v] of Object.entries(parsedPortal.parsedFields)) {
      if ((v === null || v === undefined || v === '') && priorData[k] !== null && priorData[k] !== undefined && priorData[k] !== '') {
        mergedFields[k] = priorData[k];
      }
    }
    parsedPortal.parsedFields = mergedFields;
    parsedPortal.fieldStatus = { ...(priorData.fieldStatus || {}), ...parsedPortal.fieldStatus };
    parsedPortal.evidenceSummaries = { ...(priorData.evidenceSummaries || {}), ...parsedPortal.evidenceSummaries };
    parsedPortal.needsAiGapFill = true;
  }

  stageTimingsMs.targetMatch = Date.now() - tParseStart;

  // Reject non-single-listing pages BEFORE calling AI!
  if (parsedPortal.pageType !== 'single_listing') {
    const errorOrGuidance = parsedPortal.pageTypeReason;
    res.json({
      extractionStatus: parsedPortal.pageType,
      pageType: parsedPortal.pageType,
      sourcePlatform: parsedPortal.sourcePlatform,
      sourceListingId: parsedPortal.sourceListingId,
      webFetchStatus,
      aiServiceStatus: 'skipped',
      statusDescription: errorOrGuidance,
      evidenceSummary: `目標辨識結果：${parsedPortal.pageType}（已略過 AI 呼叫）`,
      rawFetchedText: parsedPortal.rawCleanedText.slice(0, 8000),
      completeness: calculatePropertyCompleteness(null),
      stages: {
        webFetch: 'ok',
        targetMatch: parsedPortal.pageType,
        fieldParse: 'skipped',
        fieldValidate: 'skipped',
      },
      stageTimingsMs,
      telemetry: {
        sourcePlatform: parsedPortal.sourcePlatform,
        sourceListingId: parsedPortal.sourceListingId,
        fetchedAt: parsedPortal.fetchedAt,
        aiCalled: false,
      },
      data: null,
    });
    return;
  }

  // Deterministic parsed base property
  let mergedProp = normalizeProperty({
    ...parsedPortal.parsedFields,
    sourceType: 'url',
    sourceUrl: url,
    sourceId: parsedPortal.sourceListingId || url,
    fetchedAt: parsedPortal.fetchedAt,
    fieldStatus: { ...parsedPortal.fieldStatus },
    evidenceSummaries: { ...parsedPortal.evidenceSummaries },
  });
  stageTimingsMs.fieldParse = Date.now() - tParseStart;

  // Stage 4: Only invoke AI for unparsed remaining fields when needed (or when testMode explicitly tests AI)
  let aiServiceStatus: 'ok' | 'timeout' | 'unavailable' | 'quota' | 'error' | 'skipped' = 'skipped';
  let aiErrorCode: string | null = null;
  let aiErrorMessage: string | null = null;
  let aiModelUsed: string | null = null;

  const shouldCallAi = parsedPortal.needsAiGapFill || Boolean(testMode);

  if (shouldCallAi) {
    const tAiStart = Date.now();
    try {
      const promptContent = `你是台灣不動產資料結構化助手。系統已從公開網頁透過規則擷取部分欄位，請**僅針對尚未取得之缺漏欄位**，從下方目標物件摘要文字中補充擷取（沒有明確記載的欄位務必回傳 null 或 ""，嚴禁猜測或改寫既有開價、管理費周期、車位權屬或坪數）。
目標平台：${parsedPortal.sourcePlatform}（來源編號：${parsedPortal.sourceListingId || '未載明'}）
已透過規則取得之欄位（僅供參考，不需重算）：${JSON.stringify(
        Object.fromEntries(
          Object.entries(mergedProp).filter(
            ([k, v]) =>
              v !== null &&
              v !== '' &&
              !['fieldStatus', 'evidenceSummaries', 'conflicts', 'photos', 'internalNotes'].includes(k)
          )
        )
      )}

目標物件精簡摘要文字：
"""
${parsedPortal.slimAiSnippet}
"""

【嚴格規範】
1. 開價單位為萬元，面積為坪；只填入內文明確寫出的數值。
2. 不可把每坪單價、房貸月付金或附近成交填入開價。
3. 若樓層為地下室、整棟或跨樓層請原樣保留文字於 floor。
4. 不可猜測未出現的廳衛數、主建物坪數、屋齡或車位價格。`;

      const aiRes = await callGeminiWithResilience({
        contents: promptContent,
        timeoutMs: 28000,
        perAttemptTimeoutMs: 14000,
        max503Retries: 1,
        allowFallbackModel: true,
        externalSignal: clientAbortController.signal,
        testMode,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              data: {
                type: Type.OBJECT,
                properties: {
                  cityDistrict: { type: Type.STRING, nullable: true },
                  address: { type: Type.STRING, nullable: true },
                  propertyType: { type: Type.STRING, nullable: true },
                  mainArea: { type: Type.NUMBER, nullable: true },
                  auxArea: { type: Type.NUMBER, nullable: true },
                  commonArea: { type: Type.NUMBER, nullable: true },
                  parkingArea: { type: Type.NUMBER, nullable: true },
                  parkingPrice: { type: Type.NUMBER, nullable: true },
                  parkingType: { type: Type.STRING, nullable: true },
                  layout: { type: Type.STRING, nullable: true },
                  floor: { type: Type.STRING, nullable: true },
                  totalFloors: { type: Type.STRING, nullable: true },
                  age: { type: Type.NUMBER, nullable: true },
                  currentUsage: { type: Type.STRING, nullable: true },
                },
              },
            },
            required: ['data'],
          },
        },
      });

      aiModelUsed = aiRes.modelUsed;
      const jsonMatch = aiRes.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new ClassifiedAiError('AI_VALIDATION', 502, 'AI 補齊結果未通過 JSON 結構驗證。');
      }
      const aiParsed = JSON.parse(jsonMatch[0]);
      const aiData = aiParsed?.data || {};

      // Merge AI gap-fill ONLY into fields that are still empty/null (NEVER overwrite deterministic fields!)
      const fillableKeys = [
        'cityDistrict',
        'address',
        'propertyType',
        'mainArea',
        'auxArea',
        'commonArea',
        'parkingArea',
        'parkingPrice',
        'parkingType',
        'layout',
        'floor',
        'totalFloors',
        'age',
        'currentUsage',
      ];

      const nextMerged: any = { ...mergedProp };
      const nextStatus: Record<string, FieldVerificationStatus> = { ...(mergedProp.fieldStatus || {}) };
      const nextEvidence: Record<string, string> = { ...(mergedProp.evidenceSummaries || {}) };

      for (const k of fillableKeys) {
        const currentVal = nextMerged[k];
        const isCurrentEmpty = currentVal === null || currentVal === undefined || currentVal === '';
        const aiVal = aiData[k];
        const isAiValid = aiVal !== null && aiVal !== undefined && String(aiVal).trim() !== '';

        // Special layout rule: if deterministic only got "3房" and AI found full "3房2廳2衛...", upgrade cleanly
        if (k === 'layout' && isPartialLayout(currentVal) && typeof aiVal === 'string' && /\d+房\s*\d+廳\s*\d+衛/.test(aiVal)) {
          nextMerged.layout = aiVal.trim();
          nextStatus.layout = 'recorded';
          nextEvidence.layout = `內文特色補足完整格局：「${aiVal.trim()}」`;
          continue;
        }

        if (isCurrentEmpty && isAiValid) {
          nextMerged[k] = aiVal;
          nextStatus[k] = 'recorded';
          nextEvidence[k] = `AI 依內文摘要補充（來源片段比對）`;
        }
      }

      mergedProp = normalizeProperty({
        ...nextMerged,
        fieldStatus: nextStatus,
        evidenceSummaries: nextEvidence,
      });
      aiServiceStatus = 'ok';
    } catch (err: any) {
      const classified = classifyAiError(err);
      console.warn('[URL Extraction AI Gap-Fill Fallback]:', classified.code, err?.message);
      aiErrorCode = classified.code;
      aiErrorMessage = classified.userMessage;
      aiServiceStatus =
        classified.code === 'AI_TIMEOUT'
          ? 'timeout'
          : classified.code === 'AI_UNAVAILABLE'
          ? 'unavailable'
          : classified.code === 'AI_QUOTA'
          ? 'quota'
          : 'error';
    }
    stageTimingsMs.fieldValidate = Date.now() - tAiStart;
  } else {
    stageTimingsMs.fieldValidate = 2;
  }

  const completeness = calculatePropertyCompleteness(mergedProp);
  const hasAnyDeterministicData = Boolean(
    mergedProp.caseName || mergedProp.askingPrice !== null || mergedProp.totalArea !== null
  );

  // Build concise factual status summary (NEVER report raw page character count as evidence!)
  const statusParts: string[] = [];
  statusParts.push(`已確認為「${parsedPortal.sourcePlatform}」單一物件${parsedPortal.sourceListingId ? `（${parsedPortal.sourceListingId}）` : ''}`);
  statusParts.push(completeness.summaryText);
  if (isPartialLayout(mergedProp.layout)) {
    statusParts.push('格局僅取得房數（廳衛數待確認，未計入完整欄位）');
  }
  if (aiServiceStatus === 'timeout' || aiServiceStatus === 'unavailable' || aiServiceStatus === 'quota' || aiServiceStatus === 'error') {
    statusParts.push(`AI 補齊未完成（${aiErrorMessage}），已保留規則解析取得之 ${completeness.totalAvailable} 個欄位與網頁原始文字供接續校對`);
  } else if (completeness.missingCoreLabels.length > 0 || completeness.missingAdvancedLabels.length > 0) {
    statusParts.push('原頁未記載之欄位維持「待確認」');
  }

  res.json({
    extractionStatus:
      aiErrorCode && !hasAnyDeterministicData
        ? 'ai_error'
        : aiErrorCode
        ? 'partial_ai_fallback'
        : completeness.coreAvailable === completeness.coreTotal && completeness.missingAdvancedLabels.length === 0
        ? 'success'
        : 'partial',
    pageType: parsedPortal.pageType,
    sourcePlatform: parsedPortal.sourcePlatform,
    sourceListingId: parsedPortal.sourceListingId,
    webFetchStatus,
    aiServiceStatus,
    errorCode: aiErrorCode,
    error: aiErrorMessage,
    statusDescription: statusParts.join('；') + '。',
    evidenceSummary: `平台：${parsedPortal.sourcePlatform}｜來源編號：${parsedPortal.sourceListingId || '未記載'}｜擷取時間：${new Date(parsedPortal.fetchedAt).toLocaleString('zh-TW')}`,
    completeness,
    rawFetchedText: parsedPortal.rawCleanedText.slice(0, 8000),
    stages: {
      webFetch: 'ok',
      targetMatch: 'ok',
      fieldParse: hasAnyDeterministicData ? 'ok' : 'partial',
      fieldValidate: aiErrorCode ? 'fallback' : 'ok',
    },
    stageTimingsMs,
    telemetry: {
      sourcePlatform: parsedPortal.sourcePlatform,
      sourceListingId: parsedPortal.sourceListingId,
      fetchedAt: parsedPortal.fetchedAt,
      aiCalled: shouldCallAi,
      aiModelUsed,
      errorCode: aiErrorCode,
    },
    data: hasAnyDeterministicData || completeness.totalAvailable > 0 ? mergedProp : null,
  });
});

app.post('/api/extract/text-or-image', async (req: Request, res: Response) => {
  const { text, imageBase64, mimeType } = req.body || {};
  const testMode = (req.headers['x-ai-test-mode'] as string) || null;

  if (!text && !imageBase64) {
    res.status(400).json({ error: '請提供文字或圖片截圖資料' });
    return;
  }

  const clientAbortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      clientAbortController.abort('client_disconnected');
    }
  });

  try {
    const promptText = `你是一個專業的台灣不動產經紀人助理。請從以下提供的物件資訊（文字或截圖）中，嚴格擷取成屋住宅的詳細資料。
【嚴格規範】
1. 嚴格依據提供的資料填寫，沒有記載的欄位請務必填寫 null（數值欄位）或空字串 ""（文字欄位），絕不可猜測、補齊或帶入預設縣市/車位/屋齡。
2. 幣值為新台幣萬元，面積為坪。若有降價前原開價請填 previousAskingPrice，現行開價填 askingPrice。
3. 管理費若為半年/每季/每年繳，請填原始金額 managementFeeAmount、周期 managementFeePeriod（monthly/quarterly/half_year/yearly/unknown）及原文 managementFeeRaw。
4. 若車位確定包含在總價中，parkingIncluded 設為 true；確定不含則 false；未載明請填 null。若有車位權屬（如私有/共有）填 parkingOwnership，不要把權屬填進 parkingType。
5. 格局 layout 必須為純字串（例如 "4房2廳2衛"），嚴禁輸出物件；未載明填 ""。
6. 請回傳合法 JSON。`;

    let contents: any;
    if (imageBase64) {
      let resolvedMime = mimeType || 'image/jpeg';
      let cleanBase64 = String(imageBase64);
      const dataUrlMatch = cleanBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (dataUrlMatch) {
        resolvedMime = dataUrlMatch[1];
        cleanBase64 = dataUrlMatch[2];
      } else {
        cleanBase64 = cleanBase64.replace(/^data:[^;]+;base64,/, '');
      }

      contents = {
        parts: [
          {
            inlineData: {
              mimeType: resolvedMime,
              data: cleanBase64,
            },
          },
          { text: promptText + (text ? `\n附加補充文字說明：${text}` : '') },
        ],
      };
    } else {
      contents = `${promptText}\n\n物件文字內容如下：\n"""\n${text}\n"""`;
    }

    const aiRes = await callGeminiWithResilience({
      contents,
      timeoutMs: 48000,
      perAttemptTimeoutMs: 22000,
      max503Retries: 1,
      allowFallbackModel: true,
      externalSignal: clientAbortController.signal,
      testMode,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            evidenceSummary: { type: Type.STRING, nullable: true },
            data: {
              type: Type.OBJECT,
              properties: {
                caseName: { type: Type.STRING, nullable: true },
                caseId: { type: Type.STRING, nullable: true },
                cityDistrict: { type: Type.STRING, nullable: true },
                address: { type: Type.STRING, nullable: true },
                propertyType: { type: Type.STRING, nullable: true },
                askingPrice: { type: Type.NUMBER, nullable: true },
                previousAskingPrice: { type: Type.NUMBER, nullable: true },
                hasParking: { type: Type.BOOLEAN, nullable: true },
                parkingIncluded: { type: Type.BOOLEAN, nullable: true },
                totalArea: { type: Type.NUMBER, nullable: true },
                mainArea: { type: Type.NUMBER, nullable: true },
                auxArea: { type: Type.NUMBER, nullable: true },
                commonArea: { type: Type.NUMBER, nullable: true },
                parkingArea: { type: Type.NUMBER, nullable: true },
                parkingAreaIncludedInCommon: { type: Type.BOOLEAN, nullable: true },
                parkingPrice: { type: Type.NUMBER, nullable: true },
                parkingType: { type: Type.STRING, nullable: true },
                parkingOwnership: { type: Type.STRING, nullable: true },
                layout: { type: Type.STRING, nullable: true },
                floor: { type: Type.STRING, nullable: true },
                totalFloors: { type: Type.STRING, nullable: true },
                floorRaw: { type: Type.STRING, nullable: true },
                age: { type: Type.NUMBER, nullable: true },
                managementFee: { type: Type.NUMBER, nullable: true },
                managementFeeAmount: { type: Type.NUMBER, nullable: true },
                managementFeePeriod: { type: Type.STRING, nullable: true },
                managementFeeRaw: { type: Type.STRING, nullable: true },
                currentUsage: { type: Type.STRING, nullable: true },
              },
            },
          },
          required: ['data'],
        },
      },
    });

    const jsonMatch = aiRes.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new ClassifiedAiError('AI_VALIDATION', 502, 'AI 回傳格式未通過系統欄位檢核，請重試。');
    }
    const parsed = JSON.parse(jsonMatch[0]);
    const aiData = parsed.data || parsed;

    // Enrich pasted text deterministically so 1陽台, 10F/14F, managementFeePeriod, hid/spec areas, and quotes never drop
    let mergedRaw = { ...aiData };
    let detEvidence: Record<string, string> = {};
    let detStatus: Record<string, FieldVerificationStatus> = {};
    if (typeof text === 'string' && text.trim()) {
      const det = parsePastedListingTextDeterministic(text);
      detEvidence = det.evidenceSummaries;
      detStatus = det.fieldStatus;
      for (const [k, v] of Object.entries(det.parsedFields)) {
        if (v !== null && v !== undefined && v !== '') {
          // Always prefer explicit deterministic layout with 陽台, management fee period, floor parts, and spec areas
          if (
            mergedRaw[k] === null ||
            mergedRaw[k] === undefined ||
            mergedRaw[k] === '' ||
            ['layout', 'floor', 'totalFloors', 'floorRaw', 'mainArea', 'auxArea', 'commonArea', 'managementFee', 'managementFeeAmount', 'managementFeePeriod', 'managementFeeRaw', 'parkingOwnership'].includes(k)
          ) {
            mergedRaw[k] = v;
          }
        }
      }
    }

    const normalizedData = normalizeProperty({
      ...mergedRaw,
      fieldStatus: {
        ...(mergedRaw.fieldStatus || {}),
        ...detStatus,
      },
      evidenceSummaries: {
        ...(mergedRaw.evidenceSummaries || {}),
        ...detEvidence,
      },
    });
    res.json({
      success: true,
      evidenceSummary: parsed.evidenceSummary || '截自輸入文字或圖片內容',
      completeness: calculatePropertyCompleteness(normalizedData),
      data: normalizedData,
    });
  } catch (err: any) {
    const classified = classifyAiError(err);
    console.error('[Text/Image Extraction Error]:', classified.code, err?.message);
    res.status(classified.httpStatus).json({
      errorCode: classified.code,
      error: classified.userMessage,
    });
  }
});

// -----------------------------------------------------------------------------
// Gemini AI Report Generation (Deterministic Metrics + Idempotency + Validation)
// -----------------------------------------------------------------------------
function computeMetricsAndSources(params: {
  property: any;
  reportType: string;
  subType: string;
  ownerProgressInput?: any;
  buyerInput?: any;
  comparables: any[];
  competingListings: any[];
}): { metrics: ComputedReportMetrics; sources: ReportSourceEntry[] } {
  const { property, reportType, subType, ownerProgressInput, buyerInput, comparables, competingListings } = params;

  const unitPriceRes = calculateUnitPrice(property);
  const publicRatioRes = calculatePublicRatio(property);
  const budgetRes = reportType === 'buyer' ? calculateBudgetComparison(property.askingPrice, buyerInput) : null;

  const metrics: ComputedReportMetrics = {
    askingPrice: property.askingPrice ?? null,
    grossUnitPrice: unitPriceRes.grossUnitPrice,
    hasDeductedPrice: unitPriceRes.hasDeductedPrice,
    deductedUnitPrice: unitPriceRes.deductedUnitPrice,
    unitPriceCaliber: unitPriceRes.caliberLabel,
    publicRatio: publicRatioRes.ratio,
    publicRatioLabel: publicRatioRes.label,
    budgetStatus: budgetRes?.status,
    budgetDiffWan: budgetRes?.diffWan,
    budgetSummary: budgetRes?.summary,
    comparablesCount: comparables.length,
    competingCount: competingListings.length,
  };

  const sources: ReportSourceEntry[] = [];
  const sourceTypeLabels: Record<string, string> = {
    database: '物件庫資料紀錄',
    url: '公開售屋網頁快照',
    manual: '經紀人手動校對輸入',
    screenshot: '截圖辨識與經紀人校對',
  };

  sources.push({
    label: '標的物件規格快照',
    category: property.sourceType === 'url' ? 'url' : 'property',
    detail: `${sourceTypeLabels[property.sourceType] || '物件規格資料'}（案件：${property.caseName || '未命名'}）`,
    url: property.sourceUrl || undefined,
    timestamp: property.updatedAt || new Date().toISOString(),
    isDemo: Boolean(property.isDemo),
  });

  if (comparables.length > 0) {
    const compSources = Array.from(new Set(comparables.map((c: any) => c.source).filter(Boolean)));
    const hasDemoComp = comparables.some((c: any) => c.isDemo);
    sources.push({
      label: `可比成交案例 (${comparables.length} 筆)`,
      category: 'comparable',
      detail: compSources.length > 0 ? compSources.join('、') : '經紀人手動登錄之成交案例',
      isDemo: hasDemoComp,
    });
  } else {
    sources.push({
      label: '可比成交案例 (0 筆)',
      category: 'comparable',
      detail: '尚未提供可比成交案例（報告已標註「待補可比成交案例」）',
    });
  }

  if (competingListings.length > 0) {
    const clSources = Array.from(new Set(competingListings.map((c: any) => c.source).filter(Boolean)));
    const hasDemoCl = competingListings.some((c: any) => c.isDemo);
    sources.push({
      label: `在售競品資料 (${competingListings.length} 筆)`,
      category: 'competing',
      detail: clSources.length > 0 ? clSources.join('、') : '經紀人登錄之在售競品',
      isDemo: hasDemoCl,
    });
  }

  if (reportType === 'owner' && subType === 'progress' && ownerProgressInput) {
    sources.push({
      label: '本期銷售進度回報紀錄',
      category: 'progress',
      detail: `回報期間：${ownerProgressInput.periodStart || '未指定'} ～ ${ownerProgressInput.periodEnd || '未指定'}`,
      timestamp: ownerProgressInput.updatedAt,
      isDemo: Boolean(ownerProgressInput.isDemo),
    });
  }

  if (reportType === 'buyer' && buyerInput) {
    sources.push({
      label: '買方購屋需求條件設定',
      category: 'buyer',
      detail: `需求對象：${buyerInput.buyerNickname || '一般評估設定'}`,
      timestamp: buyerInput.updatedAt,
      isDemo: Boolean(buyerInput.isDemo),
    });
  }

  return { metrics, sources };
}

function validateGeneratedReportStructure(data: any): { valid: boolean; reason?: string } {
  if (!data || typeof data !== 'object') {
    return { valid: false, reason: '模型回傳非物件結構' };
  }
  if (!data.title || typeof data.title !== 'string' || !data.title.trim()) {
    return { valid: false, reason: '報告缺少標題 title' };
  }
  if (!data.summary || typeof data.summary !== 'string' || !data.summary.trim()) {
    return { valid: false, reason: '報告缺少摘要 summary' };
  }
  if (!Array.isArray(data.sections) || data.sections.length === 0) {
    return { valid: false, reason: '報告章節 sections 不可為空' };
  }
  for (const sec of data.sections) {
    if (!sec || !sec.title || !sec.contentMarkdown || !String(sec.contentMarkdown).trim()) {
      return { valid: false, reason: '部分章節缺少標題或內容' };
    }
  }
  return { valid: true };
}

app.post('/api/reports/generate', async (req: Request, res: Response) => {
  const {
    requestId: rawRequestId,
    property,
    reportType,
    subType,
    ownerProgressInput,
    buyerInput,
    comparables: rawComps,
    competingListings: rawCompeting,
    saveDraft = true,
  } = req.body || {};

  const testMode = (req.headers['x-ai-test-mode'] as string) || null;

  if (!property || !reportType) {
    res.status(400).json({ error: '請提供物件資料與報告類型' });
    return;
  }

  const requestId =
    typeof rawRequestId === 'string' && rawRequestId.trim()
      ? rawRequestId.trim()
      : `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const comparables = Array.isArray(rawComps) ? rawComps : [];
  const competingListings = Array.isArray(rawCompeting) ? rawCompeting : [];

  // 1. Check MongoDB first for idempotency by requestId
  if (process.env.MONGODB_URI) {
    try {
      const db = await getDb();
      const existing = await db.collection('reports').findOne({ requestId });
      if (existing) {
        const { _id, ...rest } = existing;
        res.json({ success: true, deduplicated: true, report: rest });
        return;
      }
    } catch {
      // continue
    }
  }

  // 2. If identical requestId is currently running in-flight, coalesce onto same Promise
  const existingFlight = inFlightReportGenerations.get(requestId);
  if (existingFlight) {
    try {
      const existingResult = await existingFlight;
      res.json(existingResult);
    } catch (err: any) {
      const classified = classifyAiError(err);
      res.status(classified.httpStatus).json({ errorCode: classified.code, error: classified.userMessage });
    }
    return;
  }

  const clientAbortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      clientAbortController.abort('client_disconnected');
    }
  });

  // PRIVACY ISOLATION: Remove owner reserve price, internal notes, buyer contact & privateNotes before AI prompt!
  const normalizedProp = normalizeProperty(property);
  const sanitizedProperty = {
    caseName: normalizedProp.caseName,
    caseId: normalizedProp.caseId,
    cityDistrict: normalizedProp.cityDistrict || '待確認',
    address: normalizedProp.address || '待確認',
    propertyType: normalizedProp.propertyType || '待確認',
    askingPrice: normalizedProp.askingPrice,
    parkingIncluded: normalizedProp.parkingIncluded,
    totalArea: normalizedProp.totalArea,
    mainArea: normalizedProp.mainArea,
    auxArea: normalizedProp.auxArea,
    commonArea: normalizedProp.commonArea,
    parkingArea: normalizedProp.parkingArea,
    parkingPrice: normalizedProp.parkingPrice,
    parkingType: normalizedProp.parkingType || '待確認',
    layout: normalizedProp.layout || '待確認',
    floor: normalizedProp.floor || '待確認',
    totalFloors: normalizedProp.totalFloors || '待確認',
    age: normalizedProp.age,
    managementFee: normalizedProp.managementFee,
    currentUsage: normalizedProp.currentUsage || '待確認',
  };

  const sanitizedBuyerInput = buyerInput
    ? {
        buyerNickname: buyerInput.buyerNickname || '',
        budgetMin: buyerInput.budgetMin ?? null,
        budgetMax: buyerInput.budgetMax ?? null,
        mustHaves: buyerInput.mustHaves || [],
        preferences: buyerInput.preferences || [],
        dealBreakers: buyerInput.dealBreakers || [],
        livingCircle: buyerInput.livingCircle || '',
      }
    : null;

  const { metrics, sources } = computeMetricsAndSources({
    property: normalizedProp,
    reportType,
    subType: subType || 'pre_listing',
    ownerProgressInput,
    buyerInput,
    comparables,
    competingListings,
  });

  const isDemoReport =
    Boolean(normalizedProp.isDemo) ||
    Boolean(ownerProgressInput?.isDemo) ||
    Boolean(buyerInput?.isDemo) ||
    comparables.some((c: any) => c.isDemo) ||
    competingListings.some((c: any) => c.isDemo);

  const lockedFactsBlock = `
【系統程式鎖定數值（以下數字經程式精算，內文與 facts 必須嚴格一致，嚴禁改寫或自行估算）】
- 現行開價總金額：${formatWan(metrics.askingPrice)}${normalizedProp.previousAskingPrice ? `（降價前原開價參考：${formatWan(normalizedProp.previousAskingPrice)}）` : ''}
- 權狀總坪數：${formatPing(normalizedProp.totalArea)}
- 含車位／毛單價：${metrics.grossUnitPrice !== null ? `${metrics.grossUnitPrice} 萬元/坪` : '待確認'}
- 車位拆分與扣車位單價狀態：${metrics.unitPriceCaliber}（${
    metrics.hasDeductedPrice && metrics.deductedUnitPrice !== null
      ? `扣車位單價為 ${metrics.deductedUnitPrice} 萬元/坪`
      : '未拆分車位價格與坪數或未含車位，不可自行估算扣車位單價'
  }）
- 車位現況：${normalizedProp.hasParking === false ? '無車位' : `${normalizedProp.parkingOwnership ? `權屬 ${normalizedProp.parkingOwnership}、` : ''}${normalizedProp.parkingType || '車位型式待確認'}${normalizedProp.parkingArea ? `（車位 ${normalizedProp.parkingArea} 坪${normalizedProp.parkingAreaIncludedInCommon ? '，已包含於共有部分內' : ''}）` : ''}` }
- 公設比試算：${metrics.publicRatioLabel}
- 格局與樓層：${formatLayout(normalizedProp.layout)} ／ ${formatFloor(normalizedProp.floor, normalizedProp.totalFloors, normalizedProp.floorRaw)}
- 屋齡：${normalizedProp.age !== null && normalizedProp.age !== undefined ? `${normalizedProp.age} 年` : '待確認'}
- 管理費：${formatManagementFee(normalizedProp)}
- 已提供可比成交案例筆數：${comparables.length} 筆
- 已提供在售競品筆數：${competingListings.length} 筆
${metrics.budgetSummary ? `- 買方預算程式精算比對：${metrics.budgetSummary}` : ''}
`;

  const noComparablesGuardrail =
    comparables.length === 0
      ? `
【零成交案例嚴格禁令】
目前「可比成交案例」為 0 筆！
1. 行情與定價章節必須明確標註「待補可比成交案例」，僅可列示本案開價、單價與應補充查證的成交案例項目與後續追蹤指標。
2. 嚴禁捏造任何市場單價區間（例如「每坪 52–58 萬」）、嚴禁捏造議價空間百分比（例如「預留 5%–8% 議價空間」）、嚴禁自行推估車位行情價格（例如「平面車位約 180–220 萬」）、嚴禁將「在售競品開價」當作「成交行情」。`
      : '';

  const systemInstruction = `你是一位資深的台灣不動產經紀人與專業估價分析顧問，為台灣成屋住宅撰寫嚴謹、可稽核且具說服力的房仲評估報告。
語言：道地台灣繁體中文與台灣房仲專業用語（成屋、公設比、主建物、實價登錄、權狀坪數、坡道平面車位、委託、帶看、在售競品）。

【最高紀律與真實性準則】
1. 數字零誤差原則：必須嚴格採用【系統程式鎖定數值】中的開價、單價（含毛單價與扣車位單價）、公設比與預算差額，絕不可出現封面與內文單價或總價不一致的情形。
2. 嚴格禁止無中生有（Zero Fabrication）：
   - 凡輸入資料中沒有明確記載的項目（例如學區名稱、步行到高鐵站分鐘數、主臥衛浴是否開窗、採光座向、屋況瑕疵、管委會積金、市場議價幅度、未拆分之車位價格、未提供的實價成交案例、未記錄的帶看/曝光數），一律不得寫入「facts（確切事實）」或正文中當作已知事實！
   - 未記載且需確認之事項，必須放入「pendingChecklist（待查證清單）」或在買方需求對照標註「【待確認】」。
3. 0 與 空白 的區分：在銷售進度中，數字為 0 代表「已確認為 0 次」；欄位為 null 代表「尚無紀錄」，不可將 null 寫成 0，也不可將 0 寫成尚無紀錄。
4. 實價成交與在售競品嚴格分表與區分口徑，不得混淆開價與成交價。
5. 隱私絕對隔離：報告對外絕不可出現屋主底價、急售原因、買方電話/LINE 或任何內部機密備註。
6. 必須回傳嚴格合法 JSON。`;

  let userPrompt = '';

  if (reportType === 'owner') {
    const isProgress = subType === 'progress';
    if (isProgress) {
      userPrompt = `請撰寫【屋主版 - 房屋銷售進度回報書】
${lockedFactsBlock}
物件資料：${JSON.stringify(sanitizedProperty, null, 2)}
回報期間進度數據（0 表示已確認為零，null 表示尚無紀錄）：${JSON.stringify(ownerProgressInput || {}, null, 2)}
在售競品動態（共 ${competingListings.length} 筆）：${JSON.stringify(competingListings, null, 2)}

請依序產出以下四個章節：
1. id: "progress_overview", title: "本期銷售進度總覽"（清楚列出回報期間、網路曝光數、詢問數、實地帶看組數、已完成行銷動作；null 標示「尚無紀錄」，0 標示「0 次（已確認）」）
2. id: "market_feedback", title: "買方市場匿名回饋摘要"（僅整理提供的匿名回饋，若無則寫「本期尚無匿名帶看回饋紀錄」）
3. id: "competing_dynamics", title: "在售市場動態與調整"（若無在售競品則明確註明「本期尚未登錄在售競品」，不得捏造）
4. id: "next_plan", title: "下期銷售推進計畫"（列出具體下一步規劃與觀察指標）`;
    } else {
      userPrompt = `請撰寫【屋主版 - 房屋銷售委託前評估報告】
${lockedFactsBlock}
${noComparablesGuardrail}
物件資料：${JSON.stringify(sanitizedProperty, null, 2)}
可比成交案例（實價登錄，共 ${comparables.length} 筆）：${JSON.stringify(comparables, null, 2)}
在售競品參考（共 ${competingListings.length} 筆）：${JSON.stringify(competingListings, null, 2)}

請依序產出以下六個章節：
1. id: "summary_rights", title: "物件基本摘要與權利分析"
2. id: "strengths_obstacles", title: "核心賣點與潛在抗性分析"（區分已有依據的優勢與待查證條件）
3. id: "buyer_persona", title: "目標買方客群畫像"
4. id: "market_comparison", title: "市場行情與競品比較"（成交與在售分開；0 筆成交案例時僅寫「待補可比成交案例」及應補查項目）
5. id: "marketing_strategy", title: "建議行銷曝光與帶看策略"
6. id: "pricing_options", title: "後續行動與定價選項策略"（若無成交案例支持，不可捏造價格區間或 5-8% 議價幅度，改列補齊成交案例前之觀察指標與行動選項）`;
    }
  } else {
    userPrompt = `請撰寫【買方版 - 購屋評估報告】
${lockedFactsBlock}
${noComparablesGuardrail}
物件資料：${JSON.stringify(sanitizedProperty, null, 2)}
買方需求條件：${JSON.stringify(sanitizedBuyerInput || {}, null, 2)}
參考成交案例（共 ${comparables.length} 筆）：${JSON.stringify(comparables, null, 2)}
參考在售競品（共 ${competingListings.length} 筆）：${JSON.stringify(competingListings, null, 2)}

請依序產出以下六個章節：
1. id: "property_overview", title: "物件摘要與關鍵指標"（嚴格使用鎖定之開價、毛單價、扣車位單價、公設比）
2. id: "requirement_match", title: "買方需求對照評估"（逐條核對必要條件、偏好、不可接受條件與預算；必須明確標記「【符合】」、「【部分符合】」、「【不符合】」或「【待確認】」。例如物件開價若超出預算上限，必須精準引用差額並標記【不符合】或【超出預算】；未記載之學區、步行分鐘數、衛浴開窗等一律標記【待確認】。若無買方需求，輸出「待填寫購屋條件」）
3. id: "living_tradeoffs", title: "居住條件與生活取捨"（缺少通勤/學區/採光現況證據者必須列為【待確認】與查核事項，不可寫成已知事實）
4. id: "price_holding_cost", title: "價格與持有費用分析"（嚴格採用鎖定單價與預算差額；0 筆成交案例時標註「待補可比成交案例」並說明應補查資料，不可捏造市場單價區間與議價空間）
5. id: "onsite_checklist", title: "現場看屋與出價前查核清單"
6. id: "advisor_next_step", title: "顧問建議與下一步行動"`;
  }

  const executionPromise = (async () => {
    const aiRes = await callGeminiWithResilience({
      contents: userPrompt,
      timeoutMs: 75000,
      perAttemptTimeoutMs: 45000,
      max503Retries: 2,
      allowFallbackModel: true,
      externalSignal: clientAbortController.signal,
      testMode,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            summary: { type: Type.STRING },
            sections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                  contentMarkdown: { type: Type.STRING },
                  facts: { type: Type.ARRAY, items: { type: Type.STRING } },
                  analysis: { type: Type.ARRAY, items: { type: Type.STRING } },
                  pendingChecklist: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ['id', 'title', 'contentMarkdown', 'facts', 'analysis', 'pendingChecklist'],
              },
            },
          },
          required: ['title', 'summary', 'sections'],
        },
      },
    });

    const jsonMatch = aiRes.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new ClassifiedAiError('AI_VALIDATION', 502, 'AI 未回傳合法 JSON 報告結構，請重試。');
    }

    const reportData = JSON.parse(jsonMatch[0]);
    const validation = validateGeneratedReportStructure(reportData);
    if (!validation.valid) {
      throw new ClassifiedAiError(
        'AI_VALIDATION',
        502,
        `AI 生成報告未通過結構驗證 (${validation.reason})，已保護現有紀錄，請重試。`
      );
    }

    const nowIso = new Date().toISOString();
    const reportDoc = {
      id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      requestId,
      propertyId: normalizedProp.id || normalizedProp.caseId,
      propertySnapshot: { ...normalizedProp },
      reportType,
      subType: subType || 'pre_listing',
      buyerRequirements: reportType === 'buyer' && buyerInput ? buyerInput : undefined,
      ownerProgress:
        reportType === 'owner' && subType === 'progress' ? ownerProgressInput : undefined,
      comparables,
      competingListings,
      isDemo: isDemoReport,
      sourcesUsed: sources,
      computedMetrics: metrics,
      layoutSettings: { fontScale: 100 as const },
      title: reportData.title,
      summary: reportData.summary,
      sections: reportData.sections.map((sec: any, idx: number) => ({
        id: sec.id || `sec-${idx + 1}`,
        title: sec.title,
        contentMarkdown: sec.contentMarkdown,
        originalAiContent: sec.contentMarkdown,
        isEditedManually: false,
        facts: Array.isArray(sec.facts) ? sec.facts : [],
        analysis: Array.isArray(sec.analysis) ? sec.analysis : [],
        pendingChecklist: Array.isArray(sec.pendingChecklist) ? sec.pendingChecklist : [],
      })),
      version: 1,
      status: 'draft' as const,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (saveDraft && process.env.MONGODB_URI) {
      const db = await getDb();
      try {
        await db.collection('reports').updateOne(
          { requestId },
          { $setOnInsert: { ...reportDoc, createdAt: new Date(nowIso), updatedAt: new Date(nowIso) } },
          { upsert: true }
        );
        const persisted = await db.collection('reports').findOne({ requestId });
        if (persisted) {
          const { _id, ...cleanPersisted } = persisted;
          return {
            success: true,
            persisted: true,
            modelUsed: aiRes.modelUsed,
            retriedCount: aiRes.retriedCount,
            report: cleanPersisted,
          };
        }
      } catch (dbErr: any) {
        if (dbErr?.code === 11000) {
          const persisted = await db.collection('reports').findOne({ requestId });
          if (persisted) {
            const { _id, ...cleanPersisted } = persisted;
            return { success: true, deduplicated: true, persisted: true, report: cleanPersisted };
          }
        }
        console.error('[Save Generated Report Error]:', dbErr.message);
      }
    }

    return {
      success: true,
      persisted: false,
      modelUsed: aiRes.modelUsed,
      retriedCount: aiRes.retriedCount,
      report: reportDoc,
    };
  })();

  inFlightReportGenerations.set(requestId, executionPromise);
  try {
    const result = await executionPromise;
    res.json(result);
  } catch (err: any) {
    const classified = classifyAiError(err);
    console.error('[Report Generation Error]:', classified.code, err?.message);
    res.status(classified.httpStatus).json({
      errorCode: classified.code,
      error: classified.userMessage,
    });
  } finally {
    inFlightReportGenerations.delete(requestId);
  }
});

app.post('/api/reports/regenerate-section', async (req: Request, res: Response) => {
  const { property, reportType, sectionTitle, currentContent, feedback } = req.body || {};
  const testMode = (req.headers['x-ai-test-mode'] as string) || null;

  if (!sectionTitle || !currentContent) {
    res.status(400).json({ error: '請提供章節標題與現有內容' });
    return;
  }

  const clientAbortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      clientAbortController.abort('client_disconnected');
    }
  });

  try {
    const unitInfo = calculateUnitPrice(property || {});
    const prompt = `你是一個專業台灣房仲報告審查顧問。經紀人希望重新微調並重寫以下章節內容。
物件概要：${property?.caseName || '未命名'} (${property?.cityDistrict || '待確認'})，開價 ${formatWan(property?.askingPrice)}，權狀 ${formatPing(property?.totalArea)}，單價口徑：${unitInfo.caliberLabel} (${unitInfo.unitPrice !== null ? `${unitInfo.unitPrice} 萬/坪` : '待確認'})，格局 ${formatLayout(property?.layout)}。
報告類型：${reportType === 'owner' ? '屋主版' : '買方版'}
章節名稱：${sectionTitle}

現有章節內容：
"""
${currentContent}
"""

經紀人調整要求 / 新回饋：
"""
${feedback || '請依最新物件市場定位重寫，加強數據依據，更精準客觀'}
"""

【規範】
1. 嚴守台灣成屋住宅房仲專業用語與繁體中文。
2. 保留原有的客觀事實數據，絕不可捏造不存在的成交案例、學區、通勤時間或違反隱私（禁止輸出底價或聯絡資訊）。
3. 請回傳合法 JSON。`;

    const aiRes = await callGeminiWithResilience({
      contents: prompt,
      timeoutMs: 38000,
      perAttemptTimeoutMs: 20000,
      max503Retries: 2,
      allowFallbackModel: true,
      externalSignal: clientAbortController.signal,
      testMode,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            proposedContent: { type: Type.STRING },
            summaryOfChanges: { type: Type.STRING },
            facts: { type: Type.ARRAY, items: { type: Type.STRING } },
            analysis: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['proposedContent', 'summaryOfChanges'],
        },
      },
    });

    const jsonMatch = aiRes.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new ClassifiedAiError('AI_VALIDATION', 502, 'AI 回傳之章節格式不完整，原有章節已保留。');
    }
    const result = JSON.parse(jsonMatch[0]);
    if (!result.proposedContent || !String(result.proposedContent).trim()) {
      throw new ClassifiedAiError('AI_VALIDATION', 502, 'AI 未產出有效章節內容，原有章節已保留。');
    }

    res.json({
      success: true,
      originalContent: currentContent,
      proposedContent: result.proposedContent,
      summaryOfChanges: result.summaryOfChanges || '已完成章節文字調整',
      facts: Array.isArray(result.facts) ? result.facts : [],
      analysis: Array.isArray(result.analysis) ? result.analysis : [],
    });
  } catch (err: any) {
    const classified = classifyAiError(err);
    console.error('[Section Re-generation Error]:', classified.code, err?.message);
    res.status(classified.httpStatus).json({
      errorCode: classified.code,
      error: classified.userMessage,
    });
  }
});

// Setup Vite middleware in dev or static files in production
async function startServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const clientDistPath = fs.existsSync(path.resolve(__dirname, 'index.html'))
      ? __dirname
      : path.resolve(__dirname, 'dist');

    console.log(`[Production] Serving static files from: ${clientDistPath}`);
    app.use(express.static(clientDistPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(clientDistPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${port} (isProd: ${isProd})`);
    if (process.env.MONGODB_URI) {
      void initDbIndexes().catch((err: any) => {
        console.warn('[MongoDB] Init indexes warning:', err?.message);
      });
    } else {
      console.warn('[MongoDB] MONGODB_URI is not set; running in fallback mode');
    }
  });
}

startServer();
