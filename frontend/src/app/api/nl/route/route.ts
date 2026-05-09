// POST /api/nl/route - parse a free-text wallet instruction and route
// it to the right surface with prefilled state.
//
// /api/nl/parse is send-specific. This endpoint is the broader Months
// 5-6 "natural-language proposal authoring" entry point: a single
// input on the wallet detail page that recognises every retail action
// (send, invite, set limits, change roles, add a chain) and bounces
// the user into the right purpose-built page with the form already
// filled in. The user reviews + signs as usual; we never auto-execute.
//
// Request:  { text: string, walletName: string, contactNames: string[] }
// Response: { action, route, summary, confidence, ambiguity? }
//
// "send sarah 5 sol for groceries"
//   → action=send, route=/app/wallet/<wallet>/send?recipient=Sarah&amount=5&note=groceries
//
// "add mark with email mark@gmail.com"
//   → action=add_friend, route=/app/wallet/.../members/add?name=Mark&email=mark%40gmail.com
//
// The model picks ONE tool from a forced selection; each tool is
// purpose-built so the JSON shape is strict per action. The frontend
// builds the route URL from the structured fields rather than
// trusting the model with arbitrary string output, so a hostile
// prompt cannot inject open-redirect URLs.

import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, clientIp } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";

const MAX_TEXT_LEN = 280;
const MAX_CONTACTS = 50;
const MODEL = "claude-haiku-4-5";

type Action =
  | "send_sol"
  | "send_eth"
  | "add_friend"
  | "set_allowance"
  | "set_budget"
  | "enable_sending"
  | "add_chain"
  | "unknown";

interface RouteResponse {
  action: Action;
  route: string;
  summary: string;
  confidence: "high" | "low";
  ambiguity?: string;
}

export async function POST(request: NextRequest) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const limited = await checkRateLimit("nl/route", clientIp(request), {
    capacity: 20,
    refillPerSec: 1,
  });
  if (limited) return limited;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Natural-language routing isn't configured on this server." },
      { status: 503 },
    );
  }

  let body: { text?: string; walletName?: string; contactNames?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const text = (body.text ?? "").trim().slice(0, MAX_TEXT_LEN);
  if (!text) {
    return NextResponse.json({ error: "Type something first." }, { status: 400 });
  }
  const walletName = (body.walletName ?? "").trim();
  if (!walletName) {
    return NextResponse.json(
      { error: "walletName is required so we know where to route." },
      { status: 400 },
    );
  }
  const contactNames = Array.isArray(body.contactNames)
    ? body.contactNames
        .filter((c): c is string => typeof c === "string" && c.length > 0)
        .slice(0, MAX_CONTACTS)
    : [];

  const tools = buildTools();
  const systemPrompt = buildSystemPrompt();
  const userPrompt =
    contactNames.length > 0
      ? `Wallet: ${walletName}\nSaved contacts: ${contactNames.join(", ")}\n\nUser said: ${text}`
      : `Wallet: ${walletName}\n(No saved contacts.)\n\nUser said: ${text}`;

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
        max_tokens: 384,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        tools,
        // Don't pin a single tool - let the model pick which retail
        // action best fits the user's text. tool_choice "any" forces
        // it to invoke ONE of them rather than emitting prose.
        tool_choice: { type: "any" },
      }),
    });
  } catch (err) {
    console.error("[nl/route] anthropic fetch failed", err);
    return NextResponse.json(
      { error: "Couldn't reach the parser. Try again." },
      { status: 502 },
    );
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    console.error("[nl/route] anthropic non-200", resp.status, detail);
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

  const block = extractToolUse(payload);
  if (!block) {
    return NextResponse.json(
      { error: "Parser didn't pick an action. Try rewording." },
      { status: 502 },
    );
  }

  const route = buildRoute(block.name ?? "", block.input ?? {}, walletName);
  if (!route) {
    return NextResponse.json(
      { error: "Parser returned an unknown action. Try rewording." },
      { status: 502 },
    );
  }
  return NextResponse.json(route);
}

interface ToolUseBlock {
  type: "tool_use";
  name?: string;
  input?: Record<string, unknown>;
}

function extractToolUse(payload: unknown): ToolUseBlock | null {
  if (!payload || typeof payload !== "object") return null;
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  return (
    content.find(
      (b): b is ToolUseBlock =>
        !!b &&
        typeof b === "object" &&
        (b as { type?: unknown }).type === "tool_use",
    ) ?? null
  );
}

// ─── Tool definitions ─────────────────────────────────────────────

