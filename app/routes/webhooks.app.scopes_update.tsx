import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { initMongo } from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { payload, session, topic, shop } = await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);

    const { db } = await initMongo();

    // Update the session's scope if session exists
    if (session) {
        const currentScopes = payload.current as string[];
        await db.collection("sessions").updateOne(
            { id: session.id },
            { $set: { scope: currentScopes.join(",") } }
        );
    }

    return new Response();
};
