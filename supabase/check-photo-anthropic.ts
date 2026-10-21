// Fore Man Gym — AI photo referee
// Supabase → Edge Functions → Deploy a new function → Via Editor
// Name it exactly:  check-photo   then paste this whole file and Deploy.
// Then Edge Functions → Secrets → add  ANTHROPIC_API_KEY = your key.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const CARDIO = `You are the referee for a gym attendance challenge. The attached photo should show the RESULTS of one cardio session: a treadmill, bike, elliptical, rower or stair-machine console, or a fitness watch / app workout summary.
Read it carefully and reply with only JSON:
{"is_cardio_result": true|false, "activity": "treadmill|bike|elliptical|rower|stairs|run|other", "minutes": number|null, "calories": number|null, "distance_km": number|null, "confidence": "high"|"medium"|"low", "reason": "one short sentence"}
Rules: minutes = total workout duration converted to minutes (45:30 means 45.5; 1:02:10 means 62.2). calories = calories burned for the session (prefer TOTAL over ACTIVE if both are shown). Use null for anything you cannot read clearly. If the photo is not a cardio result screen, set is_cardio_result false.`;

const WEIGHTS = `You are the referee for a gym attendance challenge. Look at the attached photo and decide whether it was taken in a gym or shows a weight-training session (gym machines, racks, dumbbells, barbells, plates, benches, gym mirrors or similar).
Reply with only JSON: {"in_gym": true|false, "confidence": "high"|"medium"|"low", "reason": "one short sentence"}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  // Only signed-in crew members may use the AI (protects your credit)
  try {
    const auth = req.headers.get("Authorization") || "";
    const u = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/my_name`, {
      method: "POST",
      headers: {
        Authorization: auth,
        apikey: req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const name = u.ok ? String(await u.json()).toLowerCase() : "";
    if (!["boss", "ice", "ikkew", "ong"].includes(name)) return json({ error: "sign in first" }, 401);
  } catch (_) {
    return json({ error: "sign in first" }, 401);
  }
  try {
    const { type, image } = await req.json();
    if (!image || (type !== "cardio" && type !== "weights")) return json({ error: "bad request" }, 400);
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY secret is not set" }, 500);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-5-5",
        max_tokens: 300,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
            { type: "text", text: type === "cardio" ? CARDIO : WEIGHTS },
          ],
        }],
      }),
    });
    const j = await r.json();
    if (!r.ok) return json({ error: j?.error?.message || "AI request failed" }, 502);
    const text: string = (j.content || []).find((c: { type: string }) => c.type === "text")?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return json({ error: "unreadable answer" }, 502);
    return json(JSON.parse(m[0]));
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
