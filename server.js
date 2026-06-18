const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { randomUUID } = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

mongoose.connect(
process.env.MONGO_URI || "mongodb://127.0.0.1:27017/locationtracker"
)
.then(() => console.log("MongoDB Connected"))
.catch(err => console.error(err));

const LocationSchema = new mongoose.Schema({
linkId: String,
lat: Number,
lng: Number,
time: {
type: Date,
default: Date.now
}
});

const Location = mongoose.model("Location", LocationSchema);

app.get("/", (req, res) => {

res.send(`

<!DOCTYPE html>

<html>
<head>
<meta charset="utf-8">
<title>Admin</title>
<style>
body{
  font-family:Arial;
  background:#f5f5f5;
  padding:20px;
}
button{
  padding:10px 20px;
}
.card{
  background:#fff;
  padding:10px;
  margin-top:10px;
  border-radius:8px;
}
</style>
</head>
<body>

<h1>Location Tracker Admin</h1>

<button onclick="generateLink()">Generate Link</button>

<p id="link"></p>

<div id="locations"></div>

<script src="/socket.io/socket.io.js"></script>

<script>

const socket = io();

async function generateLink(){

  const res = await fetch('/new-link');
  const data = await res.json();

  document.getElementById('link').innerHTML =
    '<a href="' + data.url + '" target="_blank">' +
    data.url +
    '</a>';
}

socket.on('location', data => {

  const html =
    '<div class="card">' +
    '<b>ID:</b> ' + data.id + '<br>' +
    '<b>Lat:</b> ' + data.lat + '<br>' +
    '<b>Lng:</b> ' + data.lng + '<br>' +
    '<b>Time:</b> ' + new Date().toLocaleString() + '<br>' +
    '<a target="_blank" href="/history/' + data.id + '">History</a>' +
    '</div>';

  document.getElementById('locations').innerHTML =
    html + document.getElementById('locations').innerHTML;
});

</script>

</body>
</html>
`);

});

app.get("/new-link", (req, res) => {

const id = randomUUID();

const baseUrl =
process.env.BASE_URL ||
(req.protocol + "://" + req.get("host"));

res.json({
id,
url: baseUrl + "/track/" + id
});

});

app.get("/track/:id", (req, res) => {

const id = req.params.id;

res.send(`

<!DOCTYPE html>

<html>
<head>
<meta charset="utf-8">
<title>Share Location</title>
<style>
body{
  font-family:Arial;
  display:flex;
  justify-content:center;
  align-items:center;
  height:100vh;
  background:#f5f5f5;
}
.box{
  background:white;
  padding:20px;
  border-radius:10px;
}
</style>
</head>
<body>

<div class="box">
  <h2>Location Sharing Active</h2>
  <p id="status">Waiting for permission...</p>
</div>

<script src="/socket.io/socket.io.js"></script>

<script>

const socket = io();
const id = "${id}";

function sendLocation(){

  navigator.geolocation.getCurrentPosition(

    function(position){

      document.getElementById('status').innerText =
        'Location sent';

      socket.emit('location',{
        id:id,
        lat:position.coords.latitude,
        lng:position.coords.longitude
      });

    },

    function(){

      document.getElementById('status').innerText =
        'Permission denied';

    }

  );
}

sendLocation();

setInterval(sendLocation, 5000);

</script>

</body>
</html>
`);

});

io.on("connection", socket => {

socket.on("location", async data => {

```
try {

  await Location.create({
    linkId: data.id,
    lat: data.lat,
    lng: data.lng
  });

  io.emit("location", data);

} catch(err) {

  console.error(err);

}
```

});

});

app.get("/history/:id", async (req, res) => {

try {

```
const history = await Location.find({
  linkId: req.params.id
}).sort({ time: -1 });

res.json(history);
```

} catch(err) {

```
res.status(500).json({
  error: err.message
});
```

}

});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
console.log("Server running on port", PORT);
});
