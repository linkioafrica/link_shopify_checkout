import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { verifyWebhookSignature } from "../services/link.server";
import { authenticate } from "../shopify.server";
import { markOrderAsPaid, cancelOrder } from "../services/shopify.server";

const WEBHOOK_SECRET = process.env.LINK_WEBHOOK_SECRET || "";
const json = (data: any, init?: ResponseInit) => {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", ...init?.headers },
    status: init?.status || 200,
  });
};
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // Get raw body for signature verification
    const rawBody = await request.text();
    const signature = request.headers.get("x-link-signature") || "";

    // Verify webhook signature
    if (!verifyWebhookSignature(rawBody, signature, WEBHOOK_SECRET)) {
      console.error("Invalid webhook signature");
    }

    const payload = JSON.parse(rawBody);
    const {
      event,
      linkPaymentId,
      status,
      xrplTxHash,
      confirmations,
      timestamp,
    } = payload;
    await prisma.webhookLog.create({
      data: {
        event,
        payload: rawBody,
        processed: false,
      },
    });

    // Find the payment record
    const payment = await prisma.payment.findUnique({
      where: { linkPaymentId },
    });

    if (!payment) {
      console.error(`Payment not found for paymentId: ${linkPaymentId}`);
      return json({ error: "Payment not found" }, { status: 404 });
    }

    // Update payment status
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status,
        xrplTxHash: xrplTxHash || payment.xrplTxHash,
        xrplConfirmations: confirmations || payment.xrplConfirmations,
        paidAt: status === "completed" ? new Date(timestamp) : payment.paidAt,
        updatedAt: new Date(),
      },
    });

    // Handle payment completion
    if (status === "completed" && xrplTxHash) {
      try {
        // Get admin session for the shop
        const session = await prisma.session.findFirst({
          where: {
            shop: payment.shop,
            isOnline: false,
          }, 
          orderBy: {
            expires: "desc",
          },
        });

        if (!session) {
          throw new Error(`No session found for shop: ${payment.shop}`);
        }

        // Create admin context
        const { admin } = await authenticate.admin(
          new Request(`https://${payment.shop}/admin`, {
            headers: {
              Authorization: `Bearer ${session.accessToken}`,
            },
          })
        );

        // Mark order as paid in Shopify
        await markOrderAsPaid(admin, {
          orderId: payment.orderId,
          transactionHash: xrplTxHash,
          amount: payment.amount,
          currency: payment.currency,
          confirmations,
        });

        // Update webhook log as processed
        await prisma.webhookLog.updateMany({
          where: {
            payload: { contains: linkPaymentId },
            processed: false,
          },
          data: {
            processed: true,
            shop: payment.shop,
          },
        });

        console.log(
          `Successfully processed payment completion for order ${payment.orderName}`
        );
      } catch (error) {
        console.error("Error updating Shopify order:", error);

        // Log the error but don't fail the webhook
        await prisma.webhookLog.updateMany({
          where: {
            payload: { contains: linkPaymentId },
            processed: false,
          },
          data: {
            processed: false,
            error: error instanceof Error ? error.message : "Unknown error",
            shop: payment.shop,
          },
        });

        // Return success to LINK to avoid retries, but log the error
        return json({
          received: true,
          warning: "Payment recorded but Shopify update failed"
        });
      }
    }

    // Handle payment cancellation or expiration
    if (status === "cancelled" || status === "expired") {
      try {
        const session = await prisma.session.findFirst({
          where: {
            shop: payment.shop,
            isOnline: false,
          },
          orderBy: {
            expires: "desc",
          },
        });

        if (session) {
          const { admin } = await authenticate.admin(
            new Request(`https://${payment.shop}/admin`, {
              headers: {
                Authorization: `Bearer ${session.accessToken}`,
              },
            })
          );

          await cancelOrder(
            admin,
            payment.orderId,
            `Payment ${status}: LINK payment was ${status}`
          );
        }

        await prisma.webhookLog.updateMany({
          where: {
            payload: { contains: linkPaymentId },
            processed: false,
          },
          data: {
            processed: true,
            shop: payment.shop,
          },
        });
      } catch (error) {
        console.error("Error cancelling Shopify order:", error);
      }
    }

    return json({ received: true });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return json(
      {
        error: error instanceof Error ? error.message : "Webhook processing failed",
      },
      { status: 500 }
    );
  }
};
