import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useSubmit, useLoaderData, useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { initMongo } from "../db.server";

// JSON helper
const json = (data: any, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", ...init?.headers },
    status: init?.status || 200,
  });

// ---------------------- LOADER ----------------------
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const { db } = await initMongo();

  // Get merchant configuration
  const config = await db.collection("merchant_configs").findOne({ shop });

  // Get recent payments
  const recentPayments = await db
    .collection("payments")
    .find({ shop })
    .sort({ createdAt: -1 })
    .limit(10)
    .toArray();

  return json({
    config: config
      ? {
        linkBusinessId: config.linkBusinessId,
        xrplAddress: config.xrplAddress,
        enabled: config.enabled,
      }
      : null,
    recentPayments: recentPayments.map((p) => ({
      _id: p._id.toString(),
      orderName: p.orderName,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      createdAt: p.createdAt,
      xrplTxHash: p.xrplTxHash,
    })),
  });
};

// ---------------------- ACTION ----------------------
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const linkBusinessId = formData.get("linkBusinessId") as string;
  const xrplAddress = formData.get("xrplAddress") as string;

  if (!linkBusinessId || !xrplAddress) {
    return json({ success: false, error: "Both LINK Business ID and XRPL Address are required" }, { status: 400 });
  }

  if (!xrplAddress.startsWith("r") || xrplAddress.length < 25) {
    return json({ success: false, error: "Invalid XRPL address format" }, { status: 400 });
  }

  try {
    const { db } = await initMongo();

    await db.collection("merchant_configs").updateOne(
      { shop },
      { $set: { linkBusinessId, xrplAddress, enabled: true, updatedAt: new Date() } },
      { upsert: true }
    );

    return json({ success: true, message: "Configuration saved successfully" });
  } catch (error) {
    console.error("Error saving configuration:", error);
    return json({ success: false, error: "Failed to save configuration" }, { status: 500 });
  }
};

// ---------------------- REACT COMPONENT ----------------------
export default function Index() {
  const { config, recentPayments } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();

  const [linkBusinessId, setLinkBusinessId] = useState(config?.linkBusinessId || "");
  const [xrplAddress, setXrplAddress] = useState(config?.xrplAddress || "");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (actionData) setIsSaving(false);
  }, [actionData]);

  const handleSubmit = () => {
    setIsSaving(true);
    const form = new FormData();
    form.append("linkBusinessId", linkBusinessId);
    form.append("xrplAddress", xrplAddress);
    submit(form, { method: "post" });
  };

  return (
    <s-page heading="LINK Checkout Configuration">
      {/* SUCCESS / ERROR BANNERS */}
      {actionData && actionData?.success && actionData?.message && (
        <s-banner tone="success">{actionData.message}</s-banner>
      )}
      {actionData && actionData.error && (
        <s-banner tone="critical">{actionData.error}</s-banner>
      )}

      {/* MAIN SETTINGS SECTION */}
      <s-section heading="Payment Gateway Settings">
        <s-text>
          Configure your LINK Business credentials to accept XRPL payments (RLUSD) at checkout.
        </s-text>

        <s-stack direction="block" gap="base">
          <s-text-field
            label="LINK Business ID"
            placeholder="Enter your LINK Business ID"
            value={linkBusinessId}
            onInput={(e: any) => setLinkBusinessId(e.target.value)}
          />
          <s-text-field
            label="XRPL Receiving Address"
            placeholder="rXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
            value={xrplAddress}
            onInput={(e: any) => setXrplAddress(e.target.value)}
          />

          <s-stack direction="inline">
            <s-button
              variant="primary"
              onClick={handleSubmit}
              {...(isSaving ? { loading: true } : {})}
            >
              Save Configuration
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      {/* SIDEBAR SECTIONS */}
      <s-section slot="aside" heading="Status">
        <s-stack gap="base">
          <s-text>Gateway Status:</s-text>
          {config?.enabled ? (
            <s-badge tone="success">Active</s-badge>
          ) : (
            <s-badge tone="warning">Not Configured</s-badge>
          )}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Supported Currencies">
        <s-stack gap="base">
          <s-stack direction="inline" gap="small">
            <s-badge>RLUSD</s-badge>
            <s-text tone="info">Ripple USD</s-text>
          </s-stack>
        </s-stack>
      </s-section>

      {/* RECENT PAYMENTS */}
      <s-section heading="Recent Payments">
        {recentPayments.length === 0 ? (
          <s-text tone="info">
            No payments yet. Payments will appear once customers start using LINK checkout.
          </s-text>
        ) : (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e1e3e5" }}>
                    <th style={{ padding: "12px", textAlign: "left" }}>Order</th>
                    <th style={{ padding: "12px", textAlign: "left" }}>Amount</th>
                    <th style={{ padding: "12px", textAlign: "left" }}>Status</th>
                    <th style={{ padding: "12px", textAlign: "left" }}>Date</th>
                    <th style={{ padding: "12px", textAlign: "left" }}>TX Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map((p) => (
                    <tr key={p._id} style={{ borderBottom: "1px solid #f1f2f3" }}>
                      <td style={{ padding: "12px" }}>{p.orderName}</td>
                      <td style={{ padding: "12px" }}>
                        {p.amount} {p.currency}
                      </td>
                      <td style={{ padding: "12px" }}>
                        <s-badge
                          tone={
                            p.status === "completed"
                              ? "success"
                              : p.status === "pending"
                                ? "info"
                                : p.status === "failed"
                                  ? "critical"
                                  : p.status === "expired"
                                    ? "warning"
                                    : undefined
                          }
                        >
                          {p.status}
                        </s-badge>
                      </td>
                      <td style={{ padding: "12px" }}>
                        <s-text tone="info">
                          {new Date(p.createdAt).toLocaleDateString()}
                        </s-text>
                      </td>
                      <td style={{ padding: "12px" }}>
                        {p.xrplTxHash ? (
                          <a
                            href={`https://livenet.xrpl.org/transactions/${p.xrplTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "#2c6ecb" }}
                          >
                            {p.xrplTxHash.slice(0, 8)}...
                          </a>
                        ) : (
                          <s-text tone="info">-</s-text>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
