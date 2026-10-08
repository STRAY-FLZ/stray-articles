import { parseVocabulary } from "./parser.mjs";
self.onmessage = ({ data }) => {
  try {
    const result = parseVocabulary(data.text, (p) =>
      self.postMessage({ type: "progress", ...p }),
    );
    self.postMessage({ type: "result", result });
  } catch (e) {
    self.postMessage({ type: "error", message: e.message });
  }
};
