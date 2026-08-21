export type ProtectedLemonSqueezyCatalogIdentity = {
  productId: string;
  storeId: string;
  variantId: string;
};

export async function verifyProtectedLemonSqueezyCatalog(input: {
  expected: ProtectedLemonSqueezyCatalogIdentity;
  request(path: string): Promise<unknown>;
}) {
  const [storeResponse, productResponse, variantResponse] = await Promise.all([
    input.request(`/v1/stores/${encodeURIComponent(input.expected.storeId)}`),
    input.request(`/v1/products/${encodeURIComponent(input.expected.productId)}`),
    input.request(`/v1/variants/${encodeURIComponent(input.expected.variantId)}`),
  ]);
  const store = resource(storeResponse);
  const product = resource(productResponse);
  const variant = resource(variantResponse);

  if (store.type !== "stores" || store.id !== input.expected.storeId) {
    throw new Error("Protected Lemon Squeezy Store does not match configuration.");
  }
  if (product.type !== "products" || product.id !== input.expected.productId) {
    throw new Error("Protected Lemon Squeezy Product does not match configuration.");
  }
  if (variant.type !== "variants" || variant.id !== input.expected.variantId) {
    throw new Error("Protected Lemon Squeezy Variant does not match configuration.");
  }
  if (identifier(product.attributes.store_id) !== input.expected.storeId) {
    throw new Error("Protected Lemon Squeezy Product does not belong to the configured Store.");
  }
  if (product.attributes.test_mode !== true || product.attributes.status !== "published") {
    throw new Error("Protected Lemon Squeezy Product must be test-mode and published.");
  }
  if (identifier(variant.attributes.product_id) !== input.expected.productId) {
    throw new Error("Protected Lemon Squeezy Variant does not belong to the configured Product.");
  }
  if (variant.attributes.test_mode !== true || variant.attributes.status !== "published") {
    throw new Error("Protected Lemon Squeezy Variant must be test-mode and published.");
  }
  if (variant.attributes.has_license_keys !== false) {
    throw new Error("Protected Lemon Squeezy Variant must keep license keys disabled.");
  }

  return { ...input.expected, testMode: true as const };
}

function resource(value: unknown) {
  const data = record(record(value).data);
  return {
    attributes: record(data.attributes),
    id: identifier(data.id),
    type: typeof data.type === "string" ? data.type : "",
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function identifier(value: unknown) {
  if (typeof value === "string") return value;
  return typeof value === "number" && Number.isInteger(value) ? String(value) : "";
}
