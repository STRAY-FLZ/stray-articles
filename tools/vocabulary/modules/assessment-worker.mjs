import { generateAssessment } from "./assessment.mjs";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      result: generateAssessment(
        data.words,
        data.units,
        data.settings,
        data.prefs,
      ),
    });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
