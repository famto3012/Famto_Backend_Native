const axios = require("axios");

const getPolylineController = async (req, res) => {
  const { path } = req.body;

  if (!Array.isArray(path) || path.length < 2) {
    return res
      .status(400)
      .json({ error: "At least two valid coordinates required" });
  }

  // -----------------------------
  // SAFE NORMALIZER
  // -----------------------------
  const normalizeLatLng = (loc) => {
  if (!loc) return null;

  if (typeof loc.toObject === "function") {
    loc = loc.toObject();
  }

  if (!Array.isArray(loc) || loc.length !== 2) return null;

  let a = Number(loc[0]);
  let b = Number(loc[1]);

  if (Number.isNaN(a) || Number.isNaN(b)) return null;

  // Standard out-of-range swap (handles |lng| > 90 cases)
  if (Math.abs(a) > 90 && Math.abs(b) <= 90) {
    return [b, a];
  }

  // India-specific heuristic:
  // lng is ~68–98, lat is ~6–38
  // If a looks like an Indian longitude and b looks like a latitude → swap
  const looksLikeIndianLng = (v) => v >= 60 && v <= 100;
  const looksLikeIndianLat = (v) => v >= 5 && v <= 40;

  if (looksLikeIndianLng(a) && looksLikeIndianLat(b)) {
    return [b, a]; // swap [lng, lat] → [lat, lng]
  }

  return [a, b];
};

  // -----------------------------
  // BUILD MAPMYINDIA STRING (lng,lat)
  // -----------------------------
  const coordinateString = path
    .map((point) => {
      const normalized = normalizeLatLng(point);

      if (!normalized) return null;

      const [lat, lng] = normalized;

      return `${lng},${lat}`; // REQUIRED FORMAT
    })
    .filter(Boolean)
    .join(";");

  console.log("COORDINATE STRING:", coordinateString);

  const url = `https://apis.mapmyindia.com/advancedmaps/v1/${process.env.MapMyIndiaAPIKey}/route_adv/biking/${coordinateString}?geometries=geojson`;

  try {
    const response = await axios.get(url);
    return res.json(response.data);
  } catch (err) {
    console.error("Polyline error:", err.response?.data || err.message);

    return res.status(500).json({
      error: "Failed to fetch polyline path from MapMyIndia API",
    });
  }
};

module.exports = { getPolylineController };
