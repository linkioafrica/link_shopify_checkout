import { useState } from "preact/hooks";
import { render } from "preact";
import {
  useBuyerJourneyIntercept,
  useShippingAddress,
  useEmail,
  usePhone,
  useDeliveryGroups,
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
  const shippingAddress = useShippingAddress();
  const email = useEmail();
  const phone = usePhone();
  const deliveryGroups = useDeliveryGroups();

  // Helper function to check if order contains physical products
  const hasPhysicalProducts = () => {
    if (!deliveryGroups || deliveryGroups.length === 0) return false;

    return deliveryGroups.some(group =>
      group.deliveryOptions && group.deliveryOptions.length > 0
    );
  };

  // Helper function to check if the checkout has sufficient data
  const isCheckoutReady = () => {
    const emailValue = email || "";
    const phoneValue = phone || "";
    // Contact information is always required
    const contactReady =
      (emailValue && emailValue.trim().length > 0) ||
      (phoneValue && phoneValue.trim().length > 0);

    if (!contactReady) {
      return false;
    }

    // Address is only required if there are physical products
    if (hasPhysicalProducts()) {
      const addressReady =
        shippingAddress &&
        shippingAddress.city &&
        shippingAddress.city.trim().length > 0 &&
        shippingAddress.address1 &&
        shippingAddress.address1.trim().length > 0 &&
        shippingAddress.zip &&
        shippingAddress.zip.trim().length > 0;

      return addressReady;
    }

    // If only digital products, address not required
    return true;
  };

  // 2. Implement the Buyer Journey Intercept
  useBuyerJourneyIntercept(() => {
    const ready = isCheckoutReady();

    // If checkout is NOT ready AND no payment link created yet → BLOCK
    if (!ready && !paymentUrl && !isLoading) {
      const errors = [];

      const emailValue = email || "";
      const phoneValue = phone || "";
      const contactReady = (emailValue && emailValue.trim().length > 0) || (phoneValue && phoneValue.trim().length > 0);

      if (!contactReady) {
        errors.push({
          message: "Please enter your email or phone number.",
          field: "contact_information",
        });
      }

      if (hasPhysicalProducts()) {
        const addressReady =
          shippingAddress &&
          shippingAddress.city &&
          shippingAddress.city.trim().length > 0 &&
          shippingAddress.address1 &&
          shippingAddress.address1.trim().length > 0 &&
          shippingAddress.zip &&
          shippingAddress.zip.trim().length > 0;

        if (!addressReady) {
          errors.push({
            message: "Please complete your shipping address.",
            field: "shipping_address",
          });
        }
      }

      return {
        behavior: "block",
        reason: "Missing required details",
        errors: errors.length > 0 ? errors : [
          {
            message: "Please complete all required information.",
            field: "general",
          },
        ],
      };
    }

    // Allow checkout progression
    return { behavior: "allow" };
  });

  const handlePayWithLink = async () => {
    if (!isCheckoutReady()) {
      setError("Please ensure you have filled out all required information before paying.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setPaymentUrl(null);

    try {
      // ✅ Capture all order details from checkout
      const totalAmount = shopify.cost.totalAmount.value.amount;
      const currency = shopify.cost.totalAmount.value.currencyCode;
      const checkoutId = shopify.checkoutToken.value;
      const token = await shopify.sessionToken.get();

      // ✅ Extract line items
      const lineItems = shopify.lines.value.map((item) => ({
        id: item.id,
        sku: item.merchandise.sku,
        product_id: item.merchandise.product.id,
        quantity: item.quantity,
        variant: {
          id: item.merchandise.id,
          title: item.merchandise.title,
          sku: item.merchandise.sku,
        },
      }));

      // ✅ Extract addresses
      const shippingAddress = shopify.shippingAddress?.value && {
        firstName: shopify.shippingAddress.value.firstName || "",
        lastName: shopify.shippingAddress.value.lastName || "",
        address1: shopify.shippingAddress.value.address1 || "",
        address2: shopify.shippingAddress.value.address2 || "",
        city: shopify.shippingAddress.value.city || "",
        province: shopify.shippingAddress.value.provinceCode || "",
        zip: shopify.shippingAddress.value.zip || "",
        country: shopify.shippingAddress.value.countryCode || "",
        phone: shopify.shippingAddress.value.phone || "",
      };

      // ✅ Extract costs
      const subtotal = shopify?.cost?.subtotalAmount?.value?.amount || 0;
      const shipping = shopify?.cost?.totalShippingAmount?.value?.amount || shopify?.cost?.totalShippingAmount?.value?.amount || 0;
      const tax = shopify?.cost?.totalTaxAmount?.value?.amount || 0;

      // ✅ Extract discounts
      let discount = null;
      if (shopify?.discountAllocations && shopify.discountAllocations.value.length > 0) {
        const totalDiscount = shopify.discountAllocations?.value.reduce((sum, d) => sum + d.discountedAmount?.amount, 0);
        discount = {
          code: shopify.discountAllocations[0].title || "Discount",
          amount: totalDiscount.toString(),
        };
      }

      const xrplCurrency = currency === "USD" ? "RLUSD" : "RLUSD";

      // ✅ Request backend with FULL order details
      const response = await fetch(
        `${app_url}/api/payment/create`,
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
            // ✅ NEW: Send all order details
            lineItems,
            shippingAddress,
            billingAddress: shippingAddress, // Usually same as shipping
            email: email || "",
            phone: phone || "",
            subtotal,
            shipping,
            tax,
            discount,
            total: totalAmount,
            note: `Crypto payment for order ${checkoutId.slice(-8)}`,
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

      if (data.paymentUrl) {
        setPaymentUrl(data.paymentUrl);
      } else {
        setError("No payment URL received");
      }
    } catch (err) {
      console.log(err);
      setError(err.message || "Error initiating payment");
    } finally {
      setIsLoading(false);
    }
  };

  if (!isConfigured) return null;

  const buttonDisabled = isLoading || !isCheckoutReady();

  return (
    <s-stack direction="block" gap="base">

      {/* Pay with LINK button */}
      <s-stack direction="inline" gap="base">
        <s-button
          variant="secondary"
          onClick={handlePayWithLink}
          loading={isLoading}
          disabled={buttonDisabled}
          inlineSize='fill'
        >
          <s-stack direction="inline" gap="small">
            <s-text>Pay with Fiat Stablecoins</s-text>
          </s-stack>
        </s-button>
      </s-stack>

      {/* Warning/Error if checkout data is missing */}
      {!isCheckoutReady() && (
        <s-banner tone="warning">
          <s-text>
            {hasPhysicalProducts()
              ? "Please complete your shipping and contact details above before creating the payment link."
              : "Please enter your email or phone number before creating the payment link."}
          </s-text>
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
          Pay securely with fiat backed stablecoins in USD, EUR, NGN and more
        </s-text>
        <s-text>
          Supported: RLUSD, USDC, EUROP etc
        </s-text>
        <s-text>
          Compatible wallets: GemWallet, Crossmark, more
        </s-text>
      </s-stack>
    </s-stack>
  );
}