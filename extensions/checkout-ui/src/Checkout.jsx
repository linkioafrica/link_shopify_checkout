import { useState } from "preact/hooks";
import { render } from "preact";
import {
  useBuyerJourneyIntercept,
  useShippingAddress,
  useEmail,
  usePhone
} from '@shopify/ui-extensions/checkout/preact';


export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [paymentUrl, setPaymentUrl] = useState(null);
  const [isConfigured, setIsConfigured] = useState(true);
  const app_url = "https://link-shopify-goldfish-app-rlrny.ondigitalocean.app" 
  // 1. Get essential checkout data
  const shippingAddress = useShippingAddress();
  const email = useEmail();

  const phone = usePhone();
  // Helper function to check if the checkout has sufficient data

  const isCheckoutReady = () => {
    // Extract values correctly (Shopify returns objects)
    const emailValue = email || "";
    const phoneValue = phone || "";

    const addressReady =
      shippingAddress &&
      shippingAddress.city &&
      shippingAddress.city.trim().length > 0 &&
      shippingAddress.address1 &&
      shippingAddress.address1.trim().length > 0;
      shippingAddress.zip &&
      shippingAddress.zip.trim().length > 0;

    const contactReady =
      (emailValue && emailValue.trim().length > 0) ||
      (phoneValue && phoneValue.trim().length > 0);

    return addressReady && contactReady;
  };

  // 2. Implement the Buyer Journey Intercept
  useBuyerJourneyIntercept(() => {
    const ready = isCheckoutReady();
    // If checkout is NOT ready AND no payment link created yet → BLOCK
    if (!ready && !paymentUrl && !isLoading) {
      return {
        behavior: "block",
        reason: "Missing required details",
        errors: [
          {
            message: "Please enter your email or phone and shipping details.",
            field: "contact_information",
          },
        ],
      };
    }

    // Allow checkout progression
    return { behavior: "allow" };
  });
  console.log(isCheckoutReady());
  const handlePayWithLink = async () => {
    if (!isCheckoutReady()) {
      // This error block should technically not be reached if the button is correctly disabled,
      // but it serves as a final programmatic safeguard.
      setError("Please ensure you have filled out all required shipping and contact information before paying.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setPaymentUrl(null);

    try {
      // Assuming these global shopify objects are accessible from your setup
      const totalAmount = shopify.cost.totalAmount.value.amount;
      const currency = shopify.cost.totalAmount.value.currencyCode;
      const checkoutId = shopify.checkoutToken.value;

      // 2. Session token
      const token = await shopify.sessionToken.get();

      // 3. XRPL supported currency
      const xrplCurrency = currency === "USD" ? "RLUSD" : "RLUSD";

      // 4. Request backend (Your existing logic)
      const response = await fetch(
        `${app_url}/api/payment/create?shop=${shopify.shop.myshopifyDomain}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          body: JSON.stringify({
            orderId: checkoutId,
            orderName: `Order ${checkoutId.slice(-8)}`,
            amount: totalAmount,
            currency: xrplCurrency,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 400 && data.error?.includes("not configured")) {
          setIsConfigured(false);
          setError("LINK payment gateway is not configured.");
        } else {
          setError(data.error || "Failed to create payment link");
        }
        return;
      }

      // 5. Store the URL for manual button click
      if (data.paymentUrl) {
        setPaymentUrl(data.paymentUrl); // Shopify-safe
      } else {
        setError("No payment URL received");
      }
    } catch (err) {
      setError(err.message || "Error initiating payment");
    } finally {
      setIsLoading(false);
    }
  };

  if (!isConfigured) return null;

  // The button is disabled if data is missing (not ready), or if it's loading
  const buttonDisabled = isLoading || !isCheckoutReady();

  return (
    <s-stack direction="block" gap="base" >

      {/* Pay with LINK button */}
      <s-stack direction="inline" gap="base">
        <s-button
          variant="secondary"
          onClick={handlePayWithLink}
          loading={isLoading}
          disabled={buttonDisabled} // <-- This is the core control
          inlineSize='fill'
        >
          <s-stack direction="inline" gap="small">
            <s-text>Pay with RLUSD</s-text>
          </s-stack>
        </s-button>
      </s-stack>

      {/* Warning/Error if checkout data is missing */}
      {!isCheckoutReady() && (
        <s-banner tone="warning">
          <s-text>Please complete your shipping and contact details above before creating the payment link.</s-text>
        </s-banner>
      )}

      {/* Loading banner */}
      {isLoading && (
        <s-banner tone="info">
          <s-stack direction="inline" gap="small">
            <s-spinner size="small" />
            <s-text>Creating secure payment link...</s-text>
          </s-stack>
        </s-banner>
      )}

      {/* Error banner */}
      {error && (
        <s-banner tone="critical">
          <s-text>{error}</s-text>
        </s-banner>
      )}

      {/* Success → Show OPEN LINK button */}
      {paymentUrl && (
        <s-banner tone="success">
          <s-stack direction="block" gap="small">
            <s-text>Payment link is ready.</s-text>
            <s-button
              variant="primary"
              href={paymentUrl}
              target="_blank"
            >
              <s-text>Open LINK Payment</s-text>
            </s-button>
            <s-text>
              Complete your payment in the new tab using RLUSD on XRPL.
            </s-text>
          </s-stack>
        </s-banner>
      )}

      {/* Footer */}
      <s-stack direction="block" gap="small">
        <s-text>
          Pay securely with cryptocurrency on the XRP Ledger
        </s-text>
        <s-text>
          Supported: RLUSD
        </s-text>
        <s-text>
          Compatible wallets: GemWallet, Crossmark, more
        </s-text>
      </s-stack>
    </s-stack>
  );
}