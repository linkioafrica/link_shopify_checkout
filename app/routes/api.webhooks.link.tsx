import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { verifyWebhookSignature } from "../services/link.server";
import { markOrderAsPaid, cancelOrder } from "../services/shopify.server";
import { initMongo } from "../db.server";

const WEBHOOK_SECRET = process.env.LINK_WEBHOOK_SECRET || "";

const json = (data: any, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", ...init?.headers },
    status: init?.status || 200,
  });

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { db } = await initMongo();

    // Get raw body for signature verification
    const rawBody = await request.text();
    const signature = request.headers.get("x-link-signature") || "";

    // Verify webhook signature
    if (!verifyWebhookSignature(rawBody, signature, WEBHOOK_SECRET)) {
      console.error("Invalid webhook signature");
      return json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const { event, linkPaymentId, status, xrplTxHash, confirmations, timestamp } = payload;

    // Log webhook
    await db.collection("webhook_logs").insertOne({
      event,
      payload: rawBody,
      processed: false,
      createdAt: new Date(),
      shop: payload.shop || null,
      error: null,
    });

    // Find the payment
    const payment = await db.collection("payments").findOne({ linkPaymentId });

    if (!payment) {
      console.error(`Payment not found for paymentId: ${linkPaymentId}`);
      return json({ error: "Payment not found" }, { status: 404 });
    }

    // Update payment
    await db.collection("payments").updateOne(
      { _id: payment._id },
      {
        $set: {
          status,
          xrplTxHash: xrplTxHash || payment.xrplTxHash,
          xrplConfirmations: confirmations ?? payment.xrplConfirmations,
          paidAt: status === "completed" ? new Date(timestamp) : payment.paidAt,
          updatedAt: new Date(),
        },
      }
    );

    // Handle payment completion
    if (status === "completed" && xrplTxHash) {
      try {
        const session = await db
          .collection("sessions")
          .find({ shop: payment.shop, isOnline: false })
          .sort({ expires: -1 })
          .limit(1)
          .next();

        if (!session) throw new Error(`No session found for shop: ${payment.shop}`);

        const { admin } = await authenticate.admin(
          new Request(`https://${payment.shop}/admin`, {
            headers: { Authorization: `Bearer ${session.accessToken}` },
          })
        );

        await markOrderAsPaid(admin, {
          orderId: payment.orderId,
          transactionHash: xrplTxHash,
          amount: payment.amount,
          currency: payment.currency,
          confirmations,
        });

        // Update webhook log as processed
        await db.collection("webhook_logs").updateMany(
          { payload: { $regex: linkPaymentId }, processed: false },
          { $set: { processed: true, shop: payment.shop } }
        );

        console.log(`Successfully processed payment for order ${payment.orderName}`);
      } catch (error) {
        console.error("Error updating Shopify order:", error);

        await db.collection("webhook_logs").updateMany(
          { payload: { $regex: linkPaymentId }, processed: false },
          {
            $set: {
              processed: false,
              error: error instanceof Error ? error.message : "Unknown error",
              shop: payment.shop,
            },
          }
        );

        return json({
          received: true,
          warning: "Payment recorded but Shopify update failed",
        });
      }
    }

    // Handle cancellation/expiration
    if (status === "cancelled" || status === "expired") {
      try {
        const session = await db
          .collection("sessions")
          .find({ shop: payment.shop, isOnline: false })
          .sort({ expires: -1 })
          .limit(1)
          .next();

        if (session) {
          const { admin } = await authenticate.admin(
            new Request(`https://${payment.shop}/admin`, {
              headers: { Authorization: `Bearer ${session.accessToken}` },
            })
          );

          await cancelOrder(admin, payment.orderId, `Payment ${status}: LINK payment was ${status}`);
        }

        await db.collection("webhook_logs").updateMany(
          { payload: { $regex: linkPaymentId }, processed: false },
          { $set: { processed: true, shop: payment.shop } }
        );
      } catch (error) {
        console.error("Error cancelling Shopify order:", error);
      }
    }

    return json({ received: true });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return json(
      { error: error instanceof Error ? error.message : "Webhook processing failed" },
      { status: 500 }
    );
  }
};
