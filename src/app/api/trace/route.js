/* ============================================================
   API Route: POST /api/trace
   Runs the ray tracing engine on the server and returns
   trace segments + screen accumulator data.
   ============================================================ */

import { doTrace } from '@/lib/optics-engine.js';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    // Aborted request — body was truncated
    return Response.json({ error: 'Request body was empty or truncated (likely cancelled)' }, { status: 400 });
  }

  try {
    // Validate required fields
    if (!body.sourceState || !body.components) {
      return Response.json(
        { error: 'Missing required fields: sourceState, components' },
        { status: 400 }
      );
    }

    // Run the trace
    const t0 = Date.now();
    const result = doTrace(body);
    const elapsed = Date.now() - t0;

    // Convert accum arrays to base64 for JSON transport
    for (const compId in result.screenData) {
      const sa = result.screenData[compId];
      if (sa.accum) {
        const buf = Buffer.from(sa.accum.buffer);
        sa.accumBase64 = buf.toString('base64');
        delete sa.accum;
      }
    }

    return Response.json({ ...result, traceTimeMs: elapsed });
  } catch (err) {
    console.error('Trace API error:', err);
    return Response.json(
      { error: 'Internal server error during trace', details: err.message },
      { status: 500 }
    );
  }
}

