const path = require("path");
const fs = require("fs");
const v1 = require("./mapplsV1Provider");
const v2 = require("./mapplsV2Provider");

// ---------------------------------------------------------------------------
// Composite Mappls Provider — v1 primary, v2 fallback (phasing out v1)
// ---------------------------------------------------------------------------
// Right now v1 is primary. When Mappls kills v1, calls fail on v1 and
// auto-fall through to v2. MapService.js never sees the failure.
//
// Each v1 failure is logged to fallback_log.txt so you know v1 is dead.
// Once the log stops showing v1 successes and only shows failures, delete
// this file and swap require to mapplsV2Provider.js in MapService.js.
//
// To test: set MapMyIndiaAPIKey to garbage, call distance → should fall
// through to v2 → v2 works. Check fallback_log.txt for the record.
// ---------------------------------------------------------------------------

const LOG_FILE = path.resolve(__dirname, "..", "..", "fallback_log.txt");

/** Best-effort append to fallback log */
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line, "utf-8"); } catch (_) {}
}

/** Try v1 first. On failure, log reason and try v2. */
async function withFallback(fnName, v1Fn, v2Fn) {
  try {
    const result = await v1Fn();
    return result;
  } catch (v1Err) {
    log(`V1 FAILED:${fnName} — ${v1Err.message}`);
    // v1 failed → try v2
    try {
      const result = await v2Fn();
      log(`V2 OK:${fnName}`);
      return result;
    } catch (v2Err) {
      // Both failed — throw v1 error as canonical
      log(`BOTH FAILED:${fnName} — v1:${v1Err.message} v2:${v2Err.message}`);
      throw v1Err;
    }
  }
}

// ---------------------------------------------------------------------------
// Public interface — same shape as v1-only and v2-only modules
// ---------------------------------------------------------------------------

async function distance(lat1, lng1, lat2, lng2, profile = "biking") {
  return withFallback(
    "distance",
    () => v1.distance(lat1, lng1, lat2, lng2, profile),
    () => v2.distance(lat1, lng1, lat2, lng2, profile),
  );
}

async function routePolyline(path, profile = "biking") {
  return withFallback(
    "routePolyline",
    () => v1.routePolyline(path, profile),
    () => v2.routePolyline(path, profile),
  );
}

async function staticMapImage(lat, lng, options = {}) {
  return withFallback(
    "staticMapImage",
    () => v1.staticMapImage(lat, lng, options),
    () => v2.staticMapImage(lat, lng, options),
  );
}

module.exports = { distance, routePolyline, staticMapImage };