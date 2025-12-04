import type { ActionFunctionArgs, LoaderFunction } from "react-router";
import { authenticate } from "../shopify.server";
import { createPaymentLink } from "../services/link.server";
import { initMongo } from "../db.server";

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
    const shop = url.searchParams.get("shop") || request.headers.get("x-shopify-shop") || "";

    const body = await request.json();
    const { orderId, orderName, amount, currency } = body;

    if (!orderId || !orderName || !amount || !currency) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { db } = await initMongo();

    // Get merchant configuration
    const config = await db.collection("merchant_configs").findOne({ shop });

    if (!config || !config.enabled) {
      return new Response(
        JSON.stringify({ error: "LINK payment gateway not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if payment already exists (idempotency)
    const existingPayment = await db.collection("payments").findOne({
      shop,
      orderId,
      status: { $in: ["pending", "completed"] },
    });

    if (existingPayment && existingPayment.linkPaymentUrl) {
      return new Response(
        JSON.stringify({
          success: true,
          paymentUrl: existingPayment.linkPaymentUrl,
          paymentId: existingPayment.linkPaymentId,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create payment link via LINK API
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

    console.log("paymentLink", paymentLink);

    // Store payment in MongoDB
    await db.collection("payments").updateOne(
      { _id: existingPayment?._id || `new-${orderId}-${Date.now()}` },
      {
        $set: {
          linkPaymentId: paymentLink.paymentId,
          linkPaymentUrl: paymentLink.paymentUrl,
          status: "pending",
          updatedAt: new Date(),
        },
        $setOnInsert: {
          shop,
          orderId,
          orderName,
          amount: amount.toString(),
          currency,
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    return new Response(
      JSON.stringify({
        success: true,
        paymentUrl: paymentLink.paymentUrl,
        paymentId: paymentLink.paymentId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error creating payment link:", error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Failed to create payment link",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};
