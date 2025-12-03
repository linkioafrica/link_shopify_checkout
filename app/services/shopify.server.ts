
export interface OrderUpdateData {
  orderId: string;
  transactionHash: string;
  amount: string;
  currency: string;
  confirmations?: number;
}

/**
 * Marks a Shopify order as paid and adds transaction details
 */
export async function markOrderAsPaid(
  admin: any,
  data: OrderUpdateData
): Promise<void> {
  try {
    // Get the order details first
    const orderResponse = await admin.rest.resources.Order.find({
      session: admin.rest.session,
      id: data.orderId,
    });

    if (!orderResponse) {
      throw new Error(`Order ${data.orderId} not found`);
    }

    // Add a note to the order with transaction details
    const note = `XRPL Payment Completed
    Transaction Hash: ${data.transactionHash}
    Amount: ${data.amount} ${data.currency}
    Confirmations: ${data.confirmations || 0}
    Network: XRPL Mainnet`;

    // Update order with note
    await admin.rest.resources.Order.find({
      session: admin.rest.session,
      id: data.orderId,
    }).then(async (order: any) => {
      order.note = note;
      await order.save({
        update: true,
      });
    });

    // Create a transaction to mark the order as paid
    const transaction = new admin.rest.resources.Transaction({
      session: admin.rest.session,
    });
    transaction.order_id = parseInt(data.orderId);
    transaction.kind = "capture";
    transaction.status = "success";
    transaction.amount = data.amount;
    transaction.currency = data.currency;
    transaction.gateway = "LINK (XRPL)";
    transaction.source_name = "web";
    transaction.message = `XRPL Transaction: ${data.transactionHash}`;

    await transaction.save({
      update: true,
    });

    // Add timeline event
    await admin.rest.resources.Event.all({
      session: admin.rest.session,
      filter: "Order",
      verb: "paid",
    });

    console.log(`Order ${data.orderId} marked as paid with XRPL tx ${data.transactionHash}`);
  } catch (error) {
    console.error("Error marking order as paid:", error);
    throw new Error(`Failed to update Shopify order: ${error}`);
  }
}

/**
 * Cancels a Shopify order
 */
export async function cancelOrder(
  admin: any,
  orderId: string,
  reason: string
): Promise<void> {
  try {
    const order = await admin.rest.resources.Order.find({
      session: admin.rest.session,
      id: orderId,
    });

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Add cancellation note
    order.note = `${order.note || ""}\n\nPayment cancelled: ${reason}`;
    await order.save({
      update: true,
    });

    // Cancel the order
    const cancel = new admin.rest.resources.Order({
      session: admin.rest.session,
    });
    cancel.id = parseInt(orderId);
    await cancel.cancel({
      reason: "customer",
      email: false,
    });

    console.log(`Order ${orderId} cancelled: ${reason}`);
  } catch (error) {
    console.error("Error cancelling order:", error);
    throw new Error(`Failed to cancel Shopify order: ${error}`);
  }
}

/**
 * Gets order details
 */
export async function getOrder(
  admin: any,
  orderId: string
) {
  try {
    const order = await admin.rest.resources.Order.find({
      session: admin.rest.session,
      id: orderId,
    });

    return order;
  } catch (error) {
    console.error("Error getting order:", error);
    throw new Error(`Failed to get Shopify order: ${error}`);
  }
}
