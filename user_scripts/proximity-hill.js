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

var serverMods = [102255, 936457, 1];

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
// dont max out
const throttle = (func, limit) => {
  let lastFunc;
  let lastRan;
  return function () {
    const context = this;
    const args = arguments;
    if (!lastRan) {
      func.apply(context, args);
      lastRan = Date.now();
    } else {
      clearTimeout(lastFunc);
      lastFunc = setTimeout(function () {
        if (Date.now() - lastRan >= limit) {
          func.apply(context, args);
          lastRan = Date.now();
        }
      }, limit - (Date.now() - lastRan));
    }
  };
};

// track which users are connected
const users = [];

io.use((socket, next) => {
  if (socket.handshake.auth && socket.handshake.auth.token) {
    jwt.verify(
      socket.handshake.auth.token,
      `${env.JWT_SECRET}`,
      function (err, decoded) {
        if (err) {
          const err = new Error("Not authorized");
          err.data = {
            content:
              "Authorization error. Please reverify your account. If this continues, please contact support.",
          };

          socket.emit("error", err.data.content);
          return next(err);
        }

        var banStatus = db.get('banned_' + decoded.user)

        if(banStatus == true) {
          const err = new Error("Banned");
          err.data = {
            content:
              "You have been banned from the server. Please contact support.",
          };

          socket.emit("error", err.data.content);
          return next(err); 
        }

        socket.decoded = decoded;
        next();
      }
    );
  } else {
    const err = new Error("Not authorized");
    err.data = {
      content:
        "No credientials provided. Please reverify your account. If this continues, please contact support.",
    };
    socket.emit("error", err.data.content);
    next(err);
  }
});

// handle socket connection
io.on("connection", (socket) => {
  var id = socket.decoded.user;
  console.log('Successfully connected to socket (' + id + ')');
  var pos = { x: 0, y: 0 };
  let player = Game.players.find((player) => player.userId === parseInt(id));
  
  if (!player) {
    return socket.emit("error", "You are currently not connected to the game.");
    socket.disconnect(true);
  }

  if (users.find((user) => user.id === id)) {
    return socket.emit("error", "You are already connected to the voice channel.");
    socket.disconnect(true);
  }

  var pos = player.position
  users.push({ id, socket, pos, username: player.username });

  // tell user his or her id
  socket.emit("id", id);
  socket.emit("pos", -1, player.position);

  // tell the other users to connect to this user
  socket.broadcast.emit("join", id, pos, player.username);
  socket.emit(
    "players",
    users.filter((u) => u.id !== id).map((u) => ({ id: u.id, pos: u.pos, username: u.username }))
  );

  Game.newEvent = (name, callback) => {
    Game.on(name, callback);
    return {
      disconnect: () => Game.off(name, callback),
    };
  };

  player.newEvent = (name, callback) => {
    player.on(name, callback);
    return {
      disconnect: () => player.off(name, callback),
    };
  };

  const emitPos = throttle((x, y, z) => {
    socket.broadcast.emit("pos", id, { x, y, z });
    socket.emit('pos', -1, { x, y, z })
  }, 25);

  let movedEvent = player.newEvent("moved", (newPosition, newRotation) => {
    emitPos(newPosition.x, newPosition.y, newPosition.z);
  });

  let disconnectEvent = Game.newEvent("playerLeave", (player) => {
    if (player.userId == parseInt(id)) {
      disconnectEvent.disconnect();
      movedEvent.disconnect();

      const index = users.find((u) => u.id === '' + player.userId);

      if (index) {
        index.socket.disconnect();
        index.peer.socket.close();
        users.splice(index, 1);
        console.log('deleted')
      }
    }
  });

  // user disconnected
  socket.on("disconnect", () => {
    console.log("User has disconnected (id: " + id + ")");
    // let other users know to disconnect this client
    socket.broadcast.emit("leave", id);

    // rmeove user from events
    disconnectEvent.disconnect();
    movedEvent.disconnect();

    // remove the user from the users list
    const index = users.findIndex((u) => u.id === id);
    if (index !== -1) {
      users.splice(index, 1);
    }
  });
});

Game.command("globalmute", (caller, args) => {
  if (!serverMods.includes(caller.userId)) return

  for (let user of users) {
    if (user.username.startsWith(args)) {
      user.socket.emit("error", "You have been muted by a server moderator.")

      users.forEach((u) => {
        if(u.id == user.id) return
        caller.message("Successfully muted " + user.username)
        u.socket.emit('mute', user.id)
      })
    }
  }
})

peerServer.on("connection", (peer) => {
  console.log("peer connected", peer.id);
  var user = users.find((u) => u.id === peer.id);
  if (user) {
    user.peer = peer;
  }
  
});

peerServer.on("disconnect", (peer) => {
  console.log("peer disconnected", peer.id);
});

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

Game.command("ban", (caller, args) => {
  if (!serverMods.includes(caller.userId)) return

  for (let user of users) {
    if (user.username.startsWith(args)) {
        // use quick.db
        db.set(`banned_${player.userId}`, true)

        // check if they are in socket
        let player = Game.players.find((player) => player.userId === parseInt(id));

        if (user) {
          user.socket.emit("error", {
            content: "You have been banned from the server. Please contact support.",
          });
          user.socket.disconnect();
          user.peer.socket.close();
        }

        caller.message("Successfully banned " + player.username)
        return player.kick("You were banned by a moderator. If you would like to appeal your ban, please message klondike#6949 on Discord.");
    }
  }
}) 

Game.command("unban", (caller, args) => {
  if (!serverMods.includes(caller.userId)) return
  if(db.get(`banned_${args}`) == true) db.set(`banned_${args}`, false)
  caller.message("Successfully modified ban status of " + args)
})

Game.command("kick", (caller, args) => {  
  if (!serverMods.includes(caller.userId)) return

  for (let user of users) {
    if (user.username.startsWith(args)) {
        let player = Game.players.find((p) => p.userId === parseInt(user.id))

        if (user) {
          user.socket.emit("error", {
            content: "You have been kicked from the server.",
          });
          user.socket.disconnect();
          user.peer.socket.close();
        }

        caller.message("Successfully kicked " + player.username)
        if(player) player.kick("You were kicked by a moderator.");
    }
  }
})

Game.command("help", (caller, args) => {
  caller.message("Commands:")
  caller.message("/help - Shows this message.")
  caller.message("/ban {username} - Bans a user.")
  caller.message("/unban {userid} - Unbans a user.")
  caller.message("/kick {username} - Kicks a user.")
  caller.message("/globalmute {username} - Mutes all users.")
})
  
Game.on("playerJoin", (player) => {
  if(db.get(`banned_${player.userId}`)) {
    player.kick("You were banned by a moderator. If you would like to appeal your ban, please message klondike#6949 on Discord.");
  }

  if(serverMods.includes(player.userId)) {
    player.message("[#ff3d3d]You are server moderator. Do [#ffffff]/help [#ff3d3d]for a list of commands.")
  }
})

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
