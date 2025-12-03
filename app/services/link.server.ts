import axios, { AxiosError } from "axios";
import crypto from "crypto";

const LINK_API_BASE_URL = process.env.LINK_API_BASE_URL || "https://api.link.xyz";

export interface CreatePaymentLinkRequest {
  businessId: string;
  amount: string;
  currency: "RLUSD" | "USDC";
  orderId: string;
  orderName: string;
  successUrl: string;
  cancelUrl: string;
  webhookUrl: string;
  metadata?: Record<string, any>;
}

export interface CreatePaymentLinkResponse {
  paymentId: string;
  paymentUrl: string;
  expiresAt: string;
}

export interface WebhookPayload {
  event: string;
  paymentId: string;
  orderId: string;
  amount: string;
  currency: string;
  status: "pending" | "completed" | "failed" | "expired" | "cancelled";
  xrplTxHash?: string;
  confirmations?: number;
  timestamp: string;
  signature: string;
}

/**
 * Creates a LINK payment link for XRPL checkout
 */
export async function createPaymentLink(
  request: CreatePaymentLinkRequest
): Promise<CreatePaymentLinkResponse> {
  try {
    console.log({ request });
    const response = await axios.post(
      `${LINK_API_BASE_URL}/api/payment-link/create-link`,
      {
        business_id: request.businessId,
        business_name: "testing shopify checkout",
        title: "testing shopify checkout",
        payment_amount: request.amount, 
        payment_currency: request.currency,
        checkout_link_duration: 60,
        wallet_address: request?.metadata?.xrplAddress,
        order_id: request.orderId,
        order_name: request.orderName,
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        webhook_url: request.webhookUrl,
        metadata: request.metadata,
        wallet_network: "xrpl",
        link_type: "checkout",
        supported_currencies: ["RLUSD", "USDC"],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Business-ID": request.businessId,
        },
        timeout: 10000,
      }
    );

    console.log(response.data);
    return {
      paymentId: response.data.data.paymentId,
      paymentUrl: response.data.data.paymentUrl,
      expiresAt: response.data.data.expiresAt,
    };
  } catch (error) {
    if (error instanceof AxiosError) {
      console.error("LINK API Error:", {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
      });
      throw new Error(
        `Failed to create LINK payment: ${error.response?.data?.message || error.message}`
      );
    }
    throw error;
  }
}

/**
 * Verifies LINK webhook signature
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  try {
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    console.error("Webhook signature verification error:", error);
    return false;
  }
}

/**
 * Retrieves payment status from LINK API
 */
export async function getPaymentStatus(
  paymentId: string,
  businessId: string
): Promise<{
  status: string;
  xrplTxHash?: string;
  confirmations?: number;
  amount: string;
  currency: string;
}> {
  try {
    const response = await axios.get(
      `${LINK_API_BASE_URL}/v1/payments/${paymentId}`,
      {
        headers: {
          "X-Business-ID": businessId,
        },
        timeout: 10000,
      }
    );

    return {
      status: response.data.status,
      xrplTxHash: response.data.xrpl_tx_hash,
      confirmations: response.data.confirmations,
      amount: response.data.amount,
      currency: response.data.currency,
    };
  } catch (error) {
    if (error instanceof AxiosError) {
      console.error("LINK API Error:", {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
      });
      throw new Error(
        `Failed to get payment status: ${error.response?.data?.message || error.message}`
      );
    }
    throw error;
  }
}
