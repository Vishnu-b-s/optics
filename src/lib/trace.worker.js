import { doTrace } from './optics-engine.js';

self.addEventListener('message', (e) => {
  const { nonce, body } = e.data;
  try {
    const t0 = performance.now();
    const result = doTrace(body);
    const elapsed = performance.now() - t0;
    
    // Collect accum buffers for transfer to avoid copying data
    const transfers = [];
    for (const compId in result.screenData) {
       if (result.screenData[compId].accum) {
          transfers.push(result.screenData[compId].accum.buffer);
       }
    }
    
    self.postMessage(
      { type: 'success', nonce, result: { ...result, traceTimeMs: elapsed } },
      transfers
    );
  } catch (err) {
    self.postMessage({ type: 'error', nonce, error: err.message });
  }
});
