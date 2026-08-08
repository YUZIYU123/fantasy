export default {
  async fetch(request: Request) {
    if (new URL(request.url).pathname === "/health") return Response.json({ ok: true });
    return Response.json({ error: "not implemented" }, { status: 501 });
  },
};
