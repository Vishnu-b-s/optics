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
    const result = doTrace(body);

    return Response.json(result);
  } catch (err) {
    console.error('Trace API error:', err);
    return Response.json(
      { error: 'Internal server error during trace', details: err.message },
      { status: 500 }
    );
  }
}

