import type { ActionFunctionArgs, LoaderFunction } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { createPaymentLink } from "../services/link.server";
import { initMongo } from "../db.server";
import type { OrderDetails } from "../models/Payment";

export const loader: LoaderFunction = async ({ request }) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "https://extensions.shopifycdn.com",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Access-Control-Allow-Origin",
    "Access-Control-Allow-Credentials": "true",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({ error: "Missing required fields" }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { sessionToken } = await authenticate.public.checkout(request);
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };

  try {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const shop = sessionToken.dest;
    const { db } = await initMongo();

    const body = await request.json();
    const {
      orderId,
      orderName,
      amount,
      currency,
      // ✅ NEW: Order details from checkout
      lineItems,
      shippingAddress,
      billingAddress,
      email,
      phone,
      subtotal,
      shipping,
      tax,
      discount,
      total,
      note,
    } = body;

    // Validation
    if (!orderId || !orderName || !amount || !currency) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get merchant config
    const config = await db.collection("merchant_configs").findOne({ shop });

    if (!config || !config.enabled) {
      return new Response(
        JSON.stringify({ error: "LINK payment gateway not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ✅ Check for existing payment
    const existingPayment = await db.collection("payments").findOne({
      shop,
      orderId,
      status: { $in: ["pending"] },
    });

    if (existingPayment && existingPayment.linkPaymentUrl) {
      // Payment link already exists, return it
      return new Response(
        JSON.stringify({
          success: true,
          paymentUrl: existingPayment.linkPaymentUrl,
          paymentId: existingPayment.linkPaymentId,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ✅ Build order details object
    const orderDetails: OrderDetails = {
      lineItems: lineItems || [],
      shippingAddress,
      billingAddress,
      email,
      phone,
      subtotal: subtotal?.toString() || "0",
      shipping: shipping?.toString() || "0",
      tax: tax?.toString() || "0",
      discount,
      total: total?.toString() || amount.toString(),
      currency,
      note,
    };

    // ✅ Create payment link via LINK API
    const host = url.origin;
    const paymentLink = await createPaymentLink({
      businessId: config.linkBusinessId,
      amount,
      currency: currency as "RLUSD" | "USDC",
      orderId,
      orderName,
      successUrl: `${host}/payment/success?order_id=${orderId}`,
      cancelUrl: `${host}/payment/cancel?order_id=${orderId}`,
      webhookUrl: `${host}/api/webhooks/link`,
      metadata: { shop, xrplAddress: config.xrplAddress },
    });

    // ✅ Get Shopify admin to create draft order
    let draftOrderId: string | undefined;
    let draftOrderUrl: string | undefined;

    try {
      const { admin } = await unauthenticated.admin(sessionToken.dest);
      // console.log({ admin });
      // Create draft order on Shopify
      const draftOrder = await admin.graphql(`
        mutation CreateDraftOrder($input: DraftOrderInput!) {
          draftOrderCreate(input: $input) {
            draftOrder {
              id
              invoiceUrl
            }
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: {
          input: {
            lineItems: (lineItems || []).map((item: any) => ({
              variantId: item.variant?.id || item.id,
              quantity: item.quantity,
              customPrice: item.price,
            })),
            shippingAddress,
            billingAddress,
            email,
            phone,
            note,
            appliedDiscount: discount ? {
              description: discount.code,
              value: discount.amount,
              valueType: "FIXED_AMOUNT",
            } : undefined,
          },
        },
      });
      // console.log({ draftOrder });
      const draftOrderData = await draftOrder.json();
      // console.log({ draftOrderData });
      if (draftOrderData.data.draftOrderCreate.draftOrder?.id) {
        draftOrderId = draftOrderData.data.draftOrderCreate.draftOrder.id;
        draftOrderUrl = draftOrderData.data.draftOrderCreate.draftOrder.invoiceUrl;
        console.log(`✅ Draft Order Created: ${draftOrderId}`);
      }
    } catch (draftError) {
      console.error("⚠️ Error creating draft order:", draftError);
      // Don't fail payment creation if draft order fails
    }

    // ✅ Store payment with full order details
    const paymentId = `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const paymentDoc: any = {
      id: paymentId,
      shop,
      orderId,
      orderName,
      linkPaymentId: paymentLink.paymentId,
      linkPaymentUrl: paymentLink.paymentUrl,
      amount: amount.toString(),
      currency,
      status: "pending",
      orderDetails, // ✅ Store full order details
      draftOrderId,
      draftOrderCreatedAt: draftOrderId ? new Date() : undefined,
      draftOrderUrl,
      paymentHistory: [
        {
          timestamp: new Date(),
          action: "created",
          details: {
            linkPaymentId: paymentLink.paymentId,
            draftOrderId,
          },
        },
      ],
      metadata: { xrplAddress: config.xrplAddress },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.collection("payments").updateOne(
      { linkPaymentId: paymentLink.paymentId },
      { $set: paymentDoc },
      { upsert: true }
    );

    return new Response(
      JSON.stringify({
        success: true,
        paymentUrl: paymentLink.paymentUrl,
        paymentId: paymentLink.paymentId,
        draftOrderId,
        draftOrderUrl,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error creating payment link:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to create payment link",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};