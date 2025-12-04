import { initMongo } from "../db.server";

export interface WebhookLog {
    id: string;
    shop?: string;
    event: string;
    payload: string;
    error?: string;
    processed: boolean;
    createdAt: Date;
}

export async function getWebhookLogCollection() {
    const { db } = await initMongo();
    const collection = db.collection<WebhookLog>("webhook_logs");

    await collection.createIndex({ shop: 1, processed: 1 });
    await collection.createIndex({ createdAt: 1 });

    return collection;
}
