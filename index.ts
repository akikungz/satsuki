import { createApp } from "./src/bootstrap/create-app";

const { app } = createApp();

process.on("SIGINT", async () => {
  await app.stop();
  process.exit(0);
});

app.start().catch(async (error) => {
  console.error("Fatal error:", error);
  await app.stop();
  process.exit(1);
});
