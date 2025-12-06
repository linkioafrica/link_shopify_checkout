import { initMongo } from "../db.server";

export interface OrderDetails {
    lineItems: {
        id: string;
        sku?: string;
        title: string;
        quantity: number;
        price: string;
        variant?: {
            id: string;
            title: string;
            sku?: string;
        };
    }[];
    shippingAddress?: {
        firstName: string;
        lastName: string;
        address1: string;
        address2?: string;
        city: string;
        province: string;
        zip: string;
        country: string;
        phone?: string;
    };
    billingAddress?: {
        firstName: string;
        lastName: string;
        address1: string;
        address2?: string;
        city: string;
        province: string;
        zip: string;
        country: string;
        phone?: string;
    };
    email: string;
    phone?: string;
    subtotal: string;
    shipping: string;
    tax: string;
    discount?: {
        code: string;
        amount: string;
    };
    total: string;
    currency: string;
    note?: string;
}

export interface Payment {
    id: string;
    shop: string;
    orderId: string; // Checkout ID
    orderName: string;
    linkPaymentId?: string;
    linkPaymentUrl?: string;
    amount: string;
    currency: string;
    status: "pending" | "completed" | "failed" | "expired" | "cancelled";

    // ✅ NEW: Store full order details (captured at payment link creation)
    orderDetails: OrderDetails;

    // ✅ NEW: Track draft order creation
    draftOrderId?: string;
    draftOrderCreatedAt?: Date;
    draftOrderUrl?: string;

    // ✅ NEW: Track actual order creation (on payment completion)
    actualOrderId?: string;
    actualOrderCreatedAt?: Date;

    // ✅ NEW: Track payment history/updates
    paymentHistory: {
        timestamp: Date;
        action: "created" | "updated" | "payment_completed" | "draft_created" | "order_created";
        details?: any;
    }[];

    xrplTxHash?: string;
    xrplConfirmations?: number;
    paidAt?: Date;
    metadata?: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

export async function getPaymentCollection() {
    const { db } = await initMongo();
    const collection = db.collection<Payment>("payments");

    // Create indexes
    await collection.createIndex({ shop: 1, orderId: 1 });
    await collection.createIndex({ linkPaymentId: 1 });
    await collection.createIndex({ status: 1 });
    await collection.createIndex({ draftOrderId: 1 });
    await collection.createIndex({ actualOrderId: 1 });
    await collection.createIndex({ createdAt: 1 }); // For cleanup

    return collection;
}