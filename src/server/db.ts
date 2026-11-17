import { MongoClient, Db } from 'mongodb';

declare global {
  // eslint-disable-next-line no-var
  var __mongoClient: MongoClient | undefined;
}

/**
 * 全站單一 MongoClient，快取在 globalThis 以支援長駐伺服器與 serverless 冷啟重用連線池
 */
export function getClient(): MongoClient {
  if (globalThis.__mongoClient) {
    return globalThis.__mongoClient;
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('環境變數 MONGODB_URI 尚未設定');
  }
  globalThis.__mongoClient = new MongoClient(uri, {
    maxPoolSize: 10,
  });
  return globalThis.__mongoClient;
}

/**
 * 取得 e8346c_report 資料庫實例
 */
export async function getDb(): Promise<Db> {
  const client = getClient();
  return client.db('e8346c_report');
}

/**
 * 啟動時冪等建立集合索引 (Idempotent Indexing)
 */
export async function initDbIndexes(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return;

  try {
    const db = await getDb();

    // 1. properties 集合索引
    const propertiesCol = db.collection('properties');
    await propertiesCol.createIndex({ id: 1 }, { unique: true });
    await propertiesCol.createIndex({ caseId: 1 });
    await propertiesCol.createIndex({ createdAt: -1 });
    await propertiesCol.createIndex({ updatedAt: -1 });

    // 2. reports 集合索引
    const reportsCol = db.collection('reports');
    await reportsCol.createIndex({ id: 1 }, { unique: true });
    await reportsCol.createIndex({ propertyId: 1, createdAt: -1 });
    await reportsCol.createIndex({ createdAt: -1 });
    await reportsCol.createIndex({ updatedAt: -1 });
    await reportsCol.createIndex({ requestId: 1 }, { unique: true, sparse: true });

    // 3. profiles 集合索引
    const profilesCol = db.collection('profiles');
    await profilesCol.createIndex({ key: 1 }, { unique: true });

    // 4. comparables 集合索引
    const comparablesCol = db.collection('comparables');
    await comparablesCol.createIndex({ id: 1 }, { unique: true });
    await comparablesCol.createIndex({ propertyId: 1, createdAt: -1 });
    await comparablesCol.createIndex({ propertyCaseId: 1, createdAt: -1 });

    // 5. competing_listings 集合索引
    const competingCol = db.collection('competing_listings');
    await competingCol.createIndex({ id: 1 }, { unique: true });
    await competingCol.createIndex({ propertyId: 1, createdAt: -1 });

    // 6. owner_progress 集合索引 (依 propertyId + 回報起訖期間隔離)
    const progressCol = db.collection('owner_progress');
    await progressCol.createIndex(
      { propertyId: 1, periodStart: 1, periodEnd: 1 },
      { unique: true }
    );
    await progressCol.createIndex({ propertyId: 1, updatedAt: -1 });

    // 7. buyer_profiles 集合索引 (依 propertyId + buyerId 隔離)
    const buyersCol = db.collection('buyer_profiles');
    await buyersCol.createIndex({ propertyId: 1, buyerId: 1 }, { unique: true });
    await buyersCol.createIndex({ propertyId: 1, updatedAt: -1 });

    console.log('[MongoDB] e8346c_report 資料庫集合索引已就緒');
  } catch (err: any) {
    console.error('[MongoDB] 建立集合索引時發生非致命錯誤:', err.message);
  }
}
