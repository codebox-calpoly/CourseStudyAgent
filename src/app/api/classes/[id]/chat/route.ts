/**
 * Draft #44 entry point. Do not enable until #41 (auth), #47 (tables),
 * #49 (retrieval), and the reviewed #50 classifier are available.
 * Wire createChatHandler with those real adapters; never substitute fake auth.
 */
export async function POST() {
  return Response.json(
    { error: "Chat is awaiting backend integration" },
    { status: 503 },
  );
}
