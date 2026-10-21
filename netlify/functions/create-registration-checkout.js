
const STRIPE_API = "https://api.stripe.com/v1";

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const secretKey = Netlify.env.get("STRIPE_SECRET_KEY");
    const priceId = Netlify.env.get("STRIPE_REGISTRATION_PRICE_ID");

    if (!secretKey || !priceId) {
      throw new Error("Stripe configuration missing");
    }

    const data = await request.json();

    const name = String(data.name || "").trim();
    const email = String(data.email || "").trim();
    const phone = String(data.phone || "").trim();
    const lessonType = String(data.lesson_type || "");
    const message = String(data.message || "").trim();

    if (!name || !email || !["Online", "In Person"].includes(lessonType)) {
      return Response.json(
        { error: "Please complete the required fields." },
        { status: 400 }
      );
    }

    const params = new URLSearchParams({
      mode: "payment",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      customer_email: email,
      success_url:
        "https://surprisepianolessons.com/payment-pending.html?session_id={CHECKOUT_SESSION_ID}",
      cancel_url:
        "https://surprisepianolessons.com/#register",
      "metadata[student_name]": name,
      "metadata[student_phone]": phone,
      "metadata[lesson_type]": lessonType,
      "metadata[student_message]": message.slice(0, 500),
"metadata[registration_type]": "surprise_piano_registration",
"metadata[registration_price_id]": priceId
    });

    const response = await fetch(`${STRIPE_API}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    const session = await response.json();

   if (!response.ok || !session.url) {
  console.error("Stripe checkout failed:", {
    status: response.status,
    type: session.error?.type || "unknown",
    code: session.error?.code || "unknown",
    message: session.error?.message || "No error message"
  });

  throw new Error("Unable to create Stripe checkout");
} 

    return Response.json({ url: session.url });
  } catch (error) {
    console.error("Registration checkout error:", error.message);

    return Response.json(
      { error: "Unable to start registration payment." },
      { status: 500 }
    );
  }
};

export const config = {
  path: "/api/create-registration-checkout"
};
