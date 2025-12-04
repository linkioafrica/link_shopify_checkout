import { MongoClient, Db } from "mongodb";

let client: MongoClient;
let db: Db;

declare global {
  // eslint-disable-next-line no-var
  var __mongo__: {
    client: MongoClient;
    db: Db;
  } | undefined;
}

const uri = process.env.MONGODB_URI!;
const dbName = process.env.MONGODB_DB || "shopify_app";

if (!uri) {
  throw new Error("❌ Missing MONGODB_URI in environment variables.");
}

export async function initMongo() {
  if (process.env.NODE_ENV === "production") {
    client = new MongoClient(uri, { tls: true });
    await client.connect();
    db = client.db(dbName);
  } else {
    if (!global.__mongo__) {
      client = new MongoClient(uri, { tls: true });
      await client.connect();

      global.__mongo__ = {
        client,
        db: client.db(dbName),
      };
    }

    client = global.__mongo__.client;
    db = global.__mongo__.db;
  }

  return { client, db };
}

// Optional exports for direct usage
export { client, db };
