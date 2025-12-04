import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { initMongo } from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const { db } = await initMongo();

  // Delete sessions for the shop if session exists
  if (session) {
    await db.collection("sessions").deleteMany({ shop });
  }

  return new Response();
};
