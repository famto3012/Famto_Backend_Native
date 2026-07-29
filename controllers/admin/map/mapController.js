const mapService = require("../../../services/MapService");

const getPolylineController = async (req, res) => {
  const { path } = req.body;

  if (!Array.isArray(path) || path.length < 2) {
    return res
      .status(400)
      .json({ error: "At least two valid coordinates required" });
  }

  // Normalize each waypoint to [lat, lng] via MapService (handles all
  // input formats — array, object, mongoose doc, [lng,lat] swap, etc.)
  const normalizedPath = [];
  for (const point of path) {
    const norm = mapService.normalize(point);
    if (!norm) {
      return res.status(400).json({
        error: `Invalid coordinate in path: ${JSON.stringify(point)}`,
      });
    }
    normalizedPath.push(norm);
  }

  try {
    // MapService delegates to the active provider (today: Mappls).
    // The provider handles the lng,lat format that the API requires.
    const data = await mapService.getRoutePolyline(normalizedPath, "biking");
    return res.json(data);
  } catch (err) {
    console.error("Polyline error:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to fetch polyline path from map service",
    });
  }
};

module.exports = { getPolylineController };
