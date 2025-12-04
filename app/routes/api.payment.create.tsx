import type { ActionFunctionArgs, LoaderFunction } from "react-router";
import prisma from "../db.server";
import { createPaymentLink } from "../services/link.server";
import { authenticate, unauthenticated } from "../shopify.server";

export const loader: LoaderFunction = async ({ request }) => {
  console.log({ request });
  await authenticate.public.checkout(request);
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
  return new Response(
    JSON.stringify({ error: "Missing required fields" }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
};
export const action = async ({ request }: ActionFunctionArgs) => {

  const { sessionToken } = await authenticate.public.checkout(request);
  // console.log("sessionToken", sessionToken);
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };

  try {
    // // Handle preflight requests
    // if (request.method === "OPTIONS") {
    //   return new Response(null, { status: 204, headers: corsHeaders });
    // }

    // Get shop from request URL or headers
    const url = new URL(request.url);
    const shop =
      url.searchParams.get("shop") ||
      request.headers.get("x-shopify-shop") ||
      "";

    const body = await request.json();
    const { orderId, orderName, amount, currency } = body;

    if (!orderId || !orderName || !amount || !currency) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get merchant configuration
    const config = await prisma.merchantConfig.findUnique({ where: { shop } });

    if (!config || !config.enabled) {
      return new Response(
        JSON.stringify({ error: "LINK payment gateway not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if payment already exists (idempotency)
    const existingPayment = await prisma.payment.findFirst({
      where: {
        shop,
        orderId,
        status: { in: ["pending", "completed"] },
      },
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
    const host = new URL(request.url).origin;
    const paymentLink = await createPaymentLink({
      businessId: config.linkBusinessId,
      amount,
      currency: currency as "RLUSD" | "USDC",
      orderId,
      orderName,
      successUrl: `${host}/payment/success?order_id=${orderId}`,
      cancelUrl: `${host}/payment/cancel?order_id=${orderId}`,
      webhookUrl: `${host}/api/webhooks/link`,
      metadata: {
        shop,
        xrplAddress: config.xrplAddress,
      },
    });
    console.log("paymentLink", paymentLink);
    // Store payment in database
    await prisma.payment.upsert({
      where: { id: existingPayment?.id || `new-${orderId}-${Date.now()}` },
      update: {
        linkPaymentId: paymentLink.paymentId,
        linkPaymentUrl: paymentLink.paymentUrl,
        status: "pending",
        updatedAt: new Date(),
      },
      create: {
        shop,
        orderId,
        orderName,
        linkPaymentId: paymentLink.paymentId,
        linkPaymentUrl: paymentLink.paymentUrl,
        amount: amount.toString(),
        currency,
        status: "pending",
      },
    });

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
