import { describe, expect, it } from "vitest";
import { ConfigError, DEFAULT_OPENAI_MODEL, loadConfig, loadWebhookAdminConfig } from "../../apps/bot/src/config.js";

const base = {
  TELEGRAM_BOT_TOKEN: "123456789:AAHexampleTokenValueXXXX",
  DATABASE_URL: "postgresql://relay:relay@127.0.0.1:5432/relay",
};

describe("startup configuration", () => {
  it("defaults to polling and the configured small model", () => {
    const config = loadConfig(base);
    expect(config.transport).toBe("polling");
    expect(config.openaiModel).toBe(DEFAULT_OPENAI_MODEL);
    expect(config.openaiApiKey).toBeUndefined();
    expect(config.allowedUserIds).toBeNull();
    expect(config.host).toBe("127.0.0.1");
  });
  it("names missing and invalid variables without repeating their values", () => {
    const secret = "not-a-valid-openai-key-and-must-not-leak";
    expect(() => loadConfig({ ...base, OPENAI_API_KEY: secret, TELEGRAM_TRANSPORT: "carrier" })).toThrow(ConfigError);
    try { loadConfig({ ...base, OPENAI_API_KEY: secret, TELEGRAM_TRANSPORT: "carrier", NODE_ENV: "production" }); }
    catch (error) {
      expect(String(error)).toContain("TELEGRAM_TRANSPORT");
      expect(String(error)).toContain("OPENAI_API_KEY");
      expect(String(error)).toContain("TELEGRAM_ALLOWED_USER_IDS");
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain(base.TELEGRAM_BOT_TOKEN);
      expect(String(error)).not.toContain(base.DATABASE_URL);
    }
  });
  it("parses an allowlist and a public https origin", () => {
    const config = loadConfig({ ...base, TELEGRAM_ALLOWED_USER_IDS: "42, 7", PUBLIC_URL: "https://bot.example.com", NODE_ENV: "production" });
    expect([...(config.allowedUserIds ?? [])]).toEqual(["42", "7"]);
    expect(config.publicUrl).toBe("https://bot.example.com");
    expect(() => loadWebhookAdminConfig({ ...base, TELEGRAM_WEBHOOK_SECRET: "a".repeat(32), PUBLIC_URL: "http://bot.example.com" })).toThrow(/PUBLIC_URL/);
  });
});
