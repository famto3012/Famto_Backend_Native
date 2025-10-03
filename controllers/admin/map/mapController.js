const axios = require("axios");

const getPolylineController = async (req, res) => {
  const { path } = req.body;

  if (!Array.isArray(path) || path.length < 2) {
    return res
      .status(400)
      .json({ error: "At least two valid coordinates required" });
  }

  const coordinateString = path.map(([lat, lng]) => `${lng},${lat}`).join(";");

  const url = `https://apis.mapmyindia.com/advancedmaps/v1/9a632cda78b871b3a6eb69bddc470fef/route_adv/biking/${coordinateString}?geometries=geojson`;

  try {
    const response = await axios.get(url);
    res.json(response.data);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to fetch polyline path from Mappls API" });
  }
};

module.exports = { getPolylineController };
