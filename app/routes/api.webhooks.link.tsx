import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { verifyWebhookSignature } from "../services/link.server";
import { initMongo } from "../db.server";

const WEBHOOK_SECRET = process.env.LINK_WEBHOOK_SECRET || "";

const json = (data: any, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", ...init?.headers },
    status: init?.status || 200,
  });

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    console.log("Received LINK webhook", request);
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

    // Find the payment with full order details
    const payment = await db.collection("payments").findOne({ linkPaymentId });

    if (!payment) {
      console.error(`Payment not found for paymentId: ${linkPaymentId}`);
      return json({ error: "Payment not found" }, { status: 404 });
    }

    // Update payment status
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
        $push: {
          paymentHistory: {
            timestamp: new Date(),
            action: status === "completed" ? "payment_completed" : "updated",
            details: { status, xrplTxHash, confirmations },
          },
        },
      }
    );

    // ✅ Handle payment completion → Convert draft order to actual order
    if (status === "completed" && xrplTxHash) {
      try {
        const session = await db
          .collection("shopify_sessions")
          .find({ shop: payment.shop, isOnline: false })
          .sort({ expires: -1 })
          .limit(1)
          .next();

        if (!session) throw new Error(`No session found for shop: ${payment.shop}`);

        const { admin } = await unauthenticated.admin(payment.shop)

        // ✅ If draft order exists, complete it to create actual order
        let actualOrderId: string | undefined;

        if (payment.draftOrderId) {
          console.log(`📝 Converting draft order ${payment.draftOrderId} to actual order...`);

          const completeResult = await admin.graphql(`
            mutation CompleteDraftOrder($id: ID!) {
              draftOrderComplete(id: $id) {
                draftOrder {
                  id
                  order {
                    id
                    name
                  }
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `, {
            variables: { id: payment.draftOrderId },
          });

          const completedOrder = await completeResult.json();
          if (completedOrder.data?.draftOrderComplete?.draftOrder?.order) {
            actualOrderId = completedOrder.data.draftOrderComplete.draftOrder.order.id;
            console.log(`✅ Actual order created: ${completedOrder.data.draftOrderComplete.draftOrder.order.name}`);
          } else {
            console.warn("⚠️ Failed to complete draft order");
          }
        }

        // ✅ Add transaction and notes to order
        if (actualOrderId) {
          await admin.graphql(`
            mutation AddTransactionAndNote($input: OrderInput!) {
              orderUpdate(input: $input) {
                order {
                  id
                  transactions {
                    id
                  }
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `, {
            variables: {
              id: actualOrderId,
              input: {
                customAttributes: [
                  {
                    key: "xrpl_tx_hash",
                    value: xrplTxHash,
                  },
                  {
                    key: "payment_method",
                    value: "XRPL_CRYPTO",
                  },
                  {
                    key: "crypto_confirmations",
                    value: confirmations.toString(),
                  },
                ],
              },
            },
          });

          // Add note to order
          await admin.graphql(`
            mutation AddOrderNote($id: ID!, $note: String!) {
              orderNoteAdd(input: { id: $id, note: $note }) {
                order {
                  id
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `, {
            variables: {
              id: actualOrderId,
              note: `Payment completed via XRPL\nTx Hash: ${xrplTxHash}\nConfirmations: ${confirmations}`,
            },
          });
        }

        // ✅ Update payment record with actual order ID
        await db.collection("payments").updateOne(
          { _id: payment._id },
          {
            $set: {
              actualOrderId,
              actualOrderCreatedAt: new Date(),
            },
            $push: {
              paymentHistory: {
                timestamp: new Date(),
                action: "order_created",
                details: { actualOrderId, draftOrderId: payment.draftOrderId },
              },
            },
          }
        );

        // Update webhook log as processed
        await db.collection("webhook_logs").updateMany(
          { payload: { $regex: linkPaymentId }, processed: false },
          { $set: { processed: true, shop: payment.shop } }
        );

        console.log(`✅ Successfully processed payment for order ${payment.orderName}`);
      } catch (error) {
        console.error("Error creating order:", error);

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
          warning: "Payment recorded but order creation failed",
        });
      }
    }

    // Handle cancellation/expiration
    if (status === "cancelled" || status === "expired") {
      console.log(`📌 Payment ${status}, cleaning up draft order...`);

      if (payment.draftOrderId) {
        try {
          const session = await db
            .collection("shopify_sessions")
            .find({ shop: payment.shop, isOnline: false })
            .sort({ expires: -1 })
            .limit(1)
            .next();

          if (session) {
            const { admin } = await unauthenticated.admin(payment.shop);

            // Delete draft order
            await admin.graphql(`
              mutation DeleteDraftOrder($id: ID!) {
                draftOrderDelete(id: $id) {
                  deletedId
                  userErrors {
                    message
                  }
                }
              }
            `, {
              variables: { id: payment.draftOrderId },
            });

            console.log(`✅ Draft order ${payment.draftOrderId} deleted`);
          }
        } catch (error) {
          console.error("Error deleting draft order:", error);
        }
      }

      await db.collection("webhook_logs").updateMany(
        { payload: { $regex: linkPaymentId }, processed: false },
        { $set: { processed: true, shop: payment.shop } }
      );
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