const express = require("express");
const router = express.Router();

router.post("/register", (req, res) => {
  res.json({
    message: "Register route working",
    body: req.body
  });
});

module.exports = router;
