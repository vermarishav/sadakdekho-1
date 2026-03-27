const express = require("express");
const router = express.Router();
const Route = require("../models/Route");

// ── Find nearest point on path to given GPS coords ──────────────────────────
function findNearestPoint(path, lat, lng) {
  let minDist = Infinity;
  let nearest = path[0];

  path.forEach(p => {
    const dist = Math.sqrt(
      Math.pow(p.lat - lat, 2) +
      Math.pow(p.lng - lng, 2)
    );
    if (dist < minDist) {
      minDist = dist;
      nearest = p;
    }
  });

  return { point: nearest, dist: minDist };
}

// ── GET /api/video ───────────────────────────────────────────────────────────
router.get("/video", async (req, res) => {
  const { from, to, fromLat, fromLng, toLat, toLng } = req.query;

  const fromPlace = from?.trim() || null;
  const toPlace   = to?.trim()   || null;

  const fromIsGPS = !!(fromLat && fromLng);
  const toIsGPS   = !!(toLat && toLng);

  
  console.log("Incoming query:", req.query);

  try {

    // Must have at least a destination
    if (!toPlace && !toIsGPS) {
      return res.json({ success: false, message: "Destination missing" });
    }

    // ── Find route in DB ───────────────────────────────────────────────────
    const routes = await Route.find({});

    const route = routes.find(r =>
      r.path.some(p =>
        (fromPlace && p.placeName.toLowerCase() === fromPlace.toLowerCase()) ||
        (toPlace   && p.placeName.toLowerCase() === toPlace.toLowerCase())
      )
    );

    if (!route) {
      return res.json({ success: false, message: "Route not found in DB" });
    }

    const finalPath = route.path;
    let startTime = finalPath[0].time;                  // default: first stop
    let endTime   = finalPath[finalPath.length - 1].time; // default: last stop

    // ── Resolve START time ─────────────────────────────────────────────────
    if (fromIsGPS) {
      const { point, dist } = findNearestPoint(
        finalPath,
        parseFloat(fromLat),
        parseFloat(fromLng)
      );
      if (dist > 0.005) {
        return res.json({ success: false, message: "No nearby route found for your location" });
      }
      startTime = point.time;

    } else if (fromPlace) {
      const startMatch = finalPath.find(p =>
        p.placeName.toLowerCase() === fromPlace.toLowerCase()
      );
      if (startMatch) startTime = startMatch.time;
    }

    // ── Resolve END time ───────────────────────────────────────────────────
    if (toIsGPS) {
      const { point, dist } = findNearestPoint(
        finalPath,
        parseFloat(toLat),
        parseFloat(toLng)
      );
      if (dist > 0.005) {
        return res.json({ success: false, message: "No nearby route found for destination" });
      }
      endTime = point.time;

    } else if (toPlace) {
      const endMatch = finalPath.find(p =>
        p.placeName.toLowerCase() === toPlace.toLowerCase()
      );
      if (endMatch) endTime = endMatch.time;
    }

    // ── Sanity check ───────────────────────────────────────────────────────
    if (startTime >= endTime) {
      return res.json({ success: false, message: "Start point is at or after destination" });
    }

    // ── Slice path between start and end ───────────────────────────────────
    const slicedPath = finalPath.filter(p =>
      p.time >= startTime && p.time <= endTime
    );

    // ── Send response ──────────────────────────────────────────────────────
    res.json({
      success:   true,
      fromPlace: fromIsGPS ? "Current Location" : fromPlace,
      toPlace:   toIsGPS   ? "Current Location" : toPlace,
      videoUrl:  route.videoUrl,
      path:      slicedPath,
      startTime,
      endTime
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;