function buildTools() {
  return [
    {
      name: "send_sol",
      description: "Compose a SOL send request from this wallet.",
      input_schema: {
        type: "object" as const,
        properties: {
          recipient: {
            type: "string",
            description:
              "Best match against the contact list, or a base58 Solana address. Empty if no recipient is named.",
          },
          amountSol: { type: "number" },
          note: { type: "string" },
          confidence: { type: "string", enum: ["high", "low"] },
          ambiguity: { type: "string" },
        },
        required: ["confidence"],
      },
    },
    {
      name: "send_eth",
      description: "Compose an ETH send request on Sepolia from this wallet.",
      input_schema: {
        type: "object" as const,
        properties: {
          recipient: {
            type: "string",
            description: "0x… Ethereum address. Empty if not provided.",
          },
          amountEth: { type: "number" },
          note: { type: "string" },
          confidence: { type: "string", enum: ["high", "low"] },
          ambiguity: { type: "string" },
        },
        required: ["confidence"],
      },
    },
    {
      name: "add_friend",
      description:
        "Add a friend / member to this wallet so they can approve or propose.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          address: {
            type: "string",
            description: "Base58 Solana address if pasted.",
          },
          role: {
            type: "string",
            enum: ["full", "approver", "watcher"],
            description:
              "full = can spend AND approve. approver = approves only. watcher = local pin, no chain rights.",
          },
          confidence: { type: "string", enum: ["high", "low"] },
          ambiguity: { type: "string" },
        },
        required: ["confidence"],
      },
    },
    {
      name: "set_allowance",
      description:
        "Set or change a per-friend spending allowance on this wallet.",
      input_schema: {
        type: "object" as const,
        properties: {
          friend: {
            type: "string",
            description: "Contact name to apply the allowance to.",
          },
          amountSol: { type: "number" },
          period: { type: "string", enum: ["daily", "weekly", "monthly", "none"] },
          confidence: { type: "string", enum: ["high", "low"] },
          ambiguity: { type: "string" },
        },
        required: ["confidence"],
      },
    },
    {
      name: "set_budget",
      description:
        "Set or change the wallet-wide weekly USD spending cap.",
      input_schema: {
        type: "object" as const,
        properties: {
          weeklyUsd: { type: "number" },
          confidence: { type: "string", enum: ["high", "low"] },
          ambiguity: { type: "string" },
        },
        required: ["confidence"],
      },
    },
    {
      name: "enable_sending",
      description:
        "Enable sending on a chain (Solana or Ethereum). Use this when the user asks to start sending on a new chain.",
      input_schema: {
        type: "object" as const,
        properties: {
          chain: { type: "string", enum: ["solana", "ethereum"] },
          confidence: { type: "string", enum: ["high", "low"] },
          ambiguity: { type: "string" },
        },
        required: ["chain", "confidence"],
      },
    },
    {
      name: "add_chain",
      description:
        "Bind a new chain (Ethereum / Bitcoin / Zcash) to this wallet via Ika dWallet DKG.",
      input_schema: {
        type: "object" as const,
        properties: {
          chain: { type: "string", enum: ["ethereum", "bitcoin", "zcash"] },
          confidence: { type: "string", enum: ["high", "low"] },
          ambiguity: { type: "string" },
        },
        required: ["chain", "confidence"],
      },
    },
  ];
}

function buildSystemPrompt(): string {
  return [
    "You route a single retail user's casual wallet instruction to the right purpose-built page in Clear, a shared-wallet app.",
    "You MUST invoke exactly one of the available tools.",
    "Pick the best-fitting tool: a send goes to send_sol or send_eth (default to send_sol if chain is unspecified), inviting / adding someone goes to add_friend, changing a per-friend cap goes to set_allowance, setting the wallet's weekly cap goes to set_budget, turning on a new chain's sending goes to enable_sending, binding a new chain at all goes to add_chain.",
    "Recipients: prefer matching against the saved contact list (case-insensitive); a base58 string (32-44 chars, no 0/I/O/l) is a Solana address; a 0x-prefixed 40-char hex string is an Ethereum address.",
    "Amounts: parse English ('five', 'half a', 'a couple') and decimals.",
    "Set confidence=low and write a one-sentence ambiguity when you guessed.",
  ].join(" ");
}

// ─── Route construction ──────────────────────────────────────────

