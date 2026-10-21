
const STRIPE_API = "https://api.stripe.com/v1";

export default async (request) => {
  if (request.method !== "GET") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405 }
    );
  }

  try {
    const secretKey = Netlify.env.get("STRIPE_SECRET_KEY");

    if (!secretKey) {
      throw new Error("Stripe configuration missing");
    }

    const url = new URL(request.url);
    const sessionId = url.searchParams.get("session_id");

    if (!sessionId || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
      return Response.json(
        { error: "Invalid checkout session" },
        { status: 400 }
      );
    }

    const response = await fetch(
      `${STRIPE_API}/checkout/sessions/${sessionId}`,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`
        }
      }
    );

    const session = await response.json();

    if (!response.ok) {
      console.error("Stripe verification failed:", {
        status: response.status,
        code: session.error?.code
      });

      return Response.json(
        { error: "Unable to verify payment" },
        { status: 502 }
      );
    }

    const priceId = Netlify.env.get(
      "STRIPE_REGISTRATION_PRICE_ID"
    );

    const paid =
      session.payment_status === "paid" &&
      session.status === "complete" &&
      session.mode === "payment" &&
      session.amount_total === 5000 &&
      session.currency === "usd" &&
      session.metadata?.registration_type ===
        "surprise_piano_registration" &&
      session.metadata?.registration_price_id === priceId;

    return Response.json({
      paid,
      status: paid ? "paid" : "pending"
    });

  } catch (error) {
    console.error("Payment verification error:", error.message);

    return Response.json(
      { error: "Payment verification unavailable" },
      { status: 500 }
    );
  }
};

export const config = {
  path: "/api/verify-registration-payment"
};
