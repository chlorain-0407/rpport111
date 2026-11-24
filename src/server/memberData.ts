import type { AcademyContext, AcademyServiceContext } from '@agentgo-tw/app-sdk';
import type { Request } from 'express';
import type { Collection, Db, Document } from 'mongodb';

declare global {
  namespace Express {
    interface Request {
      academy?: AcademyContext | null;
      academyService?: AcademyServiceContext | null;
    }
  }
}

export const memberCollections = [
  'properties', 'reports', 'profiles', 'comparables',
  'competing_listings', 'owner_progress', 'buyer_profiles',
] as const;

// The allowlist keeps new DB operations fail-closed until ownership is implemented.
export function memberCollection(collection: Collection, userUuid: string): Collection {
  const filter = (query: Document = {}) => ({ $and: [query, { userUuid }] });
  const owned = (document: Document) => {
    const data = Object.fromEntries(Object.entries(document).filter(([key]) =>
      key !== '_id' && !key.startsWith('_id.') && key !== 'userUuid' && !key.startsWith('userUuid.')));
    return { ...data, userUuid };
  };
  return new Proxy(collection, {
    get(target, key) {
      if (['find', 'findOne', 'countDocuments', 'deleteOne', 'deleteMany'].includes(String(key))) {
        return (query?: Document, options?: unknown) =>
          (target[key as keyof Collection] as Function).call(target, filter(query), options);
      }
      if (key === 'insertMany') {
        return (documents: Document[], options?: unknown) => target.insertMany(documents.map(owned), options as never);
      }
      if (key === 'insertOne') {
        return (document: Document, options?: unknown) => target.insertOne(owned(document), options as never);
      }
      if (key === 'updateOne') {
        return (query: Document, update: Document, options?: unknown) => {
          if (Object.keys(update).some(operator => !['$set', '$setOnInsert'].includes(operator))) {
            throw new Error('Unsupported member update operator');
          }
          const safeUpdate: Document = { $set: owned(update.$set || {}) };
          if (update.$setOnInsert) {
            const { userUuid: ignoredOwner, _id, ...insert } = update.$setOnInsert;
            safeUpdate.$setOnInsert = insert;
          }
          return target.updateOne(filter(query), safeUpdate, options as never);
        };
      }
      throw new Error('Unsupported member collection operation: ' + String(key));
    },
  });
}

export function memberDatabase(db: Db, req: Request): Db {
  const userUuid = req.academy?.user.uuid;
  if (!userUuid) return db; // Original, unowned records stay in the legacy workflow.
  return new Proxy(db, {
    get(target, key) {
      if (key === 'then') return undefined;
      if (key === 'collection') {
        return (name: typeof memberCollections[number]) => {
          if (!memberCollections.includes(name)) throw new Error('Unknown member collection');
          return memberCollection(target.collection('member_' + name), userUuid);
        };
      }
      if (key === 'command') {
        return (command: Document) => {
          if (Object.keys(command).length !== 1 || command.ping !== 1) throw new Error('Unsupported member command');
          return target.command({ ping: 1 });
        };
      }
      throw new Error('Unsupported member database operation: ' + String(key));
    },
  });
}

export async function initializeMemberIndexes(db: Db) {
  for (const name of memberCollections) {
    const collection = db.collection('member_' + name);
    await collection.createIndex({ userUuid: 1 });
    const identity = name === 'profiles' ? { key: 1 } :
      name === 'owner_progress' ? { propertyId: 1, periodStart: 1, periodEnd: 1 } :
      name === 'buyer_profiles' ? { propertyId: 1, buyerId: 1 } : { id: 1 };
    await collection.createIndex({ userUuid: 1, ...identity } as never, { unique: true });
  }
  await db.collection('member_reports').createIndex(
    { userUuid: 1, requestId: 1 },
    { unique: true, partialFilterExpression: { requestId: { $type: 'string' } } },
  );
}

export async function deleteMemberRecords(db: Db, userUuid: string) {
  if (typeof userUuid !== 'string' || !userUuid.trim()) throw new Error('userUuid is required');
  // Every owned collection is included. Retrying a partial deletion is safe.
  await Promise.all(memberCollections.map(name => db.collection('member_' + name).deleteMany({ userUuid })));
}
