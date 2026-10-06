/**
 * The made-up model behind the two demo paid endpoints. It returns the same
 * shape a real inference API would, built from the prompt so two calls with
 * the same prompt give the same answer and the demo reads as deterministic.
 * Nothing here calls a model.
 */

export interface FakeInference {
  model: "acme-1";
  completion: string;
  usage: { inputTokens: number; outputTokens: number };
  paid: true;
}

const OPENERS = [
  "Here is the short version.",
  "The picture is clearer than it looks.",
  "Three things stand out.",
  "The data points one way.",
];

const MIDDLES = [
  "Demand has grown in every quarter we can see, and the growth comes from repeat buyers rather than new ones.",
  "The cost side moved first: inputs fell, margins widened, and the savings went into pricing rather than profit.",
  "Adoption follows the usual curve, with the early users paying the most and the late ones paying the least.",
  "The market is split between a few large players and a long tail, and the tail is where the change is.",
  "Supply is the constraint, not demand, and the constraint is upstream of anything a buyer can see.",
];

const CLOSERS = [
  "Expect more of the same over the next two quarters.",
  "The next signal to watch is pricing, not volume.",
  "A reversal would need a change in supply, and there is none in view.",
  "That is the whole brief; the details are in the numbers.",
];

/** A small stable hash, so the same prompt always picks the same sentences. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(list: readonly T[], seed: number, shift: number): T {
  return list[(seed >>> shift) % list.length]!;
}

/** Rough token count: words, as a real tokenizer would land near it. */
function tokens(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function fakeInference(prompt: string): FakeInference {
  const clean = prompt.trim().replace(/\s+/g, " ").slice(0, 200);
  const seed = hash(clean || "empty");
  const subject = clean ? `On "${clean}": ` : "";
  const sentences = [pick(OPENERS, seed, 0), pick(MIDDLES, seed, 8), pick(CLOSERS, seed, 16)];
  // Two sentences for short prompts, three for longer ones.
  const completion = subject + (clean.length > 40 ? sentences : sentences.slice(0, 2)).join(" ");
  return {
    model: "acme-1",
    completion,
    usage: { inputTokens: tokens(prompt), outputTokens: tokens(completion) },
    paid: true,
  };
}

/** Reads `{ "prompt": "..." }` from a request body, forgiving of anything else. */
export async function promptFrom(req: Request): Promise<string> {
  try {
    const json = (await req.clone().json()) as { prompt?: unknown };
    return typeof json?.prompt === "string" ? json.prompt : "";
  } catch {
    return "";
  }
}
