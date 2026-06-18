const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { randomUUID } = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ===== DB =====
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log("DB Error:", err));

// ===== MODEL =====
const LocationSchema = new mongoose.Schema({
  linkId: String,
  lat: Number,
  lng: Number,
  time: { type: Date, default: Date.now }
});

const LinkSchema = new mongoose.Schema({
  linkId: String,
  createdAt: { type: Date, default: Date.now }
});

const Location = mongoose.model("Location", LocationSchema);
const Link = mongoose.model("Link", LinkSchema);

// ===== ADMIN PAGE =====
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<body>
<h2>Admin Panel</h2>

<button onclick="gen()">Generate Link</button>
<p id="link"></p>

<h3>Live + History</h3>
<div id="data"></div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();

async function gen(){
  const r = await fetch('/new-link');
  const d = await r.json();
  document.getElementById('link').innerHTML =
  '<a target="_blank" href="'+d.url+'">'+d.url+'</a>';
}

// live updates
socket.on('location', d => {
  document.getElementById('data').innerHTML =
  '<pre>'+JSON.stringify(d,null,2)+'</pre>' +
  document.getElementById('data').innerHTML;
});
</script>
</body>
</html>
  `);
});

// ===== CREATE LINK (10 DAYS VALID) =====
app.get("/new-link", async (req, res) => {

  const id = randomUUID();

  await Link.create({ linkId: id });

  const baseUrl =
    process.env.BASE_URL ||
    ("https://" + req.get("host"));

  res.json({
    id,
    url: baseUrl + "/track/" + id
  });
});

// ===== TRACK PAGE =====
app.get("/track/:id", (req, res) => {

  res.send(`
<!DOCTYPE html>
<html>
<body>
<h3>Sharing Location...</h3>
<p id="status">Waiting</p>

<script src="/socket.io/socket.io.js"></script>
<script>

const socket = io();
const id = "${req.params.id}";

function send(){

navigator.geolocation.getCurrentPosition(pos => {

  socket.emit("location", {
    id,
    lat: pos.coords.latitude,
    lng: pos.coords.longitude
  });

  document.getElementById("status").innerText = "Sent";

});

}

send();
setInterval(send, 5000);

</script>
</body>
</html>
  `);
});

// ===== SOCKET =====
io.on("connection", socket => {

  socket.on("location", async data => {

    await Location.create({
      linkId: data.id,
      lat: data.lat,
      lng: data.lng
    });

    io.emit("location", data);
  });

});

// ===== HISTORY (ADMIN USE) =====
app.get("/history/:id", async (req, res) => {

  const data = await Location.find({ linkId: req.params.id })
    .sort({ time: -1 });

  res.json(data);
});

// ===== AUTO DELETE AFTER 10 DAYS =====
setInterval(async () => {

  const tenDays = 10 * 24 * 60 * 60 * 1000;
  const limit = new Date(Date.now() - tenDays);

  await Location.deleteMany({ time: { $lt: limit } });
  await Link.deleteMany({ createdAt: { $lt: limit } });

}, 60 * 60 * 1000); // every 1 hour

// ===== START =====
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on", PORT);
});
