const axios = require("axios");

// ---------------------------------------------------------------------------
// Mappls v1 Provider — advancedmaps API key in URL path
// Keep as fallback for when v2 is down or slow to migrate.
// ---------------------------------------------------------------------------

const apiKey = () => {
  const key = process.env.MapMyIndiaAPIKey;
  if (!key) throw new Error("MapMyIndiaAPIKey not set in environment");
  return key;
};

async function distance(lat1, lng1, lat2, lng2, profile = "biking") {
  const url = `https://apis.mapmyindia.com/advancedmaps/v1/${apiKey()}/distance_matrix/${profile}/${lng1},${lat1};${lng2},${lat2}`;
  const { data } = await axios.get(url);

  const matrix = data?.results?.distances?.[0];
  const durationMatrix = data?.results?.durations?.[0];
  if (!Array.isArray(matrix) || !Array.isArray(durationMatrix)) {
    throw new Error("No distance matrix returned from Mappls v1");
  }

  const distanceMeters = matrix[1] ?? matrix[0];
  const durationSeconds = durationMatrix[1] ?? durationMatrix[0];
  if (distanceMeters == null) {
    throw new Error("Distance not found in Mappls v1 matrix response");
  }

  return {
    distanceInKM: Number((distanceMeters / 1000).toFixed(2)),
    durationInMinutes: Math.ceil((durationSeconds || 0) / 60),
  };
}

async function routePolyline(path, profile = "biking") {
  const coordStr = path
    .map(([lat, lng]) => `${lng},${lat}`)
    .join(";");
  const url = `https://apis.mapmyindia.com/advancedmaps/v1/${apiKey()}/route_adv/${profile}/${coordStr}?geometries=geojson`;
  const { data } = await axios.get(url);
  return data;
}

async function staticMapImage(lat, lng, options = {}) {
  const { size = "400x500", zoom = 15, key } = options;
  const activeKey = key || apiKey();
  const url = `https://apis.mapmyindia.com/advancedmaps/v1/${activeKey}/still_image?center=${lng},${lat}&size=${size}&markers=${lng},${lat}&zoom=${zoom}`;
  const response = await axios.get(url, { responseType: "arraybuffer" });
  return response.data;
}

module.exports = { distance, routePolyline, staticMapImage };