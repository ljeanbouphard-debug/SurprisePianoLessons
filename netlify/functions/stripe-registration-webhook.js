import { createHmac, timingSafeEqual } from "node:crypto";

const STRIPE_API = "https://api.stripe.com/v1";

async function sendRegistrationConfirmation(session) {
  const apiKey = Netlify.env.get("RESEND_API_KEY");
  const from = Netlify.env.get("RESEND_FROM_EMAIL");
  const secretKey = Netlify.env.get("STRIPE_SECRET_KEY");

  if (!apiKey || !from) {
    console.log("Confirmation email skipped: email settings missing", {
      sessionId: session.id
    });
    return;
  }

  const email = session.customer_details?.email || session.customer_email;
  const name = session.metadata?.student_name || "";
  const lessonType = session.metadata?.lesson_type || "";

  if (!email) {
    console.log("Confirmation email skipped: no student email", {
      sessionId: session.id
    });
    return;
  }

  // Idempotency: Stripe can deliver the same event more than once.
  // Read the session's current metadata and skip if already sent.
  if (secretKey) {
    try {
      const check = await fetch(
        `${STRIPE_API}/checkout/sessions/${session.id}`,
        {
          headers: {
            Authorization: `Bearer ${secretKey}`
          }
        }
      );

      const current = await check.json();

      if (check.ok && current.metadata?.confirmation_email_sent === "yes") {
        console.log("Confirmation email already sent", {
          sessionId: session.id
        });
        return;
      }
    } catch (error) {
      console.error("Confirmation check failed:", error.message);
    }
  }

  const firstName = name.split(" ")[0] || "there";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Registration confirmed - Surprise Piano Lessons",
      text: [
        `Hi ${firstName},`,
        "",
        "Great news - your registration with Surprise Piano Lessons is confirmed, and your $50 registration fee has been received. Thank you!",
        "",
        `Lesson type: ${lessonType || "-"}`,
        "Lessons are $30 per hour.",
        "",
        "What happens next: we will contact you soon to schedule your first lesson.",
        "",
        "Questions? Call or WhatsApp us at (240) 860-4218.",
        "",
        "- Surprise Piano Lessons"
      ].join("\n")
    })
  });

  if (!response.ok) {
    console.error("Confirmation email failed:", {
      status: response.status,
      sessionId: session.id
    });
    return;
  }

  console.log("Confirmation email sent", { sessionId: session.id });

  if (secretKey) {
    try {
      await fetch(`${STRIPE_API}/checkout/sessions/${session.id}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          "metadata[confirmation_email_sent]": "yes"
        }).toString()
      });
    } catch (error) {
      console.error("Could not mark confirmation as sent:", error.message);
    }
  }
}

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

    if (
      session?.payment_status === "paid" &&
      session?.metadata?.registration_type ===
        "surprise_piano_registration" &&
      session?.amount_total === 5000 &&
      session?.currency === "usd"
    ) {
      console.log("Verified paid registration event", {
        eventId: event.id,
        sessionId: session.id
      });

      try {
        await sendRegistrationConfirmation(session);
      } catch (error) {
        console.error("Confirmation email error:", error.message);
      }
    }
  }

  return Response.json({ received: true });
};

export const config = {
  path: "/api/stripe-registration-webhook"
};
