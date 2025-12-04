import { initMongo } from "../db.server";

export interface MerchantConfig {
    id: string;
    shop: string;
    linkBusinessId: string;
    xrplAddress: string;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export async function getMerchantConfigCollection() {
    const { db } = await initMongo();
    const collection = db.collection<MerchantConfig>("merchant_configs");

    await collection.createIndex({ shop: 1 }, { unique: true });

    return collection;
}
