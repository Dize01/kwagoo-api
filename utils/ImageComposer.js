function composeImage(payload = {}) {
  const { elements = [] } = payload;

  if (!Array.isArray(elements)) {
    throw new Error("'elements' must be an array");
  }

  // 1️⃣ Filter only elements with valid string values
  const items = elements.filter(el => typeof el?.Value === "string");

  if (items.length === 0) {
    throw new Error("No valid 'Value' fields found in elements");
  }

  // 2️⃣ Loop through items, build combined string based on Type
  let combined = "";

  for (const item of items) {
    if (item.Type === "Text") {
      combined += combined ? ` ${item.Value}` : item.Value;
    } else if (item.Type === "Image") {
      combined += combined ? ` [Image:${item.Value.slice(0, 10)}...]` : `[Image:${item.Value.slice(0, 10)}...]`;
    }
  }

  return combined;
}

module.exports = { composeImage };
