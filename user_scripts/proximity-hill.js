// Web handling
const http = getModule("http");
var express = getModule("express");
// Parse Express data
var bodyParser = getModule("body-parser");
var cookieParser = getModule("cookie-parser");

const { ExpressPeerServer } = getModule("peer");
// Authorization
var jwt = getModule("jsonwebtoken");
var db = getModule("quick.db");
var fetch = getModule("node-fetch");
var env = getModule("config");
var app = express();
const server = http.createServer(app);
const io = getModule("socket.io")(server);

const peerjsWrapper = {
  on(event, callback) {
    if (event === "upgrade") {
      server.on("upgrade", (req, socket, head) => {
        if (!req.url.startsWith("/socket.io/")) callback(req, socket, head);
      });
    } else {
      server.on(...arguments);
    }
  },
};

const peerServer = ExpressPeerServer(peerjsWrapper);
app.use("/peerjs", peerServer);

app.use(
  express.static(__dirname + "/public/html", {
    extensions: ["html", "htm"],
  })
);
app.use(express.static(__dirname + "/public/css"));
app.use(express.static(__dirname + "/public/js"));

app.use(bodyParser.json());
app.use(cookieParser());

// Functions & consts
const decodeToken = (token) => {
  jwt.verify(token, `${env.JWT_SECRET}`, function (err, decoded) {
    if (err) {
      return err;
    } else if (decoded) {
      return decoded;
    } else {
      return "Unexpected error.";
    }
  });
};

const authenticateJWT = (req, res, next) => {
  const authHeader = req.cookies;
  console.log(authHeader);

  if (authHeader) {
    const token = authHeader.token;
    console.log(`Token: ${token}`);

    jwt.verify(token, `${env.JWT_SECRET}`, (err, user) => {
      if (err) {
        // console.log(err)
        return res.sendStatus(403);
      }

      req.user = user;
      next();
    });
  } else {
    res.sendStatus(401);
  }
};

const createToken = (user) => {
  return jwt.sign({ user }, `${env.JWT_SECRET}`, { expiresIn: "7d" });
};

// voice chat servers
// track which users are connected
const users = [];

function getCookie(cookie, name) {
  const value = `; ${cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(";").shift();
}

// handle socket connection
io.on("connection", (socket) => {
  var token = getCookie(socket.handshake.headers.cookie, "token");
  var decoded = jwt.decode(token);
  if (decoded == null) return socket.disconnect();
  var id = decoded.user;
  users.push({ id, socket });
  console.log("user connected", id);

  // tell user his or her id
  socket.emit("id", id);

  // tell the other users to connect to this user
  socket.broadcast.emit("join", id);

  // user disconnected
  socket.on("disconnect", () => {
    console.log("user disconnected", id);
    // let other users know to disconnect this client
    socket.broadcast.emit("leave", id);

    // remove the user from the users list
    const index = users.findIndex((u) => u.id === id);
    if (index !== -1) {
      users.splice(index, 1);
    }
  });
});

peerServer.on("connection", (peer) => {
  console.log("peer connected", peer.id);
});

peerServer.on("disconnect", (peer) => {
  console.log("peer disconnected", peer.id);
});

function createSocketListener(userid, type) {
  // createSocketListener('1', 'moved')

  let player = Game.players.find(
    (player) => player.playerId === parseInt(userid)
  );

  if (player) {
    player.newEvent = (name, callback) => {
      player.on(name, callback);
      return {
        disconnect: () => player.off(name, callback),
      };
    };

    let movedEvent = player.newEvent("moved", (newPosition, newRotation) => {
      let checkAlive = setInterval(function () {
        if (player.destroyed == true) {
          console.log("Disconnected move alive funtion for " + player.username);
          // disconnect their socket.io connection (none for you invis)
          clearInterval(checkAlive);
          movedEvent.disconnect();
        }
      }, 1000);
    });
  } else return "no user eixst bruh";
}

// delete later, dev only
app.get("/whoami", authenticateJWT, (req, res) => {
  var token = req.cookies.token;
  console.log(token);
  var decoded = jwt.decode(token);
  console.log(decoded);

  res.json({
    signedIn: true,
    decoded: decoded,
  });
});

var VALID_USERNAME = RegExp(/^[a-zA-Z0-9\-.\_ ]{1,26}$/);

app.post("/exist", async function (req, res) {
  if (!req.body.username)
    return res.status(400).json({
      error: "Missing parameters.",
      prettyMessage: "An error has occured.",
    });
  if (!VALID_USERNAME.test(req.body.username))
    return res.status(400).json({
      error:
        "Username must be 3-26 alphanumeric characters (including [ , ., -, _]).",
      prettyMessage: "An error has occured.",
    });
  await fetch(
    "https://api.brick-hill.com/v1/user/id?username=" + req.body.username
  )
    .then((res) => res.json())
    .then(async (json) => {
      if (json.error)
        return res.json({
          error: "User does not exist.",
          prettyMessage: "An error has occured.",
        });
      await res.status(200).json(json);
      console.log(json);
    });
});

Game.command("verify", (caller, message) => {
  var args = message.split(" ");
  var code = Math.floor(100000 + Math.random() * 900000);

  caller.message(
    `[#34b1eb][VC] [#ffffff]Your verification code is [#34b1eb]${code}[#ffffff].`
  );
  db.set(`${caller.userId}`, code);
  setTimeout(function () {
    if (db.get(`${caller.userId}`)) {
      db.delete(`${caller.userId}`);
      caller.message(
        "[#34b1eb][VC] [#ffffff]Your verification code has expired due to inactivity."
      );
    }
  }, 30 * 1000);
});

app.post("/auth", (req, res) => {
  console.log(req.body);
  if (!req.body.code || !req.body.userid)
    return res.status(400).json({
      error: "Missing parameters.",
      prettyMessage: "An error has occured.",
    });

  if (req.body.code == db.get(req.body.userid)) {
    var token = createToken(req.body.userid);
    res.json({ token: token });
    db.delete(req.body.userid);

    // createSocketListener(req.body.userid, "moved");
  } else {
    res.status(401).json({
      error: "Incorrect verification code.",
      prettyMessage: "An error has occured.",
    });
  }
});

server.listen(env.PORT, () =>
  console.log(`proximity-hill listening on port: ${env.PORT}.`)
);
