const Geofence = require("../models/Geofence");
const appError = require("./appError");
const { point, polygon, booleanPointInPolygon, area } = require("@turf/turf");

// Function to find the appropriate geofence for given coordinates
const geoLocation = async (latitude, longitude) => {
  try {
    // Retrieve all geofences (assuming you have a Geofence model)
    const geofences = await Geofence.find({}); // Adjust this based on your actual model name

    // Convert user coordinates into a Turf.js point
    const userPoint = point([longitude, latitude]);

    let largestArea = 0;
    let largestGeofence = null;

    // Iterate through each geofence and check if userPoint is inside
    for (let i = 0; i < geofences.length; i++) {
      const coords = geofences[i].coordinates.map((coord) => [
        coord[1],
        coord[0],
      ]);
      const geoPolygon = polygon([coords]);

      if (booleanPointInPolygon(userPoint, geoPolygon)) {
        const currentArea = area(geoPolygon);
        // If a larger area is found, update the largestGeofence
        if (currentArea > largestArea) {
          largestArea = currentArea;
          largestGeofence = geofences[i];
        }
        // If the area is the same as the largestArea, keep the first one found
        else if (currentArea === largestArea && !largestGeofence) {
          largestGeofence = geofences[i];
        }
      }
    }

    // Return the geofence with the largest area or null if no matching geofence is found
    return largestGeofence || null;
  } catch (err) {
    throw new Error(err.message);
  }
};

const calculateRoadDistance = async (origin, destination) => {
  try {
    const response = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${origin[1]},${origin[0]};${destination[1]},${destination[0]}?overview=false`
    );
    const data = await response.json();
    return data.routes[0].distance / 1000; // Convert meters to kilometers
  } catch (error) {
    console.error("Error calculating road distance:", error);
    return null;
  }
};

module.exports = { geoLocation, calculateRoadDistance };
