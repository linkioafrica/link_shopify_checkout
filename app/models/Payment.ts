import { initMongo } from "../db.server";

export interface Payment {
    id: string;
    shop: string;
    orderId: string;
    orderName: string;
    linkPaymentId?: string;
    linkPaymentUrl?: string;
    amount: string;
    currency: string;
    status: string;
    xrplTxHash?: string;
    xrplConfirmations?: number;
    paidAt?: Date;
    metadata?: string;
    createdAt: Date;
    updatedAt: Date;
}

export async function getPaymentCollection() {
    const { db } = await initMongo();
    const collection = db.collection<Payment>("payments");

    await collection.createIndex({ shop: 1, orderId: 1 });
    await collection.createIndex({ linkPaymentId: 1 });
    await collection.createIndex({ status: 1 });

    return collection;
}
