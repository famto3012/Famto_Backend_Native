const axios = require("axios");

// ---------------------------------------------------------------------------
// Mappls (MapMyIndia) Provider
// ---------------------------------------------------------------------------
// This is the ONLY file that constructs Mappls API URLs or touches the raw
// response format. Everything else in the app goes through MapService.js,
// which delegates here.
//
// To switch Mappls for another provider, you write a new provider file
// (e.g. osrmProvider.js) that exposes the same functions and swap the
// reference in MapService.js — no other file changes.
// ---------------------------------------------------------------------------

/** Return the API key from env (lazy-loaded so .env has loaded by first call) */
const apiKey = () => {
  const key = process.env.MapMyIndiaAPIKey;
  if (!key) throw new Error("MapMyIndiaAPIKey not set in environment");
  return key;
};

/**
 * Get road distance and duration between two points.
 *
 * @param {number} lat1  - pickup latitude
 * @param {number} lng1  - pickup longitude
 * @param {number} lat2  - delivery latitude
 * @param {number} lng2  - delivery longitude
 * @param {'driving'|'biking'|'walking'} [profile='biking']
 * @returns {Promise<{distanceInKM: number, durationInMinutes: number}>}
 */
async function distance(lat1, lng1, lat2, lng2, profile = "biking") {
  // Mappls Distance Matrix API expects coordinates as lng,lat
  const url = `https://apis.mapmyindia.com/advancedmaps/v1/${apiKey()}/distance_matrix/${profile}/${lng1},${lat1};${lng2},${lat2}`;

  const { data } = await axios.get(url);

  const matrix = data?.results?.distances?.[0];
  const durationMatrix = data?.results?.durations?.[0];

  if (!Array.isArray(matrix) || !Array.isArray(durationMatrix)) {
    throw new Error("No distance matrix returned from Mappls");
  }

  // matrix is [[0, distance_meters]] — index [1] is the value we want
  const distanceMeters = matrix[1] ?? matrix[0];
  const durationSeconds = durationMatrix[1] ?? durationMatrix[0];

  if (distanceMeters == null) {
    throw new Error("Distance not found in Mappls matrix response");
  }

  return {
    distanceInKM: Number((distanceMeters / 1000).toFixed(2)),
    durationInMinutes: Math.ceil((durationSeconds || 0) / 60),
  };
}

/**
 * Get a route polyline (the path line drawn on the map).
 *
 * @param {Array<[number, number]>} path  - array of [lat, lng] waypoints
 * @param {'driving'|'biking'|'walking'} [profile='biking']
 * @returns {Promise<object>}  raw GeoJSON response from Mappls
 */
async function routePolyline(path, profile = "biking") {
  // Mappls Route Advanced API needs lng,lat;lng,lat;...
  const coordStr = path
    .map(([lat, lng]) => `${lng},${lat}`)
    .join(";");

  const url = `https://apis.mapmyindia.com/advancedmaps/v1/${apiKey()}/route_adv/${profile}/${coordStr}?geometries=geojson`;

  const { data } = await axios.get(url);
  return data;
}

/**
 * Get a static map image (used for merchant location thumbnails).
 *
 * @param {number} lat
 * @param {number} lng
 * @param {object} [options]
 * @param {string}  [options.size='400x500']
 * @param {number}  [options.zoom=15]
 * @param {string}  [options.key]  - optional API key override (some endpoints use a different key)
 * @returns {Promise<Buffer>} raw image bytes
 */
async function staticMapImage(lat, lng, options = {}) {
  const { size = "400x500", zoom = 15, key } = options;
  const activeKey = key || apiKey();

  const url = `https://apis.mapmyindia.com/advancedmaps/v1/${activeKey}/still_image?center=${lng},${lat}&size=${size}&markers=${lng},${lat}&zoom=${zoom}`;

  const response = await axios.get(url, { responseType: "arraybuffer" });
  return response.data;
}

module.exports = { distance, routePolyline, staticMapImage };
