const axios = require("axios");

// ---------------------------------------------------------------------------
// Mappls v2 Provider — static access_token via query param
// New base URLs: route.mappls.com (distance + routing), tile.mappls.com (still image)
// ---------------------------------------------------------------------------

const accessToken = () => {
  const token = process.env.MAPPLS_ACCESS_TOKEN;
  if (!token) throw new Error("MAPPLS_ACCESS_TOKEN not set in environment");
  return token;
};

/**
 * Get road distance and duration between two points.
 * v2: GET https://route.mappls.com/route/dm/distance_matrix/{profile}/{lng,lat;lng,lat}?access_token=...
 */
async function distance(lat1, lng1, lat2, lng2, profile = "biking") {
  // v2 expects lng,lat order (same as v1)
  const url = `https://route.mappls.com/route/dm/distance_matrix/${profile}/${lng1},${lat1};${lng2},${lat2}?access_token=${accessToken()}`;

  const { data } = await axios.get(url);

  const matrix = data?.results?.distances?.[0];
  const durationMatrix = data?.results?.durations?.[0];

  if (!Array.isArray(matrix) || !Array.isArray(durationMatrix)) {
    throw new Error("No distance matrix returned from Mappls v2");
  }

  const distanceMeters = matrix[1] ?? matrix[0];
  const durationSeconds = durationMatrix[1] ?? durationMatrix[0];

  if (distanceMeters == null) {
    throw new Error("Distance not found in Mappls v2 matrix response");
  }

  return {
    distanceInKM: Number((distanceMeters / 1000).toFixed(2)),
    durationInMinutes: Math.ceil((durationSeconds || 0) / 60),
  };
}

/**
 * Get a route polyline (GeoJSON) for map display.
 * v2: GET https://route.mappls.com/route/direction/route_adv/{profile}/{lng,lat;lng,lat}?geometries=geojson&access_token=...
 */
async function routePolyline(path, profile = "biking") {
  const coordStr = path
    .map(([lat, lng]) => `${lng},${lat}`)
    .join(";");

  const url = `https://route.mappls.com/route/direction/route_adv/${profile}/${coordStr}?geometries=geojson&access_token=${accessToken()}`;

  const { data } = await axios.get(url);
  return data;
}

/**
 * Get a static map image.
 * v2: GET https://tile.mappls.com/map/raster_tile/still_image?access_token=...&center=...&size=...&markers=...&zoom=...
 */
async function staticMapImage(lat, lng, options = {}) {
  const { size = "400x500", zoom = 15 } = options;
  const token = accessToken();

  const url = `https://tile.mappls.com/map/raster_tile/still_image?access_token=${token}&center=${lng},${lat}&size=${size}&markers=${lng},${lat}&zoom=${zoom}`;

  const response = await axios.get(url, { responseType: "arraybuffer" });
  return response.data;
}

module.exports = { distance, routePolyline, staticMapImage };