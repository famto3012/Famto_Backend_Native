const MapService = require("../../../services/MapService");

const getPolylineController = async (req, res) => {
  const { path: waypoints } = req.body;

  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    return res
      .status(400)
      .json({ error: "At least two valid coordinates required" });
  }

  try {
    const data = await MapService.getRoutePolyline(waypoints, "biking");
    return res.json(data);
  } catch (err) {
    console.error("Polyline error:", err.message);
    return res.status(500).json({
      error: "Failed to fetch polyline path from MapMyIndia API",
    });
  }
};

module.exports = { getPolylineController };
