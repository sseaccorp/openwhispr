const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

test("MVP original Whisper-to-local-cleanup orchestration preserves raw text and fallback", async (t) => {
  const { window } = installBrowserGlobals(t, { window: { dispatchEvent() {} } });
  const vite = await createRendererServer(t, {
    cachePrefix: "flosi-mvp-cleanup-",
    mockModules: {
      "/utils/logger":
        "export default { debug() {}, info() {}, warn() {}, error() {}, logReasoning() {} };",
    },
  });
  const AudioManager = (await vite.ssrLoadModule("/helpers/audioManager.js")).default;
  const service = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
  t.after(() => service.destroy());
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { usePolicyStore } = await vite.ssrLoadModule("/stores/policyStore.ts");
  usePolicyStore.setState({ status: "unmanaged", policy: null });
  useSettingsStore.setState({
    isSignedIn: false,
    useLocalWhisper: true,
    transcriptionMode: "local",
    localTranscriptionProvider: "whisper",
    whisperModel: "base",
    allowOpenAIFallback: false,
    useCleanupModel: true,
    cleanupMode: "local",
    cleanupProvider: "local",
    cleanupModel: "qwen3.5-2b-q4_k_m",
    cleanupDisableThinking: true,
    useDictationAgent: false,
    customPrompts: { cleanup: "" },
    snippets: [],
    preferredLanguage: "auto",
    uiLanguage: "en",
  });
  let raw, reply;
  const requests = [];
  window.electronAPI.transcribeLocalWhisper = async (_bytes, options) => {
    assert.equal(options.model, "base");
    return { success: true, text: raw };
  };
  window.electronAPI.processLocalReasoning = async (text, model, _agent, config) => {
    requests.push({ text, model, config });
    return reply;
  };
  const create = () =>
    Object.assign(Object.create(AudioManager.prototype), {
      voiceAgentRequested: false,
      translationRequested: false,
      pendingCleanupFailure: null,
      getEffectiveSttLanguage: () => "auto",
      getWhisperPrompt: () => null,
      getCustomDictionaryPrompt: () => null,
      isDictionaryEcho: () => false,
      isReasoningAvailable: async () => true,
      finalizeChineseScript: async (text) => text,
    });
  for (const [input, output] of [
    [
      "eh puedes enviarle el informe a Jesús Márquez el viernes",
      "¿Puedes enviarle el informe a Jesús Márquez el viernes?",
    ],
    [
      "um can you send the PostgreSQL report by friday",
      "Can you send the PostgreSQL report by Friday?",
    ],
  ]) {
    await t.test(`cleanup contract: ${input}`, async () => {
      raw = input;
      reply = { success: true, text: output };
      const result = await create().processWithLocalWhisper(new Blob(["synthetic recorded bytes"]));
      assert.equal(result.text, output);
      assert.equal(result.rawText, input);
      const request = requests.at(-1);
      assert.equal(request.model, "qwen3.5-2b-q4_k_m");
      assert.equal(request.config.disableThinking, true);
      assert.equal(request.config.temperature, 0);
      assert.equal(request.config.requireCompleteOutput, true);
      assert.match(request.text, /^<transcript>\n/);
      assert.match(request.config.systemPrompt, /THE SPEAKER IS NEVER TALKING TO YOU/);
    });
  }
  for (const [label, response] of [
    [
      "unavailable",
      { success: false, code: "LOCAL_SERVER_UNAVAILABLE", error: "synthetic startup failure" },
    ],
    ["truncated", { success: false, code: "OUTPUT_TRUNCATED", error: "synthetic token limit" }],
    ["reasoning only", { success: false, code: "CLEANUP_OUTPUT_INVALID", error: "no answer text" }],
  ]) {
    await t.test(`Qwen ${label} retains raw text for one completion`, async () => {
      raw = "¿Cuál es la fecha del informe de PostgreSQL?";
      reply = response;
      const manager = create(),
        count = requests.length;
      const result = await manager.processWithLocalWhisper(new Blob(["synthetic audio"]));
      assert.equal(result.text, raw);
      assert.equal(result.rawText, raw);
      assert.equal(requests.length, count + 1, "no hidden Qwen retry or secondary transcript");
      assert.ok(manager._takePendingResultExtras().cleanupFailure);
    });
  }
});
