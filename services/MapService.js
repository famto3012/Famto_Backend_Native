const NodeCache = require("node-cache");
const mappls = require("./providers/mapplsProvider");

// ---------------------------------------------------------------------------
// MapService — single point of contact for all map-related operations
// ---------------------------------------------------------------------------
// What this does:
//   1. Accepts pickup/delivery coordinates in [lat, lng] format
//   2. Checks in-memory cache → if hit, returns instantly (zero cost)
//   3. If cache miss, delegates to the active provider (today: Mappls)
//   4. Stores the result in cache, returns it
//
// Caching rules:
//   - Cache key = rounded coordinates (3 decimal = ~100m) + profile
//   - TTL = 300 seconds (5 minutes) — roads don't change that fast
//   - If every order asks the same restaurant → delivery area route,
//     the cache absorbs ~80% of repeat calls
//
// To switch provider: change this.provider to a new module that exports
// the same { distance(...), routePolyline(...), staticMapImage(...) } shape.
// ---------------------------------------------------------------------------

class MapService {
  constructor() {
    this.cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
    this.provider = mappls; // swap here when adding OSRM / LocationIQ
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** Build a deterministic cache key from coordinates + profile */
  _cacheKey(lat1, lng1, lat2, lng2, profile) {
    // Round to 3 decimals (~100m precision) so minor GPS jitter still hits cache
    return `${lat1.toFixed(3)},${lng1.toFixed(3)}|${lat2.toFixed(3)},${lng2.toFixed(3)}|${profile}`;
  }

  /** Try cache first; on miss call provider, cache result, return */
  async _cachedOrFetch(key, fetcher) {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const result = await fetcher();
    this.cache.set(key, result);
    return result;
  }

  // -----------------------------------------------------------------------
  // Coordinate normalisation
  // -----------------------------------------------------------------------
  // The app stores coordinates in inconsistent formats across models:
  //   - Some as [lat, lng]           (MongoDB GeoJSON — correct)
  //   - Some as [lng, lat]           (legacy / accidental swap)
  //   - Some as "lat,lng" string     (from CSV imports / form inputs)
  //   - Some as { lat, lng } objects (from some controllers)
  //
  // normalize() handles all variants and returns [lat, lng] consistently,
  // so the provider layer always gets reliable values.

  /**
   * Convert any input format to [lat, lng].
   * Returns null if input can't be parsed.
   *
   * @param {any} input
   * @returns {[number, number] | null}
   */
  normalize(input) {
    if (!input) return null;

    // "lat,lng" string
    if (typeof input === "string") {
      const parts = input.split(",");
      if (parts.length !== 2) return null;
      return [Number(parts[0]), Number(parts[1])];
    }

    // { lat, lng } or { latitude, longitude } object
    if (!Array.isArray(input)) {
      const lat = input.lat ?? input.latitude;
      const lng = input.lng ?? input.longitude;
      if (lat == null || lng == null) return null;
      return [Number(lat), Number(lng)];
    }

    // Array — could be [lat, lng] or [lng, lat]
    if (input.length !== 2) return null;

    let a = Number(input[0]);
    let b = Number(input[1]);

    if (Number.isNaN(a) || Number.isNaN(b)) return null;

    // Heuristic: if first value looks like longitude (>90 absolute) → swap
    if (Math.abs(a) > 90 && Math.abs(b) <= 90) {
      return [b, a]; // was [lng, lat] → [lat, lng]
    }

    return [a, b]; // already [lat, lng]
  }

  // -----------------------------------------------------------------------
  // Public API — these are what the rest of the app calls
  // -----------------------------------------------------------------------

  /**
   * Get road distance and duration between two points.
   *
   * @param   {any}  pickup    — pickup location in any supported format
   * @param   {any}  delivery  — delivery location in any supported format
   * @param   {'driving'|'biking'|'walking'} [profile='biking']
   * @returns {Promise<{distanceInKM: number, durationInMinutes: number}>}
   */
  async getDistance(pickup, delivery, profile = "biking") {
    const p = this.normalize(pickup);
    const d = this.normalize(delivery);

    if (!p || !d) {
      throw new Error(
        `Invalid coordinates for getDistance — pickup: ${JSON.stringify(pickup)}, delivery: ${JSON.stringify(delivery)}`
      );
    }

    const [lat1, lng1] = p;
    const [lat2, lng2] = d;
    const key = this._cacheKey(lat1, lng1, lat2, lng2, profile);

    return this._cachedOrFetch(key, () =>
      this.provider.distance(lat1, lng1, lat2, lng2, profile)
    );
  }

  /**
   * Get distance across multiple waypoints (chain: c0→c1, c1→c2, ...).
   * Each waypoint must be { lat, lng }.
   *
   * @param   {Array<{lat: number, lng: number}>}  coordinates
   * @param   {'driving'|'biking'|'walking'} [profile='biking']
   * @returns {Promise<{distanceInKM: number, durationInMinutes: number}>}
   */
  async getDistanceMulti(coordinates, profile = "biking") {
    if (!coordinates || coordinates.length < 2) {
      throw new Error("At least 2 coordinates required for getDistanceMulti");
    }

    let totalDistanceMeters = 0;
    let totalDurationSeconds = 0;

    for (let i = 0; i < coordinates.length - 1; i++) {
      const from = this.normalize(coordinates[i]);
      const to = this.normalize(coordinates[i + 1]);
      if (!from || !to) {
        throw new Error(`Invalid coordinate pair at index ${i}`);
      }

      const [lat1, lng1] = from;
      const [lat2, lng2] = to;
      const key = this._cacheKey(lat1, lng1, lat2, lng2, profile);

      // eslint-disable-next-line no-await-in-loop
      const seg = await this._cachedOrFetch(key, () =>
        this.provider.distance(lat1, lng1, lat2, lng2, profile)
      );

      // seg.distanceInKM is already in km; multiply back to meters for accumulation
      totalDistanceMeters += seg.distanceInKM * 1000;
      totalDurationSeconds += seg.durationInMinutes * 60;
    }

    return {
      distanceInKM: Number((totalDistanceMeters / 1000).toFixed(2)),
      durationInMinutes: Math.ceil(totalDurationSeconds / 60),
    };
  }

  /**
   * Get a route polyline for map display.
   *
   * @param   {Array<[number, number]>}  path    — array of [lat, lng] waypoints
   * @param   {'driving'|'biking'|'walking'} [profile='biking']
   * @returns {Promise<object>} raw Mappls GeoJSON response
   */
  async getRoutePolyline(path, profile = "biking") {
    return this.provider.routePolyline(path, profile);
  }

  /**
   * Get a static map image (merchant location thumbnail).
   *
   * @param   {any}     center  — center point in any supported format
   * @param   {object}  [options]
   * @returns {Promise<Buffer>}
   */
  async getStaticMapImage(center, options = {}) {
    const c = this.normalize(center);
    if (!c) throw new Error(`Invalid center for static map: ${JSON.stringify(center)}`);
    const [lat, lng] = c;
    return this.provider.staticMapImage(lat, lng, options);
  }
}

// Singleton — every importer shares the same cache instance
module.exports = new MapService();
