// Preloaded by npm test. All provider tests must inject a local fake transport.
globalThis.fetch = async () => { throw new Error('Network disabled in offline tests'); };
