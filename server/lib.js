// Request validation, the prompt, and the model call. No HTTP server code here,
// so it can be tested without a network and reused in a serverless function.

export const MAX_IMAGES = 6;
export const MAX_IMAGE_B64 = 7_000_000; // about 5 MB of image data per photo
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export const SYSTEM = "You read photos of grocery store aisles for a store-mapping tool. Reply with JSON only.";

export const PROMPT = `These photos show one aisle or section of a grocery store.

1. If a hanging aisle sign shows an aisle number, return it as aisle_number (for example "7"). It is usually the largest text on the sign, sometimes between small side letters such as A and B: return only the number. Otherwise null.
2. List the product categories on the sign and shelves as categories: short shopping-list nouns such as "cereal", "peanut butter", "canned tomatoes". Lowercase, most prominent first, at most 12. Use sign text when it is readable. Do not list items you cannot see.
3. Ignore people and anything that is not the aisle.

Reply with only this JSON:
{"aisle_number": string or null, "categories": [string]}`;

/** Returns { images } on success or { status, error, message } on a bad request. */
export function validateImages(body) {
  const list = body && body.images;
  if (!Array.isArray(list) || list.length === 0) return { status: 400, error: "no_images", message: "Send at least one photo." };
  if (list.length > MAX_IMAGES) return { status: 400, error: "too_many", message: `Send at most ${MAX_IMAGES} photos.` };
  for (const im of list) {
    if (!im || !TYPES.has(im.mediaType) || typeof im.data !== "string" || !B64.test(im.data))
      return { status: 400, error: "bad_image", message: "Photos must be JPEG, PNG or WebP." };
    if (im.data.length > MAX_IMAGE_B64) return { status: 413, error: "too_large", message: "A photo is too large. Try a smaller one." };
  }
  return { images: list };
}

export function buildRequest(images, model) {
  return {
    model,
    max_tokens: 500,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: [
        ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.mediaType, data: im.data } })),
        { type: "text", text: PROMPT },
      ],
    }],
  };
}

/** Call the Messages API and return the reply text. Throws on a non-2xx answer. */
export async function callModel({ apiKey, baseUrl = "https://api.anthropic.com", model, images }) {
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(buildRequest(images, model)),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Model API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}
