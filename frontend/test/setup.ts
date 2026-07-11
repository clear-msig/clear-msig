import { beforeEach } from "vitest";

beforeEach(() => {
  Object.assign(process.env, {
    NODE_ENV: "test",
    VERCEL_ENV: "",
    UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "",
  });
});
