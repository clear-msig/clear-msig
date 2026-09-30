import assert from "node:assert/strict";
import test from "node:test";

import axios from "axios";
import nodemailer from "nodemailer";
import sharp from "sharp";

test("patched Axios preserves JSON request and response handling without network access", async () => {
  const client = axios.create({
    baseURL: "https://example.invalid",
    adapter: async (config) => {
      assert.equal(config.method, "post");
      assert.equal(config.url, "/wallets");
      assert.equal(config.headers.get("Content-Type"), "application/json");
      assert.deepEqual(JSON.parse(config.data), { address: "test-address" });
      return {
        data: '{"accepted":true}',
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        config,
      };
    },
  });
  const response = await client.post("/wallets", { address: "test-address" });
  assert.deepEqual(response.data, { accepted: true });
});

test("patched Nodemailer preserves the invitation message API without network access", async () => {
  const transporter = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "unix",
  });
  const result = await transporter.sendMail({
    from: "ClearSig <sender@example.invalid>",
    to: "recipient@example.invalid",
    subject: "Invitation to review a wallet",
    text: "Review the wallet invitation.",
    html: "<p>Review the wallet invitation.</p>",
  });

  assert.deepEqual(result.envelope.to, ["recipient@example.invalid"]);
  assert.match(result.message.toString(), /Subject: Invitation to review a wallet/);
  assert.match(result.message.toString(), /Content-Type: multipart\/alternative/);
});

test("patched sharp loads its native runtime and preserves image conversion", async () => {
  const input = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#123456" },
  }).png().toBuffer();
  const output = await sharp(input).resize(1, 1).webp().toBuffer();
  const metadata = await sharp(output).metadata();

  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 1);
  assert.equal(metadata.height, 1);
});
