import { describe, expect, it } from "vitest";
import { isPublicProductAddress, publicProductUrl } from "../electron/core/product-page";

describe("Product page safety", () => {
  it("accepts bare public URLs and strips fragments", () => {
    expect(publicProductUrl("example.com/product#hero").href).toBe("https://example.com/product");
  });
  it.each(["file:///tmp/private", "http://127.1/", "http://[::1]/", "https://user:secret@example.com/", "http://example.com:8080/", "http://local.localhost/"])("rejects %s", (url) => {
    expect(() => publicProductUrl(url)).toThrow();
  });
  it.each(["127.0.0.1", "169.254.169.254", "192.168.1.1", "172.16.0.1", "10.0.0.1", "100.100.100.100", "224.0.0.1", "::1"])("blocks nonpublic DNS addresses %s", (address) => {
    expect(isPublicProductAddress(address)).toBe(false);
  });
});

