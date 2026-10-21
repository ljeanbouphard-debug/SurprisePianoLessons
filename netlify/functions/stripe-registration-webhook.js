
import { createHmac, timingSafeEqual } from "node:crypto";

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const webhookSecret = Netlify.env.get("STRIPE_WEBHOOK_SECRET");

  if (!webhookSecret) {
    console.error("Stripe webhook secret is missing");
    return new Response("Webhook not configured", { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  const payload = await request.text();

  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  const parts = signature.split(",");
  const timestamp = parts.find(p => p.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter(p => p.startsWith("v1="))
    .map(p => p.slice(3));

  if (!timestamp || !signatures.length) {
    return new Response("Invalid signature", { status: 400 });
  }

  const timestampNumber = Number(timestamp);

  if (
    !Number.isFinite(timestampNumber) ||
    Math.abs(Date.now() / 1000 - timestampNumber) > 300
  ) {
    return new Response("Expired signature", { status: 400 });
  }

  const expected = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  const valid = signatures.some(sig => {
    if (!/^[a-f0-9]{64}$/i.test(sig)) return false;

    return timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(sig, "hex")
    );
  });

  if (!valid) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event;

  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = event.data?.object;

    if (session?.payment_status === "paid") {
      console.log("Verified paid registration event", {
        eventId: event.id,
        sessionId: session.id
      });
    }
  }

  return Response.json({ received: true });
};

export const config = {
  path: "/api/stripe-registration-webhook"
};