function buildRoute(
  toolName: string,
  input: Record<string, unknown>,
  walletName: string,
): RouteResponse | null {
  const wallet = encodeURIComponent(walletName);
  const confidence = pickConfidence(input.confidence);
  const ambiguity = pickString(input.ambiguity, 200) ?? undefined;

  switch (toolName) {
    case "send_sol": {
      const recipient = pickString(input.recipient, 60) ?? "";
      const amount = pickPositiveNumber(input.amountSol);
      const note = pickString(input.note, 140) ?? "";
      const params = new URLSearchParams();
      if (recipient) params.set("recipient", recipient);
      if (amount !== null) params.set("amount", String(amount));
      if (note) params.set("note", note);
      const qs = params.toString();
      return {
        action: "send_sol",
        route: `/app/wallet/${wallet}/send${qs ? `?${qs}` : ""}`,
        summary: amount && recipient
          ? `Send ${amount} SOL to ${recipient}`
          : "Open the SOL send form",
        confidence,
        ambiguity,
      };
    }
    case "send_eth": {
      const recipient = pickString(input.recipient, 60) ?? "";
      const amount = pickPositiveNumber(input.amountEth);
      const note = pickString(input.note, 140) ?? "";
      const params = new URLSearchParams();
      if (recipient) params.set("recipient", recipient);
      if (amount !== null) params.set("amount", String(amount));
      if (note) params.set("note", note);
      const qs = params.toString();
      return {
        action: "send_eth",
        route: `/app/wallet/${wallet}/send/eth${qs ? `?${qs}` : ""}`,
        summary: amount && recipient
          ? `Send ${amount} ETH to ${recipient}`
          : "Open the ETH send form",
        confidence,
        ambiguity,
      };
    }
    case "add_friend": {
      const name = pickString(input.name, 60) ?? "";
      const email = pickString(input.email, 120) ?? "";
      const address = pickString(input.address, 64) ?? "";
      const role = pickString(input.role, 20) ?? "";
      const params = new URLSearchParams();
      if (name) params.set("name", name);
      if (email) params.set("email", email);
      if (address) params.set("address", address);
      if (role) params.set("role", role);
      const qs = params.toString();
      return {
        action: "add_friend",
        route: `/app/wallet/${wallet}/members/add${qs ? `?${qs}` : ""}`,
        summary: name ? `Add ${name} to ${walletName}` : `Open the add-friend form`,
        confidence,
        ambiguity,
      };
    }
    case "set_allowance": {
      const friend = pickString(input.friend, 60) ?? "";
      const amount = pickPositiveNumber(input.amountSol);
      const period = pickString(input.period, 20) ?? "";
      const params = new URLSearchParams();
      if (friend) params.set("friend", friend);
      if (amount !== null) params.set("amount", String(amount));
      if (period) params.set("period", period);
      const qs = params.toString();
      return {
        action: "set_allowance",
        route: `/app/wallet/${wallet}/allowances${qs ? `?${qs}` : ""}`,
        summary: friend && amount
          ? `Set ${friend}'s ${period || "period"} limit to ${amount} SOL`
          : "Open spending limits",
        confidence,
        ambiguity,
      };
    }
    case "set_budget": {
      const weekly = pickPositiveNumber(input.weeklyUsd);
      const params = new URLSearchParams();
      if (weekly !== null) params.set("weekly", String(weekly));
      const qs = params.toString();
      return {
        action: "set_budget",
        route: `/app/wallet/${wallet}/budget${qs ? `?${qs}` : ""}`,
        summary: weekly
          ? `Set ${walletName}'s weekly cap to $${weekly}`
          : "Open the spending policy",
        confidence,
        ambiguity,
      };
    }
    case "enable_sending": {
      const chain = pickString(input.chain, 20) ?? "";
      if (chain === "ethereum") {
        return {
          action: "enable_sending",
          route: `/app/wallet/${wallet}/setup/eth`,
          summary: `Enable Ethereum sending in ${walletName}`,
          confidence,
          ambiguity,
        };
      }
      // Default + Solana: route to /setup
      return {
        action: "enable_sending",
        route: `/app/wallet/${wallet}/setup`,
        summary: `Enable Solana sending in ${walletName}`,
        confidence,
        ambiguity,
      };
    }
    case "add_chain": {
      const chain = pickString(input.chain, 20) ?? "";
      const params = new URLSearchParams();
      if (chain) params.set("preselect", chain);
      const qs = params.toString();
      return {
        action: "add_chain",
        route: `/app/wallet/${wallet}/chains/add${qs ? `?${qs}` : ""}`,
        summary: chain
          ? `Add ${chain} to ${walletName}`
          : `Open the add-chain page`,
        confidence,
        ambiguity,
      };
    }
    default:
      return null;
  }
}

function pickString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

function pickPositiveNumber(v: unknown): number | null {
  if (typeof v !== "number") return null;
  if (!isFinite(v)) return null;
  if (v <= 0) return null;
  return v;
}

function pickConfidence(v: unknown): "high" | "low" {
  return v === "high" ? "high" : "low";
}
