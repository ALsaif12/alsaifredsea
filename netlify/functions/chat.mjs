// Al Saif Concierge — the AI chat's server half.
//
// The browser sends the conversation + a live snapshot of the app's data;
// this function calls Claude and returns the raw response. Claude's tool
// calls (create_booking, add_villa, request_car) are executed BY THE BROWSER
// with the same Supabase client + conflict checks the rest of the app uses,
// then the loop continues here. One invocation = exactly one model call,
// which keeps every request comfortably inside Netlify's function timeout.
//
// The system prompt and tool schemas live here — not in the page — so this
// endpoint can only ever act as the family concierge, never as a
// general-purpose Claude proxy for whoever finds the URL.
//
// Setup: set ANTHROPIC_API_KEY in Netlify → Site configuration →
// Environment variables. Optional: CHAT_MODEL, CHAT_EFFORT.

import Anthropic from "@anthropic-ai/sdk";

const TOOLS = [
  {
    name: "create_booking",
    description:
      "Create a villa booking once ALL required details are gathered from the user: which villa, exact check-in and check-out dates, guest count, and guest names (ask for names; pass [] only if the user declines to give them). Check the bookings snapshot for date conflicts BEFORE calling — never call this for dates that overlap an existing booking on the same villa.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        property_id: { type: "string", description: "The villa's id from the PROPERTIES snapshot" },
        start_date: { type: "string", description: "Check-in date, YYYY-MM-DD" },
        end_date: { type: "string", description: "Check-out date, YYYY-MM-DD — must be after start_date; the checkout morning frees the villa" },
        guest_count: { type: "integer", description: "Total number of guests, at least 1" },
        guest_names: { type: "array", items: { type: "string" }, description: "Guest names; [] only if the user declined to name them" },
        purpose: { type: "string", enum: ["family", "friends", "pr"], description: "Who the stay is for" },
        notes: { type: "string", description: "Optional notes (arrival time, chef, occasion). \"\" if none" }
      },
      required: ["property_id", "start_date", "end_date", "guest_count", "guest_names", "purpose", "notes"],
      additionalProperties: false
    }
  },
  {
    name: "add_villa",
    description:
      "Add a new villa to the family portfolio once the required details are gathered: name, location, bedrooms, and nightly rate in SAR. Hotel brand and description are optional.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Villa name, e.g. \"Rosewood — 4BR Villa\"" },
        hotel: { type: "string", description: "Hotel/brand, e.g. \"Rosewood\". \"\" to default to the name" },
        location: { type: "string", description: "Where it is, e.g. \"Shura Island\" or \"Amaala\"" },
        bedrooms: { type: "integer", description: "Number of bedrooms, at least 1" },
        nightly_rate_sar: { type: "number", description: "Full hotel nightly rate in SAR (the family's share is 40% of this)" },
        description: { type: "string", description: "Optional description. \"\" if none" },
        is_owned: { type: "boolean", description: "true if the family owns it outright (not in a rental program)" }
      },
      required: ["name", "hotel", "location", "bedrooms", "nightly_rate_sar", "description", "is_owned"],
      additionalProperties: false
    }
  },
  {
    name: "request_car",
    description:
      "Raise a car/transport request in the family's shared inbox once the required details are gathered: passengers, number of cars, car type, pickup location, and pickup date & time. Destination villa and notes are optional.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        passengers: { type: "integer", description: "How many people need transport, at least 1" },
        cars: { type: "integer", description: "How many cars, at least 1" },
        car_type: { type: "string", enum: ["sedan", "van"], description: "Type of car" },
        pickup_location: { type: "string", description: "Where from — usually \"Red Sea Int’l\" or \"Al Wajh\"" },
        pickup_at: { type: "string", description: "Pickup date & time as ISO 8601, e.g. 2026-10-12T14:30 (family's local time)" },
        for_whom: { type: "string", enum: ["family", "friends", "pr"], description: "Who the cars are for" },
        property_id: { type: "string", description: "Destination villa id from the PROPERTIES snapshot, or \"\" if not tied to a villa" },
        notes: { type: "string", description: "Flight number, child seats, etc. \"\" if none" }
      },
      required: ["passengers", "cars", "car_type", "pickup_location", "pickup_at", "for_whom", "property_id", "notes"],
      additionalProperties: false
    }
  }
];

const buildSystem = (data) => `You are the Al Saif family concierge — the AI inside the family's private Red Sea villa booking app. You help the four family members book stays, add villas, arrange cars, and understand their year. Warm, capable, brief — like the best hotel concierge they know. Reply in the language the user writes in (English or Arabic).

CURRENT USER: ${data?.user?.name || "unknown"} (id: ${data?.user?.id || "?"}). Today is ${data?.today || "unknown"}, local time ${data?.now || "?"}.

LIVE APP DATA (source of truth — never invent bookings, villas, or numbers):
${JSON.stringify(data?.snapshot || {}, null, 0)}

HOW THE APP WORKS
- Dates are half-open [check-in, check-out): the checkout morning frees the villa, so a stay may START on the same day another ENDS. Any other overlap on the same villa is a conflict — the database physically rejects it.
- "Shadow value" = what a stay was worth to give away = 40% of the villa's full nightly rate × nights. The operator keeps the other 60%. Always use the 40% figure for value questions.
- Seasonality: these villas realistically rent only in season (the cooler months); most of the year they would sit unrented anyway. When analyzing value or occupancy, say so — shadow value is an upper bound, and off-season stays cost the family almost nothing in forgone rent. Occupancy percentages in the app are over the full 365 days.
- Villas with is_owned=true (the Four Seasons home) are never rented out — staying there never forgoes revenue.

BEFORE CALLING A TOOL — gather what's required, in ONE compact question when several things are missing:
- create_booking needs: villa + exact dates + guest count + guest names (ask; if they decline, proceed with []). Notes optional. Check the snapshot for conflicts first; if the dates are taken, say who has it and offer the nearest free dates.
- request_car needs: passengers + cars + type (sedan/van) + pickup place + pickup date & time. Destination villa and notes optional.
- add_villa needs: name + location + bedrooms + nightly rate (SAR). Brand and description optional.
Never call a tool with guessed or made-up required values. Confirm what you did in one short sentence after the tool result comes back. If a tool result reports an error, explain it simply and continue helping.

Keep answers short — a few sentences, or a tight list when comparing. No markdown headings. You only know what's in this app; for anything else, answer briefly from general knowledge or say it's outside your desk.`;

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "missing_key" }, { status: 500 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_request" }, { status: 400 }); }
  const { messages, data } = body || {};
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 80 ||
      JSON.stringify(messages).length > 200_000) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: process.env.CHAT_MODEL || "claude-opus-5",
      max_tokens: 2048,
      // Refusal fallbacks: on a policy decline the API re-runs the request on a
      // fallback model inside the same call, instead of returning nothing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Low effort keeps concierge replies snappy and inside the function timeout.
      output_config: { effort: process.env.CHAT_EFFORT || "low" },
      system: buildSystem(data),
      tools: TOOLS,
      messages
    });
    return Response.json(response);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return Response.json({ error: "bad_key" }, { status: 500 });
    if (err instanceof Anthropic.RateLimitError) return Response.json({ error: "rate_limited" }, { status: 429 });
    if (err instanceof Anthropic.APIError) return Response.json({ error: "api_error", detail: err.message }, { status: 502 });
    return Response.json({ error: "unknown", detail: String(err) }, { status: 500 });
  }
};

export const config = { path: "/api/chat" };
