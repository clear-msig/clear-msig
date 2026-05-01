// POST /api/nl/parse — turn a free-text send instruction into form
// fields the /send page can prefill.
//
// Request:  { text: string, contactNames: string[] }
// Response: { recipientText?: string, amountSol?: number, note?: string,
//             confidence: "high" | "low",  ambiguity?: string }
//
// "send sarah 5 sol for groceries" → { recipientText: "Sarah",
// amountSol: 5, note: "groceries", confidence: "high" }
//
// We pass the user's contact names in so the model resolves "sarah"
// → an exact match instead of guessing. The /send page then resolves
// the contact name → address via the existing contacts store, no
// additional logic needed there.
//
// Privacy: we send the user's typed text + a list of contact NAMES
// only (no addresses, no email) to Anthropic. The text is bounded
// at 280 chars on the frontend; we re-clamp here as defense.
//
// Cost: ~10-50 input tokens + ~30 output tokens per request on
// claude-haiku-4-5. At Haiku's price that's a fraction of a cent.

import { NextRequest, NextResponse } from "next/server";

const MAX_TEXT_LEN = 280;
const MAX_CONTACTS = 50;
const MODEL = "claude-haiku-4-5";

interface ParseResponse {
  recipientText?: string;
  amountSol?: number;
  note?: string;
  confidence: "high" | "low";
  ambiguity?: string;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Natural-language parsing isn't configured on this server." },
      { status: 503 },
    );
  }

  let body: { text?: string; contactNames?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body must be JSON." },
      { status: 400 },
    );
  }

  const text = (body.text ?? "").trim().slice(0, MAX_TEXT_LEN);
  if (!text) {
    return NextResponse.json(
      { error: "Type something first." },
      { status: 400 },
    );
  }

  const contactNames = Array.isArray(body.contactNames)
    ? body.contactNames
        .filter((c): c is string => typeof c === "string" && c.length > 0)
        .slice(0, MAX_CONTACTS)
    : [];

  // Tool-use call. Forcing the model to invoke the tool gets us
  // strict-shaped JSON without the "extract from prose" dance —
  // saves tokens AND makes the success path a single object access.
  const tool = {
    name: "fill_send_form",
    description:
      "Fill in the fields the user wants for a single send-money request.",
    input_schema: {
      type: "object" as const,
      properties: {
        recipientText: {
          type: "string",
          description:
            "Best match against the contact list, or a raw Solana base58 address if pasted. Empty string when the user's request doesn't pick anyone.",
        },
        amountSol: {
          type: "number",
          description:
            "Amount in SOL the user asked to send. Convert other units to SOL if mentioned (e.g. 'half a sol' → 0.5). Omit when no amount is mentioned or ambiguous.",
        },
        note: {
          type: "string",
          description:
            "Short reason / memo if the user mentioned one ('for groceries', 'rent split'). Omit when there isn't one.",
        },
        confidence: {
          type: "string",
          enum: ["high", "low"],
          description:
            "high when every requested field is unambiguous; low when you guessed.",
        },
        ambiguity: {
          type: "string",
          description:
            "When confidence is low, one short sentence explaining what was unclear.",
        },
      },
      required: ["confidence"],
    },
  };

  const systemPrompt =
    "You parse a single retail user's casual send-money instruction into form fields. " +
    "Always invoke the fill_send_form tool. " +
    "Recipients: prefer matching against the user's saved contacts (case-insensitive); " +
    "if the text contains a base58-looking string (32-44 chars, no 0/I/O/l), keep it verbatim. " +
    "Amounts: parse English ('five', 'half a', 'a couple') and decimals ('1.5'). " +
    "Notes: strip filler like 'for' or 'because'. " +
    "Set confidence=low and explain in `ambiguity` when you guessed.";

  const userPrompt =
    contactNames.length > 0
      ? `Saved contact names: ${contactNames.join(", ")}.\n\nRequest: ${text}`
      : `(No saved contacts — recipient must be a base58 address or omitted.)\n\nRequest: ${text}`;

  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 256,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        tools: [tool],
        tool_choice: { type: "tool", name: "fill_send_form" },
      }),
    });
  } catch (err) {
    console.error("[nl/parse] anthropic fetch failed", err);
    return NextResponse.json(
      { error: "Couldn't reach the parser. Try again." },
      { status: 502 },
    );
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    console.error("[nl/parse] anthropic non-200", resp.status, detail);
    return NextResponse.json(
      { error: "Parser rejected the request." },
      { status: 502 },
    );
  }

  let payload: unknown;
  try {
    payload = await resp.json();
  } catch {
    return NextResponse.json(
      { error: "Parser returned invalid JSON." },
      { status: 502 },
    );
  }

  const parsed = extractToolInput(payload);
  if (!parsed) {
    return NextResponse.json(
      { error: "Parser didn't fill the form. Try rewording." },
      { status: 502 },
    );
  }

  const result: ParseResponse = {
    confidence:
      parsed.confidence === "low" || parsed.confidence === "high"
        ? parsed.confidence
        : "low",
  };
  if (typeof parsed.recipientText === "string" && parsed.recipientText.trim()) {
    result.recipientText = parsed.recipientText.trim();
  }
  if (typeof parsed.amountSol === "number" && isFinite(parsed.amountSol) && parsed.amountSol > 0) {
    result.amountSol = parsed.amountSol;
  }
  if (typeof parsed.note === "string" && parsed.note.trim()) {
    result.note = parsed.note.trim().slice(0, 140);
  }
  if (typeof parsed.ambiguity === "string" && parsed.ambiguity.trim()) {
    result.ambiguity = parsed.ambiguity.trim().slice(0, 200);
  }

  return NextResponse.json(result);
}

interface ToolUseBlock {
  type: "tool_use";
  name?: string;
  input?: {
    recipientText?: unknown;
    amountSol?: unknown;
    note?: unknown;
    confidence?: unknown;
    ambiguity?: unknown;
  };
}

/// Pull the tool_use block out of Anthropic's response. Returns the
/// raw input object — the caller filters/coerces.
function extractToolInput(payload: unknown): ToolUseBlock["input"] | null {
  if (!payload || typeof payload !== "object") return null;
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const block = content.find(
    (b): b is ToolUseBlock =>
      !!b && typeof b === "object" && (b as { type?: unknown }).type === "tool_use",
  );
  return block?.input ?? null;
}
