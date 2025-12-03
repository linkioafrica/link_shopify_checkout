import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useSubmit, useLoaderData, useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";


import prisma from "../db.server";

// 💡 FIX: Import or assume the 'json' helper from the framework
const json = (data: any, init?: ResponseInit) => {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", ...init?.headers },
    status: init?.status || 200,
  });
};


export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get merchant configuration
  const config = await prisma.merchantConfig.findUnique({
    where: { shop },
  });

  // Get recent payments
  const recentPayments = await prisma.payment.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // 💡 FIX APPLIED HERE: Use the json() helper instead of new Response() 
  // to correctly serialize the object and set the headers.
  return json({
    config: config
      ? {
        linkBusinessId: config.linkBusinessId,
        xrplAddress: config.xrplAddress,
        enabled: config.enabled,
      }
      : null,
    recentPayments: recentPayments.map((p) => ({
      id: p.id,
      orderName: p.orderName,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      xrplTxHash: p.xrplTxHash,
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const linkBusinessId = formData.get("linkBusinessId") as string;
  const xrplAddress = formData.get("xrplAddress") as string;

  // Validate required fields
  if (!linkBusinessId || !xrplAddress) {
    // Return a JSON response for errors too
    return json(
      {
        success: false,
        error: "Both LINK Business ID and XRPL Address are required",
      },
      {
        status: 400,
      }
    );
  }

  // Basic XRPL address validation
  if (!xrplAddress.startsWith("r") || xrplAddress?.length < 25) {
    // Return a JSON response for errors too
    return json(
      {
        success: false,
        error: "Invalid XRPL address format",
      },
      {
        status: 400,
      }
    );
  }

  try {
    await prisma.merchantConfig.upsert({
      where: { shop },
      update: {
        linkBusinessId,
        xrplAddress,
        enabled: true,
      },
      create: {
        shop,
        linkBusinessId,
        xrplAddress,
        enabled: true,
      },
    });

    // Return a JSON response for success
    return json(
      {
        success: true,
        message: "Configuration saved successfully",
      },
      {
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error saving configuration:", error);

    // Return a JSON response for errors too
    return json(
      {
        success: false,
        error: "Failed to save configuration",
      },
      {
        status: 500,
      }
    );
  }
};


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
      {actionData?.success && actionData?.message && (
        <s-banner tone="success">{actionData.message}</s-banner>
      )}
      {actionData?.error && (
        <s-banner tone="critical">{actionData.error}</s-banner>
      )}

      {/* MAIN SETTINGS SECTION */}
      <s-section heading="Payment Gateway Settings">
        <s-text>
          Configure your LINK Business credentials to accept XRPL payments
          (RLUSD) at checkout.
        </s-text>

        <s-stack direction="block" gap="base">
          <s-text-field
            label="LINK Business ID"
            placeholder="Enter your LINK Business ID"
            value={linkBusinessId}
            onInput={(e: any) => setLinkBusinessId(e.target.value)}
            help-text="Find this in your LINK Business dashboard under API settings"
          />

          <s-text-field
            label="XRPL Receiving Address"
            placeholder="rXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
            value={xrplAddress}
            onInput={(e: any) => setXrplAddress(e.target.value)}
            help-text="Your XRPL wallet address where payments will be received"
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
            <s-text tone="subdued">Ripple USD</s-text>
          </s-stack>

          {/* <s-stack direction="inline" gap="small">
            <s-badge>USDC</s-badge>
            <s-text tone="subdued">USD Coin</s-text>
          </s-stack> */}
        </s-stack>
      </s-section>

      {/* RECENT PAYMENTS SECTION */}
      <s-section heading="Recent Payments">
        {recentPayments?.length === 0 ? (
          <s-text tone="subdued">
            No payments yet. Payments will appear once customers start
            using LINK checkout.
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
                  {recentPayments?.map((p) => (
                    <tr key={p.id} style={{ borderBottom: "1px solid #f1f2f3" }}>
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


export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};